from decimal import Decimal

from django.db import models
from django.utils import timezone

from apps.expenses.models import Category, Expense, Merchant


class Product(models.Model):
    """A normalized product for price tracking, e.g. "Milk, whole, 1L"."""

    name = models.CharField(max_length=120)
    unit = models.CharField(max_length=20, blank=True)  # "1L", "1kg", "un"
    category = models.ForeignKey(
        Category,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="products",
    )

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.unit})" if self.unit else self.name


class PriceObservation(models.Model):
    """A price seen for a product at a store on a date."""

    class Source(models.TextChoices):
        MANUAL = "manual", "Manual"
        RECEIPT = "receipt", "Receipt"  # Receipt FK arrives in Phase 3

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="prices")
    merchant = models.ForeignKey(
        Merchant, on_delete=models.CASCADE, related_name="price_observations"
    )
    price = models.DecimalField(max_digits=12, decimal_places=2)
    date = models.DateField(default=timezone.localdate)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.MANUAL)
    receipt = models.ForeignKey(
        "receipts.Receipt",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="price_observations",
    )

    class Meta:
        ordering = ["-date", "-id"]

    def __str__(self) -> str:
        return f"{self.product} @ {self.merchant}: {self.price} on {self.date}"


class ShoppingList(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        COMPLETED = "completed", "Completed"
        ARCHIVED = "archived", "Archived"

    name = models.CharField(max_length=120)
    store = models.ForeignKey(
        Merchant,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="shopping_lists",
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.name

    def complete(self) -> None:
        """Mark completed (idempotent)."""
        if self.status != self.Status.COMPLETED:
            self.status = self.Status.COMPLETED
            self.completed_at = timezone.now()
            self.save(update_fields=["status", "completed_at"])


class ShoppingListItem(models.Model):
    list = models.ForeignKey(ShoppingList, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(
        Product, on_delete=models.SET_NULL, null=True, blank=True
    )
    name = models.CharField(max_length=120, blank=True)  # serializer defaults from product
    quantity = models.DecimalField(max_digits=8, decimal_places=3, default=Decimal("1"))
    unit = models.CharField(max_length=20, blank=True)
    checked = models.BooleanField(default=False)
    checked_at = models.DateTimeField(null=True, blank=True)
    paid_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    note = models.CharField(max_length=255, blank=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self) -> str:
        return self.name

    def check_off(self, paid_price=None) -> None:
        """Check the item; with a paid price, a linked product and a list store,
        also record a PriceObservation."""
        self.checked = True
        self.checked_at = timezone.now()
        self.paid_price = paid_price
        self.save(update_fields=["checked", "checked_at", "paid_price"])
        if paid_price is not None and self.product_id and self.list.store_id:
            PriceObservation.objects.create(
                product=self.product,
                merchant=self.list.store,
                price=paid_price,
                date=timezone.localdate(),
                source=PriceObservation.Source.MANUAL,
            )

    def uncheck(self) -> None:
        self.checked = False
        self.checked_at = None
        self.paid_price = None
        self.save(update_fields=["checked", "checked_at", "paid_price"])


class PlannedPurchase(models.Model):
    """A future purchase being considered; never counts as spend until purchased."""

    class Priority(models.TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"

    class Status(models.TextChoices):
        PLANNED = "planned", "Planned"
        PURCHASED = "purchased", "Purchased"
        DROPPED = "dropped", "Dropped"

    name = models.CharField(max_length=120)
    estimated_cost = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    priority = models.CharField(
        max_length=20, choices=Priority.choices, default=Priority.MEDIUM
    )
    category = models.ForeignKey(
        Category,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="planned_purchases",
    )
    target_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    url = models.URLField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PLANNED)
    expense = models.OneToOneField(
        Expense,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="planned_purchase",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    purchased_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.name

    def purchase(self, amount, category=None) -> Expense:
        """Mark purchased and create the ledger expense (idempotent)."""
        if self.status == self.Status.PURCHASED and self.expense_id:
            return self.expense
        category = category or self.category
        if category is None:
            raise ValueError("A category is required to record the expense.")
        expense = Expense.objects.create(
            amount=amount,
            occurred_at=timezone.now(),
            category=category,
            description=self.name,
            kind=Expense.Kind.ONE_OFF,
            source=Expense.Source.MANUAL,
        )
        self.expense = expense
        self.category = category
        self.status = self.Status.PURCHASED
        self.purchased_at = timezone.now()
        self.save(update_fields=["expense", "category", "status", "purchased_at"])
        return expense
