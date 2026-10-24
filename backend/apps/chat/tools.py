import calendar
from datetime import date
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from apps.bills.models import Bill, RecurringExpense
from apps.expenses.models import Expense
from apps.shopping.models import PriceObservation, Product

from . import sql_tool

# Food split -> Category.slug (see docs/DATA_MODEL.md taxonomy).
FOOD_SPLIT_SLUGS = {"ifood": "ifooddelivery", "groceries": "groceries", "dining": "restaurant"}

PERIOD_PROPERTIES = {
    "month": {
        "type": "string",
        "description": "Month as YYYY-MM. Defaults to the current month when no period is given.",
    },
    "date_from": {
        "type": "string",
        "description": "Range start date, YYYY-MM-DD. Use with date_to instead of month for an arbitrary range.",
    },
    "date_to": {
        "type": "string",
        "description": "Range end date, YYYY-MM-DD.",
    },
}


def _resolve_period(month: str | None, date_from: str | None, date_to: str | None) -> tuple[date, date]:
    """A date range from either month=YYYY-MM or date_from/date_to; defaults to
    the current month when nothing is given."""
    if date_from or date_to:
        try:
            start = date.fromisoformat(date_from) if date_from else date.min
            end = date.fromisoformat(date_to) if date_to else timezone.localdate()
            return start, end
        except ValueError:
            pass

    today = timezone.localdate()
    year, mon = today.year, today.month
    if month:
        try:
            year, mon = (int(x) for x in month.split("-"))
        except (ValueError, TypeError):
            pass
    last_day = calendar.monthrange(year, mon)[1]
    return date(year, mon, 1), date(year, mon, last_day)


def _money(value) -> float:
    return float(value or Decimal("0"))


def get_spending_summary(month=None, date_from=None, date_to=None, group_by="none"):
    start, end = _resolve_period(month, date_from, date_to)
    qs = Expense.objects.filter(occurred_at__date__gte=start, occurred_at__date__lte=end)
    total = _money(qs.aggregate(t=Sum("amount"))["t"])

    breakdown = []
    if group_by == "topic":
        rows = qs.values("category__topic__name").annotate(total=Sum("amount")).order_by("-total")
        breakdown = [{"name": r["category__topic__name"], "total": _money(r["total"])} for r in rows]
    elif group_by == "category":
        rows = qs.values("category__name").annotate(total=Sum("amount")).order_by("-total")
        breakdown = [{"name": r["category__name"], "total": _money(r["total"])} for r in rows]
    elif group_by == "merchant":
        rows = (
            qs.exclude(merchant__isnull=True)
            .values("merchant__name")
            .annotate(total=Sum("amount"))
            .order_by("-total")[:20]
        )
        breakdown = [{"name": r["merchant__name"], "total": _money(r["total"])} for r in rows]
    elif group_by == "day":
        rows = qs.values("occurred_at__date").annotate(total=Sum("amount")).order_by("occurred_at__date")
        breakdown = [{"date": r["occurred_at__date"].isoformat(), "total": _money(r["total"])} for r in rows]

    return {
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "total": total,
        "group_by": group_by,
        "breakdown": breakdown,
    }


def get_biggest_expense(month=None, date_from=None, date_to=None):
    start, end = _resolve_period(month, date_from, date_to)
    expense = (
        Expense.objects.filter(occurred_at__date__gte=start, occurred_at__date__lte=end)
        .select_related("category__topic", "merchant")
        .order_by("-amount")
        .first()
    )
    period = {"from": start.isoformat(), "to": end.isoformat()}
    if not expense:
        return {"period": period, "expense": None}
    return {
        "period": period,
        "expense": {
            "amount": _money(expense.amount),
            "date": expense.occurred_at.date().isoformat(),
            "category": expense.category.name,
            "topic": expense.category.topic.name,
            "merchant": expense.merchant.name if expense.merchant else None,
            "description": expense.description,
        },
    }


def get_food_spending(month=None, date_from=None, date_to=None, split=None):
    start, end = _resolve_period(month, date_from, date_to)
    qs = Expense.objects.filter(
        category__topic__is_food=True,
        occurred_at__date__gte=start,
        occurred_at__date__lte=end,
    )
    slug = FOOD_SPLIT_SLUGS.get(split or "")
    if slug:
        qs = qs.filter(category__slug=slug)

    total = _money(qs.aggregate(t=Sum("amount"))["t"])
    rows = qs.values("category__name").annotate(total=Sum("amount")).order_by("-total")
    return {
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "split": split,
        "total": total,
        "by_category": [{"name": r["category__name"], "total": _money(r["total"])} for r in rows],
    }


def list_expenses(
    month=None,
    date_from=None,
    date_to=None,
    topic=None,
    category=None,
    merchant=None,
    kind=None,
    min_amount=None,
    max_amount=None,
    sort="amount_desc",
    limit=10,
):
    """Individual expense rows matching filters, sorted and capped — the general-
    purpose lookup for anything the fixed aggregate tools don't cover: 'top 10
    expenses', 'expenses over R$200', 'what did I buy at X', etc."""
    start, end = _resolve_period(month, date_from, date_to)
    qs = Expense.objects.filter(
        occurred_at__date__gte=start, occurred_at__date__lte=end
    ).select_related("category__topic", "merchant")

    if topic:
        qs = qs.filter(category__topic__name__icontains=topic)
    if category:
        qs = qs.filter(category__name__icontains=category)
    if merchant:
        qs = qs.filter(merchant__name__icontains=merchant)
    if kind:
        qs = qs.filter(kind=kind)
    if min_amount is not None:
        qs = qs.filter(amount__gte=min_amount)
    if max_amount is not None:
        qs = qs.filter(amount__lte=max_amount)

    order = {
        "amount_desc": "-amount",
        "amount_asc": "amount",
        "date_desc": "-occurred_at",
        "date_asc": "occurred_at",
    }.get(sort, "-amount")
    qs = qs.order_by(order)

    total_matches = qs.count()
    limit = max(1, min(int(limit or 10), 50))
    rows = qs[:limit]

    return {
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "filters": {
            "topic": topic, "category": category, "merchant": merchant,
            "kind": kind, "min_amount": min_amount, "max_amount": max_amount,
        },
        "sort": sort,
        "total_matches": total_matches,
        "returned": len(rows),
        "expenses": [
            {
                "amount": _money(e.amount),
                "date": e.occurred_at.date().isoformat(),
                "topic": e.category.topic.name,
                "category": e.category.name,
                "merchant": e.merchant.name if e.merchant else None,
                "description": e.description,
                "kind": e.kind,
            }
            for e in rows
        ],
    }


def list_subscriptions(active_only=True):
    qs = RecurringExpense.objects.filter(type=RecurringExpense.Type.SUBSCRIPTION)
    if active_only:
        qs = qs.filter(active=True)

    items = []
    monthly_total = 0.0
    for rec in qs.select_related("category"):
        monthly_amount = _money(rec.amount)
        if rec.cadence == RecurringExpense.Cadence.YEARLY:
            monthly_amount /= 12
        monthly_total += monthly_amount
        items.append(
            {
                "name": rec.name,
                "amount": _money(rec.amount),
                "cadence": rec.cadence,
                "monthly_equivalent": round(monthly_amount, 2),
                "category": rec.category.name,
                "active": rec.active,
            }
        )
    return {"subscriptions": items, "monthly_total": round(monthly_total, 2)}


def get_bill_status(query):
    bills = Bill.objects.filter(name__icontains=query).select_related("category").order_by("-due_date")[:5]
    return {
        "query": query,
        "bills": [
            {
                "name": b.name,
                "amount": _money(b.amount),
                "due_date": b.due_date.isoformat(),
                "status": b.status,
                "paid_at": b.paid_at.isoformat() if b.paid_at else None,
                "is_overdue": b.is_overdue,
            }
            for b in bills
        ],
    }


def get_cheapest_store(product):
    products = Product.objects.filter(name__icontains=product)
    if not products.exists():
        return {"product": product, "found": False}

    # Latest observation per merchant, across every matching product.
    latest_by_merchant = {}
    observations = (
        PriceObservation.objects.filter(product__in=products)
        .select_related("merchant", "product")
        .order_by("merchant_id", "-date")
    )
    for obs in observations:
        latest_by_merchant.setdefault(obs.merchant_id, obs)

    if not latest_by_merchant:
        return {"product": product, "found": False}

    ranked = sorted(latest_by_merchant.values(), key=lambda o: o.price)
    cheapest = ranked[0]
    return {
        "product": product,
        "found": True,
        "cheapest": {
            "merchant": cheapest.merchant.name,
            "price": _money(cheapest.price),
            "date": cheapest.date.isoformat(),
            "product_name": cheapest.product.name,
        },
        "all_stores": [
            {"merchant": o.merchant.name, "price": _money(o.price), "date": o.date.isoformat()}
            for o in ranked
        ],
    }


def run_sql_query(query):
    return sql_tool.run_query(query)


def get_price_history(product):
    products = Product.objects.filter(name__icontains=product)
    if not products.exists():
        return {"product": product, "found": False}

    observations = (
        PriceObservation.objects.filter(product__in=products)
        .select_related("merchant", "product")
        .order_by("-date")[:20]
    )
    return {
        "product": product,
        "found": True,
        "history": [
            {
                "product_name": o.product.name,
                "merchant": o.merchant.name,
                "price": _money(o.price),
                "date": o.date.isoformat(),
            }
            for o in observations
        ],
    }


TOOLS = [
    {
        "name": "get_spending_summary",
        "description": (
            "Total spending for a period, optionally broken down by topic, category, "
            "merchant, or day. Use for 'how much did I spend', 'spend by category', "
            "'spend per day'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                **PERIOD_PROPERTIES,
                "group_by": {
                    "type": "string",
                    "enum": ["none", "topic", "category", "merchant", "day"],
                    "description": "How to break down the total. 'none' for just the total.",
                },
            },
        },
    },
    {
        "name": "get_biggest_expense",
        "description": "The single largest expense in a period. Use for 'biggest expense this month'.",
        "input_schema": {"type": "object", "properties": PERIOD_PROPERTIES},
    },
    {
        "name": "get_food_spending",
        "description": (
            "Food spending for a period, optionally split into 'ifood' (delivery), "
            "'groceries', or 'dining' (restaurants)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                **PERIOD_PROPERTIES,
                "split": {
                    "type": "string",
                    "enum": ["ifood", "groceries", "dining"],
                    "description": "Optional: narrow to one food category.",
                },
            },
        },
    },
    {
        "name": "list_expenses",
        "description": (
            "List individual expenses matching filters, sorted and capped to a limit. "
            "The general-purpose lookup: use this for 'top N expenses', 'expenses over "
            "R$X', 'what did I buy from <merchant>', 'smallest expenses', or anything "
            "else get_spending_summary / get_biggest_expense can't answer, since those "
            "only return totals or the single largest row."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                **PERIOD_PROPERTIES,
                "topic": {"type": "string", "description": "Filter by topic name (partial match)."},
                "category": {"type": "string", "description": "Filter by category name (partial match)."},
                "merchant": {"type": "string", "description": "Filter by merchant name (partial match)."},
                "kind": {
                    "type": "string",
                    "enum": ["fixed", "subscription", "installment", "one_off"],
                    "description": "Filter by expense kind.",
                },
                "min_amount": {"type": "number", "description": "Only expenses >= this amount."},
                "max_amount": {"type": "number", "description": "Only expenses <= this amount."},
                "sort": {
                    "type": "string",
                    "enum": ["amount_desc", "amount_asc", "date_desc", "date_asc"],
                    "description": "Sort order. Defaults to amount_desc (biggest first).",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max rows to return, 1-50. Defaults to 10.",
                },
            },
        },
    },
    {
        "name": "list_subscriptions",
        "description": "Active subscriptions and their combined monthly total.",
        "input_schema": {
            "type": "object",
            "properties": {
                "active_only": {
                    "type": "boolean",
                    "description": "If false, also include cancelled/inactive subscriptions. Defaults to true.",
                },
            },
        },
    },
    {
        "name": "get_bill_status",
        "description": "Find bills by (partial) name and their payment status. Use for 'did I pay the internet boleto?'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Bill name or partial name to search for."},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_cheapest_store",
        "description": "The store with the lowest latest price for a product. Use for 'where is milk cheapest?'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "product": {"type": "string", "description": "Product name or partial name."},
            },
            "required": ["product"],
        },
    },
    {
        "name": "get_price_history",
        "description": "Price points over time for a product, most recent first.",
        "input_schema": {
            "type": "object",
            "properties": {
                "product": {"type": "string", "description": "Product name or partial name."},
            },
            "required": ["product"],
        },
    },
    {
        "name": "run_sql_query",
        "description": (
            "Last resort: run one read-only PostgreSQL SELECT against the app database "
            "for questions no other tool covers. Read-only — INSERT/UPDATE/DELETE/DDL/etc. "
            "are rejected, and every query runs inside a rolled-back transaction, so it "
            "cannot change any data. Automatically capped at 200 rows.\n\n"
            "Prefer the typed tools above when one fits — they're cheaper and less error-"
            "prone. Use this one for genuinely uncovered shapes (e.g. joining across "
            "several tables, or an aggregate the other tools don't expose).\n\n"
            "Tables and columns (name(column, column, ...)):\n" + sql_tool.schema_text()
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "A single PostgreSQL SELECT statement (or WITH ... SELECT).",
                },
            },
            "required": ["query"],
        },
    },
]

DISPATCH = {
    "get_spending_summary": get_spending_summary,
    "get_biggest_expense": get_biggest_expense,
    "list_expenses": list_expenses,
    "get_food_spending": get_food_spending,
    "list_subscriptions": list_subscriptions,
    "get_bill_status": get_bill_status,
    "get_cheapest_store": get_cheapest_store,
    "get_price_history": get_price_history,
    "run_sql_query": run_sql_query,
}


def run_tool(name: str, tool_input: dict, extra_dispatch: dict | None = None) -> dict:
    fn = (extra_dispatch or {}).get(name) or DISPATCH.get(name)
    if fn is None:
        return {"error": f"Unknown tool: {name}"}
    try:
        return fn(**tool_input)
    except TypeError as e:
        return {"error": f"Invalid arguments for {name}: {e}"}
