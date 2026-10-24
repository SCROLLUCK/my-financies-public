import re
import unicodedata

from .models import Category


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in text if not unicodedata.combining(c))


def build_alias_map() -> list[tuple[str, Category]]:
    """(normalized alias, category) pairs from category aliases + names."""
    alias_map = []
    for category in Category.objects.all():
        for alias in category.aliases or []:
            alias_map.append((normalize(alias), category))
        alias_map.append((normalize(category.name), category))
    return alias_map


def match(text: str, alias_map: list[tuple[str, Category]]) -> Category | None:
    """Longest whole-word alias found in the text ("game" must not match
    inside "pagamento"); None when nothing matches."""
    haystack = normalize(text)
    best, best_len = None, 0
    for alias, category in alias_map:
        if len(alias) < 2 or len(alias) <= best_len:
            continue
        if re.search(rf"\b{re.escape(alias)}\b", haystack):
            best, best_len = category, len(alias)
    return best
