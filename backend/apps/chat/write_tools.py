import datetime
from decimal import Decimal, InvalidOperation

from django.utils import timezone

from apps.bills.models import Bill
from apps.expenses import categorize
from apps.expenses.models import Category, Expense, Merchant
from apps.shopping.models import ShoppingList, ShoppingListItem

from .models import LastCaptureAction


def taxonomy_text() -> str:
    """Compact "Topic: Cat1, Cat2, ..." lines for the write-enabled system
    prompt, so the model can pick a real category instead of guessing."""
    by_topic: dict[str, list[str]] = {}
    for cat in Category.objects.select_related("topic").order_by("topic__order", "name"):
        by_topic.setdefault(cat.topic.name, []).append(cat.name)
    return "\n".join(f"{topic}: {', '.join(cats)}" for topic, cats in by_topic.items())


def _resolve_category(text: str) -> Category:
    alias_map = categorize.build_alias_map()
    return categorize.match(text, alias_map) or Category.objects.filter(
        slug="uncategorized"
    ).first()


def _resolve_merchant(name: str | None) -> Merchant | None:
    if not name:
        return None
    merchant, _ = Merchant.objects.get_or_create(
        name=name[:120], defaults={"kind": Merchant.Kind.OTHER}
    )
    return merchant


def register_expense(amount, category, date=None, description="", merchant=None, spent_by=""):
    try:
        amount = Decimal(str(amount))
        if amount <= 0:
            return {"error": "amount must be positive"}
    except InvalidOperation:
        return {"error": "invalid amount"}

    try:
        occurred_on = datetime.date.fromisoformat(date) if date else timezone.localdate()
    except ValueError:
        return {"error": "date must be YYYY-MM-DD"}

    resolved_category = _resolve_category(category or "")
    resolved_merchant = _resolve_merchant(merchant)

    expense = Expense.objects.create(
        amount=amount,
        occurred_at=timezone.make_aware(
            timezone.datetime(occurred_on.year, occurred_on.month, occurred_on.day, 12)
        ),
        category=resolved_category,
        merchant=resolved_merchant,
        description=description or "",
        kind=Expense.Kind.ONE_OFF,
        source=Expense.Source.WHATSAPP,
        spent_by=spent_by,
    )
    LastCaptureAction.objects.create(
        kind=LastCaptureAction.Kind.REGISTER_EXPENSE, object_id=expense.id
    )
    return {
        "created": True,
        "amount": float(expense.amount),
        "date": occurred_on.isoformat(),
        "category": resolved_category.name,
        "merchant": resolved_merchant.name if resolved_merchant else None,
        "description": expense.description,
    }


def mark_bill_paid(bill, spent_by=""):
    matches = list(Bill.objects.filter(status=Bill.Status.PENDING, name__icontains=bill)[:5])
    if not matches:
        return {"found": False}
    if len(matches) > 1:
        return {"found": False, "ambiguous": True, "candidates": [b.name for b in matches]}

    target = matches[0]
    expense = target.pay()
    if spent_by and expense.spent_by != spent_by:
        expense.spent_by = spent_by
        expense.save(update_fields=["spent_by"])
    LastCaptureAction.objects.create(
        kind=LastCaptureAction.Kind.MARK_BILL_PAID, object_id=target.id
    )
    return {
        "found": True,
        "bill": target.name,
        "amount": float(target.amount),
        "expense_id": expense.id,
    }


def add_shopping_item(name, list=None, quantity=None):
    active_lists = ShoppingList.objects.filter(status=ShoppingList.Status.ACTIVE)
    if list:
        active_lists = active_lists.filter(name__icontains=list)

    matches = active_lists[:5]
    count = len(matches)
    if count == 0:
        return {"created": False, "reason": "no_active_list"}
    if count > 1:
        return {
            "created": False,
            "reason": "ambiguous",
            "candidates": [sl.name for sl in matches],
        }

    target_list = matches[0]
    try:
        qty = Decimal(str(quantity)) if quantity is not None else Decimal("1")
    except InvalidOperation:
        qty = Decimal("1")

    item = ShoppingListItem.objects.create(list=target_list, name=name, quantity=qty)
    LastCaptureAction.objects.create(
        kind=LastCaptureAction.Kind.ADD_SHOPPING_ITEM, object_id=item.id
    )
    return {"created": True, "list": target_list.name, "name": item.name}


def undo_last():
    action = LastCaptureAction.objects.first()
    if action is None:
        return {"undone": False, "reason": "nothing_to_undo"}

    if action.kind == LastCaptureAction.Kind.REGISTER_EXPENSE:
        Expense.objects.filter(pk=action.object_id).delete()
    elif action.kind == LastCaptureAction.Kind.MARK_BILL_PAID:
        bill = Bill.objects.filter(pk=action.object_id).first()
        if bill:
            bill.unpay()
    elif action.kind == LastCaptureAction.Kind.ADD_SHOPPING_ITEM:
        ShoppingListItem.objects.filter(pk=action.object_id).delete()

    kind = action.kind
    action.delete()
    return {"undone": True, "kind": kind}


WRITE_TOOLS = [
    {
        "name": "register_expense",
        "description": (
            "Create a one-off expense from a free-form message like 'gastei 45,50 no ifood "
            "ontem'. Always echo back what was recorded (amount, category, date) after calling."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "amount": {"type": "number", "description": "The expense amount in BRL."},
                "category": {
                    "type": "string",
                    "description": "Best-matching category name from the taxonomy given in context.",
                },
                "date": {
                    "type": "string",
                    "description": "YYYY-MM-DD. Defaults to today if the message doesn't say otherwise.",
                },
                "description": {"type": "string", "description": "Short free-text note, optional."},
                "merchant": {"type": "string", "description": "Merchant/store name, optional."},
            },
            "required": ["amount", "category"],
        },
    },
    {
        "name": "mark_bill_paid",
        "description": (
            "Mark a pending bill as paid, matched by (partial) name, e.g. 'paguei a conta de luz'. "
            "If the result is ambiguous or not found, ask the user instead of guessing."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "bill": {"type": "string", "description": "Bill name or partial name."},
            },
            "required": ["bill"],
        },
    },
    {
        "name": "add_shopping_item",
        "description": (
            "Add an item to an active shopping list, e.g. 'põe leite na lista'. If there's no "
            "active list or more than one, ask the user instead of guessing which one."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Item name, e.g. 'leite'."},
                "list": {
                    "type": "string",
                    "description": "Target list name or partial name, if the user specified one.",
                },
                "quantity": {"type": "number", "description": "Quantity, defaults to 1."},
            },
            "required": ["name"],
        },
    },
    {
        "name": "undo_last",
        "description": (
            "Revert the last write skill (register_expense/mark_bill_paid/add_shopping_item) "
            "invoked in this conversation, e.g. when the user says 'desfazer'."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
]

DISPATCH = {
    "register_expense": register_expense,
    "mark_bill_paid": mark_bill_paid,
    "add_shopping_item": add_shopping_item,
    "undo_last": undo_last,
}
