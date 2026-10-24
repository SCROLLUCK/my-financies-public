from django.contrib.auth import authenticate, login, logout
from django.db import connection
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from .serializers import LoginSerializer


@api_view(["GET"])
@permission_classes([AllowAny])
def health(_request):
    """Liveness + DB connectivity check used by the frontend to confirm the stack is up."""
    try:
        connection.ensure_connection()
        db_ok = True
    except Exception:
        db_ok = False

    return Response({"status": "ok", "db": "ok" if db_ok else "down"})


class LoginRateThrottle(AnonRateThrottle):
    scope = "login"


class LoginView(APIView):
    """Single-user login: no registration, just the one seeded account."""

    permission_classes = [AllowAny]
    throttle_classes = [LoginRateThrottle]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(request, **serializer.validated_data)
        if user is None:
            return Response({"detail": "Invalid credentials."}, status=401)
        login(request, user)
        return Response({"authenticated": True, "username": user.username})


class LogoutView(APIView):
    def post(self, request):
        logout(request)
        return Response(status=204)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class MeView(APIView):
    """Who-am-I check the SPA calls on boot; also bootstraps the CSRF cookie
    (ensure_csrf_cookie) so it exists before the user's first login attempt."""

    permission_classes = [AllowAny]

    def get(self, request):
        if request.user.is_authenticated:
            return Response({"authenticated": True, "username": request.user.username})
        return Response({"authenticated": False})
