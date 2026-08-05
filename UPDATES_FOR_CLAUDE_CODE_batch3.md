# UPDATES for Claude Code — batch 3 (apply to the existing L'Casaoui build)

Apply all of these to the EXISTING project in place. Do not rebuild. No data files change in this
batch — these are code/UI changes.

---

## 1. Stock count screen must include ALL tracked items (food + packaging)

Currently the nightly count only lists recipe/food items. It must list **every tracked item**
(`isTracked = true`), including packaging/non-recipe items (boxes, bags, cups, forks, etc.).

- Packaging IS counted (so its stock is known and it can be reordered).
- Packaging stays OUT of the food waste/consumption calculation (recipes remain food-only) — do
  not add packaging to consumption. It just gets a counted stock level like any item.
- Keep the count BLIND (see existing rule): show only item name, unit, empty input. No expected
  numbers. Enforced server-side.

## 2. Waste declaration (new) — Manager / Shift-Leader

Add the ability for Manager/Shift-Leader to **declare waste** during the daily flow.

- Entry = per line: **item OR product**, **quantity**, **optional reason (free text)**.
- Two kinds of waste can be declared:
  - **Raw ingredient waste** (e.g. "2 kg Poulet spoiled") → recorded as a WASTE movement on that item.
  - **Finished product waste** (e.g. "3 Chicken Burger thrown away") → recorded at PRODUCT level.
    Do NOT break the product into its ingredients — keep it product-level only.
- Declared waste is stored as its own records (a WasteDeclaration table: location, date, item-or-
  product ref, qty, reason, created_by).

**Effect on variance:** declared waste must SUBTRACT from the variance so the report shows only the
UNEXPLAINED gap:
```
expected = opening + received − consumption
variance = expected − counted − declared_ingredient_waste
```
(Product-level declared waste is shown in the waste view but, since it's product-level, it is not
subtracted from per-ingredient variance — list it separately in the report as product waste.)

## 3. Separate, named manager pages (bilingual labels)

Split the manager/shift-leader area into distinct, clearly named pages (labels shown in the
current UI language — see i18n section; French / Arabic labels given):

- **Déclarer les Ventes** / **تسجيل المبيعات** — enter quantities sold per product that day.
- **Déclarer le Stock** / **جرد المخزون** — the blind nightly count of ALL items.
- **Déclarer les Pertes** / **تسجيل الخسائر** — declare waste (item or product + qty + reason).
- **Commander Emballage** / **طلب التغليف** — manager enters packaging/consumable order quantities
  (with recent-history hint; skipped if left blank). (Food ordering stays with Direction/Order
  Manager, not here.)

Each is its own screen/route with its own name — not one combined form.

## 4. Declared-waste view page

Add a page to VIEW declared waste:
- **Manager / Shift-Leader:** can SEE their own restaurant's declared waste — READ ONLY (no edit/delete).
- **Direction:** sees declared waste for BOTH restaurants, with the variance/report context.
- Show: date, item/product, quantity, reason, who declared it.

## 5. Full bilingual FR / AR interface with RTL — write real Arabic, not machine translation

The app must support **French and Arabic (Modern Standard Arabic)** for the INTERFACE.

- **Language can be switched at any time** (a visible language toggle, e.g. FR / ع). Not locked per
  user — any user can switch whenever.
- When Arabic is active, the layout must be **RTL** (right-to-left): direction, alignment, menus,
  forms all mirrored correctly.
- **Write the Arabic natively and correctly** — clear, natural, good-level MSA using proper
  restaurant/business terms. DO NOT machine-translate the French strings word-for-word; that reads
  wrong. Author real Arabic labels for every screen, button, message, and menu.
- **Product and item names STAY IN FRENCH in both languages** (e.g. "Poulet Crousty", "Pizza
  Marinara", "Sachet Emporté" remain French even in the Arabic interface). Only the INTERFACE
  chrome (buttons, labels, headings, menus, system messages, table headers) is translated.
- Put all interface strings in i18n resource files (fr + ar). Do not hardcode UI strings.

## 6. Mobile-first / phone-friendly — EVERY screen

Most daily users (managers, shift-leaders) work on **phones**. Every screen must be excellent on a
phone:

- Responsive, mobile-first layout (works from ~360px width up).
- Large tap targets (buttons/inputs comfortable for a thumb).
- Forms easy to fill on a small screen (stacked fields, big number inputs for counts/quantities).
- No tiny text, no horizontal scrolling, tables collapse/scroll gracefully on narrow screens.
- The four manager pages (sales, stock, waste, packaging) especially must be fast and easy on a phone.
- Must also still work on desktop for Direction/Order Manager.

Prioritize mobile-first and Arabic/RTL together — both are core, not optional polish.

---

## Schema additions (Prisma)
- Add `WasteDeclaration` model: id, locationId, date, refType (`ITEM` | `PRODUCT`), itemId?
  (nullable), dishId? (nullable), qty, reason (text, nullable), createdBy, createdAt.
- Add a per-user or per-session language preference is NOT required (language is switchable live),
  but store a default UI language setting if convenient.
- Run a migration (use `prisma db push` if migrations aren't set up in this project — that's how the
  DB was initialized).

## Verify after applying
- [ ] Night count lists ALL tracked items (food + packaging), still blind, packaging excluded from consumption
- [ ] Manager/Shift-Leader can declare waste (item or product + qty + reason)
- [ ] Declared ingredient waste subtracts from variance (unexplained gap only); product waste shown separately
- [ ] Four separate named manager pages exist (Ventes, Stock, Pertes, Emballage) — bilingual labels
- [ ] Declared-waste view: manager read-only own restaurant; Direction sees both
- [ ] FR/AR interface toggle works anytime; Arabic is natively written; RTL correct
- [ ] Product/item names stay French in both languages
- [ ] Every screen is phone-friendly (mobile-first), works ~360px up
