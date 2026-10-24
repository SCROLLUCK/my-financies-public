import csv
import hashlib
import io
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from apps.expenses import categorize
from apps.expenses.models import Category

# ---------------------------------------------------------------------------
# OFX (SGML 1.x and XML 2.x): fields appear as `<TAG>value` lines inside
# <STMTTRN> blocks; closing tags are optional in SGML.
# ---------------------------------------------------------------------------

STMTTRN_RE = re.compile(r"<STMTTRN>(.*?)(?=</STMTTRN>|<STMTTRN>|</BANKTRANLIST>)", re.S)
FIELD_RES = {
    "trntype": re.compile(r"<TRNTYPE>([^<\r\n]+)"),
    "dtposted": re.compile(r"<DTPOSTED>(\d{8})"),
    "trnamt": re.compile(r"<TRNAMT>([-\d.,]+)"),
    "fitid": re.compile(r"<FITID>([^<\r\n]+)"),
    "memo": re.compile(r"<MEMO>([^<\r\n]+)"),
    "name": re.compile(r"<NAME>([^<\r\n]+)"),
}
ORG_RE = re.compile(r"<ORG>([^<\r\n]+)")


def decode_bytes(raw: bytes) -> str:
    for encoding in ("utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _ofx_amount(raw: str) -> Decimal | None:
    # OFX uses dot decimals; some banks emit comma.
    normalized = raw.replace(",", ".") if raw.count(",") == 1 and "." not in raw else raw
    try:
        return Decimal(normalized)
    except InvalidOperation:
        return None


def parse_ofx(raw: bytes) -> dict:
    text = decode_bytes(raw)
    bank = ""
    if m := ORG_RE.search(text):
        bank = m.group(1).strip()

    transactions = []
    for block in STMTTRN_RE.findall(text):
        fields = {}
        for key, regex in FIELD_RES.items():
            if m := regex.search(block):
                fields[key] = m.group(1).strip()
        amount = _ofx_amount(fields.get("trnamt", ""))
        posted = fields.get("dtposted")
        if amount is None or not posted:
            continue
        try:
            tx_date = datetime.strptime(posted, "%Y%m%d").date()
        except ValueError:
            continue
        transactions.append(
            {
                "fitid": fields.get("fitid", ""),
                "date": tx_date,
                "amount": abs(amount),
                "direction": "out" if amount < 0 else "in",
                "name": fields.get("name", "")[:255],
                "memo": fields.get("memo", "")[:255],
            }
        )
    return {"bank": bank, "transactions": transactions}


# ---------------------------------------------------------------------------
# CSV: Brazilian bank exports (`;` separator, comma decimals, a few header
# lines before the actual table). Columns located by name.
# ---------------------------------------------------------------------------

DATE_COL_HINTS = ("data",)
VALUE_COL_HINTS = ("valor",)
DESC_COL_HINTS = ("descrição", "descricao", "histórico", "historico", "lançamento", "lancamento", "memo", "title")


def _csv_amount(raw: str) -> Decimal | None:
    cleaned = raw.strip().replace("R$", "").replace(" ", "")
    if not cleaned:
        return None
    if "," in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def _csv_date(raw: str) -> date | None:
    raw = raw.strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def parse_csv(raw: bytes) -> dict:
    text = decode_bytes(raw)
    delimiter = ";" if text.count(";") >= text.count(",") else ","
    rows = list(csv.reader(io.StringIO(text), delimiter=delimiter))

    header_idx = None
    columns: dict[str, int] = {}
    for i, row in enumerate(rows):
        lowered = [cell.strip().lower() for cell in row]
        date_col = next(
            (j for j, c in enumerate(lowered) if any(h in c for h in DATE_COL_HINTS)), None
        )
        value_col = next(
            (j for j, c in enumerate(lowered) if any(h in c for h in VALUE_COL_HINTS)), None
        )
        if date_col is not None and value_col is not None:
            header_idx = i
            columns = {"date": date_col, "value": value_col}
            desc_cols = [
                j for j, c in enumerate(lowered)
                if any(h in c for h in DESC_COL_HINTS) and j not in (date_col, value_col)
            ]
            columns["desc"] = desc_cols
            break
    if header_idx is None:
        return {"bank": "", "transactions": []}

    transactions = []
    for row in rows[header_idx + 1 :]:
        if len(row) <= columns["value"]:
            continue
        tx_date = _csv_date(row[columns["date"]])
        amount = _csv_amount(row[columns["value"]])
        if tx_date is None or amount is None or amount == 0:
            continue
        desc_parts = [row[j].strip() for j in columns["desc"] if j < len(row) and row[j].strip()]
        description = " - ".join(desc_parts)[:255]
        # CSVs carry no FITID: synthesize a stable hash for dedupe.
        fitid = "csv-" + hashlib.sha1(
            f"{tx_date.isoformat()}|{amount}|{description}".encode()
        ).hexdigest()[:32]
        transactions.append(
            {
                "fitid": fitid,
                "date": tx_date,
                "amount": abs(amount),
                "direction": "out" if amount < 0 else "in",
                "name": description,
                "memo": "",
            }
        )
    return {"bank": "", "transactions": transactions}


# ---------------------------------------------------------------------------
# Category suggestion from taxonomy aliases (same hints the WhatsApp agent
# will use later) — pure local matching, no AI (shared in expenses.categorize).
# ---------------------------------------------------------------------------

def suggest_categories(transactions: list[dict]) -> None:
    """Mutates each transaction dict adding `suggested_category` (or None)."""
    alias_map = categorize.build_alias_map()
    transfers = Category.objects.filter(slug="transfers").first()

    for tx in transactions:
        best = categorize.match(f"{tx['name']} {tx['memo']}", alias_map)
        # Fallback: an unmatched outgoing Pix is almost always a transfer to a
        # person — suggest Transfers so the user just confirms.
        if best is None and transfers and "pix enviado" in categorize.normalize(tx.get("memo", "")):
            best = transfers
        tx["suggested_category"] = best
