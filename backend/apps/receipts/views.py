from datetime import date
from decimal import Decimal, InvalidOperation

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.expenses.models import Category, Merchant
from apps.shopping.models import Product

from .models import Receipt
from .serializers import ReceiptSerializer
from .services import process


class ReceiptViewSet(viewsets.ModelViewSet):
    serializer_class = ReceiptSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    http_method_names = ["get", "post", "delete"]

    def get_queryset(self):
        qs = Receipt.objects.all()
        if status_param := self.request.query_params.get("status"):
            qs = qs.filter(status=status_param)
        return qs

    def perform_create(self, serializer):
        receipt = serializer.save()
        process(receipt)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        receipt = self.get_object()
        data = request.data

        try:
            amount = Decimal(str(data.get("amount")))
            if amount <= 0:
                raise InvalidOperation
        except InvalidOperation:
            return Response({"amount": "A valid amount is required."}, status=400)

        try:
            confirm_date = date.fromisoformat(str(data.get("date")))
        except (TypeError, ValueError):
            return Response({"date": "Use YYYY-MM-DD."}, status=400)

        category = Category.objects.filter(pk=data.get("category_id")).first()
        if category is None:
            return Response({"category_id": "Pick a category."}, status=400)

        merchant = None
        if merchant_id := data.get("merchant_id"):
            merchant = Merchant.objects.filter(pk=merchant_id).first()
            if merchant is None:
                return Response({"merchant_id": "Unknown merchant."}, status=400)
        elif merchant_name := (data.get("merchant_name") or "").strip():
            merchant = Merchant.objects.create(
                name=merchant_name[:120],
                kind=Merchant.Kind.GROCERY,
                cnpj=receipt.cnpj_guess[:18],
            )

        price_items = data.get("price_items") or []
        if price_items and merchant is None:
            return Response(
                {"price_items": "A merchant is required to record prices."}, status=400
            )
        cleaned_items = []
        for item in price_items:
            try:
                price = Decimal(str(item["price"]))
            except (KeyError, TypeError, ValueError, InvalidOperation):
                return Response({"price_items": "Each item needs a price."}, status=400)

            product = None
            if product_id := item.get("product_id"):
                try:
                    product = Product.objects.filter(pk=int(product_id)).first()
                except (TypeError, ValueError):
                    product = None
                if product is None:
                    return Response({"price_items": "Unknown product_id."}, status=400)
            elif product_name := (item.get("product_name") or "").strip():
                # New product typed inline — same "or type a new name" pattern as merchant.
                product, _ = Product.objects.get_or_create(name=product_name[:120])
            else:
                return Response(
                    {"price_items": "Each item needs a product_id or product_name."},
                    status=400,
                )

            cleaned_items.append({"product_id": product.id, "price": price})

        receipt.confirm(
            amount=amount,
            date=confirm_date,
            category=category,
            merchant=merchant,
            description=(data.get("description") or "").strip(),
            price_items=cleaned_items,
        )
        return Response(self.get_serializer(receipt).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        receipt = self.get_object()
        if receipt.status == Receipt.Status.CONFIRMED:
            return Response(
                {"status": "Already confirmed."}, status=status.HTTP_400_BAD_REQUEST
            )
        receipt.cancel()
        return Response(self.get_serializer(receipt).data)

    @action(detail=True, methods=["post"])
    def reprocess(self, request, pk=None):
        receipt = self.get_object()
        if receipt.status == Receipt.Status.CONFIRMED:
            return Response(
                {"status": "Already confirmed."}, status=status.HTTP_400_BAD_REQUEST
            )
        process(receipt)
        return Response(self.get_serializer(receipt).data)
