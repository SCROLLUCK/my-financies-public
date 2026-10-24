from decimal import Decimal, InvalidOperation

from django.db.models import Count, Max, Min, Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.expenses.models import Category
from apps.expenses.serializers import MerchantSerializer

from .models import (
    PlannedPurchase,
    PriceObservation,
    Product,
    ShoppingList,
    ShoppingListItem,
)
from .serializers import (
    PlannedPurchaseSerializer,
    PriceObservationSerializer,
    ProductSerializer,
    ShoppingListItemSerializer,
    ShoppingListSerializer,
)


class ProductViewSet(viewsets.ModelViewSet):
    serializer_class = ProductSerializer

    def get_queryset(self):
        qs = (
            Product.objects.select_related("category__topic")
            .annotate(cheapest_price=Min("prices__price"), last_price_date=Max("prices__date"))
            .all()
        )
        params = self.request.query_params
        if q := params.get("q"):
            qs = qs.filter(name__icontains=q)
        if category := params.get("category"):
            qs = qs.filter(category_id=category)
        return qs

    @action(detail=True, methods=["get"], url_path="price-summary")
    def price_summary(self, request, pk=None):
        """Latest and lowest price per store, plus the cheapest store right now."""
        product = self.get_object()
        latest_per_store = (
            PriceObservation.objects.filter(product=product)
            .select_related("merchant")
            .order_by("merchant_id", "-date", "-id")
            .distinct("merchant_id")
        )
        lowest = {
            row["merchant_id"]: row["lowest"]
            for row in PriceObservation.objects.filter(product=product)
            .values("merchant_id")
            .annotate(lowest=Min("price"))
        }

        by_store = sorted(
            (
                {
                    "merchant": MerchantSerializer(obs.merchant).data,
                    "latest_price": str(obs.price),
                    "latest_date": obs.date.isoformat(),
                    "lowest_price": str(lowest[obs.merchant_id]),
                }
                for obs in latest_per_store
            ),
            key=lambda row: float(row["latest_price"]),
        )

        cheapest = None
        if by_store:
            best = by_store[0]
            cheapest = {
                "merchant_id": best["merchant"]["id"],
                "merchant_name": best["merchant"]["name"],
                "price": best["latest_price"],
                "date": best["latest_date"],
            }

        return Response(
            {
                "product": ProductSerializer(product).data,
                "by_store": by_store,
                "cheapest": cheapest,
            }
        )


class PriceObservationViewSet(viewsets.ModelViewSet):
    serializer_class = PriceObservationSerializer

    def get_queryset(self):
        qs = PriceObservation.objects.select_related("product", "merchant").all()
        params = self.request.query_params
        if product := params.get("product"):
            qs = qs.filter(product_id=product)
        if merchant := params.get("merchant"):
            qs = qs.filter(merchant_id=merchant)
        return qs


class ShoppingListViewSet(viewsets.ModelViewSet):
    serializer_class = ShoppingListSerializer

    def get_queryset(self):
        qs = ShoppingList.objects.select_related("store").annotate(
            items_total=Count("items"),
            items_checked=Count("items", filter=Q(items__checked=True)),
        )
        if status_param := self.request.query_params.get("status"):
            qs = qs.filter(status=status_param)
        return qs

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        shopping_list = self.get_object()
        shopping_list.complete()
        return Response(self.get_serializer(shopping_list).data)


class ShoppingListItemViewSet(viewsets.ModelViewSet):
    serializer_class = ShoppingListItemSerializer

    def get_queryset(self):
        qs = ShoppingListItem.objects.select_related("product", "list__store").all()
        if list_id := self.request.query_params.get("list"):
            qs = qs.filter(list_id=list_id)
        return qs

    @action(detail=True, methods=["post"])
    def check(self, request, pk=None):
        item = self.get_object()
        paid_price = None
        if (raw := request.data.get("paid_price")) not in (None, ""):
            try:
                paid_price = Decimal(str(raw))
            except InvalidOperation:
                return Response(
                    {"paid_price": "Invalid price."}, status=status.HTTP_400_BAD_REQUEST
                )
        item.check_off(paid_price=paid_price)
        return Response(self.get_serializer(item).data)

    @action(detail=True, methods=["post"])
    def uncheck(self, request, pk=None):
        item = self.get_object()
        item.uncheck()
        return Response(self.get_serializer(item).data)


class PlannedPurchaseViewSet(viewsets.ModelViewSet):
    serializer_class = PlannedPurchaseSerializer

    def get_queryset(self):
        qs = PlannedPurchase.objects.select_related("category__topic").all()
        params = self.request.query_params
        if status_param := params.get("status"):
            qs = qs.filter(status=status_param)
        if priority := params.get("priority"):
            qs = qs.filter(priority=priority)
        return qs

    @action(detail=True, methods=["post"])
    def purchase(self, request, pk=None):
        planned = self.get_object()
        try:
            amount = Decimal(str(request.data.get("amount")))
        except InvalidOperation:
            return Response(
                {"amount": "A valid amount is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if amount <= 0:
            return Response(
                {"amount": "A valid amount is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        category = None
        if category_id := request.data.get("category_id"):
            category = Category.objects.filter(pk=category_id).first()
            if category is None:
                return Response(
                    {"category_id": "Unknown category."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        try:
            planned.purchase(amount, category=category)
        except ValueError as exc:
            return Response(
                {"category_id": str(exc)}, status=status.HTTP_400_BAD_REQUEST
            )
        return Response(self.get_serializer(planned).data)
