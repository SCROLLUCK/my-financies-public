import datetime
import re
from decimal import Decimal
from functools import lru_cache

from django.apps import apps
from django.db import connection, transaction

# App labels whose tables are relevant to finance questions (excludes django.contrib,
# and apps.chat which has no models of its own).
SCHEMA_APP_LABELS = ["core", "expenses", "bills", "shopping", "receipts", "statements"]

# Belt-and-suspenders: block anything that isn't a plain read, even though every
# query also runs inside a transaction that is always rolled back (see run_query).
FORBIDDEN_RE = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|CALL|"
    r"VACUUM|MERGE|EXECUTE|DO|SET|RESET|LOCK|REFRESH)\b",
    re.IGNORECASE,
)
LIMIT_RE = re.compile(r"\bLIMIT\s+\d+\s*$", re.IGNORECASE)
MAX_ROWS = 200
STATEMENT_TIMEOUT_MS = 3000


@lru_cache(maxsize=1)
def schema_text() -> str:
    """Real table/column names (Django's actual db_table/column), built once from
    the model registry so it can never drift from what's really in Postgres."""
    lines = []
    for label in SCHEMA_APP_LABELS:
        for model in apps.get_app_config(label).get_models():
            cols = ", ".join(f.column for f in model._meta.fields)
            lines.append(f"{model._meta.db_table}({cols})")
    return "\n".join(sorted(lines))


def _to_jsonable(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    return value


def run_query(query: str) -> dict:
    """Execute one read-only SQL SELECT against the app database. Always runs
    inside a transaction that is rolled back afterward and under a short
    statement timeout, so even a query that slips past the keyword check
    cannot persist a change or hang the connection."""
    if not query or not query.strip():
        return {"error": "Empty query."}

    stripped = query.strip().rstrip(";")
    if ";" in stripped:
        return {"error": "Only a single statement is allowed (no semicolons)."}
    if not re.match(r"^\s*(SELECT|WITH)\b", stripped, re.IGNORECASE):
        return {"error": "Only SELECT (or WITH ... SELECT) statements are allowed."}
    if FORBIDDEN_RE.search(stripped):
        return {"error": "Query contains a disallowed keyword. Read-only SELECT only."}
    if not LIMIT_RE.search(stripped):
        stripped = f"{stripped} LIMIT {MAX_ROWS}"

    try:
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}")
                cursor.execute(stripped)
                columns = [c[0] for c in cursor.description] if cursor.description else []
                rows = cursor.fetchmany(MAX_ROWS)
            transaction.set_rollback(True)
    except Exception as e:  # noqa: BLE001 - surfaced to the model as a tool error, not raised
        return {"error": f"Query failed: {e}"}

    return {
        "columns": columns,
        "rows": [[_to_jsonable(v) for v in row] for row in rows],
        "row_count": len(rows),
        "truncated": len(rows) >= MAX_ROWS,
    }
