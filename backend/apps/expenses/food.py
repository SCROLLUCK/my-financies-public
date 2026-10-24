import calendar
from datetime import date

from django.db.models import Sum
from django.db.models.functions import TruncMonth
from rest_framework.response import Response
from rest_framework.views import APIView

from .dashboard import _money, _month_bounds
from .models import Expense


def _shift_month(d: date, delta: int) -> date:
    """First day of the month `delta` months away from `d`'s month."""
    total = d.year * 12 + (d.month - 1) + delta
    return date(total // 12, total % 12 + 1, 1)


class FoodSummaryView(APIView):
    """Food spending: month total, split by category, and a monthly trend."""

    def get(self, request):
        first_day, last_day = _month_bounds(request.query_params.get("month"))
        try:
            months = int(request.query_params.get("months", 6))
        except (ValueError, TypeError):
            months = 6
        months = max(1, min(months, 24))

        food = Expense.objects.filter(category__topic__is_food=True)
        in_month = food.filter(
            occurred_at__date__gte=first_day, occurred_at__date__lte=last_day
        )

        total = _money(in_month.aggregate(t=Sum("amount"))["t"])

        by_category = [
            {
                "category_id": row["category__id"],
                "name": row["category__name"],
                "slug": row["category__slug"],
                "color": row["category__color"],
                "total": _money(row["total"]),
            }
            for row in in_month.values(
                "category__id", "category__name", "category__slug", "category__color"
            )
            .annotate(total=Sum("amount"))
            .order_by("-total")
        ]

        trend_start = _shift_month(first_day, -(months - 1))
        rows = (
            food.filter(
                occurred_at__date__gte=trend_start, occurred_at__date__lte=last_day
            )
            .annotate(m=TruncMonth("occurred_at"))
            .values("m", "category__id", "category__name")
            .annotate(total=Sum("amount"))
        )
        by_month: dict[str, list[dict]] = {}
        for row in rows:
            by_month.setdefault(row["m"].strftime("%Y-%m"), []).append(
                {
                    "category_id": row["category__id"],
                    "name": row["category__name"],
                    "total": _money(row["total"]),
                }
            )

        trend = []
        for i in range(months):
            month_key = _shift_month(trend_start, i).strftime("%Y-%m")
            cats = sorted(
                by_month.get(month_key, []), key=lambda c: c["total"], reverse=True
            )
            trend.append(
                {
                    "month": month_key,
                    "total": round(sum(c["total"] for c in cats), 2),
                    "by_category": cats,
                }
            )

        return Response(
            {
                "month": first_day.strftime("%Y-%m"),
                "total": total,
                "by_category": by_category,
                "trend": trend,
            }
        )
