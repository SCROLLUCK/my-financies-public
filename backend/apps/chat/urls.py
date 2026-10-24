from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ChatView, ConversationViewSet

router = DefaultRouter()
router.register("conversations", ConversationViewSet, basename="conversation")

urlpatterns = [
    path("chat/", ChatView.as_view(), name="chat"),
    *router.urls,
]
