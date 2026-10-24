from rest_framework import serializers

from apps.expenses.serializers import CategoryLiteSerializer

from .models import Receipt

MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class ReceiptSerializer(serializers.ModelSerializer):
    expense = serializers.SerializerMethodField()
    suggested_category = CategoryLiteSerializer(read_only=True)

    class Meta:
        model = Receipt
        fields = [
            "id", "image", "uploaded_at", "channel", "status",
            "merchant_guess", "cnpj_guess", "date_guess", "total_guess",
            "line_items", "suggested_category", "ocr_text", "expense",
        ]
        read_only_fields = [
            "uploaded_at", "status", "merchant_guess", "cnpj_guess",
            "date_guess", "total_guess", "line_items", "ocr_text",
        ]

    def get_expense(self, receipt):
        expense = receipt.expenses.first()
        return expense.pk if expense else None

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Relative /media/... path: works through the vite proxy in dev
        # regardless of which Host header the backend saw.
        data["image"] = instance.image.url if instance.image else None
        return data

    def validate_image(self, value):
        content_type = getattr(value, "content_type", "") or ""
        if not content_type.startswith("image/"):
            raise serializers.ValidationError("Upload an image file.")
        if value.size > MAX_UPLOAD_BYTES:
            raise serializers.ValidationError("Image larger than 10MB.")
        return value
