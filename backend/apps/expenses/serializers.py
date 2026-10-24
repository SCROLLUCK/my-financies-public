from django.utils.text import slugify
from rest_framework import serializers

from .models import Category, Expense, Income, Merchant, Topic


def unique_slug(model, name):
    base = slugify(name) or "item"
    slug = base
    i = 2
    while model.objects.filter(slug=slug).exists():
        slug = f"{base}-{i}"
        i += 1
    return slug


class TopicSerializer(serializers.ModelSerializer):
    class Meta:
        model = Topic
        fields = ["id", "name", "slug", "is_food", "color", "icon", "order"]
        read_only_fields = ["slug"]

    def create(self, validated_data):
        validated_data["slug"] = unique_slug(Topic, validated_data["name"])
        return super().create(validated_data)


class CategorySerializer(serializers.ModelSerializer):
    topic = TopicSerializer(read_only=True)
    topic_id = serializers.PrimaryKeyRelatedField(
        queryset=Topic.objects.all(), source="topic", write_only=True
    )
    expense_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Category
        fields = [
            "id", "name", "slug", "aliases", "color", "icon",
            "topic", "topic_id", "expense_count",
        ]
        read_only_fields = ["slug"]

    def create(self, validated_data):
        validated_data["slug"] = unique_slug(Category, validated_data["name"])
        return super().create(validated_data)


class CategoryLiteSerializer(serializers.ModelSerializer):
    """Compact category for embedding in expense rows (includes its topic)."""

    topic = TopicSerializer(read_only=True)

    class Meta:
        model = Category
        fields = ["id", "name", "slug", "color", "topic"]


class MerchantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Merchant
        fields = ["id", "name", "kind", "cnpj"]


class IncomeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Income
        fields = ["id", "amount", "occurred_at", "description", "source", "created_at"]
        read_only_fields = ["source", "created_at"]


class ExpenseSerializer(serializers.ModelSerializer):
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
        model = Expense
        fields = [
            "id", "amount", "occurred_at", "description", "kind", "source", "spent_by",
            "category", "category_id", "merchant", "merchant_id",
            "created_at",
        ]
        read_only_fields = ["source", "created_at"]
