from rest_framework.routers import DefaultRouter

from .views import StatementImportViewSet

router = DefaultRouter()
router.register("statement-imports", StatementImportViewSet, basename="statementimport")

urlpatterns = router.urls
