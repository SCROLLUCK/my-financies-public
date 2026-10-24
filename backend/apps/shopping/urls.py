from rest_framework.routers import DefaultRouter

from .views import (
    PlannedPurchaseViewSet,
    PriceObservationViewSet,
    ProductViewSet,
    ShoppingListItemViewSet,
    ShoppingListViewSet,
)

router = DefaultRouter()
router.register("products", ProductViewSet, basename="product")
router.register("price-observations", PriceObservationViewSet, basename="priceobservation")
router.register("shopping-lists", ShoppingListViewSet, basename="shoppinglist")
router.register("shopping-list-items", ShoppingListItemViewSet, basename="shoppinglistitem")
router.register("planned-purchases", PlannedPurchaseViewSet, basename="plannedpurchase")

urlpatterns = router.urls
