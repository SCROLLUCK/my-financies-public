from rest_framework import serializers

from apps.expenses.serializers import CategoryLiteSerializer

from .models import StatementImport, StatementTransaction

MAX_UPLOAD_BYTES = 5 * 1024 * 1024


class PossibleDuplicateExpenseSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    description = serializers.CharField()
    occurred_at = serializers.DateTimeField()
    source = serializers.CharField()


class StatementTransactionSerializer(serializers.ModelSerializer):
    suggested_category = CategoryLiteSerializer(read_only=True)
    possible_duplicate = serializers.SerializerMethodField()

    class Meta:
        model = StatementTransaction
        fields = [
            "id", "date", "amount", "direction", "name", "memo",
            "status", "suggested_category", "expense", "income",
            "possible_duplicate",
        ]

    def get_possible_duplicate(self, obj):
        if obj.status != StatementTransaction.Status.PENDING:
            return None
        match = obj.find_possible_duplicate_expense()
        return PossibleDuplicateExpenseSerializer(match).data if match else None


class StatementImportSerializer(serializers.ModelSerializer):
    transactions = StatementTransactionSerializer(many=True, read_only=True)

    class Meta:
        model = StatementImport
        fields = [
            "id", "original_name", "format", "bank", "uploaded_at",
            "transactions_found", "duplicates_skipped", "transactions",
        ]


class StatementImportListSerializer(serializers.ModelSerializer):
    pending_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = StatementImport
        fields = [
            "id", "original_name", "format", "bank", "uploaded_at",
            "transactions_found", "duplicates_skipped", "pending_count",
        ]
