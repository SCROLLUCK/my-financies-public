from django.urls import path
from rest_framework.routers import DefaultRouter

from .dashboard import DashboardView
from .food import FoodSummaryView
from .views import (
    CategoryViewSet,
    ExpenseViewSet,
    IncomeViewSet,
    MerchantViewSet,
    TopicViewSet,
)

router = DefaultRouter()
router.register("topics", TopicViewSet, basename="topic")
router.register("categories", CategoryViewSet, basename="category")
router.register("merchants", MerchantViewSet, basename="merchant")
router.register("expenses", ExpenseViewSet, basename="expense")
router.register("incomes", IncomeViewSet, basename="income")

urlpatterns = [
    path("dashboard/", DashboardView.as_view(), name="dashboard"),
    path("food/", FoodSummaryView.as_view(), name="food"),
    *router.urls,
]
