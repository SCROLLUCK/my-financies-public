from datetime import timedelta

from django.db import models
from django.utils import timezone

from apps.expenses.models import Category, Expense, Income

# How far apart a statement line's posting date and a receipt/manual expense's
# date can be and still be considered the same real-world purchase — bank
# posting dates commonly lag the actual purchase by a day or two.
DUPLICATE_MATCH_WINDOW_DAYS = 3


class StatementImport(models.Model):
    """One uploaded bank/card statement file (.ofx or .csv)."""

    class Format(models.TextChoices):
        OFX = "ofx", "OFX"
        CSV = "csv", "CSV"

    file = models.FileField(upload_to="statements/%Y/%m/")
    original_name = models.CharField(max_length=255, blank=True)
    format = models.CharField(max_length=10, choices=Format.choices)
    bank = models.CharField(max_length=120, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    transactions_found = models.PositiveIntegerField(default=0)
    duplicates_skipped = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-uploaded_at", "-id"]

    def __str__(self) -> str:
        return f"{self.original_name or self.file.name} ({self.format})"


class StatementTransaction(models.Model):
    """A single statement line awaiting the user's decision."""

    class Direction(models.TextChoices):
        IN = "in", "Credit"
        OUT = "out", "Debit"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        IMPORTED = "imported", "Imported"
        SKIPPED = "skipped", "Skipped"

    statement = models.ForeignKey(
        StatementImport, on_delete=models.CASCADE, related_name="transactions"
    )
    # OFX FITID, or a synthetic hash for CSVs — dedupes across re-imports.
    fitid = models.CharField(max_length=120, unique=True)
    date = models.DateField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)  # absolute value
    direction = models.CharField(max_length=5, choices=Direction.choices)
    name = models.CharField(max_length=255, blank=True)
    memo = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    suggested_category = models.ForeignKey(
        Category, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    expense = models.OneToOneField(
        Expense,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="statement_transaction",
    )
    income = models.OneToOneField(
        Income,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="statement_transaction",
    )

    class Meta:
        ordering = ["-date", "-id"]

    def __str__(self) -> str:
        return f"{self.date} {self.name} {self.amount}"

    def find_possible_duplicate_expense(self) -> Expense | None:
        """An existing (non-import) expense that this statement line might
        already be accounted for by — same amount, date within a few days.
        Debits only; never guesses, just surfaces a candidate for the user."""
        if self.direction != self.Direction.OUT:
            return None
        window_start = self.date - timedelta(days=DUPLICATE_MATCH_WINDOW_DAYS)
        window_end = self.date + timedelta(days=DUPLICATE_MATCH_WINDOW_DAYS)
        return (
            Expense.objects.exclude(source=Expense.Source.OPEN_FINANCE)
            .filter(
                amount=self.amount,
                occurred_at__date__gte=window_start,
                occurred_at__date__lte=window_end,
            )
            .order_by("occurred_at")
            .first()
        )

    def link_to_expense(self, expense: Expense) -> Expense:
        """Mark this line as already accounted for by an existing expense
        (e.g. one created from a receipt) instead of creating a duplicate."""
        self.expense = expense
        self.status = self.Status.IMPORTED
        self.save(update_fields=["expense", "status"])
        return expense

    def import_as_expense(self, category: Category, description: str = "") -> Expense:
        """Create the ledger expense for this line (idempotent)."""
        if self.expense_id:
            return self.expense
        occurred_at = timezone.make_aware(
            timezone.datetime(self.date.year, self.date.month, self.date.day, 12)
        )
        expense = Expense.objects.create(
            amount=self.amount,
            occurred_at=occurred_at,
            category=category,
            description=description or self.name or self.memo,
            kind=Expense.Kind.ONE_OFF,
            source=Expense.Source.OPEN_FINANCE,
        )
        self.expense = expense
        self.status = self.Status.IMPORTED
        self.save(update_fields=["expense", "status"])
        return expense

    def import_as_income(self, description: str = "") -> Income:
        """Create a ledger income for this credit line (idempotent)."""
        if self.income_id:
            return self.income
        occurred_at = timezone.make_aware(
            timezone.datetime(self.date.year, self.date.month, self.date.day, 12)
        )
        income = Income.objects.create(
            amount=self.amount,
            occurred_at=occurred_at,
            description=description or self.name or self.memo,
            source=Income.Source.OPEN_FINANCE,
        )
        self.income = income
        self.status = self.Status.IMPORTED
        self.save(update_fields=["income", "status"])
        return income
