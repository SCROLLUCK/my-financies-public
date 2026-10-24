# Frontend — my-financies

## 1. Stack

- **React + TypeScript + Vite.**
- **Mantine** — primary component system (layout, inputs, tables, modals, dates,
  notifications, forms). Chosen for speed: batteries-included, so we don't build components
  from scratch.
- **@mantine/charts** (Recharts under the hood) — dashboard charts (donut for spend-by-topic,
  bar/line for spend-per-day). Keeps charting inside the Mantine ecosystem; no separate lib.
- **Tailwind** — secondary utility layer for spacing/layout tweaks only.
- **TanStack Query** — server state (fetching, caching, invalidation).
- **React Router** — pages per module.

### Mantine + Tailwind coexistence (important)
Mantine is **not** Tailwind-first and ships its own CSS reset. To use both without conflicts:
- **Disable Tailwind's preflight** (`corePlugins.preflight = false`) so it doesn't fight
  Mantine's reset.
- Let **Mantine own theming** (colors, spacing scale, radius, typography) via `MantineProvider`.
- Use Tailwind only for ad-hoc utilities (`flex`, `gap`, `grid`) where reaching for a Mantine
  layout prop is overkill. Don't restyle Mantine components with Tailwind — theme Mantine instead.

If this friction becomes annoying, the fallback is to drop Tailwind entirely and use Mantine's
style props + CSS modules. Revisit only if it hurts.

## 2. Structure

```
frontend/src/
├── api/            # typed client + TanStack Query hooks (one file per resource)
├── components/     # shared, app-specific composites built on Mantine
├── features/       # one folder per PRD module (mirrors backend apps)
│   ├── expenses/
│   ├── bills/
│   ├── food/
│   ├── prices/
│   ├── shopping/
│   ├── receipts/
│   ├── purchases/
│   └── chat/
├── pages/          # route-level screens composing features
├── theme.ts        # Mantine theme (tokens: colors, radius, spacing, font)
└── main.tsx
```

## 3. Screens (MVP)

- **Dashboard** — month selector; big **"total spent so far"** figure with last-month delta;
  **donut of spend by topic** (drill-down to category); **bar/line of spend per day**;
  upcoming/overdue bills; food snapshot; quick-add.
- **Expenses** — ledger table with month/topic/category/merchant filters; add/edit.
- **Categories** — manage the Topic → Category taxonomy (colors/icons used by the charts).
- **Recurring** — fixed expenses & subscriptions; monthly total.
- **Bills** — due/paid list; mark paid.
- **Food** — food spending views (iFood/delivery/groceries/dining, trend).
- **Prices** — per-product price-by-store comparison + history.
- **Shopping list** — build a list, check items off while shopping; cheapest-store hint for
  cataloged products; optional price capture on check.
- **Receipts** — upload/capture, review OCR draft, confirm.
- **Planned purchases** — wishlist of future acquisitions by priority/status; total estimated
  cost of open items; mark-as-purchased.
- **Chat** — conversational panel.
- **Settings** — WhatsApp reminders (link via QR, phone, lead days, test message).

Design tokens live in `theme.ts` so the whole app changes from one place: a small BRL-friendly
palette, consistent radius/spacing, and one display + one text font.

## 4. Design workflow — the "5 skills" from the reference post

The referenced Instagram post (Gabriel Miranda, #ClaudeCode) argues for giving the AI the tools
to **see, test, and correct its own UI** instead of blindly generating markup. We adopt that
working style for this project's frontend. Concretely, the loop we follow when building/changing
UI:

1. **Visual context** — the agent renders the running app and takes screenshots (via a browser
   automation tool, e.g. Playwright) to *see* the current state, not just the code.
2. **Design standards** — a short, explicit set of design principles (spacing scale, hierarchy,
   contrast, empty/loading/error states, mobile breakpoints) the UI is checked against. Kept in
   this doc / `theme.ts`, not improvised per screen.
3. **UI testing** — drive the real interface (navigate, fill forms, submit) and assert behavior,
   catching broken flows before the user does.
4. **Feedback loop** — compare the screenshot against the design standards, list concrete
   deltas, fix, re-screenshot. Iterate until it matches — the agent self-corrects.
5. **Decisions from evidence** — design/layout choices are justified by what the rendered,
   tested UI shows, not by guesswork.

Practical setup for this repo:
- Run the app via Docker; expose the Vite dev server on `:5173`.
- Use a browser-automation capability to screenshot and interact during development.
- Keep the **design principles** below authoritative; every UI PR is checked against them.

### Design principles (authoritative checklist)
- **Consistency:** all spacing/color/radius from Mantine theme tokens; no magic values.
- **Hierarchy:** one clear primary action per screen; money figures are the visual anchor.
- **States:** every data view handles loading, empty, and error explicitly.
- **Responsive:** usable on a phone; tables collapse to cards on small screens.
- **Locale:** pt-BR number/date/currency formatting (`R$ 1.234,56`, `30/06/2026`).
- **Feedback:** every mutation shows a success/error notification.
- **Accessibility:** rely on Mantine's accessible primitives; label all inputs.

## 5. API integration

- One typed client module per backend resource under `api/`, wrapped in TanStack Query hooks.
- Vite dev server proxies `/api` → `backend:8000` (configured in `vite.config.ts`).
- Money handled as strings/decimals from the API; format for display, never do money math in
  floating point on the client.
