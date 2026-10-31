# MakeaTon-SMS
Subscription Management System

# Brightloop — Subscription Management System

Quotes, subscriptions, automated invoicing, tax and discount engines, payments and a finance dashboard, with an admin/staff back office and a self-service customer portal.

![Dashboard](docs/screenshots/02-dashboard.png)

## Requirements

- **Node.js 22.13 or newer** (22 LTS or 24 LTS). Check with `node -v`.
- Nothing else. The database is Node's built-in SQLite (a single file), so there's no PostgreSQL, Docker or cloud service to install. Email works offline (see below).

No VS Code extensions are required. Optional but helpful: *Tailwind CSS IntelliSense*, *ESLint*, *Prettier*, and *SQLite Viewer* (to browse `server/data/brightloop.db`).

## Quick start

From the project folder in any terminal (cmd, PowerShell, macOS/Linux shell or VS Code's terminal):

```bash
npm run setup     # installs dependencies and loads demo data (run once)
npm run dev       # starts API (http://localhost:4000) + UI (http://localhost:5173)
```

Open **http://localhost:5173**. The login page has one-click demo buttons:

| Role     | Email                 | Password      |
|----------|-----------------------|---------------|
| Admin    | admin@brightloop.io   | Admin@12345   |
| Staff    | staff@brightloop.io   | Staff@12345   |
| Customer | priya@acmeretail.in   | Customer@123  |

<details><summary>Running the two parts in separate terminals instead</summary>

```bash
cd server && npm install && npm run seed && npm run dev    # terminal 1
cd client && npm install && npm run dev                    # terminal 2
```
</details>

**Single-process mode:** `npm run build && npm start` serves the built UI from the API at http://localhost:4000.

## Tests

```bash
npm test            # 39 API tests: auth, RBAC, pricing, tax, discounts, lifecycle, billing, payments, dashboard
npm run test:perf   # loads 3,000 customers / 5,000 subscriptions / ~20,000 invoices and times every endpoint
```

The perf run's slowest request is about 50 ms against the 2-second target.

## Features → where they live

| Requirement | Implementation |
|---|---|
| Roles & RBAC | `server/src/lib/auth.js` (`requireRole`, `scopeCustomer`). Customers only ever see their own rows; other customers' records return 404 so they don't leak. |
| Password policy | More than 8 characters, with an uppercase letter, a lowercase letter and a special character. Enforced in `lib/validation.js` (server) and `client/src/lib/validate.js` (live checklist in the UI). |
| Password reset | `POST /api/auth/forgot-password` emails a single-use, SHA-256-hashed token that expires in 60 minutes. The response is the same for unknown emails, so accounts can't be discovered. |
| Unique email | `UNIQUE COLLATE NOCASE` on `users.email` and `customers.email`. |
| Variants | `product_attributes` / `attribute_values.extra_price`. For example, Brand = Odoo adds ₹560 (`services/pricing.js`). |
| Plans & rules | Billing period plus every-N interval, minimum quantity, availability window, term length, auto-close, early-closure lock, pausing, auto-renewal. |
| Quote templates | Preset plan, lines (with variants), validity in days and payment terms. |
| Lifecycle | Draft → Quotation → Confirmed → Active → Closed, enforced in `services/subscriptions.js`. Quotes are emailed and expire. Customers can accept quotes and pause, resume or close where the plan allows. |
| Batch invoicing | `services/billing.js`, hourly plus *Run billing now*. |
| Tax engine | The product's explicit tax, else the rule for its product type, else the default rule. |
| Discount engine | Percent or fixed, with minimum amount, minimum quantity, date window, usage cap and optional product scope. Discounts are added as negative invoice lines with the tax reversed proportionally. Usage is consumed atomically and released when an invoice is cancelled. |
| Invoices | Draft → Confirmed → Paid, plus cancel. There's a print/PDF stylesheet, and emailing an invoice sends an HTML message. |
| Payments | Card, bank transfer, UPI, cash, cheque or other. Partial payments are supported; overpayment is rejected, and an invoice is marked paid automatically when fully settled. |
| Dashboard | Active subscriptions, revenue collected, pending, overdue and MRR, with a 12-month chart. Filter by period and by customer. |

### How double-billing and skipped cycles are prevented

- Each invoice records its **cycle index**. A partial unique index on `(subscription_id, cycle_index)` makes a duplicate impossible at the database level, even if two schedulers run at once.
- Cycle dates are always computed **from the start date** (`start + k × period`), never chained from the previous invoice. As a result, the 31st stays the 31st when the month has one (31 Jan → 28 Feb → 31 Mar → 30 Apr).
- Each run bills **every** cycle due up to today. If the server was down for a month, the next run catches up all the missed cycles.
- Each subscription is billed inside its own `BEGIN IMMEDIATE` transaction, and the row is re-read inside it.
- Pausing stops billing. Cycles that fall inside the pause are skipped deliberately when the subscription resumes, not billed late.

### Email in local development

Every email (password reset, quotation, invoice) is saved to an `email_outbox` table and can be read in the app under **Billing & email → Outbox**, so the reset flow works without an internet connection. To actually send email, copy `server/.env.example` to `server/.env` and fill in the SMTP settings.

## Project structure

```
server/
  src/
    db.js                 schema, indexes, transaction helper
    config.js             env-driven settings
    lib/                  auth (JWT/RBAC), validation (zod), mailer, date & money utils
    services/             pricing, subscriptions, invoicing, billing scheduler
    routes/               auth, catalog, people, billing (REST)
    seed.js               demo data (--bulk for perf data)
  test/                   node:test + supertest suite, perf script
client/
  src/
    lib/                  api client, auth context, validators, formatting
    components/           UI kit, layout, pickers
    pages/                Dashboard, Subscriptions, Invoices, Catalog, Admin, Auth
docs/screenshots/
```

## API overview

All routes are under `/api` and take `Authorization: Bearer <token>`.

- `POST /auth/login | signup | forgot-password | reset-password | change-password`, `GET /auth/me`
- `GET|POST|PUT /products /plans /templates /taxes /discounts` (writes are admin-only)
- `GET|POST|PUT /customers`, `GET|POST|PATCH /users` (users are admin-only)
- `GET|POST|PUT /subscriptions`, `POST /subscriptions/:id/{send_quote|confirm|revert_draft|activate|pause|resume|close|invoice_now}`
- `GET /invoices` (accepts `status=overdue`, date range and search), `POST /invoices/:id/{confirm|cancel|reset_draft|email}`
- `GET|POST /payments`, `GET /dashboard?from&to&customer_id`, `POST /billing/run`

List endpoints are paginated (`page`, `pageSize`) and searchable (`q`).
