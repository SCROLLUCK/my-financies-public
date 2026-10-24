import calendar
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.bills.models import Bill
from apps.bills.serializers import BillSerializer
from apps.bills.services import generate_bills

from .models import Expense


def _month_bounds(month: str | None):
    """Return (first_day, last_day) for a 'YYYY-MM' string, defaulting to the current month."""
    today = timezone.localdate()
    year, mon = today.year, today.month
    if month:
        try:
            year, mon = (int(x) for x in month.split("-"))
        except (ValueError, TypeError):
            pass
    last = calendar.monthrange(year, mon)[1]
    return date(year, mon, 1), date(year, mon, last)


def _money(value) -> float:
    return float(value or Decimal("0"))


class DashboardView(APIView):
    """Monthly overview: total so far, spend by topic, spend per day, upcoming bills."""

    def get(self, request):
        # Materialize the current month's bills so "upcoming" is always fresh.
        generate_bills()
        first_day, last_day = _month_bounds(request.query_params.get("month"))
        today = timezone.localdate()
        # "So far": current month up to today; past months, the whole month.
        end = min(today, last_day)

        in_month = Expense.objects.filter(
            occurred_at__date__gte=first_day, occurred_at__date__lte=end
        )

        total_so_far = _money(in_month.aggregate(t=Sum("amount"))["t"])

        # Previous month (whole).
        prev_first = (first_day - timedelta(days=1)).replace(day=1)
        prev_month_total = _money(
            Expense.objects.filter(
                occurred_at__date__gte=prev_first, occurred_at__date__lt=first_day
            ).aggregate(t=Sum("amount"))["t"]
        )

        by_topic = [
            {
                "topic_id": row["category__topic__id"],
                "name": row["category__topic__name"],
                "color": row["category__topic__color"],
                "total": _money(row["total"]),
            }
            for row in in_month.values(
                "category__topic__id",
                "category__topic__name",
                "category__topic__color",
            )
            .annotate(total=Sum("amount"))
            .order_by("-total")
        ]

        by_category = [
            {
                "topic_id": row["category__topic__id"],
                "topic_name": row["category__topic__name"],
                "category_id": row["category__id"],
                "category_name": row["category__name"],
                "total": _money(row["total"]),
            }
            for row in in_month.values(
                "category__topic__id",
                "category__topic__name",
                "category__id",
                "category__name",
            )
            .annotate(total=Sum("amount"))
            .order_by("-total")
        ]

        daily = {
            row["day"]: _money(row["total"])
            for row in in_month.annotate(day=TruncDate("occurred_at"))
            .values("day")
            .annotate(total=Sum("amount"))
        }
        by_day = []
        cumulative = 0.0
        day = first_day
        while day <= end:
            amount = daily.get(day, 0.0)
            cumulative += amount
            by_day.append(
                {"date": day.isoformat(), "total": amount, "cumulative": round(cumulative, 2)}
            )
            day = day.fromordinal(day.toordinal() + 1)

        upcoming = Bill.objects.filter(status=Bill.Status.PENDING).order_by("due_date")[:10]

        return Response(
            {
                "month": first_day.strftime("%Y-%m"),
                "total_so_far": total_so_far,
                "prev_month_total": prev_month_total,
                "by_topic": by_topic,
                "by_category": by_category,
                "by_day": by_day,
                "upcoming_bills": BillSerializer(upcoming, many=True).data,
            }
        )
