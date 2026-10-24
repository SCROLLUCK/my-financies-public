# AI Features — my-financies

A single **finance agent** (Claude with tool-calling) powers both the **finance chat** (Q&A)
and **free-form capture over WhatsApp**, plus the **receipt OCR pipeline** (local Tesseract +
Claude text structuring). The agent has two kinds of tools:
- **read tools** — scoped ORM queries that answer questions (never mutate);
- **write skills** — actions that change data (register an expense, mark a bill paid, …),
  enabled only on capture channels and gated by a confirm/undo policy.

Which tools are enabled depends on the channel: the in-app Q&A chat gets **read tools only**;
the WhatsApp capture channel additionally gets the **write skills**.

> Model & SDK details (model IDs, tool-use format, pricing) must be checked against the
> current Anthropic docs at implementation time — do not hardcode from memory.

## 1. Finance chat

### Principle
The assistant **must not invent numbers**. It answers only from tool results that run real
database queries. If a question can't be mapped to a tool, it says so.

### Flow
```
user message
   ▼
POST /api/chat  ──▶  Claude (tool-use loop)
   ▲                    │  model requests a tool call
   │                    ▼
   │             backend runs the tool = a scoped ORM query
   │                    │  returns structured JSON
   └────────────────────┘  model composes the final NL answer
```

The backend runs a standard tool-use loop: send message + tool definitions → if the model
returns tool calls, execute them against the ORM and feed results back → repeat until the
model returns a final text answer.

### Tools (each maps to a safe, read-only ORM query)

| Tool | Params | Returns / answers |
|------|--------|-------------------|
| `get_spending_summary` | `period` (month/range), `group_by` (topic/category/merchant/day/none) | totals; "how much did I spend", "spend by topic", "spend per day" |
| `get_biggest_expense` | `period` | the top Expense row; "biggest expense this month" |
| `list_expenses` | `period`, `topic`/`category`/`merchant`/`kind`, `min_amount`/`max_amount`, `sort`, `limit` | individual expense rows, sorted + capped; the general-purpose lookup — "top 10 expenses", "expenses over R$200", "what did I buy from X" |
| `get_food_spending` | `period`, `split` (ifood/groceries/dining) | food totals; "iFood in June" |
| `list_subscriptions` | `active_only` | subscriptions + monthly total |
| `get_bill_status` | `name`/`query` | matching Bill(s) + status; "did I pay the internet boleto?" |
| `get_cheapest_store` | `product` | store with lowest latest price; "where is milk cheapest?" |
| `get_price_history` | `product` | price points over time |
| `run_sql_query` | `query` (one SQL SELECT) | last-resort escape hatch for shapes the typed tools above don't cover — see below |

Design rules for read tools:
- **Read-only.** These tools never mutate data.
- **Bounded output.** Cap rows (e.g. top N) so results fit the context cheaply.
- **Typed args over an ORM query, preferred.** Each typed tool above is a thin wrapper with
  typed args — cheaper and harder to misuse than free-form SQL, so the model is instructed to
  reach for these first.
- **`run_sql_query` is a deliberate, guarded exception**, added because the fixed typed tools
  can't anticipate every question shape (e.g. "top 10 individual expenses" needed a real row
  list, not another aggregate). Guardrails (`apps/chat/sql_tool.py`): only a single `SELECT`/
  `WITH ... SELECT` statement is accepted (keyword-blocklist rejects INSERT/UPDATE/DELETE/DDL/
  session commands); it always runs inside a transaction that is rolled back regardless of
  outcome, under a 3s Postgres `statement_timeout`; results are capped at 200 rows. The table/
  column list in its tool description is generated from the live Django model registry
  (`sql_tool.schema_text()`), so it can't drift from the real schema.

### Write skills (capture channels only)

Actions the agent may take when it judges the message calls for one. **The message is not a
rigid command** — any free-form text ("gastei 45,50 no ifood ontem", "paguei a luz", "põe leite
na lista") is interpreted by the model, which decides whether a skill applies and with what args.

| Skill | Args (model-filled) | Effect |
|-------|---------------------|--------|
| `register_expense` | `amount`, `category`, `date?` (default today), `description?`, `merchant?` | creates an Expense (`source=whatsapp`) |
| `mark_bill_paid` | `bill` (matched by name) | pays a bill → creates the linked Expense |
| `add_shopping_item` | `name`/`product`, `list?`, `quantity?` | adds an item to a shopping list |
| `undo_last` | — | reverts the last write in this chat (delete/unpay) |

Write-skill policy:
- **Category resolution is the model's job**, not regex: the current Topic→Category taxonomy is
  provided in context (it's small), so the model picks the right leaf; if it can't, it **asks**
  or uses "Other".
- **Ambiguity → ask, don't guess.** Missing amount, or two plausible categories → the agent
  replies with a clarifying question instead of writing.
- **Always echo + undo.** After a write, the agent replies with exactly what it did and offers
  `desfazer`/undo. Writes are cheap to reverse, so low-friction capture is safe.
- Every write skill records an audit row so `undo_last` and idempotency work.

### System prompt (intent)
- Role: a personal finance assistant answering strictly from the tools.
- Rules: use tools for any factual/numeric claim; never estimate; format money as BRL; be
  concise; if no tool fits, say what you can't answer.
- Locale: respond in the user's language (pt-BR), format dates/currency accordingly.

### MVP scope
- Conversation history is persisted (`Conversation` + `ChatMessage` models): each `POST /api/chat/`
  takes an optional `conversation_id`, loads that thread's prior messages as context (capped to
  the last 40), and saves both sides of the new exchange. The title is auto-set from the first
  user message. `GET/DELETE /api/conversations/` lets the UI list and reopen past chats.
- Synchronous request (no streaming) is acceptable first; streaming is a later polish.

## 2. Receipt OCR pipeline

Goal: photograph a receipt → a **draft** expense (and grocery price points) the user confirms.
Chosen approach: **local Tesseract** for raw text (zero cost, offline) + **Claude to structure
the receipt** into fields. When the API key is set, the structuring call attaches the **photo
itself** (with the OCR text as a cross-check aid) — real phone pictures proved too noisy for
text-only structuring, and a Haiku vision call on one receipt image costs well under a cent.

### Flow
```
1. Upload image        POST /api/receipts/            → Receipt(status=uploaded)
2. Preprocess          Pillow/OpenCV: grayscale, deskew, threshold
3. OCR                 pytesseract (lang=por) → Receipt.ocr_text
4. Structure           heuristics first; Claude structures image+ocr_text into JSON
                       → merchant_guess, date_guess, total_guess, line_items[]
                       Receipt(status=parsed)
5. Review              user edits the draft in the UI
6. Confirm             POST /api/receipts/{id}/confirm → creates Expense(source=receipt)
                       + PriceObservation per grocery line item
                       Receipt(status=confirmed)
```

### Structuring step
- **Heuristics** handle the easy, reliable bits: total (largest `R$` value / "TOTAL" line),
  date (regex), CNPJ (regex + check-digit validation → match a Merchant), and best-effort
  NFC-e line items (barcode + "1UN X price" patterns).
- **Claude structuring** (optional but recommended) reads the receipt photo (plus the OCR
  text as an aid) and returns a strict JSON object (merchant, date, total, line items with
  description+price) — far more reliable than OCR text alone on real phone photos, and the
  only path that recovers digits Tesseract drops. Enforce a JSON schema and validate before
  creating drafts.
- If the API key is absent, fall back to heuristics-only, still as a draft.
- **`kind` also distinguishes a payment confirmation** from a purchase receipt:
  `card_slip`/`itemized` (a store purchase) vs. `payment_receipt` (a banking-app screenshot
  confirming a Pix/TED/boleto payment — not a purchase). For `payment_receipt`, structuring
  fills `payee_name` (the recipient/beneficiary) instead of `merchant_name`, and `line_items`
  is always `[]`. See §3 for what happens next with that kind on the WhatsApp channel.

### Guardrails
- **Never auto-commit.** OCR output is always a draft requiring confirmation.
- Validate upload: image mime-type and max size.
- Store the original image (media volume) so the user can re-check against the parse.
- Tesseract `por` language pack must be installed in the backend image (see ARCHITECTURE §3).

## 3. WhatsApp capture (inbound routing)

The gateway forwards every message from the ingest group to `POST /api/wa/inbound`; the backend
hands it to the **finance agent** with the write skills enabled (see §1 and
[ARCHITECTURE.md](ARCHITECTURE.md) §6). There is **no rigid command grammar** — the message can be
anything, and the model decides what (if anything) to do.

- **Text (any phrasing) →** the agent interprets intent and, if warranted, calls a write skill:
  - "gastei 45,50 no ifood ontem" → `register_expense(amount=45.50, category=iFood, date=yesterday)`
  - "paguei a conta de luz" → `mark_bill_paid(bill="energia")`
  - "quanto gastei esse mês?" → a **read** tool (it's a question, not a capture) → answers
  - "põe leite na lista" → `add_shopping_item(name="leite")`
  - It **echoes what it did with an undo option**, or **asks a clarifying question** when the
    message is ambiguous or missing info (e.g. no amount). Nothing is written on a guess.
- **Image →** OCR pipeline above, `channel=whatsapp`. The agent **replies in the group** with the
  detected store/total/items and asks to **confirm (✅)**; receipt sits at `awaiting_confirmation`
  until `✅`/`confirmar` (→ create Expense + PriceObservations) or `cancelar` (→ `cancelled`).
  Photos keep confirm-first because OCR can be wrong; free-form text relies on echo+undo.
  - **Payment confirmations** (`kind=payment_receipt`): the paid amount is matched against
    pending `Bill`s (`apps/bills/services.py::match_pending_bill`, amount first, payee name to
    break ties — never guesses through an ambiguous match). If exactly one bill matches, the
    confirm reply changes to "looks like a payment for X" and `✅` calls `Bill.pay()` (marking it
    paid, linking its existing Expense) instead of creating a separate Expense — `bill.pay()`
    already creates its own linked Expense, so a second one would double-count the spend.
    `desfazer` reverts it the same way it reverts a text-triggered `mark_bill_paid`. If nothing
    matches (or more than one bill ties on amount+name), it falls back to the normal
    receipt-confirm path — a plain one-off Expense — so a payment is always recorded somewhere.
  - This bill-matching only runs for `channel=whatsapp`; a payment screenshot uploaded through
    the web Receipts review UI is treated like any other draft (no auto-pay path there).
- **Requires the API key** — free-form interpretation needs the model. Without it, WhatsApp text
  capture is disabled (the agent replies that it's unavailable); reminders and OCR still work.
- **Idempotency:** ignore a `wa_message_id` already processed (re-delivered messages).

## 4. Cost & privacy notes

- Chat sends the user's question + tool results to Anthropic. Tool results are small,
  aggregated numbers — not the full database.
- OCR structuring sends the receipt **image + OCR text** to Anthropic when enabled.
- WhatsApp capture sends the **message text** (+ the small category taxonomy) to Anthropic so the
  agent can interpret it; images go through the same OCR pipeline (photo + OCR text sent).
- Features degrade gracefully without the API key: in-app chat and WhatsApp text capture are
  disabled with a clear message; OCR falls back to heuristics; reminders still work.
