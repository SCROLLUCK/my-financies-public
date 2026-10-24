# Data Model — my-financies

The ledger is the backbone: **Expense** is the record of money that left your pocket and is
the source of truth for "how much did I spend". Everything else either feeds the ledger
(recurring templates, bills, receipts) or annotates spending (categories, merchants, prices).

## 1. Entity map

```
Topic ─< Category ──┐
                    ├─< Expense >─── Merchant
Merchant ───────────┘        │  ▲
                             │  └──── Receipt (source, optional)
RecurringExpense ─< Bill ──(pay)──▶ Expense
                                     
Product ─< PriceObservation >─ Merchant
Receipt ─< PriceObservation (from grocery line items)
ShoppingList ─< ShoppingListItem >─ Product (optional)

Bill ─< NotificationLog          NotificationSetting (singleton)

PlannedPurchase ──(mark purchased)──▶ Expense

Conversation ─< ChatMessage
```

## 2. Entities

### Topic  *(level 1 — the top-level classification)*
The high-level bucket every expense rolls up to, driving the dashboard charts.
- `name` (str), `slug` (str)
- `is_food` (bool) — convenience flag for the Food module (true for the "Food" topic)
- `color`, `icon`, `order` (for the UI / chart legend)
- Seeded defaults (all user-editable): Aesthetics, Hygiene, Food, Mobility, Health,
  Leisure & entertainment, Housing, Subscriptions, Education, Other.

### Category  *(level 2 — subtopic; the leaf everything is classified at)*
Belongs to exactly one Topic. Expenses and other records point here (the leaf); the topic is
derived via `category.topic`.
- `topic` (FK Topic)
- `name` (str), `slug` (str)
- `aliases` (JSON list of str, optional) — hint keywords fed to the WhatsApp capture agent to
  help it map free-form text to this category, e.g. "iFood/Delivery" ← `["ifood", "rappi"]`,
  "Groceries" ← `["mercado", "feira"]`. A hint, not a hard rule — the model still decides.
- `color`, `icon` (optional; falls back to the topic's)
- Example leaves: Food → {Groceries, Restaurant, iFood/Delivery}; Mobility → {Fuel, Maintenance,
  Vehicle, Parking}; Health → {Pharmacy, Doctor, Dental}; Aesthetics → {Haircut, Skincare,
  Nails}; Hygiene → {Toiletries, Cleaning}; Leisure → {Streaming, Bars, Travel}. See §4 seed.

### Merchant
A place money is spent or a product is priced (store, restaurant, utility company).
- `name` (str)
- `kind` (enum: `grocery`, `restaurant`, `ifood`, `delivery`, `utility`, `service`, `other`)
- `cnpj` (str, optional — helps match receipts)

### Expense  *(the ledger — source of truth for spending)*
- `amount` (Decimal 12,2, BRL)
- `date` (date)
- `category` (FK Category)
- `merchant` (FK Merchant, nullable)
- `description` (str)
- `kind` (enum: `fixed`, `subscription`, `installment`, `one_off`) — provenance/intent
- `source` (enum: `manual`, `bill`, `receipt`, `whatsapp`, `open_finance`) — how it was created
  (`whatsapp` = a text quick-add like "ifood 45,50"; a WhatsApp receipt photo lands as `receipt`)
- `receipt` (FK Receipt, nullable)
- `bill` (FK Bill, nullable)
- timestamps

Queries like "biggest expense this month", "food spending in June", "subscription total"
are all aggregations over Expense.

### RecurringExpense  *(template for fixed expenses, subscriptions & card installments)*
Configured once; generates Bills on a cadence.
- `name` (str) — e.g. "Internet", "Netflix"
- `type` (enum: `fixed`, `subscription`, `installment`)
- `amount` (Decimal 12,2) — for installments, the amount per installment
- `cadence` (enum: `monthly`, `yearly`) — forced `monthly` for installments
- `due_day` (int 1–31) — day of month the bill is due
- `category` (FK), `merchant` (FK, nullable)
- `active` (bool), `start_date`, `end_date` (nullable)
- `installments` (int, nullable) — card purchases: total count; the first lands in
  `start_date`'s month, `end_date` is derived, and generated bills are named with
  progress ("Sofa (2/10)")

### Bill  *(a payable instance — "did I pay it?")*
- `name` (str)
- `amount` (Decimal 12,2)
- `due_date` (date)
- `status` (enum: `pending`, `paid`, `overdue`) — `overdue` derived when `pending` and past due
- `paid_at` (datetime, nullable)
- `recurring` (FK RecurringExpense, nullable — null for one-off boletos)
- `category` (FK)
- Paying a bill (`POST /bills/{id}/pay`) sets status/paid_at **and** creates an Expense
  (`source=bill`, linked back via `Expense.bill`).

### Receipt  *(OCR capture)*
- `image` (ImageField, stored on media volume)
- `uploaded_at` (datetime)
- `channel` (enum: `web`, `whatsapp`) — where the photo came from
- `wa_chat_id`, `wa_message_id` (str, nullable) — set when `channel=whatsapp`; `wa_message_id`
  also de-dupes re-delivered messages
- `ocr_text` (text) — raw Tesseract output
- `status` (enum: `uploaded`, `parsed`, `awaiting_confirmation`, `confirmed`, `cancelled`, `failed`)
- Parsed draft fields (nullable until parsed): `merchant_guess`, `date_guess`, `total_guess`,
  `line_items` (JSON), `suggested_category` (FK Category — Groceries for itemized cupons,
  else taxonomy-alias match on the merchant name; prefills the review form)
- On confirm (web UI, or a `✅` reply for `channel=whatsapp`): creates one Expense
  (`source=receipt`) and, for grocery line items, PriceObservations. See [AI.md](AI.md) §OCR.

### Product  *(for price comparison)*
- `name` (str) — normalized, e.g. "Milk, whole, 1L"
- `unit` (str) — e.g. "1L", "1kg", "un"
- `category` (FK, nullable)

### PriceObservation
One data point: this product cost this much at this store on this date.
- `product` (FK Product)
- `merchant` (FK Merchant)  — the store
- `price` (Decimal 12,2)
- `date` (date)
- `source` (enum: `manual`, `receipt`)
- `receipt` (FK Receipt, nullable — landed with the Receipt model in Phase 3)

"Where is milk cheapest?" = for the milk Product, the min latest `price` grouped by Merchant.

### ShoppingList
A supermarket list to check off while shopping.
- `name` (str) — e.g. "Weekly groceries"
- `store` (FK Merchant, nullable) — optional target store
- `status` (enum: `active`, `completed`, `archived`)
- `created_at`, `completed_at` (nullable)

### ShoppingListItem
- `list` (FK ShoppingList)
- `product` (FK Product, nullable) — optional link to the catalog (unlocks the cheapest-store hint)
- `name` (str) — free text; required when `product` is null, else defaults from the product
- `quantity` (Decimal, default 1), `unit` (str, nullable)
- `checked` (bool, default false), `checked_at` (datetime, nullable)
- `paid_price` (Decimal 12,2, nullable) — optional; if set at check-time and `product` is set,
  a PriceObservation (`source=manual`) is recorded
- `note` (str, nullable), `order` (int) — manual ordering within the list

### Conversation / ChatMessage  *(chat history — in-app and WhatsApp capture)*
- `Conversation`: `id`, `title`, `channel` (blank = in-app chat; `"whatsapp"` = the single
  WhatsApp-capture thread, hidden from the in-app sidebar but kept so the write-enabled agent has
  multi-turn context for clarifying questions), `created_at`, `updated_at`.
- `ChatMessage`: `conversation` (FK), `role` (`user`/`assistant`), `content` (text), `created_at`.
  Tool calls/results aren't persisted — each turn's history is just the prior text exchanges.

### LastCaptureAction  *(undo_last's memory)*
- `kind` (enum: `register_expense`, `mark_bill_paid`, `add_shopping_item`)
- `object_id` (int) — the `Expense`/`Bill`/`ShoppingListItem` id the write created/touched
- `created_at`
- One row per successful write-skill call; `undo_last` picks the most recent, reverses it
  (delete the expense / `Bill.unpay()` / delete the item), then deletes the row.

### StatementImport / StatementTransaction  *(bank statement import — .ofx/.csv)*
Draft-then-confirm import of bank/card statements (added alongside Phase 3).
- `StatementImport`: `file`, `original_name`, `format` (enum: `ofx`, `csv`), `bank`,
  `uploaded_at`, `transactions_found`, `duplicates_skipped`.
- `StatementTransaction`: `statement` (FK), `fitid` (str, unique — OFX FITID or a synthetic
  hash for CSVs; dedupes re-imports), `date`, `amount` (Decimal 12,2, absolute), `direction`
  (enum: `in`, `out`), `name`, `memo`, `status` (enum: `pending`, `imported`, `skipped`),
  `suggested_category` (FK Category, nullable — matched locally from category `aliases`),
  `expense` (OneToOne Expense, nullable).
- Confirming selected lines creates `Expense(source=open_finance)`; nothing is imported
  automatically.
- **Cross-source duplicate guard**: a real purchase can already be in the ledger via a
  receipt/WhatsApp/manual entry before its statement line ever gets imported — `fitid` only
  dedupes *within* statement imports, so it can't catch that. Each pending debit line is
  matched against existing non-`open_finance` expenses by exact amount + date within ±3 days
  (`StatementTransaction.find_possible_duplicate_expense`); a match surfaces as a "possible
  duplicate" badge in the review UI, and confirming with `link_expense_id` marks the line as
  accounted-for by that expense instead of creating a second one. Never automatic — the user
  decides per line.

### PlannedPurchase  *(future acquisitions / wishlist)*
Something the user intends to buy or do; not a spend until purchased.
- `name` (str) — e.g. "Fridge", "Replace kitchen faucet", "Diapers size GG"
- `estimated_cost` (Decimal 12,2, nullable — may be unknown)
- `priority` (enum: `low`, `medium`, `high`)
- `category` (FK Category, nullable)
- `target_date` (date, nullable)
- `notes` (text), `url` (str, nullable — where to buy)
- `status` (enum: `planned`, `purchased`, `dropped`)
- `expense` (FK Expense, nullable) — set when purchased
- `created_at`, `purchased_at` (nullable)
- Marking purchased (`POST /planned-purchases/{id}/purchase` with the actual amount) creates an
  Expense (`source=manual`) and links it here. Open (`planned`) items are never counted as
  expenses.

### NotificationSetting  *(singleton — single user)*
Reminder + linking preferences, editable from the Settings screen.
- `enabled` (bool) — master switch for `send_bill_reminders`
- `chat_id` (str, blank) / `chat_name` (str, blank) — the one WhatsApp chat used for everything:
  reminders are sent here, and it's also the chat watched for receipt/quick-add capture. A JID
  (DM `@s.whatsapp.net` or group `@g.us`), picked from a dropdown of chats the gateway has seen —
  not typed in
- `lead_days` (JSON list of ints, default `[7, 3, 1]`) — how many days before due to remind
- `notify_on_due_day` (bool)

### NotificationLog  *(idempotency + audit for reminders)*
- `bill` (FK Bill)
- `lead_offset` (int) — the days-before value that triggered this send (`0` = due day)
- `status` (enum: `sent`, `failed`)
- `error` (str, blank) — failure detail when `status=failed`
- `sent_at`
- `unique_together (bill, lead_offset)` — the actual idempotency guard the daily command checks
- `sent_at` (datetime)
- `message` (text) — the delivered content
- **Uniqueness:** at most one row per `(bill, lead_offset)` — this is what stops duplicate
  reminders when the daily job runs (or reruns).

### ProcessedWaMessage  *(idempotency for inbound WhatsApp capture)*
- `wa_message_id` (str, unique), `created_at`
- The gateway may redeliver a message (offline queue, flaky reconnect); `/api/wa/inbound` inserts
  here before doing anything else and no-ops if the id was already seen.

## 3. Modeling notes & decisions

- **Expense vs. Bill split.** Bills answer *"is it paid?"* (a to-do with a due date); Expenses
  answer *"how much did I spend?"* (the ledger). Paying a bill produces an Expense so totals
  stay correct without double counting. A surprise expense goes straight into Expense with no
  Bill. This keeps each question answerable from one table.
- **Fixed vs. subscription** is a `type` on RecurringExpense (and mirrored on `Expense.kind`),
  not two tables — they behave identically, only intent differs.
- **Two-level taxonomy (Topic → Category).** Every classified record (Expense, RecurringExpense,
  Bill, PlannedPurchase, Product) points at a **leaf Category**; the **Topic** is derived via
  `category.topic`. Dashboard charts group by Topic (with drill-down to Category). Both levels
  are user-editable data, not code enums, so the taxonomy can evolve without a migration.
- **Overdue is derived**, not stored, to avoid stale state: a `pending` bill past `due_date`
  is overdue. A daily management command can also flip persisted status if preferred.
- **Money is `Decimal(12,2)`** everywhere. No floats.
- **Draft-then-confirm** for receipts: OCR never writes an Expense directly; it writes a
  Receipt with guesses, the user confirms, then the Expense is created. Prevents garbage data.
- **Product normalization** is manual in the MVP (user picks/creates the Product when
  confirming a receipt line). Auto-matching by name is a later enhancement.

## 4. Seed taxonomy (default Topics → Categories)

Created by a data migration on first run; fully editable afterward.

| Topic | Default categories (leaves) |
|-------|------------------------------|
| Food *(is_food)* | Groceries, Restaurant, iFood/Delivery, Snacks |
| Hygiene | Toiletries, Cleaning supplies |
| Aesthetics | Haircut, Skincare, Nails, Cosmetics |
| Health | Pharmacy, Doctor, Dental, Gym |
| Mobility | Fuel, Maintenance, Vehicle, Parking, Tolls, Ride-hailing/Transit |
| Leisure & entertainment | Streaming, Bars, Travel, Games, Events |
| Housing | Rent, Condo, Utilities, Internet, Furniture |
| Subscriptions | Software, Memberships |
| Education | College, Courses, Books, School supplies |
| Other | Uncategorized |

Notes: the six topics the user named are the core; Housing / Subscriptions / Other are added so
pre-existing examples (rent, internet, Netflix) have a home. "Gym" and "Streaming" placements are
opinionated defaults — the user can move any category to another topic.
