# my-financies

A self-hosted, Dockerized personal finance app focused on **managing cost of living**:
fixed expenses, subscriptions, one-off surprises, food/delivery tracking, grocery price
comparison, receipt scanning (OCR), and a natural-language chat over your own data.

Single user, runs on your own machine or server. The only external service is the
Anthropic API (optional, for the chat and receipt structuring). The UI is in Brazilian
Portuguese/English with BRL currency formatting.

## Features

- **Expense ledger** — fixed expenses, subscriptions and one-off costs in one place, classified
  in an editable two-level taxonomy (topic → category).
- **Bills & boletos** — recurring templates generate monthly bills; track what's due, paid or
  overdue ("did I already pay the internet bill?").
- **Income sources** — recurring income to compare against monthly commitments.
- **Food & delivery** — a dedicated view for food spending trends.
- **Price comparison** — track a product's price across stores ("where is milk cheapest?").
- **Shopping lists & planned purchases.**
- **Bank statement import** — parse a statement and turn its transactions into expenses/income.
- **Receipt scanning** — photograph a receipt, local OCR extracts the data, you confirm the draft.
- **Finance chat** — ask questions in plain language, answered from your data via tool calls
  (Claude), never invented numbers.
- **WhatsApp bill reminders** — link your own WhatsApp once (QR code) and get pinged before a
  bill is due.
- **WhatsApp capture** — in the same chat, send a receipt photo for an OCR draft you confirm, or
  free-form text like "gastei 45,50 no ifood" to register an expense directly.

## Stack

| Layer      | Choice                                                         |
|------------|----------------------------------------------------------------|
| Frontend   | React + TypeScript + Vite, Mantine UI, Tailwind (utilities), TanStack Query |
| Backend    | Django + Django REST Framework                                 |
| Database   | PostgreSQL 16                                                  |
| AI (chat)  | Claude (Anthropic API) via tool calling                        |
| OCR        | Tesseract (local, `pytesseract`) + optional Claude text structuring |
| WhatsApp   | Node gateway (Baileys), internal-only, no host port exposed    |
| Infra      | Docker Compose, monorepo                                       |

## Repository layout

```
my-financies/
├── docker-compose.dev.yml    # local development (builds images, hot reload)
├── docker-compose.prod.yml   # production (pre-built images)
├── .env.example              # dev environment template
├── .env.prod.example         # prod environment template
├── backend/                  # Django + DRF
├── frontend/                 # Vite + React + Mantine
├── whatsapp/                 # Node WhatsApp gateway (Baileys)
├── deploy/nginx/             # example host reverse-proxy vhost
└── docs/                     # product, architecture, data model, AI, frontend, roadmap
```

## Running locally

Requirements: Docker with Docker Compose.

```bash
cp .env.example .env                              # working dev defaults are provided
docker compose -f docker-compose.dev.yml up --build
# frontend: http://localhost:15173
# backend:  http://localhost:18000/api
```

First run only, apply migrations (the default taxonomy is seeded by a migration) and create
your login:

```bash
docker compose -f docker-compose.dev.yml exec backend python manage.py migrate
docker compose -f docker-compose.dev.yml exec backend python manage.py createsuperuser
```

### Optional configuration

- **`ANTHROPIC_API_KEY`** — enables the finance chat and Claude structuring of receipts (line
  items). Without it, receipt OCR still runs locally and falls back to heuristics
  (total/date/CNPJ). Use the "Reprocess" action on a receipt after adding the key.
- **WhatsApp** — open **Settings** in the app, scan the QR code with your phone (WhatsApp →
  Linked devices → Link a device), then set the reminder phone and lead days. The session is
  kept in the `whatsapp_auth` Docker volume. `WA_INBOUND_SECRET` must be set to the same value
  for the gateway and the backend.
- **`PARTNER_WHATSAPP_NAME`** — if a second person shares the ledger through a WhatsApp group,
  messages whose sender display name contains this value are attributed to "Partner"; your own
  messages are attributed to "Me".

Scheduled jobs are Django management commands (run them daily, e.g. from cron):

```bash
python manage.py generate_bills
python manage.py send_bill_reminders
```

## Production

`docker-compose.prod.yml` pulls pre-built images from a container registry
(`registry.gitlab.com/${IMAGE_OWNER}/my-finances/{backend,frontend,whatsapp}`); the included
`.gitlab-ci.yml` builds and pushes them on every push to `main`. Adjust the image names if you
use another registry.

```bash
cp .env.prod.example .env.prod                    # set real secrets, hosts and IMAGE_OWNER
docker compose -f docker-compose.prod.yml --env-file .env.prod pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

The prod backend runs `migrate`, `ensure_superuser`, `collectstatic` and gunicorn on start. The
single login is created on first boot from `DJANGO_SUPERUSER_USERNAME` / `_PASSWORD`. The
frontend container serves the built SPA with nginx on `FRONTEND_PORT` (bound to `127.0.0.1`);
put a TLS reverse proxy in front of it — see `deploy/nginx/example.conf`.

## Documentation

1. [docs/PRD.md](docs/PRD.md) — what the app does and why.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the system is put together.
3. [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — entities and relationships.
4. [docs/AI.md](docs/AI.md) — the chat agent and the OCR pipeline.
5. [docs/FRONTEND.md](docs/FRONTEND.md) — UI stack and design workflow.
6. [docs/ROADMAP.md](docs/ROADMAP.md) — delivery phases.

## Disclaimer

The WhatsApp integration uses an unofficial client library (Baileys), which is against
WhatsApp's Terms of Service and may lead to the linked number being banned. Use at your own risk.

## License

MIT, see [LICENSE](LICENSE).
