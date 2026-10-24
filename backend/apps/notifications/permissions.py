from django.conf import settings
from rest_framework.permissions import BasePermission


class HasGatewaySecret(BasePermission):
    """Shared-secret check for the WhatsApp gateway's inbound webhook — the
    gateway is not a browser, it has no session/CSRF token. Fails closed if
    the secret isn't configured."""

    def has_permission(self, request, view):
        expected = settings.WA_INBOUND_SECRET
        return bool(expected) and request.headers.get("X-Wa-Gateway-Secret") == expected
