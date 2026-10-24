import base64
import json
import logging
import mimetypes
from datetime import date
from decimal import Decimal, InvalidOperation

from django.conf import settings

logger = logging.getLogger(__name__)

# Strict JSON schema for the structuring call (structured outputs).
RECEIPT_SCHEMA = {
    "type": "object",
    "properties": {
        "merchant_name": {"type": ["string", "null"]},
        "payee_name": {"type": ["string", "null"]},
        "cnpj": {"type": ["string", "null"]},
        "date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
        "total": {"type": ["string", "null"], "description": "Decimal as string, dot separator"},
        "kind": {"type": "string", "enum": ["card_slip", "itemized", "payment_receipt"]},
        "line_items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "description": {"type": "string"},
                    "quantity": {"type": ["string", "null"]},
                    "unit_price": {"type": ["string", "null"]},
                    "total_price": {"type": ["string", "null"]},
                },
                "required": ["description", "quantity", "unit_price", "total_price"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["merchant_name", "payee_name", "cnpj", "date", "total", "kind", "line_items"],
    "additionalProperties": False,
}

PROMPT = """You are reading a Brazilian financial document sent via WhatsApp — either a
purchase receipt (card-machine slip or itemized NFC-e grocery cupom) or a payment
confirmation screenshot from a banking app (Pix, TED/DOC transfer, or boleto payment).
Extract the structured fields. Rules:
- Amounts use Brazilian format on the receipt (1.234,56); output them with a dot as
  the decimal separator and no thousands separator (e.g. "1234.56").
- Dates are printed as DD/MM/YYYY (day first, Brazilian convention) — e.g. "05/07/2026"
  is July 5th, 2026, not May 7th. Convert to YYYY-MM-DD using that convention, even
  when both day and month are ≤12 and the date looks ambiguous.
- "total" is the amount actually paid/debited.
- "date" is when the payment/purchase happened — for a payment confirmation, that's the
  execution date/time shown on the receipt, not an unrelated due date that might also be
  printed on it (e.g. a boleto's original due date).
- kind:
  - "itemized": an NFC-e grocery cupom listing products — extract every product line
    into line_items, keeping repeated products as separate lines exactly as printed.
  - "card_slip": a single-total purchase receipt (card machine, store receipt) —
    line_items must be [].
  - "payment_receipt": a banking-app screenshot confirming a Pix/TED/boleto payment, not
    a store purchase — line_items must be []. Fill "payee_name" with the recipient's/
    beneficiary's name (who was paid); leave "merchant_name" null.
- "merchant_name" (kind card_slip/itemized only) is the store's display/trade name
  printed at the top, not noise around it. Null for payment_receipt.
- "payee_name" (kind payment_receipt only) is the Pix/TED recipient or boleto
  beneficiary name. Null for the other kinds.
- Use null when a field is not present, unreadable, or not applicable to this kind. Do
  not guess values that are not on the document.
- The attached photo is the source of truth. The OCR text is frequently wrong —
  especially individual digits in dates, totals, and prices — so whenever it
  conflicts with what you can read in the image, trust the image and ignore the
  OCR text for that field.

{source_note}
```
{ocr_text}
```"""

IMAGE_NOTE = (
    "The receipt photo is attached — read every field from the image yourself. "
    "Below is raw Tesseract OCR of the same photo; it often misreads digits, so use "
    "it only to locate text, never as the value itself when it conflicts with the photo:"
)
TEXT_NOTE = "The text below is raw OCR output (Tesseract, Portuguese) of the receipt:"


def _to_decimal(value) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return None


def _to_date(value) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _image_block(image_path: str) -> dict | None:
    media_type, _ = mimetypes.guess_type(image_path)
    if media_type not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
        return None
    try:
        with open(image_path, "rb") as f:
            data = base64.standard_b64encode(f.read()).decode()
    except OSError:
        return None
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": media_type, "data": data},
    }


def structure(ocr_text: str, image_path: str | None = None) -> dict | None:
    """Ask Claude to structure the receipt — reading the photo itself when given
    (far more reliable than OCR text on real phone pictures). Returns None when
    disabled/failed, in which case heuristics stand alone."""
    if not settings.ANTHROPIC_API_KEY:
        return None

    image = _image_block(image_path) if image_path else None
    prompt = PROMPT.format(
        source_note=IMAGE_NOTE if image else TEXT_NOTE,
        ocr_text=ocr_text[:8000],
    )
    content = [image, {"type": "text", "text": prompt}] if image else prompt

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = client.messages.create(
            model=settings.OCR_STRUCTURING_MODEL,
            max_tokens=16000,
            output_config={"format": {"type": "json_schema", "schema": RECEIPT_SCHEMA}},
            messages=[{"role": "user", "content": content}],
        )
        text = next(b.text for b in response.content if b.type == "text")
        data = json.loads(text)
    except Exception:
        logger.exception("Receipt structuring failed; falling back to heuristics")
        return None

    line_items = []
    for item in data.get("line_items") or []:
        if not item.get("description"):
            continue
        line_items.append(
            {
                "description": item["description"][:200],
                "quantity": item.get("quantity"),
                "unit_price": item.get("unit_price"),
                "total_price": item.get("total_price"),
            }
        )

    return {
        "merchant_name": (data.get("merchant_name") or "")[:120],
        "payee_name": (data.get("payee_name") or "")[:120],
        "cnpj": (data.get("cnpj") or "")[:20],
        "date": _to_date(data.get("date")),
        "total": _to_decimal(data.get("total")),
        "kind": data.get("kind") or "card_slip",
        "line_items": line_items,
    }
