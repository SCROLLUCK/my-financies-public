# Product Requirements — my-financies

## 1. Vision

A private, self-hosted app to **understand and control cost of living**. It replaces the
spreadsheet-plus-mental-math routine with a single place that knows your recurring
commitments, your day-to-day spending, and answers questions about them in plain language.

The differentiators over a generic budgeting app are the **low-friction capture**
(photograph a receipt instead of typing), the **food/iFood focus**, the **grocery price
comparison**, and the **conversational interface** over real data.

## 2. User & context

- **Single user** (the owner), running locally. No multi-tenant, no sharing.
- **Currency:** BRL. **Locale:** pt-BR formatting in the UI; code/data in English.
- **Auth:** a single login (see Architecture) — required now that the app is deployed on a VPS
  rather than staying purely local-only.
- **Data is personal and stays local**, except text sent to the Anthropic API for chat and
  optional receipt structuring.

## 3. Modules & requirements

### 3.1 Expenses (core ledger)
The ledger of money that left your pocket — the source of truth for "how much did I spend".

- Record an expense: amount, date, category, store/merchant, description, source.
- Three conceptual kinds, all landing in the same ledger:
  - **Fixed** (rent, condo, internet) — recurring, predictable.
  - **Subscription** (Netflix, Spotify, gym) — recurring, cancelable.
  - **Surprise / one-off** (car repair, gift) — ad hoc.
- Fixed and subscriptions are configured once as **recurring templates** that generate
  monthly bills automatically (see 3.2).
- **Every expense is classified in a two-level taxonomy: a Topic (level 1) and a Category
  (level 2 / subtopic).** Seeded topics (all editable): Aesthetics, Hygiene, Food, Vehicle,
  Health, Leisure & entertainment (+ Housing, Subscriptions, Other). Categories are the leaves
  (e.g. Vehicle → Fuel/Maintenance/Insurance). See [DATA_MODEL.md](DATA_MODEL.md) §4.
- Filter and total by month, topic, category, and store.

### 3.2 Bills & boletos (what's due / what's paid)
Answers "did I already pay X?" and "what's due this week?".

- A bill has: name, amount, due date, status (`pending` / `paid` / `overdue`), paid date.
- Bills can be generated from recurring templates (fixed/subscriptions) or added manually
  (a one-off boleto).
- Marking a bill **paid** creates the corresponding ledger expense.
- Dashboard shows upcoming and overdue bills.

### 3.3 Food & iFood tracking
A focused lens on food spending because it's volatile and worth watching.

- Any expense under the **Food topic** (categories: Groceries, Restaurant, iFood/Delivery, …)
  feeds here.
- Views: monthly food total, split iFood/delivery vs. groceries vs. dining out, trend over time.
- Quick-add optimized for the common case (iFood order: amount + date).

### 3.4 Price comparison
Answers "where is product X cheapest?".

- Track a **product** (e.g. "Milk, whole, 1L") and observations of its **price per store**
  over time.
- Price observations come from manual entry or from parsed receipts (3.5).
- View: per product, the latest and lowest price by store; price history.

### 3.5 Receipt scanning (OCR)
Low-friction capture. Photograph a receipt → a draft expense to confirm.

- Upload/take a photo → stored as a Receipt. Two channels: the web UI, or **WhatsApp** (§3.11).
- Local OCR (Tesseract) extracts raw text; a parsing step extracts merchant, date, total,
  and (for groceries) line items.
- Produces a **draft** expense (and draft price observations for grocery line items) that the
  user **reviews and confirms** before it's saved. Never auto-commits silently.

### 3.6 Finance chat
Natural-language questions answered from the user's real data.

- Example questions to support at launch:
  - "What was my biggest expense this month?"
  - "How much did I spend on iFood in June?"
  - "Where is milk cheapest?"
  - "Did I already pay the internet boleto?"
  - "What are my active subscriptions and their total?"
- The assistant answers using structured tools that query the database — it does **not**
  invent numbers (see [AI.md](AI.md)).

### 3.7 WhatsApp bill reminders
Get pinged on WhatsApp before a bill/boleto is due, so nothing is missed.

- A **daily job** scans `pending` bills and sends a WhatsApp reminder when a bill is within a
  configured lead window.
- **Lead window is configurable** (e.g. 7, 3, and 1 day before due date; plus optionally on the
  due day). Defaults live in notification settings.
- **De-duplicated:** each (bill, lead-offset) reminder is sent at most once; no daily spam for
  the same bill. Reminders stop once the bill is marked paid.
- Message contents: bill name, amount, due date, and days remaining.
- Delivery via an **unofficial WhatsApp gateway** (whatsapp-web.js/Baileys) running as its own
  service; the user's WhatsApp account is linked once by scanning a QR code. See
  [ARCHITECTURE.md](ARCHITECTURE.md) §Notifications.
- **Caveat (documented risk):** unofficial WhatsApp automation violates WhatsApp's Terms of
  Service and can lead to the number being banned or the integration breaking on updates. This
  is an accepted trade-off for a personal, local setup; the feature must fail gracefully (a
  reminder that can't be delivered is logged, never crashes the app).

### 3.8 Planned purchases (future acquisitions)
A wishlist/plan of things to buy or do, from big-ticket items to small chores — e.g. a fridge,
a wardrobe, replacing the kitchen faucet, a pack of size-GG diapers.

- Add a planned purchase: name, estimated cost (optional — may be unknown), priority
  (`low`/`medium`/`high`), category, target date (optional), notes, and an optional link.
- Status: `planned` → `purchased` → (or `dropped`).
- **Mark as purchased** captures the actual amount and creates a ledger Expense
  (`source=manual`, linked back), so a plan becomes real spending without re-typing.
- Views: list filtered by status/priority; total estimated cost of open items ("how much do I
  need for everything I'm planning to buy?").
- This is a planning list, **not** part of the spend ledger until an item is purchased — open
  items never count as expenses.

### 3.9 Dashboard
The home screen — an at-a-glance monthly overview.

- **Total spent so far this month** shown prominently (e.g. "Total gasto até agora: R$ 3.000,23"),
  with a compare-to-last-month delta.
- **Spending by topic** for the selected month — a donut/pie chart (Aesthetics, Hygiene, Food,
  Vehicle, Health, Leisure…), with drill-down to categories.
- **Spending per day** for the selected month — a bar/line chart of the daily totals, to spot
  spikes; optionally a cumulative line reaching the "total so far".
- **Upcoming & overdue bills** (from 3.2).
- **Food snapshot** (from 3.3).
- Month selector; all widgets react to the chosen month. "So far" for the current month means
  up to today; for past months it's the full month.
- Charts are built with Mantine's chart components (see [FRONTEND.md](FRONTEND.md)); the numbers
  come from backend aggregation endpoints, not client-side math.

### 3.10 Shopping list
Build a supermarket shopping list and check off items as you pick them up.

- Create a list (e.g. "Weekly groceries"), optionally tied to a target store.
- Add items: free-text name, or pick a **Product** from the catalog; with quantity/unit and
  optional notes.
- **Check items off** as you grab them (a checkbox per item); the list shows remaining vs. done.
- Items linked to a Product can show a **"cheapest store" hint** from the price-comparison data
  (§3.4) — helping decide where to shop.
- Optional at check-time: enter the price paid → records a **PriceObservation** (§3.4), so
  shopping also feeds the price history. Purely optional; the core is the checkbox.
- Lists can be reused/duplicated and archived when done.

### 3.11 WhatsApp capture (inbox)
Register expenses straight from WhatsApp by posting to a dedicated **personal group** — the
fastest capture path, usable on the go.

- **Setup:** the app links the user's WhatsApp once (QR) and watches one chosen group. Same
  number, no bot number needed; the app reads what the user posts there (see
  [ARCHITECTURE.md](ARCHITECTURE.md) §6).
- **Photo of a receipt →** runs OCR (§3.5), then **replies in the group** with what it detected
  (store, total, items) and asks to **confirm (✅)**. On confirm it creates the expense; on
  `cancelar` it discards. Nothing is saved until confirmed.
- **Text (any phrasing) →** an AI agent interprets the message — not a fixed command. "gastei
  45,50 no ifood ontem", "paguei a luz", "põe leite na lista", or "quanto gastei esse mês?" all
  work: the agent decides whether to **register an expense**, mark a bill paid, add a shopping
  item, or just answer a question. It replies with what it did and a **`desfazer` (undo)** option,
  or asks a clarifying question when the message is ambiguous. See [AI.md](AI.md) §1 (write skills).
- Reuses the same reminders gateway (§3.7); it's one WhatsApp integration doing send + receive.
- **Requires the AI (API key)** for free-form text; **same documented ToS caveat** as §3.7 applies.

## 4. Out of scope (MVP)

- **Open Finance / bank & card auto-import** — deferred (see [ROADMAP.md](ROADMAP.md)); requires
  a regulated aggregator (Pluggy/Belvo).
- Multi-user, sharing, roles.
- Mobile native apps (the web UI should be responsive/mobile-friendly instead).
- Investments, net-worth tracking, forecasting/budgets beyond simple monthly totals.
- Multi-currency.

## 5. Success criteria

- Add a fixed expense, a subscription, and a surprise expense; see them in this month's total.
- Mark the internet bill paid and have the chat correctly answer that it's paid.
- Scan one grocery receipt and confirm a draft expense with at least the total and date correct.
- Log milk prices at two stores and have the chat name the cheaper one.
- Link WhatsApp once (QR) and receive a reminder for a bill due within the lead window, exactly once.
- Everything runs with a single `docker compose up`.
