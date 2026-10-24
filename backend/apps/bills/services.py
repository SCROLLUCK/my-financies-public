import calendar
from datetime import date
from decimal import Decimal

from django.utils import timezone

from apps.expenses.models import Expense

from .models import Bill, RecurringExpense

_REC_KIND = {
    RecurringExpense.Type.FIXED: Expense.Kind.FIXED,
    RecurringExpense.Type.SUBSCRIPTION: Expense.Kind.SUBSCRIPTION,
    RecurringExpense.Type.INSTALLMENT: Expense.Kind.INSTALLMENT,
}


def _month_charge(rec: RecurringExpense, year: int, mon: int, last_day: int):
    """(name, due_date) if the recurring charges in the given month, else None."""
    if rec.start_date and rec.start_date > date(year, mon, last_day):
        return None
    if rec.end_date and rec.end_date < date(year, mon, 1):
        return None
    if rec.cadence == RecurringExpense.Cadence.YEARLY and rec.start_date.month != mon:
        return None

    due_date = date(year, mon, min(rec.due_day, last_day))
    name = rec.name
    if rec.type == RecurringExpense.Type.INSTALLMENT and rec.installments:
        nth = (year - rec.start_date.year) * 12 + (mon - rec.start_date.month) + 1
        name = f"{rec.name} ({nth}/{rec.installments})"
    return name, due_date


def generate_bills(month: str | None = None) -> int:
    """Create Bills for active recurring expenses for a month (default: current).

    Idempotent: skips recurring entries that already have a bill in the month.
    Returns the number of bills created.
    """
    today = timezone.localdate()
    year, mon = today.year, today.month
    if month:
        year, mon = (int(x) for x in month.split("-"))

    last_day = calendar.monthrange(year, mon)[1]
    created = 0

    for rec in RecurringExpense.objects.filter(active=True):
        charge = _month_charge(rec, year, mon, last_day)
        if charge is None:
            continue

        exists = Bill.objects.filter(
            recurring=rec, due_date__year=year, due_date__month=mon
        ).exists()
        if exists:
            continue

        name, due_date = charge
        Bill.objects.create(
            name=name,
            amount=rec.amount,
            due_date=due_date,
            recurring=rec,
            category=rec.category,
        )
        created += 1

    return created


def project_bills(month: str) -> list[dict]:
    """Expected charges for a month, persisting nothing: pending bills already
    created for it plus what active recurring expenses would generate."""
    year, mon = (int(x) for x in month.split("-"))
    last_day = calendar.monthrange(year, mon)[1]
    items = []

    month_bills = Bill.objects.filter(
        due_date__year=year, due_date__month=mon
    ).select_related("category__topic", "recurring")
    for bill in month_bills:
        if bill.status == Bill.Status.PENDING:
            kind = (
                _REC_KIND[bill.recurring.type]
                if bill.recurring
                else Expense.Kind.ONE_OFF
            )
            items.append(
                {
                    "name": bill.name,
                    "amount": str(bill.amount),
                    "due_date": bill.due_date.isoformat(),
                    "kind": kind,
                    "category": bill.category,
                }
            )
    covered = {bill.recurring_id for bill in month_bills if bill.recurring_id}

    for rec in RecurringExpense.objects.filter(active=True).select_related(
        "category__topic"
    ):
        if rec.id in covered:
            continue
        charge = _month_charge(rec, year, mon, last_day)
        if charge is None:
            continue
        name, due_date = charge
        items.append(
            {
                "name": name,
                "amount": str(rec.amount),
                "due_date": due_date.isoformat(),
                "kind": _REC_KIND[rec.type],
                "category": rec.category,
            }
        )

    items.sort(key=lambda item: item["due_date"])
    return items


def sync_pending_bills(rec: RecurringExpense) -> None:
    """Re-align open bills after a recurring expense was edited.

    Pending bills from the current month on are dropped and regenerated with the
    new name/amount/due day (respecting active/start/end/cadence). Paid bills
    stay frozen.
    """
    first_of_month = timezone.localdate().replace(day=1)
    Bill.objects.filter(
        recurring=rec, status=Bill.Status.PENDING, due_date__gte=first_of_month
    ).delete()
    generate_bills()


def drop_pending_bills(rec: RecurringExpense) -> None:
    """Remove open bills before deleting a recurring expense (paid ones stay)."""
    Bill.objects.filter(recurring=rec, status=Bill.Status.PENDING).delete()


def match_pending_bill(amount: Decimal, payee_name: str = "") -> Bill | None:
    """Match a payment receipt's paid amount to a single pending bill.

    Amount-first: a bank receipt's paid amount is precise and reliable, while the
    payee text may not match a Bill's name verbatim. Any remaining ambiguity is left
    unmatched rather than guessed — the caller falls back to a plain one-off expense.
    """
    candidates = list(Bill.objects.filter(status=Bill.Status.PENDING, amount=amount))
    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1 and payee_name:
        payee_lower = payee_name.lower()
        narrowed = [
            b for b in candidates
            if payee_lower in b.name.lower() or b.name.lower() in payee_lower
        ]
        if len(narrowed) == 1:
            return narrowed[0]
    return None
