import logging

from PIL import Image

from apps.bills.services import match_pending_bill
from apps.expenses import categorize
from apps.expenses.models import Category

from . import heuristics, ocr, structuring
from .models import Receipt

logger = logging.getLogger(__name__)


def process(receipt: Receipt) -> None:
    """Run the OCR pipeline and fill the draft fields (never creates an Expense)."""
    try:
        with Image.open(receipt.image.path) as img:
            text = ocr.run(img)
    except Exception:
        logger.exception("OCR failed for receipt %s", receipt.pk)
        receipt.status = Receipt.Status.FAILED
        receipt.save(update_fields=["status", "updated_at"])
        return

    receipt.ocr_text = text.strip()
    if not receipt.ocr_text:
        receipt.status = Receipt.Status.FAILED
        receipt.save(update_fields=["ocr_text", "status", "updated_at"])
        return

    guessed = heuristics.parse(receipt.ocr_text)
    structured = structuring.structure(receipt.ocr_text, receipt.image.path)

    # Structuring wins field-by-field where it produced a value.
    receipt.total_guess = (structured or {}).get("total") or guessed["total"]
    receipt.date_guess = (structured or {}).get("date") or guessed["date"]
    receipt.cnpj_guess = (structured or {}).get("cnpj") or guessed["cnpj"]
    kind = (structured or {}).get("kind") or guessed["kind"]

    receipt.matched_bill = None
    if kind == "payment_receipt":
        payee_name = (structured or {}).get("payee_name") or ""
        receipt.merchant_guess = payee_name or guessed["merchant_guess"]
        receipt.line_items = []
        if receipt.channel == Receipt.Channel.WHATSAPP and receipt.total_guess:
            receipt.matched_bill = match_pending_bill(receipt.total_guess, payee_name)
    else:
        receipt.merchant_guess = (
            (structured or {}).get("merchant_name") or guessed["merchant_guess"]
        )
        receipt.line_items = (structured or {}).get("line_items") or guessed["line_items"]

    # Category prefill: a matched bill wins outright, then an itemized cupom is a
    # grocery run, otherwise try the taxonomy aliases against the merchant/payee name
    # (same engine as statements).
    suggestion = None
    if receipt.matched_bill:
        suggestion = receipt.matched_bill.category
    elif kind == "itemized":
        suggestion = Category.objects.filter(slug="groceries").first()
    if suggestion is None and receipt.merchant_guess:
        suggestion = categorize.match(receipt.merchant_guess, categorize.build_alias_map())
    receipt.suggested_category = suggestion

    receipt.status = Receipt.Status.PARSED
    receipt.save(
        update_fields=[
            "ocr_text", "total_guess", "date_guess", "cnpj_guess", "merchant_guess",
            "line_items", "suggested_category", "matched_bill", "status", "updated_at",
        ]
    )
