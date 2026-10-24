from django.db import models
from django.utils import timezone

from apps.expenses.models import Category, Expense, Merchant
from apps.shopping.models import PriceObservation, Product


class Receipt(models.Model):
    """A photographed receipt going through OCR → draft → confirm.

    OCR output is always a draft: confirming is the only way an Expense
    (and grocery PriceObservations) get created from it.
    """

    class Channel(models.TextChoices):
        WEB = "web", "Web"
        WHATSAPP = "whatsapp", "WhatsApp"

    class Status(models.TextChoices):
        UPLOADED = "uploaded", "Uploaded"
        PARSED = "parsed", "Parsed"
        AWAITING_CONFIRMATION = "awaiting_confirmation", "Awaiting confirmation"
        CONFIRMED = "confirmed", "Confirmed"
        CANCELLED = "cancelled", "Cancelled"
        FAILED = "failed", "Failed"

    image = models.ImageField(upload_to="receipts/%Y/%m/")
    uploaded_at = models.DateTimeField(auto_now_add=True)
    channel = models.CharField(max_length=20, choices=Channel.choices, default=Channel.WEB)
    wa_chat_id = models.CharField(max_length=100, blank=True)
    wa_message_id = models.CharField(max_length=100, blank=True)
    # Who sent the photo (resolved from the WhatsApp sender at upload time) —
    # carried onto the Expense at confirm, not re-resolved from who confirms it.
    spent_by = models.CharField(max_length=20, choices=Expense.SpentBy.choices, blank=True)

    ocr_text = models.TextField(blank=True)
    status = models.CharField(max_length=30, choices=Status.choices, default=Status.UPLOADED)

    # Parsed draft fields (nullable/blank until parsed).
    merchant_guess = models.CharField(max_length=120, blank=True)
    cnpj_guess = models.CharField(max_length=20, blank=True)
    date_guess = models.DateField(null=True, blank=True)
    total_guess = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    # [{description, quantity, unit_price, total_price}] — from Claude structuring.
    line_items = models.JSONField(default=list, blank=True)
    # Prefill for the review form: Groceries for itemized cupons, else alias match.
    suggested_category = models.ForeignKey(
        "expenses.Category", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # Set when this is a WhatsApp payment_receipt matched to a single pending Bill by
    # amount — confirming pays that Bill instead of creating a separate one-off Expense.
    matched_bill = models.ForeignKey(
        "bills.Bill", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-uploaded_at", "-id"]

    def __str__(self) -> str:
        return f"Receipt {self.pk} ({self.status})"

    def confirm(
        self,
        amount,
        date,
        category: Category,
        merchant: Merchant | None = None,
        description: str = "",
        price_items: list | None = None,
    ) -> Expense:
        """Create the ledger expense from this draft (idempotent)."""
        existing = Expense.objects.filter(receipt=self).first()
        if self.status == self.Status.CONFIRMED and existing:
            return existing

        occurred_at = timezone.make_aware(
            timezone.datetime(date.year, date.month, date.day, 12)
        )
        expense = Expense.objects.create(
            amount=amount,
            occurred_at=occurred_at,
            category=category,
            merchant=merchant,
            description=description or self.merchant_guess,
            kind=Expense.Kind.ONE_OFF,
            source=Expense.Source.RECEIPT,
            receipt=self,
        )

        if merchant and price_items:
            for item in price_items:
                product = Product.objects.filter(pk=item["product_id"]).first()
                if product is None:
                    continue
                PriceObservation.objects.create(
                    product=product,
                    merchant=merchant,
                    price=item["price"],
                    date=date,
                    source=PriceObservation.Source.RECEIPT,
                    receipt=self,
                )

        self.status = self.Status.CONFIRMED
        self.save(update_fields=["status", "updated_at"])
        return expense

    def cancel(self) -> None:
        if self.status != self.Status.CONFIRMED:
            self.status = self.Status.CANCELLED
            self.save(update_fields=["status", "updated_at"])
