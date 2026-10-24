# Roadmap — my-financies

Delivery is phased so there's a working app early, then progressively richer capture and
intelligence. Each phase should end in a state that runs with `docker compose up`.

## Phase 0 — Foundation
- Monorepo scaffold, Docker Compose (`db`, `backend`, `frontend`), `.env.example`.
- Django project + DRF, Postgres wired, single-user auth, health check.
- Vite + React + Mantine (+ Tailwind utility layer) shell with routing and theme.
- **Done when:** the stack boots and the frontend can call a trivial backend endpoint.

## Phase 1 — Core ledger, taxonomy & dashboard
- Models: Topic, Category, Merchant, Expense, RecurringExpense, Bill.
- Seed default Topics → Categories (data migration); Categories management screen.
- CRUD for expenses, categories, merchants; recurring templates.
- Bill generation management command; mark-bill-paid → creates Expense.
- `/api/dashboard/` aggregation endpoint; Dashboard screen: **total spent so far**, **donut by
  topic**, **bar of spend per day**, upcoming/overdue bills.
- **Done when:** fixed + subscription + surprise expenses show in the monthly total; the
  dashboard shows the correct total-so-far, a by-topic chart, and a per-day chart; a bill can be
  marked paid.

## Phase 2 — Food, prices & planned purchases
- `is_food` categories and the Food view (iFood/delivery/groceries/dining, trend).
- Product + PriceObservation; Prices screen with cheapest-by-store and history.
- ShoppingList + ShoppingListItem; Shopping-list screen with check-off, cheapest-store hint,
  optional price capture on check.
- PlannedPurchase CRUD + screen; mark-as-purchased creates a ledger Expense; open-items total.
- **Done when:** milk prices at two stores are logged and the cheaper store is shown; a shopping
  list can be created and its items checked off; a planned fridge can be added and, when marked
  purchased, appears in the month's expenses.

## Phase 3 — Receipt OCR
- Receipt upload/capture; Tesseract (`por`) in the backend image; preprocessing.
- Heuristic parse + optional Claude text structuring → draft; review & confirm flow.
- Confirm creates Expense (+ grocery PriceObservations).
- **Done when:** a grocery receipt yields a confirmable draft with correct total and date.

## Phase 4 — Finance chat
- `/api/chat` tool-use loop with the read-only tools in [AI.md](AI.md).
- Chat UI; optional conversation history.
- **Done when:** the four sample questions in [PRD.md](PRD.md) §3.6 are answered correctly.

## Phase 5 — WhatsApp integration (reminders + capture)
Builds on Phase 3 (OCR) and Phase 4 (parsing). Split into two slices — 5a shipped first to
de-risk the unofficial-library/account-linking part before building capture on top of it.

### Phase 5a — gateway, linking, reminders (done)
- `whatsapp` Node gateway (Baileys): QR linking (`GET /qr`, `GET /status`), session persisted to a
  named volume, `POST /send`, best-effort `GET /chats` (populated from history sync + traffic).
- `notifications` app: `NotificationSetting` (singleton — `enabled`, `chat_id`/`chat_name`,
  `lead_days`, `notify_on_due_day`), `NotificationLog` (`(bill, lead_offset)` idempotency), a thin
  `gateway.py` HTTP client. A single chat (`chat_id`/`chat_name`) is used for reminders now, and
  will double as the capture source in 5b — one dropdown picker (of chats the gateway has seen),
  not a separate reminder-destination + ingest-source split. Settings screen: QR image, connection
  badge, reminder config, chat picker, test-send button.
- `send_bill_reminders` daily command — skips cleanly when disabled/not configured/gateway
  unreachable; never crashes on a gateway hiccup.
- **Done when:** scan the QR once, status shows connected; a bill inside its lead window produces
  exactly one WhatsApp message and one `NotificationLog` row, and re-running the command same-day
  doesn't double-send.

### Phase 5b — inbound capture (done)
- `POST /api/wa/inbound` — the gateway forwards every live (`type=notify`, not history-replay)
  message from `messages.upsert`; the backend checks it against `NotificationSetting.chat_id` and
  a `ProcessedWaMessage` idempotency table before doing anything.
- **Photo →** the existing OCR pipeline (`apps/receipts/services.process`), then
  `awaiting_confirmation` until a `✅`/`confirmar` or `cancelar` reply (handled as fixed keywords,
  not model judgment calls — same reasoning as `desfazer` below).
- **Free-form text →** the **finance agent with write skills** (`register_expense`,
  `mark_bill_paid`, `add_shopping_item`, `undo_last`; `apps/chat/write_tools.py`), sharing
  `apps/chat/service.py`'s tool-use loop with the read-only in-app chat via a `write_enabled` flag.
  `undo_last` is invoked directly from a fixed `"desfazer"` keyword rather than left to the model
  to decide to call — testing showed Haiku would sometimes claim an undo happened (or claim a
  bill/item wasn't found) without calling the tool at all. The other write skills run on
  `WHATSAPP_CAPTURE_MODEL` (Sonnet 5 by default), a stronger/pricier model than the in-app chat's
  Haiku, since real financial side effects need the more reliable tool-calling.
- **Done when:** posting a receipt photo yields a confirmable draft; "gastei 45,50 no ifood"
  creates that expense (right category); "quanto gastei esse mês?" is answered.
- **Payment receipts → bill paid:** the same photo pipeline also recognizes Pix/TED/boleto
  payment confirmations (`kind=payment_receipt` in the structuring step) and, when the paid
  amount matches exactly one pending `Bill`, offers to mark it paid on confirm instead of
  logging a generic expense — still draft-then-confirm, still reversible with `desfazer`. No
  match (or an ambiguous one) falls back to a normal one-off expense so the payment is always
  recorded. WhatsApp-only; the web Receipts review flow is unaffected.

## Phase 6 — Polish
- Empty/loading/error states everywhere; mobile responsiveness pass.
- Notifications on all mutations; pt-BR formatting audit.
- Backup docs (`pg_dump` + media), basic seed/demo data.
- Apply the design workflow ([FRONTEND.md](FRONTEND.md) §4) across all screens.

## Future — Open Finance (deferred, not scheduled)
Automatic bank/card import via a regulated aggregator (Pluggy or Belvo).
- New `source=open_finance` expenses; account linking; sync job.
- Requires: aggregator account, sandbox onboarding, likely Celery/Redis for sync, careful
  handling of credentials and consent. Evaluate cost/effort before committing.
- Deferred because manual entry + receipt OCR already cover the core value.

## Explicitly not planned
Multi-user, investments/net-worth, budgets/forecasting beyond monthly totals, native mobile
apps, multi-currency.
