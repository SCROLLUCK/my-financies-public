from django.db import models
from django.utils import timezone


class Topic(models.Model):
    """Level-1 classification (e.g. Food, Vehicle). Expenses roll up to a topic for charts."""

    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(max_length=80, unique=True)
    is_food = models.BooleanField(default=False)
    color = models.CharField(max_length=32, blank=True)
    icon = models.CharField(max_length=64, blank=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "name"]

    def __str__(self):
        return self.name


class Category(models.Model):
    """Level-2 leaf. Everything is classified here; the topic is derived via ``topic``."""

    topic = models.ForeignKey(Topic, on_delete=models.PROTECT, related_name="categories")
    name = models.CharField(max_length=80)
    slug = models.SlugField(max_length=80, unique=True)
    aliases = models.JSONField(default=list, blank=True)
    color = models.CharField(max_length=32, blank=True)
    icon = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["topic__order", "name"]
        verbose_name_plural = "categories"

    def __str__(self):
        return f"{self.topic.name} / {self.name}"


class Merchant(models.Model):
    class Kind(models.TextChoices):
        GROCERY = "grocery", "Grocery"
        RESTAURANT = "restaurant", "Restaurant"
        IFOOD = "ifood", "iFood"
        DELIVERY = "delivery", "Delivery"
        UTILITY = "utility", "Utility"
        SERVICE = "service", "Service"
        OTHER = "other", "Other"

    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.OTHER)
    cnpj = models.CharField(max_length=18, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Expense(models.Model):
    """The ledger: money that left the pocket. Source of truth for spending."""

    class Kind(models.TextChoices):
        FIXED = "fixed", "Fixed"
        SUBSCRIPTION = "subscription", "Subscription"
        INSTALLMENT = "installment", "Installment"
        ONE_OFF = "one_off", "One-off"

    class Source(models.TextChoices):
        MANUAL = "manual", "Manual"
        BILL = "bill", "Bill"
        RECEIPT = "receipt", "Receipt"
        WHATSAPP = "whatsapp", "WhatsApp"
        OPEN_FINANCE = "open_finance", "Open Finance"

    class SpentBy(models.TextChoices):
        OWNER = "owner", "Owner"
        PARTNER = "partner", "Partner"

    amount = models.DecimalField(max_digits=12, decimal_places=2)
    occurred_at = models.DateTimeField(default=timezone.now)
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="expenses")
    merchant = models.ForeignKey(
        Merchant, on_delete=models.SET_NULL, null=True, blank=True, related_name="expenses"
    )
    description = models.CharField(max_length=255, blank=True)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.ONE_OFF)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.MANUAL)
    # Who incurred it (the owner and a partner share the ledger) — optional, auto-filled from
    # the WhatsApp sender when detectable, editable otherwise. Blank = unspecified.
    spent_by = models.CharField(max_length=20, choices=SpentBy.choices, blank=True)
    receipt = models.ForeignKey(
        "receipts.Receipt",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-occurred_at", "-id"]

    def __str__(self):
        return f"{self.occurred_at} {self.amount} {self.category}"


class Income(models.Model):
    """Money coming into the account (salary, refunds, received transfers).

    Kept separate from Expense so spending aggregations stay pure sums.
    """

    class Source(models.TextChoices):
        MANUAL = "manual", "Manual"
        OPEN_FINANCE = "open_finance", "Open Finance"

    amount = models.DecimalField(max_digits=12, decimal_places=2)
    occurred_at = models.DateTimeField(default=timezone.now)
    description = models.CharField(max_length=255, blank=True)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.MANUAL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-occurred_at", "-id"]

    def __str__(self):
        return f"+{self.amount} {self.description}"
