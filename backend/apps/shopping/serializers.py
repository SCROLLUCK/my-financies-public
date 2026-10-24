from rest_framework import serializers

from apps.expenses.models import Category, Merchant
from apps.expenses.serializers import CategoryLiteSerializer, MerchantSerializer

from .models import (
    PlannedPurchase,
    PriceObservation,
    Product,
    ShoppingList,
    ShoppingListItem,
)


class ProductSerializer(serializers.ModelSerializer):
    category = CategoryLiteSerializer(read_only=True)
    category_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.all(),
        source="category",
        write_only=True,
        required=False,
        allow_null=True,
    )
    # Annotated on the queryset (see ProductViewSet.get_queryset) so the list
    # view can show a price hint without a per-product round trip.
    cheapest_price = serializers.DecimalField(
        max_digits=12, decimal_places=2, read_only=True, allow_null=True
    )
    last_price_date = serializers.DateField(read_only=True, allow_null=True)

    class Meta:
        model = Product
        fields = [
            "id", "name", "unit", "category", "category_id",
            "cheapest_price", "last_price_date",
        ]


class ProductLiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = ["id", "name", "unit"]


class PriceObservationSerializer(serializers.ModelSerializer):
    product = ProductLiteSerializer(read_only=True)
    product_id = serializers.PrimaryKeyRelatedField(
        queryset=Product.objects.all(), source="product", write_only=True
    )
    merchant = MerchantSerializer(read_only=True)
    merchant_id = serializers.PrimaryKeyRelatedField(
        queryset=Merchant.objects.all(), source="merchant", write_only=True
    )

    class Meta:
        model = PriceObservation
        fields = ["id", "product", "product_id", "merchant", "merchant_id", "price", "date", "source"]
        read_only_fields = ["source"]


class ShoppingListSerializer(serializers.ModelSerializer):
    store = MerchantSerializer(read_only=True)
    store_id = serializers.PrimaryKeyRelatedField(
        queryset=Merchant.objects.all(),
        source="store",
        write_only=True,
        required=False,
        allow_null=True,
    )
    items_total = serializers.IntegerField(read_only=True, default=0)
    items_checked = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = ShoppingList
        fields = [
            "id", "name", "store", "store_id", "status",
            "created_at", "completed_at", "items_total", "items_checked",
        ]
        read_only_fields = ["created_at", "completed_at"]

    def validate_status(self, value):
        if value == ShoppingList.Status.COMPLETED:
            raise serializers.ValidationError(
                "Use the complete action to finish a list."
            )
        return value


class ShoppingListItemSerializer(serializers.ModelSerializer):
    product = ProductLiteSerializer(read_only=True)
    product_id = serializers.PrimaryKeyRelatedField(
        queryset=Product.objects.all(),
        source="product",
        write_only=True,
        required=False,
        allow_null=True,
    )
    list_id = serializers.PrimaryKeyRelatedField(
        queryset=ShoppingList.objects.all(), source="list", write_only=True
    )
    cheapest = serializers.SerializerMethodField()

    class Meta:
        model = ShoppingListItem
        fields = [
            "id", "list_id", "product", "product_id", "name", "quantity", "unit",
            "checked", "checked_at", "paid_price", "note", "order", "cheapest",
        ]
        read_only_fields = ["checked", "checked_at", "paid_price"]

    def validate(self, attrs):
        product = attrs.get("product", getattr(self.instance, "product", None))
        name = attrs.get("name", getattr(self.instance, "name", ""))
        if not product and not (name or "").strip():
            raise serializers.ValidationError({"name": "Name is required without a product."})
        if product and not (name or "").strip():
            attrs["name"] = product.name
        return attrs

    def get_cheapest(self, item):
        """Cheapest store for the linked product: latest observation per store,
        then the lowest of those."""
        if not item.product_id:
            return None
        latest_per_store = (
            PriceObservation.objects.filter(product_id=item.product_id)
            .select_related("merchant")
            .order_by("merchant_id", "-date", "-id")
            .distinct("merchant_id")
        )
        best = min(latest_per_store, key=lambda obs: obs.price, default=None)
        if best is None:
            return None
        return {
            "merchant_id": best.merchant_id,
            "merchant_name": best.merchant.name,
            "price": str(best.price),
            "date": best.date.isoformat(),
        }


class PlannedPurchaseSerializer(serializers.ModelSerializer):
    category = CategoryLiteSerializer(read_only=True)
    category_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.all(),
        source="category",
        write_only=True,
        required=False,
        allow_null=True,
    )

    class Meta:
        model = PlannedPurchase
        fields = [
            "id", "name", "estimated_cost", "priority", "category", "category_id",
            "target_date", "notes", "url", "status", "expense",
            "created_at", "purchased_at",
        ]
        read_only_fields = ["expense", "created_at", "purchased_at"]

    def validate_status(self, value):
        if value == PlannedPurchase.Status.PURCHASED:
            raise serializers.ValidationError(
                "Use the purchase action to mark as purchased."
            )
        return value
