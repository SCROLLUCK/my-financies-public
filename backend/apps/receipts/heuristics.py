import re
from datetime import date
from decimal import Decimal, InvalidOperation

from apps.expenses.models import Merchant

# Brazilian money: 1.234,56 or 1234,56 (comma decimals).
MONEY_RE = re.compile(r"(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})")
# On total-hint lines only: tolerate OCR dropping the comma ("56 96" -> 56,96).
RELAXED_MONEY_RE = re.compile(r"(\d{1,3}(?:\.\d{3})*)[,\s](\d{2})\b")
DATE_RE = re.compile(r"(\d{2})/(\d{2})/(\d{4})")
CNPJ_RE = re.compile(r"(\d{2})[.\s]?(\d{3})[.\s]?(\d{3})/?(\d{4})-?(\d{2})")

# Lines whose amount is most likely the receipt total.
TOTAL_HINTS = ("VALOR TOTAL", "TOTAL A PAGAR", "VALOR PAGO", "TOTAL R$", "CRÉDITO", "CREDITO", "DÉBITO", "DEBITO", "TOTAL")
# Marker of the itemized cupom shape (vs a single-total card slip).
ITEM_TABLE_HINTS = ("QTD", "VL.UN", "VL UN", "DESCRIÇÃO", "DESCRICAO", "UN X")

# NFC-e item line: product code (6-14 digits) followed by the description.
ITEM_CODE_RE = re.compile(r"\b(\d{6,14})\b\s*(.*)")
# "1UN X 7,49" — tolerating OCR misreads of the quantity digit (I/l/O/T for 1).
QTY_X_RE = re.compile(r"([\dIlOT]{1,3})\s*UN\s*[xX×]\s*(\d{1,3}(?:[.,]\d{1,2})?)", re.I)
# End of the item table.
ITEM_STOP_HINTS = ("QTD.TOTAL", "QTD TOTAL", "VALOR TOTAL", "TOTAL A PAGAR", "SUBTOTAL")


def _to_decimal(raw: str) -> Decimal | None:
    try:
        return Decimal(raw.replace(".", "").replace(",", "."))
    except InvalidOperation:
        return None


def _name_like(line: str) -> bool:
    """Mostly-alphabetic line that could be a store name (filters photo noise)."""
    letters = sum(c.isalpha() for c in line)
    if letters < 5 or letters / len(line) < 0.5:
        return False
    return not CNPJ_RE.search(line) and "CLIENTE" not in line.upper()


def _clean_name(line: str) -> str:
    """Drop leading OCR junk (border artifacts like '| ' or '— ')."""
    return re.sub(r"^[^0-9A-Za-zÀ-ÿ]+", "", line)[:120]


def _valid_cnpj(digits: str) -> bool:
    """Check-digit validation so random 14-digit runs (card auth codes, NFC-e
    protocol numbers) are not mistaken for a CNPJ."""
    if len(digits) != 14 or digits == digits[0] * 14:
        return False

    def check_digit(nums: str, weights: list[int]) -> int:
        remainder = sum(int(n) * w for n, w in zip(nums, weights)) % 11
        return 0 if remainder < 2 else 11 - remainder

    w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    w2 = [6] + w1
    return (
        int(digits[12]) == check_digit(digits[:12], w1)
        and int(digits[13]) == check_digit(digits[:13], w2)
    )


def _qty_digits(raw: str) -> str:
    return raw.translate(str.maketrans("IlTtOo", "111100"))


def _strip_edges(desc: str) -> str:
    return re.sub(r"[^0-9A-Za-zÀ-ÿ).]+$", "", re.sub(r"^[^0-9A-Za-zÀ-ÿ]+", "", desc))[:200]


def parse_line_items(lines: list[str]) -> list[dict]:
    """Best-effort NFC-e item extraction: barcode opens an item, a 'QTD UN X price'
    or lone amount on a following line prices it. Values are strings (JSON field)."""
    items: list[dict] = []
    current: dict | None = None

    def close() -> None:
        nonlocal current
        if current is None:
            return
        if current["total_price"] is None and current["quantity"] and current["unit_price"]:
            total = Decimal(current["quantity"]) * Decimal(current["unit_price"])
            current["total_price"] = str(total.quantize(Decimal("0.01")))
        items.append(current)
        current = None

    for line in lines:
        upper = line.upper()
        if any(hint in upper for hint in ITEM_STOP_HINTS):
            break
        rest = line
        opened_here = False
        code_match = ITEM_CODE_RE.search(line)
        if code_match and sum(c.isalpha() for c in code_match.group(2)) >= 3:
            close()
            current = {
                "description": _strip_edges(code_match.group(2)),
                "quantity": None,
                "unit_price": None,
                "total_price": None,
            }
            rest = code_match.group(2)
            opened_here = True
        if current is None:
            continue
        if qty_match := QTY_X_RE.search(rest):
            current["quantity"] = _qty_digits(qty_match.group(1))
            unit = _to_decimal(qty_match.group(2)) if "," in qty_match.group(2) else None
            current["unit_price"] = str(unit) if unit is not None else qty_match.group(2)
            prefix = _strip_edges(rest[: qty_match.start()])
            if opened_here:
                # Prices were on the barcode line itself: description ends before them.
                current["description"] = prefix
            elif sum(c.isalpha() for c in prefix) >= 3:
                # Wrapped description line that also carries the prices.
                current["description"] = f"{current['description']} {prefix}"[:200]
            if trailing := MONEY_RE.findall(rest[qty_match.end() :]):
                total = _to_decimal(trailing[-1])
                current["total_price"] = str(total) if total is not None else None
        elif current["total_price"] is None and (moneys := MONEY_RE.findall(rest)):
            total = _to_decimal(moneys[-1])
            current["total_price"] = str(total) if total is not None else None
    close()
    return items[:50]


def parse(ocr_text: str) -> dict:
    """Regex-only extraction: total, date, CNPJ (→ merchant match), name guess."""
    lines = [line.strip() for line in ocr_text.splitlines() if line.strip()]
    upper = ocr_text.upper()

    # Total: prefer amounts on/right-after lines with a total hint, else the max.
    total = None
    for i, line in enumerate(lines):
        line_upper = line.upper()
        if any(hint in line_upper for hint in TOTAL_HINTS):
            window = " ".join(lines[i : i + 2])
            amounts = [_to_decimal(m) for m in MONEY_RE.findall(window)]
            amounts = [a for a in amounts if a is not None]
            if not amounts:
                amounts = [
                    _to_decimal(f"{units},{cents}")
                    for units, cents in RELAXED_MONEY_RE.findall(window)
                ]
                amounts = [a for a in amounts if a is not None]
            if amounts:
                total = max(amounts)
                break
    if total is None:
        amounts = [_to_decimal(m) for m in MONEY_RE.findall(ocr_text)]
        amounts = [a for a in amounts if a is not None]
        total = max(amounts) if amounts else None

    parsed_date = None
    if match := DATE_RE.search(ocr_text):
        day, month, year = (int(g) for g in match.groups())
        try:
            parsed_date = date(year, month, day)
        except ValueError:
            pass

    cnpj = ""
    merchant = None
    for match in CNPJ_RE.finditer(ocr_text):
        digits = "".join(match.groups())
        if not _valid_cnpj(digits):
            continue
        cnpj = "{}.{}.{}/{}-{}".format(*match.groups())
        for candidate in Merchant.objects.exclude(cnpj=""):
            if re.sub(r"\D", "", candidate.cnpj) == digits:
                merchant = candidate
                break
        break

    # Merchant name guess: the line just above the CNPJ is almost always the
    # store name; fall back to the first name-like line near the top.
    merchant_guess = merchant.name if merchant else ""
    if not merchant_guess:
        cnpj_idx = next(
            (i for i, line in enumerate(lines) if CNPJ_RE.search(line)), None
        )
        if cnpj_idx:
            for line in reversed(lines[max(0, cnpj_idx - 3) : cnpj_idx]):
                if _name_like(line):
                    merchant_guess = _clean_name(line)
                    break
        if not merchant_guess:
            for line in lines[:15]:
                if _name_like(line):
                    merchant_guess = _clean_name(line)
                    break

    kind = "itemized" if any(h in upper for h in ITEM_TABLE_HINTS) else "card_slip"
    return {
        "total": total,
        "date": parsed_date,
        "cnpj": cnpj,
        "merchant": merchant,
        "merchant_guess": merchant_guess,
        "kind": kind,
        "line_items": parse_line_items(lines) if kind == "itemized" else [],
    }
