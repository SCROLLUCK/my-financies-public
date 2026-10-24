from datetime import date

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.expenses.serializers import CategoryLiteSerializer

from .models import Bill, IncomeSource, RecurringExpense
from .serializers import BillSerializer, IncomeSourceSerializer, RecurringExpenseSerializer
from .services import (
    drop_pending_bills,
    generate_bills,
    project_bills,
    sync_pending_bills,
)


class IncomeSourceViewSet(viewsets.ModelViewSet):
    queryset = IncomeSource.objects.all()
    serializer_class = IncomeSourceSerializer


class RecurringExpenseViewSet(viewsets.ModelViewSet):
    queryset = RecurringExpense.objects.select_related("category__topic", "merchant").all()
    serializer_class = RecurringExpenseSerializer

    def perform_update(self, serializer):
        rec = serializer.save()
        sync_pending_bills(rec)

    def perform_destroy(self, instance):
        drop_pending_bills(instance)
        instance.delete()


class BillViewSet(viewsets.ModelViewSet):
    serializer_class = BillSerializer

    def list(self, request, *args, **kwargs):
        # Lazy auto-generation: opening any bill view materializes the current
        # month's bills from recurring expenses (idempotent, single-user app).
        generate_bills()
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        qs = Bill.objects.select_related("category__topic").all()
        params = self.request.query_params

        if status := params.get("status"):
            qs = qs.filter(status=status)
        if params.get("upcoming") == "true":
            qs = qs.filter(status=Bill.Status.PENDING).order_by("due_date")
        if month := params.get("month"):  # YYYY-MM on due_date
            try:
                year, mon = (int(x) for x in month.split("-"))
                qs = qs.filter(due_date__year=year, due_date__month=mon)
            except (ValueError, TypeError):
                pass
        return qs

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        bill = self.get_object()
        bill.pay()
        return Response(self.get_serializer(bill).data)

    @action(detail=True, methods=["post"])
    def unpay(self, request, pk=None):
        bill = self.get_object()
        bill.unpay()
        return Response(self.get_serializer(bill).data)

    @action(detail=False, methods=["get"])
    def projected(self, request):
        """Expected charges for a month (virtual — nothing is persisted)."""
        month = request.query_params.get("month", "")
        try:
            year, mon = (int(x) for x in month.split("-"))
            date(year, mon, 1)
        except (ValueError, TypeError):
            return Response({"month": "Use YYYY-MM."}, status=status.HTTP_400_BAD_REQUEST)

        items = project_bills(month)
        for item in items:
            item["category"] = CategoryLiteSerializer(item["category"]).data
        return Response(items)
