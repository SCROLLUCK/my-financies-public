import functools
import json
import logging

import anthropic
from django.conf import settings
from django.utils import timezone

from .tools import TOOLS, run_tool
from .write_tools import DISPATCH as WRITE_DISPATCH
from .write_tools import WRITE_TOOLS, mark_bill_paid, register_expense, taxonomy_text

logger = logging.getLogger(__name__)

MAX_TOOL_ITERATIONS = 6

SYSTEM_PROMPT = """You are the finance assistant for my-financies, a personal finance app for a \
single user in Brazil.

Rules:
- Answer only using data returned by tool calls. Never invent or estimate numbers.
- Prefer the typed tools; fall back to run_sql_query only for shapes they don't cover.
  If even that can't answer it (nothing to query), say so plainly instead of guessing.
- Use tools freely, including multiple calls, to fully answer compound questions.
- Format all money amounts as Brazilian Reais (e.g. R$ 1.234,56).
- Respond in Brazilian Portuguese, concisely.
- Markdown is rendered by the UI — use **bold** and "- " lists where they help readability.
- Today's date is {today}."""

# Appended to SYSTEM_PROMPT only for the WhatsApp capture channel (write_enabled=True).
# The base SYSTEM_PROMPT stays byte-for-byte unchanged so the in-app chat's
# prompt-cache key/hit-rate is unaffected.
WRITE_ADDENDUM = """

You are also connected via WhatsApp, where you may take actions using the write tools \
(register_expense, mark_bill_paid, add_shopping_item, undo_last) when the user's free-form \
message calls for one — not every message is a command, some are just questions (use the \
read-only tools for those instead).
- Formatting override: this reply goes straight into a WhatsApp message, not the app's Markdown \
UI. Do NOT use **double-asterisk** bold or Markdown headers/tables — WhatsApp doesn't render \
them (they show up as literal asterisks). Use WhatsApp's own formatting instead: *single \
asterisk* for bold, _underscore_ for italic, and plain "- " for lists. Keep it light.
- CRITICAL: whenever the user's message calls for one of these four actions, you MUST actually \
call the corresponding tool and base your reply strictly on what it returned. Never reply that \
something was found/not found, done/undone, or created based on what you see earlier in this \
conversation, or on assumption — you cannot know the real outcome (an expense may already be \
undone, a bill may or may not exist, spelled differently than expected) without calling the \
tool. This applies equally to reporting failure as success: do not guess a bill/item "doesn't \
exist" without calling the tool to check.
- Category resolution is your job: pick the best-matching category from the taxonomy below.
- If required info is missing or ambiguous (no amount, unclear category, unclear which bill or \
shopping list), ask a short clarifying question instead of guessing or writing anything.
- After any successful write, briefly echo back what you did and mention "responda 'desfazer' \
para desfazer".

Category taxonomy (Topic: categories):
{taxonomy}"""


def _as_blocks(content) -> list[dict]:
    return [{"type": "text", "text": content}] if isinstance(content, str) else list(content)


def _with_cache_breakpoint(msg: dict) -> dict:
    """Copy of msg with an ephemeral prompt-cache marker on its last content block."""
    blocks = [dict(b) for b in _as_blocks(msg["content"])]
    blocks[-1]["cache_control"] = {"type": "ephemeral"}
    return {**msg, "content": blocks}


def answer(
    message: str,
    history: list[dict] | None = None,
    write_enabled: bool = False,
    spent_by: str = "",
) -> str:
    """Runs the tool-use loop for one user turn; returns the final text reply.
    `history` is a flat list of prior {role, content} *text* turns — tool
    calls/results are not carried across turns, so results are always fresh and
    context stays small.

    `write_enabled` adds the WhatsApp-capture write skills (register_expense,
    mark_bill_paid, add_shopping_item, undo_last) on top of the read-only
    tools — used only for the WhatsApp channel, never the in-app chat.

    `spent_by` (Expense.SpentBy value, e.g. "owner"/"partner") is resolved by the
    caller from the WhatsApp message's sender — it's metadata the model has no
    way to know from the text itself, so it's bound onto register_expense/
    mark_bill_paid via functools.partial rather than exposed as a tool argument
    the model could see or guess at.

    Prompt caching: the system prompt (which also caches the tool definitions,
    since those render just before it) always gets a cache breakpoint — it's
    the same bytes on every request within a day. The tail of `history` gets
    one too, so a same-conversation follow-up within the 5-minute TTL reuses
    the whole prior transcript instead of repaying for it."""
    if not settings.ANTHROPIC_API_KEY:
        return "O chat financeiro precisa de uma ANTHROPIC_API_KEY configurada no servidor."

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    history = list(history or [])
    if history:
        history[-1] = _with_cache_breakpoint(history[-1])
    messages = history + [{"role": "user", "content": message}]

    system_text = SYSTEM_PROMPT.format(today=timezone.localdate().isoformat())
    if write_enabled:
        system_text += WRITE_ADDENDUM.format(taxonomy=taxonomy_text())
    system = [{"type": "text", "text": system_text, "cache_control": {"type": "ephemeral"}}]
    tools = TOOLS + WRITE_TOOLS if write_enabled else TOOLS
    extra_dispatch = None
    if write_enabled:
        extra_dispatch = dict(WRITE_DISPATCH)
        if spent_by:
            extra_dispatch["register_expense"] = functools.partial(
                register_expense, spent_by=spent_by
            )
            extra_dispatch["mark_bill_paid"] = functools.partial(
                mark_bill_paid, spent_by=spent_by
            )
    model = settings.WHATSAPP_CAPTURE_MODEL if write_enabled else settings.CHAT_MODEL

    for _ in range(MAX_TOOL_ITERATIONS):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=2000,
                system=system,
                tools=tools,
                messages=messages,
            )
        except anthropic.APIError:
            logger.exception("Chat completion failed")
            return "Tive um problema para responder agora. Tente de novo em instantes."

        usage = response.usage
        logger.info(
            "chat usage: input=%d cache_read=%d cache_write=%d output=%d",
            usage.input_tokens,
            usage.cache_read_input_tokens or 0,
            usage.cache_creation_input_tokens or 0,
            usage.output_tokens,
        )

        tool_uses = [b for b in response.content if b.type == "tool_use"]
        if not tool_uses:
            texts = [b.text for b in response.content if b.type == "text"]
            return "\n".join(texts).strip() or "Não consegui gerar uma resposta."

        messages.append({"role": "assistant", "content": response.content})
        tool_results = [
            {
                "type": "tool_result",
                "tool_use_id": tool_use.id,
                "content": json.dumps(
                    run_tool(tool_use.name, tool_use.input, extra_dispatch=extra_dispatch),
                    ensure_ascii=False,
                ),
            }
            for tool_use in tool_uses
        ]
        messages.append({"role": "user", "content": tool_results})

    return "Não consegui concluir a resposta (muitas chamadas de ferramentas em sequência)."
