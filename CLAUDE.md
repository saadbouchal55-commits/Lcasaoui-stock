# L'Casaoui — Stock & Waste Tool (Emergency v1)

You are building a restaurant stock, waste-detection, and auto-ordering web app for
**L'Casaoui Original Food** (Fès, Morocco). This document is the single source of truth.
Follow it exactly. Everything here was decided with the owner; do not re-litigate it.

## What this app does (v1 scope)

Two restaurants — **L1 = Narjiss**, **L2 = Ain Chekef** — order ingredients daily from a
central kitchen. This tool:

1. **Daily reconciliation → waste**: from opening stock + received − (sold × recipe) =
   expected closing; expected − actual counted = **waste**, per item per day.
2. **Auto-order suggestion**: learns each item's daily need from order history (and improves
   as real daily "sent" values are entered), suggests the next order, auto-sends it. The team
   flags anomalies; nothing is blocked.
3. **Recipe editor & Item editor** (Direction only): manage dishes, ingredients, units.
4. **Universal Excel export**: EVERY table/report in the app must export to Excel, scoped to
   what the user can see.

Build for L1 first; L2 slots in when its sales data arrives (architecture already supports both).

## Absolute principles (do not violate)

- **The system suggests, a human decides.** Auto-send happens, but staff can flag/override.
  Never present the tool as making decisions on its own.
- **Ledger-based stock**: stock level is NEVER a stored mutable number. It is always derived
  from an append-only movement log (received, sold-consumption, waste, adjustment, count).
- **Every item has ONE native unit.** Never mix units for one item.
- **Recipes hold FOOD INGREDIENTS ONLY.** Packaging/disposables are NOT in recipes — they are
  tracked from order history only.
- **Soft-delete only.** Deactivate items/recipes; never hard-delete (history must stay valid).
- **Versioned recipes.** Editing a recipe creates a new version; past days keep the old one so
  historical waste reports never change retroactively.
- **Everything exports to Excel**, permission-scoped, with the active filters/date range in the file.
- **Bilingual FR/AR later** — for v1 the UI is French. Keep all UI strings in a single i18n file
  (fr.json) from day one so Arabic (+ RTL) can be added without rework. Do NOT hardcode strings.

## Tech stack (locked)

- **Node.js** backend. **Express** (or Fastify) REST API.
- **ORM: Prisma** (mandatory — makes MySQL→PostgreSQL migration painless later).
- **DB: MySQL now** (Hostinger Business shared hosting), PostgreSQL later on VPS. Because Prisma
  is used, keep all DB access through it; no raw MySQL-specific SQL.
- **Frontend**: a modern JS framework (React preferred), same language front-to-back.
- **Scheduled jobs**: nightly recompute of order suggestions / learning — cron on shared hosting.
- **Auth**: session-based login (mirror the pattern already used in the owner's scheduling app),
  bcrypt password hashing, server-side role checks on every API route.
- **Deploy target**: `lesracinesdor.ma` (Hostinger Business). Node runs as a configured Node app.
- Design so the same codebase moves to a VPS later with only config/DB changes.

## Roles (v1)

- **Direction** — sees BOTH restaurants; only role that edits items, recipes, units, buffer.
- **Manager L1** — sees/operates L1 only (reconciliation, order, counts).
- **Manager L2** — sees/operates L2 only.
- (Shift leaders can be added later with the same rights as manager, per-restaurant.)

Access is **role + location**. A manager can never see the other restaurant. Exports are scoped
to what the user can see.

## Data model (Prisma schema — see db/schema.prisma)

Core tables:
- **Location** (L1, L2)
- **Item** — name, unit enum, pack_size (nullable), yield (nullable, e.g. Frites 0.65),
  is_tracked, in_recipes, category (ingredient|packaging|sold_as_is), active
- **Dish** — sellable menu item, active
- **Recipe** / **RecipeVersion** / **RecipeLine** — versioned; a line = (item, qty, unit).
  Recipe lines are FOOD ONLY.
- **PosMapping** — POS dish name → Dish (handles POS spelling variants)
- **StockMovement** — append-only ledger: location, item, type
  (RECEIVED|CONSUMPTION|WASTE|ADJUSTMENT|COUNT_SET), qty (in item's native unit), date,
  ref, created_by. Stock on hand = running sum per (location,item).
- **DailyEntry** — per (location, date): status, created_by; holds the day's sales + counts.
- **SalesLine** — (daily_entry, dish, qty_sold)
- **CountLine** — (daily_entry, item, counted_qty)  ← actual closing count
- **OrderSuggestion** / **OrderLine** — generated suggestion per (location, date, item, qty)
- **ActualSent** — (location, date, item, qty_sent) ← what really went; feeds learning
- **Buffer** — per item %, editable (Direction)
- **User** — username, password_hash, role, location (nullable for Direction)
- **AuditLog** — every edit to items/recipes/stock corrections (who/when/old→new)

Use enums for unit: `KG | UNIT | PIECE | PACKAGE | L | UNTRACKED`.

## The reconciliation math (waste)

For a given (location, date), per FOOD item:
```
consumption = Σ over dishes sold that day: qty_sold × recipe_line_qty(item)
              (recipe qty is in the item's native unit;
               grams convert to kg by /1000;
               Frites: fried grams ÷ yield(0.65) = raw grams, then /1000 = raw kg;
               PACKAGE items: recipe qty is in pieces → pieces ÷ pack_size = packages)
expected_closing = opening_stock + received − consumption
waste = expected_closing − actual_counted_closing
```
- opening_stock = prior day's closing count (auto-carried) or manual first day.
- received = RECEIVED movements that day.
- Report waste per item, and fold waste into "used" for cost views. Waste is separately
  extractable.
- Flag `counted = 0` as possible stockout/lost-sales, never "perfect".

## The auto-order engine

Per (location, item):
- Classify **daily** vs **periodic-bulk** from history (bulk = lumpy, infrequent, large qty).
- Daily: suggestion = recent avg daily consumption × coverage + buffer% − current stock.
  Coverage: order at night → produced next morning → delivered midday; each delivery covers
  ~1 day; the morning runs on the previous night's leftover. Keep coverage a config constant
  (default 1 day + morning fraction) — do not overthink; the manager can adjust.
- Periodic-bulk / long-life package items (Cheddar, Oreo, bottled sauces): restock when low,
  whole packages, overstock OK.
- **Learning**: each day the owner enters ACTUAL sent → appended to history → recompute. Mark
  team-flagged anomalies as excluded from learning.
- Output auto-sends but is fully visible; team flags outliers.

## Units — the resolved rules (CRITICAL, already cleaned)

- **kg**: all sauces, meats, cheeses (Mozzarella), vegetables, **Frites** (raw; yield 0.65).
- **unit** (whole): Pain Burger/Grec/Spécial, Riz Atlas M/XL, Poke Bowl Salade, tagliatelle
  (1 unit = a 200g portion), Génoise, Mangue, Avocat, Viande Haché Burger (1 patty), Pain Tacos.
- **piece**: ALL packaging/disposables (boites, bowls, gobelets, sachets, fourchettes,
  cuillères, pailles, serviettes, etc.) — tracked from ORDERS, not recipes.
- **package** (with pack_size): Cheddar(88), Oreo entier(144), Mayonnaise(220), Moutarde(220),
  Hot Sauce(220). Recipe references pieces; convert pieces↔packages via pack_size.
- **L**: Citrons, Lait.
- **untracked** (ignore): Glaçons, Sauce Huil d'herbe.
- **Viande Hachée is TWO items**: `Viande Hachée B` (bolognaise, kg) and
  `Viande Haché Burger` (patty, unit). Never merge.
- **Cheddar** merges old Maasdam + Maasdam/Cheddar + Cheddar; old Maasdam piece-counts ÷88 = packages.
- **Poulet Crousty** is the canonical name (POS "Poulet Crunchy" maps to it).
- **Sucre**: recipe in weight (2 spoons = 30g = 0.030 kg).
- **Sauce Tomate** (base sauce) and **Tomate cerise S** (cherry tomato, kg) are DIFFERENT.
- **Yaourt Grec**: sold as-is, no recipe.
- Packaging quantity depends on take-away vs dine-in, which is why it is order-tracked, not
  recipe-tracked. (Pizza is mostly dine-in.)

## Validation already done (trust these)

- Recipes were cross-checked against 28 days of real L1 sales. Fresh-ingredient consumption
  matched orders closely → recipes are correct.
- Frites: sales imply ~37 kg/day raw (24 kg fried ÷ 0.65) ≈ real delivery ~40 kg/day. ✓

## Seed data (in /data)

- `items.json` — 86 items with unit, pack_size, yield, flags, category.
- `recipes.json` — 23 dishes, FOOD ingredients only, qty in native unit (g for weight items).
- `pos_mapping.json` — POS dish name → recipe; special Frites Maison rule; ignore/drinks lists.
- `order_history.csv` — L1+L2 order history (date, location, item, qty).
- `sales_history_L1.csv` — 28 days L1 sales (date, dish, qty). L2 to be added later.

Write a seed script that loads these into the DB via Prisma. Frites Maison / Épicées in sales
map to Frites consumption at 150g fried each (÷0.65 → raw). Ignore MENU 79 combo and drinks;
treat trivial one-off typos (qty 1 of an unknown item) as noise.

## Build order (suggested)

1. Prisma schema + migrations + seed script (load /data).
2. Auth + roles + location scoping.
3. Item editor + Recipe editor (Direction), versioned, unit validation, pick-from-list.
4. Daily entry screen (sales + counts) + reconciliation engine → waste report.
5. Auto-order engine + order screen + actual-sent entry + learning job.
6. Universal Excel export on every table.
7. i18n scaffolding (fr.json) — French now, AR/RTL later.

## Non-negotiables checklist (verify before shipping any feature)

- [ ] Stock derived from ledger, never a stored mutable field
- [ ] Recipes food-only; packaging order-tracked
- [ ] One native unit per item; conversions only via pack_size / yield / g→kg
- [ ] Recipe edits versioned; past reports stable
- [ ] Soft-delete everywhere
- [ ] Role+location enforced server-side on every route
- [ ] Excel export on every table, permission-scoped
- [ ] No hardcoded UI strings (i18n ready)
- [ ] counted=0 flagged as possible stockout
