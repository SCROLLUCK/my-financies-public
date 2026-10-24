from django.urls import path

from .views import (
    GatewayChatsView,
    GatewayQRView,
    GatewayStatusView,
    NotificationSettingView,
    TestSendView,
    WaInboundView,
)

urlpatterns = [
    path("notifications/settings/", NotificationSettingView.as_view(), name="notification-settings"),
    path("notifications/gateway/status/", GatewayStatusView.as_view(), name="gateway-status"),
    path("notifications/gateway/qr/", GatewayQRView.as_view(), name="gateway-qr"),
    path("notifications/gateway/chats/", GatewayChatsView.as_view(), name="gateway-chats"),
    path("notifications/test-send/", TestSendView.as_view(), name="notification-test-send"),
    path("wa/inbound/", WaInboundView.as_view(), name="wa-inbound"),
]
