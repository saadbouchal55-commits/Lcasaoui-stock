# L'Casaoui — Stock, Waste & Auto-Ordering Tool (Emergency v1)

Restaurant stock reconciliation, waste detection and auto-ordering for
**L'Casaoui Original Food** (Fès). Two restaurants: **L1 = Narjiss**, **L2 = Ain Chekef**.

The full specification lives in [`CLAUDE.md`](CLAUDE.md) — all decisions are locked there.
This README is how to **run and deploy** what has been built.

> **The system suggests, a human decides.** Auto-send happens, but staff can always flag or override.

---

## Stack

- **Backend:** Node.js (ESM) + Express, Prisma ORM.
- **DB:** MySQL now (Hostinger Business) → PostgreSQL later (VPS). All access via Prisma; no raw SQL.
- **Frontend:** React (Vite), French UI, i18n-ready (single `locales/fr.json`).
- **Auth:** session-based, bcrypt (pure-JS `bcryptjs` — no native build), server-side role+location checks.
- **Excel:** every table/report exports via `exceljs`, permission-scoped, with filters/date range in the file.

## Project layout

```
db/schema.prisma        Prisma schema (locked). package.json points Prisma here.
data/                   Seed data (items, recipes, POS map, order + sales history).
locales/fr.json         All UI strings (add ar.json later for Arabic/RTL — no code change).
src/
  config.js             Env + order-engine tuning constants.
  server.js             Express app; serves the API and the built frontend.
  engine/               PURE logic (no DB) — unit conversions, reconciliation, auto-order.
  services/             orderservice.js — shared by the API route and the nightly job.
  lib/                  prisma, auth-audit, excel, csv, i18n, stock ledger, http helpers.
  middleware/auth.js    requireAuth / requireRole / location scoping.
  routes/               auth, meta, items, dishes, recipes, daily (reconcile+waste), orders, buffers, audit.
prisma/seed.js          Loads /data into the DB.
jobs/nightly.js         Recompute & auto-send order suggestions (run via cron).
test/engine.test.js     Pure-engine unit tests (node --test, no DB needed).
frontend/               React (Vite) SPA. Build output (dist/) is served by Express.
```

## Local development

Requires **Node 18+** and a MySQL database.

```bash
# 1. Install backend deps
npm install

# 2. Configure environment
cp .env.example .env        # then edit DATABASE_URL, SESSION_SECRET, SEED_ADMIN_*

# 3. Create the schema and generate the client
npx prisma migrate dev --name init
# (prisma reads db/schema.prisma via the "prisma" field in package.json)

# 4. Seed the catalogue + history
npm run seed

# 5. Run the API (port 3000)
npm run dev

# 6. In another terminal, run the frontend dev server (port 5173, proxies /api)
npm --prefix frontend install
npm --prefix frontend run dev
```

Open http://localhost:5173 and log in with the seeded Direction account
(`SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`). **Change the password after first login.**

Run the engine tests (no DB required):

```bash
npm test
```

## Production build (single server)

Express serves the built SPA from `frontend/dist`, so one Node process serves everything.

```bash
npm install
npm run build:frontend        # builds frontend/dist
npx prisma migrate deploy
npm run seed                  # first deploy only
npm start                     # serves API + SPA on $PORT
```

## Nightly auto-order job (cron)

Order at night → produced next morning → delivered midday. Schedule the recompute, e.g.:

```
30 1 * * *  cd /home/USER/app && node jobs/nightly.js >> logs/nightly.log 2>&1
```

It regenerates and auto-sends the next day's suggestion for every active location using the
latest learning (actual-sent history + consumption). Suggestions remain fully visible and
editable; the team flags outliers.

## Deploy notes (Hostinger Business → `lesracinesdor.ma`)

- Create a **Node app** in hPanel, entry point `src/server.js`, and set env vars there
  (or via `.env`). Node 18+.
- Point `DATABASE_URL` at the MySQL DB created in hPanel.
- Run `npx prisma migrate deploy` and `npm run seed` once (via SSH or a one-off script).
- `secure` cookies require HTTPS — the domain has it, and `NODE_ENV=production` enables it.
- **VPS / PostgreSQL later:** change `provider` in `db/schema.prisma` to `postgresql`, update
  `DATABASE_URL`, re-run migrations. No application code changes (that is why everything goes
  through Prisma).

### Keeping under the "Max Processes" limit (shared hosting)

Hostinger's *Max Processes* cap counts threads too, and Node + Prisma are thread-heavy.
To stay under it:

- **Run ONE instance only.** Start with `npm start` (`node src/server.js`) — never `npm run dev`
  (that uses `--watch`, which keeps an extra supervisor process). In the hPanel Node app, keep the
  instance/worker count at **1**.
- Set **`UV_THREADPOOL_SIZE=1`** in the env panel (shrinks Node's libuv thread pool from 4 to 1).
- Add **`?connection_limit=3`** to `DATABASE_URL` (caps Prisma's DB connection pool).
- Don't leave stray processes: after running `seed` / `prisma db push` over SSH, let them exit;
  check with `ps aux | grep node` that only the one app process remains.
- If you keep hitting the cap, that's the signal to move to a small **VPS** — the codebase already
  supports it with only config/DB changes.

## Security

- **Passwords:** bcrypt (`bcryptjs`, no native build). First login forces a password change
  (`mustChangePassword`); change-your-own-password screen for everyone after.
- **Sessions:** DB-backed (Prisma `Session` table — survives restarts, Postgres-portable),
  httpOnly + `sameSite=strict` + `secure` cookie in production, 12h rolling expiry. The session
  id is **regenerated on login** (anti-fixation).
- **Login brute-force:** rate-limited per IP + username (default 10 / 15 min → HTTP 429).
- **Authorization:** `requireAuth` + `requireRole` on every route; managers are pinned to their
  own restaurant server-side and cannot read or write the other one. Same login error for bad
  user vs bad password (no enumeration).
- **HTTP hardening:** `nosniff`, `X-Frame-Options: DENY`, strict `Content-Security-Policy`,
  `Referrer-Policy`, HSTS in production, `x-powered-by` disabled.
- **Injection:** all DB access is parameterized through Prisma (no raw SQL).
- **Audit:** every item/recipe/stock/order/password change is logged (who + old→new).

Before go-live: set a strong `SESSION_SECRET`, use a strong seeded admin password, and serve
only over HTTPS. Not yet built (next candidates): a Direction UI to create manager accounts,
and 2FA if desired.

## Daily operating cycle (starts with the night count)

1. **Night — "Comptage du soir":** count the stock. The **first ever** count at a restaurant is
   recorded as the *baseline* (no waste) and becomes tomorrow's opening. **Every night after**,
   the count is the day's *closing* count → the app computes waste (expected − counted) and
   carries it to the next day's opening automatically.
2. **Night — order:** review the auto-suggestion (Commandes) and adjust/flag before it goes.
3. **Midday — delivery:** enter what was actually sent (feeds learning + posts stock received).
4. **Sales:** enter or import the POS sales for the day so the night count can compute waste.

## The core rules (enforced in code — see CLAUDE.md for the full list)

- Stock is **derived from the append-only ledger** (`StockMovement`), never a stored number.
- **Recipes are food-only**; packaging is order-tracked (the recipe editor rejects non-food items).
- **One native unit per item**; conversions only via `pack_size`, `yield`, or grams→kg.
- **Recipe edits create a new version**; past days keep the version effective then, so historical
  waste reports never change.
- **Soft-delete only** (deactivate).
- **Role + location enforced server-side** on every route; a manager never sees the other restaurant.
- **counted = 0** is flagged as a possible stockout, never "perfect".
