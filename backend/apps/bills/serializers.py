import calendar
from datetime import date

from django.utils import timezone
from rest_framework import serializers

from apps.expenses.models import Category, Merchant
from apps.expenses.serializers import CategoryLiteSerializer, MerchantSerializer

from .models import Bill, IncomeSource, RecurringExpense


class RecurringExpenseSerializer(serializers.ModelSerializer):
    category = CategoryLiteSerializer(read_only=True)
    category_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.all(), source="category", write_only=True
    )
    merchant = MerchantSerializer(read_only=True)
    merchant_id = serializers.PrimaryKeyRelatedField(
        queryset=Merchant.objects.all(),
        source="merchant",
        write_only=True,
        required=False,
        allow_null=True,
    )

    class Meta:
        model = RecurringExpense
        fields = [
            "id", "name", "type", "amount", "cadence", "due_day",
            "category", "category_id", "merchant", "merchant_id",
            "active", "start_date", "end_date", "installments",
        ]

    def validate(self, attrs):
        def current(field):
            return attrs.get(field, getattr(self.instance, field, None))

        if current("type") == RecurringExpense.Type.INSTALLMENT:
            installments = current("installments")
            if not installments or installments < 2:
                raise serializers.ValidationError(
                    {"installments": "Enter at least 2 installments."}
                )
            # Installments are monthly; the last one lands installments-1
            # months after start_date's month.
            attrs["cadence"] = RecurringExpense.Cadence.MONTHLY
            start = current("start_date") or timezone.localdate()
            total = start.year * 12 + (start.month - 1) + (installments - 1)
            year, month = total // 12, total % 12 + 1
            attrs["end_date"] = date(year, month, calendar.monthrange(year, month)[1])
        else:
            attrs["installments"] = None
        return attrs


class IncomeSourceSerializer(serializers.ModelSerializer):
    is_active = serializers.BooleanField(read_only=True)

    class Meta:
        model = IncomeSource
        fields = ["id", "name", "amount", "end_date", "is_active"]


class BillSerializer(serializers.ModelSerializer):
    category = CategoryLiteSerializer(read_only=True)
    category_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.all(), source="category", write_only=True
    )
    is_overdue = serializers.BooleanField(read_only=True)

    class Meta:
        model = Bill
        fields = [
            "id", "name", "amount", "due_date", "status", "paid_at",
            "recurring", "category", "category_id", "expense", "is_overdue",
        ]
        read_only_fields = ["status", "paid_at", "expense", "recurring"]
