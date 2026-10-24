# Architecture — my-financies

## 1. Overview

A monorepo with three long-running services orchestrated by Docker Compose:

```
┌─────────────┐      HTTP/JSON       ┌──────────────┐      SQL       ┌────────────┐
│  frontend   │  ───────────────▶    │   backend    │  ──────────▶   │  postgres  │
│ Vite/React  │   /api/*             │  Django/DRF  │                │            │
│  Mantine    │  ◀───────────────    │              │  ◀──────────   │            │
└─────────────┘                      └──────┬───────┘                └────────────┘
                                            │
                                            ▼ (chat, receipt structuring)
                                     ┌──────────────┐
                                     │ Anthropic API│
                                     └──────────────┘
       OCR (Tesseract) runs in-process inside the backend container.
```

A fourth service, `whatsapp`, is an internal-only **bidirectional** Node gateway holding one
linked WhatsApp session. It **sends** bill reminders and confirmation replies, and **receives**
receipt photos from a configured group to ingest expenses (see §6).

```
                 send (reminders / replies)
┌──────────┐ ─────────────────────────────▶ ┌──────────────┐  Baileys/whatsapp-web.js
│ backend  │                                 │  whatsapp    │ ◀──▶ WhatsApp (your account)
│          │ ◀───────────────────────────── │ (Node, internal)     ▲ personal receipts group
└──────────┘   forward inbound msgs          │  QR session  │       │ you post a receipt photo
                (images, ✅ confirmations)    └──────────────┘
```

Everything is local-first. Outbound network calls: the Anthropic API for the chat agent (and
optional OCR structuring), and WhatsApp via the gateway (reminders out, receipt photos in).

## 2. Monorepo layout

```
my-financies/
├── docker-compose.yml
├── .env.example
├── README.md
├── docs/
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── manage.py
│   ├── config/                 # Django project (settings, urls, wsgi)
│   └── apps/
│       ├── expenses/           # ledger, topics/categories, merchants, dashboard aggregation
│       ├── bills/              # recurring templates + bills/boletos
│       ├── receipts/           # upload + OCR pipeline
│       ├── prices/             # products + price observations
│       ├── shopping/           # shopping lists + checkable items
│       ├── chat/               # finance chat agent (tools + endpoint)
│       ├── purchases/          # planned purchases (future acquisitions)
│       └── notifications/      # settings, daily reminder job, gateway client, log
├── whatsapp/                   # Node WhatsApp gateway (Baileys)
│   ├── Dockerfile
│   ├── package.json
│   └── index.js                # /status, /qr, /chats, POST /send; QR auth, persisted session
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── index.html
    └── src/
        ├── main.tsx
        ├── api/                # typed API client
        ├── components/         # shared UI
        ├── features/           # one folder per PRD module
        └── pages/
```

Rationale: Django apps map 1:1 to PRD modules; frontend `features/` mirror the same modules,
so a change to "prices" touches `apps/prices` and `features/prices` and nothing else.

## 3. Services (docker-compose)

| Service    | Image / base                    | Port  | Notes |
|------------|---------------------------------|-------|-------|
| `db`       | `postgres:16`                   | 5432  | Named volume for data. |
| `backend`  | Python 3.12 (custom Dockerfile) | 8000  | DRF; installs `tesseract-ocr` + `tesseract-ocr-por`. Dev: `runserver`. |
| `frontend` | Node 20 (custom Dockerfile)     | 5173  | Vite dev server; proxies `/api` to backend. |
| `whatsapp` | Node 20 (custom Dockerfile)     | 3000 (internal) | WhatsApp gateway; **not published to host**. Persists session on a named volume. |

- **Media/uploads:** receipt images stored on a named volume mounted at `backend/media`.
- **WhatsApp session:** stored on a named volume mounted in the `whatsapp` service; sensitive
  (a full account session) — never commit, keep the port internal to the compose network.
- **No Celery/Redis in the MVP.** Both recurring bill generation and reminder sending run via
  management commands (`generate_bills`, `send_bill_reminders`) invoked by a host cron. Async
  workers are a later addition if OCR/chat latency demands it (see ROADMAP).

## 4. Backend design

- **Django REST Framework** with ViewSets + routers; one app per module.
- **Auth:** single-user. Session auth with one seeded superuser is enough for a local app;
  the SPA logs in once. Do not build multi-user features. (Token/JWT only if a second client
  ever needs it.)
- **Settings** read from environment (`django-environ`), never hardcoded secrets.
- **API prefix:** all endpoints under `/api/`. DRF browsable API enabled in dev.
- **Money:** `DecimalField(max_digits=12, decimal_places=2)`. Never floats for money.
- **Time:** store timezone-aware UTC; format in the UI.

### Key endpoints (indicative)
```
/api/topics/               CRUD (level-1 taxonomy)
/api/categories/           CRUD (level-2 leaves; ?topic=)
/api/merchants/            CRUD
/api/expenses/             CRUD + ?month=&topic=&category=&merchant=  (+ summary actions)
/api/dashboard/            GET ?month= → { total_so_far, prev_month_total,
                                           by_topic[], by_day[], upcoming_bills[] }
/api/recurring/            CRUD (fixed + subscriptions)
/api/bills/                CRUD + POST {id}/pay
/api/products/             CRUD
/api/prices/               CRUD + ?product=  (+ cheapest action)
/api/shopping-lists/       CRUD (nested items)
/api/shopping-items/       CRUD + PATCH {id} {checked} (check/uncheck)
/api/receipts/             POST (upload) → draft; POST {id}/confirm
/api/planned-purchases/    CRUD + POST {id}/purchase (creates an Expense)
/api/chat/                 POST {message, conversation_id?} → answer
/api/notifications/settings/   GET/PUT (enabled, chat_id, chat_name, lead_days, notify_on_due_day)
/api/notifications/status/     GET WhatsApp link state; POST link → returns QR to scan
/api/notifications/test/       POST → send a test WhatsApp message
/api/wa/inbound/               POST (internal; called by the gateway with forwarded messages)
```

## 5. Frontend design

- **Vite + React + TypeScript.**
- **Mantine** as the primary component system (see [FRONTEND.md](FRONTEND.md)).
- **Tailwind** as a secondary utility layer (layout/spacing), with `preflight` disabled to
  avoid clashing with Mantine's reset.
- Typed API client generated/handwritten against the DRF endpoints.
- State/data fetching via TanStack Query.

## 6. WhatsApp integration (reminders out + capture in)

One `whatsapp` gateway, three jobs: **send** bill reminders (PRD §3.7), and **receive** receipt
photos and text quick-adds from a configured personal group (PRD §3.11), replying in that group.

### Components
- **`whatsapp` gateway (Node service, Baileys).** Node-only, hence a separate service. It:
  - links the user's WhatsApp once via QR (session persisted on a named volume);
  - exposes `POST /send { to, message }` (internal only) for reminders and replies;
  - **forwards every live message** (`messages.upsert` events with `type="notify"` — history
    replayed on reconnect is `type="append"` and is never forwarded, so old messages can't be
    reprocessed as fresh commands) to the backend: JSON `POST /api/wa/inbound
    { chat_id, message_id, text }`, or multipart with an `image` file + `caption` for photos.
    The gateway itself doesn't filter by which chat — it's a true dumb pipe;
  - exposes `GET /status` / a QR endpoint for the linking flow surfaced in the UI.
- **`notifications` Django app.** Reminder settings, logic, log, and the gateway HTTP client.
- **Inbound router (backend `/api/wa/inbound`).** Checks the forwarded `chat_id` against
  `NotificationSetting.chat_id` (ignores everything else), gates on `ProcessedWaMessage` for
  idempotency, then classifies and dispatches (details below). The gateway is a dumb pipe; the
  backend is the brain.

### Daily reminder job (`manage.py send_bill_reminders`)
Run by host cron once a day (e.g. 09:00):
1. If notifications disabled or WhatsApp not linked → exit.
2. For each `pending` bill, compute `days_until = due_date - today`.
3. If `days_until` matches a `lead_days` value (e.g. 7/3/1), or `== 0` and `notify_on_due_day`.
4. Skip if a `NotificationLog` exists for `(bill, offset)` (idempotent — no daily spam).
5. Send via the gateway; record a `NotificationLog` (`sent`/`failed`). Failures logged, never fatal.

### Inbound capture (from the ingest group)
The router forwards the message to the **finance agent** (Claude + tools, write skills enabled —
see [AI.md](AI.md) §1). There is **no fixed command grammar**; the model interprets any phrasing
and decides which skill, if any, to invoke:
- **Image →** create a `Receipt` (`channel=whatsapp`, storing `wa_chat_id`/`wa_message_id`) → run
  the OCR pipeline → the agent replies with the parsed store/total/items and asks to **confirm
  (✅)**. On a later `✅`/`confirmar` → create the Expense (+ price observations); `cancelar`
  discards. Draft-then-confirm — OCR is never auto-committed.
- **Text (any wording)** → the agent judges intent and may call a write skill
  (`register_expense`, `mark_bill_paid`, `add_shopping_item`) or a read tool for a question. It
  **echoes what it did with an undo option**, or **asks for clarification** when the message is
  ambiguous/missing info. Not confirm-first (unlike OCR): the user authored the text, and every
  write is reversible via `undo_last`. Runs on `WHATSAPP_CAPTURE_MODEL` (Sonnet 5 by default) —
  a stronger model than the in-app chat's Haiku, since testing showed a cheaper model isn't
  reliable enough at actually calling a write tool (vs. answering as if it had) when real money
  is on the line.
- **Confirmation/undo words** (`✅`, `confirmar`, `cancelar`, `desfazer`) → resolved as fixed
  keywords in the inbound view itself, *not* left to the agent's judgment: `✅`/`confirmar`
  against the chat's pending `awaiting_confirmation` Receipt, `cancelar` the same, and
  `desfazer` calls `undo_last` directly. Testing found the model unreliable at reliably calling
  `undo_last` itself (sometimes claiming success without calling it, sometimes claiming nothing
  happened without checking) — deterministic keywords remove that risk for the one-word cases
  the docs already promise, the same way the OCR confirm/cancel words never depended on the model.

### Design notes
- **Unofficial gateway = documented risk** (ToS violation, possible ban / breakage). Accepted for a
  personal local app; degrades gracefully if the gateway is down or unlinked.
- **Same account + personal group:** the gateway forwards from whatever chat a message arrives in;
  the backend only acts on messages from `NotificationSetting.chat_id`, set from the UI. Replies
  appear as sent by the user — no second number needed.
- **Idempotency:** reminders via `NotificationLog(bill, lead-offset)`; inbound via
  `ProcessedWaMessage(wa_message_id)` (don't double-process a re-delivered message).
- Only `WHATSAPP_GATEWAY_URL` and `INGEST_CHAT_ID` are env/config; the rest lives in the DB.

## 7. Configuration & secrets

`.env` (from `.env.example`):
```
POSTGRES_DB=financies
POSTGRES_USER=financies
POSTGRES_PASSWORD=change-me
DATABASE_URL=postgres://financies:change-me@db:5432/financies
DJANGO_SECRET_KEY=change-me
DJANGO_DEBUG=1
ANTHROPIC_API_KEY=sk-ant-...
WHATSAPP_GATEWAY_URL=http://whatsapp:3000
INGEST_CHAT_ID=                # WhatsApp group id the gateway listens to (set after linking)
```
Secrets never committed. `.env` is git-ignored; `.env.example` documents the keys.

### Dev vs prod compose
- **`docker-compose.dev.yml`** — builds locally, mounts source for hot-reload; backend on
  `runserver`, frontend on the Vite dev server. Uses `.env`.
- **`docker-compose.prod.yml`** — pulls pre-built images from GitLab's container registry;
  backend runs `migrate` + `ensure_superuser` + `collectstatic` + gunicorn, frontend is the built
  SPA served by nginx (which proxies `/api` to the backend). A reverse proxy (nginx + TLS) sits in
  front of the frontend's `127.0.0.1`-bound host port. Uses `.env.prod`.

### CI/CD
The repo lives on GitLab (`gitlab.com/<owner>/my-finances`). `.gitlab-ci.yml` builds and pushes
all three images to GitLab's own container registry on every push to `main` (tags `latest` +
commit sha), authenticating with GitLab CI's built-in `$CI_REGISTRY_*` variables — no manually
managed deploy token needed. Images:
`registry.gitlab.com/<owner>/my-finances/{backend,frontend,whatsapp}`. They're private, so a
deploy host must `docker login registry.gitlab.com` before pulling.

## 8. Key technical decisions (ADR-lite)

| # | Decision | Why | Trade-off |
|---|----------|-----|-----------|
| 1 | Monorepo, one Docker Compose | Single-command local run; modules stay aligned | Coupled deploy (fine for local) |
| 2 | DRF over FastAPI | Admin, ORM, migrations, batteries-included for CRUD-heavy app | Heavier than needed for pure API |
| 3 | Mantine over shadcn | User preference; batteries-included components speed up screens | Not Tailwind-first; Tailwind demoted to utilities |
| 4 | Local Tesseract OCR | Zero per-scan cost, offline | Lower accuracy on messy receipts; mitigated by Claude text structuring |
| 5 | Claude for chat via tool-calling | Answers grounded in DB queries, not hallucinated | External API dependency + cost |
| 6 | No Celery in MVP | Simplicity; bill generation is a daily batch | Long OCR/chat calls block a request thread |
| 7 | Open Finance deferred | Needs regulated aggregator, real cost/onboarding | No automatic card import yet |
| 8 | Unofficial WhatsApp gateway, bidirectional (Node service) | User choice; zero cost, one linked personal account sends reminders + captures receipts/quick-adds | Violates WhatsApp ToS; ban/breakage risk; extra service |
| 9 | Reminders via daily management command | Consistent with bill generation; no Celery | Not real-time (once-a-day granularity) |
| 10 | WA text capture = the LLM agent interpreting free-form messages (not a regex parser) via write skills | Any phrasing works; the model picks the category and skill | Needs the API key; a misread is possible (mitigated by echo + `undo_last`) |
| 11 | Photos confirm-in-chat, text writes echo-with-undo | Matches risk: OCR can be wrong (confirm first), user-typed text is reversible (undo suffices) | Two inbound handling styles |

## 9. Non-functional notes

- **Security:** the app now enforces the §4 auth (session login + `IsAuthenticated` by default
  on every DRF endpoint) since it's moving to a VPS — no longer purely local-only. Cookie
  hardening (`SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE`/`SECURE_PROXY_SSL_HEADER`) is gated on
  `DEBUG`; `/api/wa/inbound/` uses a separate shared-secret permission (`WA_INBOUND_SECRET`)
  since the gateway has no browser session. TLS itself (the reverse proxy/cert) is the separate
  VPS-deployment task. Validate/limit uploaded image size and type.
- **Backups:** Postgres volume + media volume are the entire state; document a `pg_dump`
  backup command.
- **Observability:** structured logging in the backend; that's enough at this scale.
