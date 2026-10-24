from rest_framework.routers import DefaultRouter

from .views import BillViewSet, IncomeSourceViewSet, RecurringExpenseViewSet

router = DefaultRouter()
router.register("recurring", RecurringExpenseViewSet, basename="recurring")
router.register("bills", BillViewSet, basename="bill")
router.register("income-sources", IncomeSourceViewSet, basename="income-source")

urlpatterns = router.urls
