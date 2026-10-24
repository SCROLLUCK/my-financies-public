"""Django settings for the my-financies backend."""
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
)

SECRET_KEY = env("DJANGO_SECRET_KEY", default="dev-insecure-key-change-me")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third-party
    "rest_framework",
    "corsheaders",
    # Local apps
    "apps.core",
    "apps.expenses",
    "apps.bills",
    "apps.shopping",
    "apps.receipts",
    "apps.statements",
    "apps.chat",
    "apps.notifications",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    # Serves collected static files (admin, DRF browsable API) in production.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": env.db("DATABASE_URL"),
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
# Local-user timezone so "today"/"this month" match the user, not the UTC container clock.
TIME_ZONE = env("DJANGO_TIME_ZONE", default="America/Sao_Paulo")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# AI: receipt OCR text structuring (optional — heuristics-only fallback when unset).
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY", default="")
OCR_STRUCTURING_MODEL = env("OCR_STRUCTURING_MODEL", default="claude-haiku-4-5")
# AI: finance chat (read-only tool-use Q&A). Disabled (clear error) when unset.
CHAT_MODEL = env("CHAT_MODEL", default="claude-haiku-4-5")
# AI: WhatsApp capture (write-enabled: register_expense, mark_bill_paid, ...).
# A stronger model than CHAT_MODEL on purpose — testing showed Haiku skips
# calling the write tools (or hallucinates their result) often enough to be
# unsafe for actions with real financial side effects.
WHATSAPP_CAPTURE_MODEL = env("WHATSAPP_CAPTURE_MODEL", default="claude-sonnet-5")

# WhatsApp gateway (internal-only Node service, see whatsapp/).
WHATSAPP_GATEWAY_URL = env("WHATSAPP_GATEWAY_URL", default="http://whatsapp:3000")
# Shared secret the gateway must send on /api/wa/inbound/ — it has no browser
# session, so it can't use the same cookie/CSRF auth as everything else. Empty
# by default: fails closed rather than silently accepting unauthenticated calls.
WA_INBOUND_SECRET = env("WA_INBOUND_SECRET", default="")
# WhatsApp display name (case-insensitive substring) that marks an inbound
# message as sent by the partner. Empty = never attributed to the partner.
PARTNER_WHATSAPP_NAME = env("PARTNER_WHATSAPP_NAME", default="")

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_THROTTLE_RATES": {"login": "5/min"},
}

CORS_ALLOWED_ORIGINS = env.list(
    "CORS_ALLOWED_ORIGINS", default=["http://localhost:5173"]
)
# Needed even though frontend/backend are same-origin from the browser: in dev,
# Vite's proxy uses changeOrigin=true, which rewrites the Host header Django
# sees to the backend's own address — so the CSRF middleware's Origin-vs-Host
# check never matches on its own, even for a real same-browser-origin request.
# nginx in prod preserves the original Host, but trusting the real origin
# explicitly here is correct either way and avoids depending on that detail.
CSRF_TRUSTED_ORIGINS = env.list(
    "CSRF_TRUSTED_ORIGINS", default=["http://localhost:15173"]
)

# Single-user app: no registration, one seeded superuser logs in once via the
# SPA. Cookie hardening only makes sense once actually served over HTTPS —
# dev runs on plain HTTP, so this stays off there. nginx already forwards
# X-Forwarded-Proto (frontend/nginx.conf), so SECURE_PROXY_SSL_HEADER is ready
# for whenever TLS is added in front on the VPS (a separate, later task).
if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
