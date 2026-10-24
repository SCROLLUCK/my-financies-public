from django.db.models import Count
from rest_framework import viewsets

from .models import Category, Expense, Income, Merchant, Topic
from .serializers import (
    CategorySerializer,
    ExpenseSerializer,
    IncomeSerializer,
    MerchantSerializer,
    TopicSerializer,
)


class TopicViewSet(viewsets.ModelViewSet):
    queryset = Topic.objects.all()
    serializer_class = TopicSerializer


class CategoryViewSet(viewsets.ModelViewSet):
    serializer_class = CategorySerializer

    def get_queryset(self):
        qs = Category.objects.select_related("topic").annotate(
            expense_count=Count("expenses")
        )
        topic = self.request.query_params.get("topic")
        if topic:
            qs = qs.filter(topic_id=topic)
        return qs


class MerchantViewSet(viewsets.ModelViewSet):
    queryset = Merchant.objects.all()
    serializer_class = MerchantSerializer


class ExpenseViewSet(viewsets.ModelViewSet):
    serializer_class = ExpenseSerializer

    def get_queryset(self):
        qs = Expense.objects.select_related("category__topic", "merchant").all()
        params = self.request.query_params

        month = params.get("month")  # YYYY-MM
        if month:
            try:
                year, mon = (int(x) for x in month.split("-"))
                qs = qs.filter(occurred_at__year=year, occurred_at__month=mon)
            except (ValueError, TypeError):
                pass
        if year_param := params.get("year"):  # YYYY
            try:
                qs = qs.filter(occurred_at__year=int(year_param))
            except (ValueError, TypeError):
                pass
        if date_from := params.get("date_from"):  # YYYY-MM-DD
            qs = qs.filter(occurred_at__date__gte=date_from)
        if date_to := params.get("date_to"):
            qs = qs.filter(occurred_at__date__lte=date_to)

        if topic := params.get("topic"):
            qs = qs.filter(category__topic_id=topic)
        if category := params.get("category"):
            qs = qs.filter(category_id=category)
        if merchant := params.get("merchant"):
            qs = qs.filter(merchant_id=merchant)
        if kind := params.get("kind"):
            qs = qs.filter(kind=kind)
        if spent_by := params.get("spent_by"):
            qs = qs.filter(spent_by=spent_by)

        return qs


class IncomeViewSet(viewsets.ModelViewSet):
    serializer_class = IncomeSerializer

    def get_queryset(self):
        qs = Income.objects.all()
        params = self.request.query_params

        month = params.get("month")  # YYYY-MM
        if month:
            try:
                year, mon = (int(x) for x in month.split("-"))
                qs = qs.filter(occurred_at__year=year, occurred_at__month=mon)
            except (ValueError, TypeError):
                pass
        if year_param := params.get("year"):
            try:
                qs = qs.filter(occurred_at__year=int(year_param))
            except (ValueError, TypeError):
                pass
        if date_from := params.get("date_from"):
            qs = qs.filter(occurred_at__date__gte=date_from)
        if date_to := params.get("date_to"):
            qs = qs.filter(occurred_at__date__lte=date_to)

        return qs
