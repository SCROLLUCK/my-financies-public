from django.db import models
from django.utils import timezone

from apps.expenses.models import Category, Expense, Merchant


class RecurringExpense(models.Model):
    """Template for fixed expenses & subscriptions; generates Bills on a cadence."""

    class Type(models.TextChoices):
        FIXED = "fixed", "Fixed"
        SUBSCRIPTION = "subscription", "Subscription"
        INSTALLMENT = "installment", "Installment"

    class Cadence(models.TextChoices):
        MONTHLY = "monthly", "Monthly"
        YEARLY = "yearly", "Yearly"

    name = models.CharField(max_length=120)
    type = models.CharField(max_length=20, choices=Type.choices, default=Type.FIXED)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    cadence = models.CharField(max_length=20, choices=Cadence.choices, default=Cadence.MONTHLY)
    due_day = models.PositiveSmallIntegerField(default=1)
    category = models.ForeignKey(
        Category, on_delete=models.PROTECT, related_name="recurring_expenses"
    )
    merchant = models.ForeignKey(
        Merchant, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="recurring_expenses",
    )
    active = models.BooleanField(default=True)
    start_date = models.DateField(default=timezone.localdate)
    end_date = models.DateField(null=True, blank=True)
    # Card installment purchases: total number of installments; the first one
    # falls in start_date's month and end_date is derived (see serializer).
    installments = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Bill(models.Model):
    """A payable instance — answers 'did I pay it?'. Paying it creates an Expense."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PAID = "paid", "Paid"

    name = models.CharField(max_length=120)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    due_date = models.DateField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    paid_at = models.DateTimeField(null=True, blank=True)
    recurring = models.ForeignKey(
        RecurringExpense, on_delete=models.SET_NULL, null=True, blank=True, related_name="bills"
    )
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="bills")
    expense = models.OneToOneField(
        Expense, on_delete=models.SET_NULL, null=True, blank=True, related_name="bill"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["due_date"]

    def __str__(self):
        return f"{self.name} ({self.due_date})"

    @property
    def is_overdue(self) -> bool:
        return self.status == self.Status.PENDING and self.due_date < timezone.localdate()

    def pay(self) -> Expense:
        """Mark paid and create the corresponding ledger expense (idempotent)."""
        if self.status == self.Status.PAID and self.expense_id:
            return self.expense

        kind = Expense.Kind.ONE_OFF
        merchant = None
        if self.recurring:
            kind = {
                RecurringExpense.Type.FIXED: Expense.Kind.FIXED,
                RecurringExpense.Type.SUBSCRIPTION: Expense.Kind.SUBSCRIPTION,
                RecurringExpense.Type.INSTALLMENT: Expense.Kind.INSTALLMENT,
            }[self.recurring.type]
            merchant = self.recurring.merchant

        expense = Expense.objects.create(
            amount=self.amount,
            occurred_at=timezone.now(),
            category=self.category,
            merchant=merchant,
            description=self.name,
            kind=kind,
            source=Expense.Source.BILL,
        )
        self.expense = expense
        self.status = self.Status.PAID
        self.paid_at = timezone.now()
        self.save(update_fields=["expense", "status", "paid_at", "updated_at"])
        return expense

    def unpay(self) -> None:
        """Revert an accidental pay(): delete the ledger expense, back to pending
        (idempotent)."""
        if self.status == self.Status.PENDING:
            return

        if self.expense_id:
            self.expense.delete()
        self.expense = None
        self.status = self.Status.PENDING
        self.paid_at = None
        self.save(update_fields=["expense", "status", "paid_at", "updated_at"])


class IncomeSource(models.Model):
    """A recurring source of income (salary, freelance retainer, etc.) that
    feeds the expected-monthly-income baseline. end_date=None means ongoing/
    no limit."""

    name = models.CharField(max_length=120)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    end_date = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    @property
    def is_active(self) -> bool:
        return self.end_date is None or self.end_date >= timezone.localdate()
