import requests
from django.conf import settings

TIMEOUT = 5


class GatewayError(Exception):
    """The WhatsApp gateway is unreachable or returned an error — callers
    degrade gracefully (notifications disabled/failed), never crash."""


def _url(path: str) -> str:
    return f"{settings.WHATSAPP_GATEWAY_URL.rstrip('/')}{path}"


def get_status() -> dict:
    try:
        resp = requests.get(_url("/status"), timeout=TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        raise GatewayError(str(e)) from e


def list_chats() -> list[dict]:
    try:
        resp = requests.get(_url("/chats"), timeout=TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        raise GatewayError(str(e)) from e


def send(to: str, message: str) -> None:
    try:
        resp = requests.post(_url("/send"), json={"to": to, "message": message}, timeout=TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise GatewayError(str(e)) from e
