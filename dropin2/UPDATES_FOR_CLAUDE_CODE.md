# UPDATES for Claude Code — batch 2 (apply to the existing L'Casaoui build)

Apply all of these to the EXISTING project in place. Do not rebuild from scratch.
Files included in this drop-in (already placed in the correct folders):
- `data/pos_mapping.json`  (replaces the old one)
- `data/sales_history_L2.csv`  (new — Ain Chekef sales)

After copying files in, re-seed the database, then make the code changes below.

---

## 1. Data: mapping fixes + L2 sales  (files included)

- `data/pos_mapping.json` is updated: `"Pizza Margaritta M"` → **`"Pizza Marinara"`**,
  `"Dopamina Chocolat"` → **`"Dopamina Oreo"`**. Ignore lists still cover MENU 79, soft drinks,
  and stray `Sauce Biggy` / `Sauce Algerienne` **sold-dish** lines. Keep Sauce Biggy & Algérienne
  as real **recipe ingredients** (Tacos) — only their POS sold-dish lines are ignored.
- `data/sales_history_L2.csv` is new: Ain Chekef (L2) sales, 18/07–03/08/2026, same columns as
  sales_history_L1.csv (date, location, dish, qty_sold). Load it in the seed so L2 gets its own
  sales-driven ordering and waste detection. Blank cells in the source = 0.

Re-run the seed after placing these files.

---

## 2. Blind stock counting (inventory integrity)

On the daily stock **count entry** screen (Manager / Shift-Leader):
- Show ONLY: item name, unit, empty count input.
- HIDE completely: expected/opening stock, received, consumption, variance, previous count —
  no reference numbers at all.
- Compute reconciliation on submit but do NOT return expected/variance in the API response for
  Manager/Shift-Leader roles (omit from payload — do not send-then-hide in CSS).
- Expected stock and variance/waste are shown ONLY to Direction, in the management report.
  Managers/shift-leaders cannot access that report.

Reason: prevents anchoring so real waste/theft is caught.

---

## 3. Initial stock entry (Direction only, one-time per restaurant)

Add an **Initial Stock** setup screen:
- Access: Direction only.
- Lists ALL active items for the location, quantity field in each item's native unit, blank = 0.
- On submit: write one `COUNT_SET` StockMovement per item to the ledger, dated go-live = opening
  baseline. Thereafter each day's closing count carries into the next day's opening.
- ONE-TIME per location: lock the screen after it's used for that restaurant (cannot re-run).
  Later corrections go through the normal Direction-only stock **adjustment** (audit-logged).

---

## 4. NEW ORDER FLOW — replaces auto-send and the "actual sent" page

This changes how orders work. Implement exactly:

**A) Generation (automatic):**
- The system auto-generates the **food** order per restaurant per day from sales × recipe learning
  (daily vs periodic-bulk logic as before). Food = items with `in_recipes = true`.
- **Guardrail:** if the day's sales or stock count are missing, OR the generated quantity is absurd
  (e.g. far above the normal range — likely a typo), do NOT proceed. **HOLD the order and alert
  Direction** to review instead.

**B) Review & edit (human, before it goes):**
- The generated order is shown as "to be collected/prepared".
- **Only Direction and the new Order Manager role** can view and EDIT it. Restaurant
  managers/shift-leaders CANNOT see or touch orders at all.
- It does NOT auto-send. It waits for a human.

**C) Confirm sent (after it goes):**
- After the order goes out, Direction or the Order Manager **confirms it was sent**.
- The **confirmed-sent order is the system of record** for what was sent, AND it is what the
  learning uses going forward (learn from confirmed-sent quantities).
- **Remove the separate "actual sent" entry page/table** (`ActualSent`) — it's replaced by the
  confirmed-sent order. Migrate learning to read confirmed-sent orders instead.

**D) Packaging:**
- Packaging / non-recipe items (`in_recipes = false`) are entered by the restaurant manager
  (with a recent-history hint). If the manager enters nothing, packaging is **skipped** (not sent,
  no fallback).

**Resulting order lifecycle:** `GENERATED → (HOLD+alert if bad) → edited by Direction/OrderManager
→ goes out → CONFIRMED_SENT (learning input)`.

---

## 5. NEW ROLE — Order Manager

Add role `ORDER_MANAGER`:
- Sees **both** restaurants' orders (L1 + L2).
- Can **view, edit, and confirm-sent** orders. NOTHING else — no stock screens, no waste reports,
  no recipes, no item editor.
- Order authority is shared with Direction (either can view/edit/confirm).
- Enforce server-side: only DIRECTION and ORDER_MANAGER roles can reach any order endpoint.

Update the role enum accordingly (e.g. `DIRECTION | ORDER_MANAGER | MANAGER`). Manager/Shift-Leader
remain per-location and have NO order access.

---

## 6. Confirm the order screen split (food vs packaging)

- Food items → system-generated quantities (editable by Direction/Order Manager).
- Packaging → manager-entered with history hint; skipped if left blank.

---

## Schema changes summary (Prisma)
- Add `ORDER_MANAGER` to the Role enum.
- Add an order status/lifecycle field: `GENERATED | HELD | CONFIRMED_SENT` (+ edited_by,
  confirmed_by, confirmed_at).
- Remove the `ActualSent` model (learning now reads confirmed-sent OrderLines).
- Keep everything else (ledger, versioned recipes, blind-count rules) as-is.
- Run a migration; do not drop existing data.

## Verify after applying
- [ ] pos_mapping.json replaced + L2 sales loaded (re-seeded)
- [ ] Manager count screen shows no reference numbers (server-side enforced)
- [ ] Only Direction sees expected/variance report
- [ ] Initial-stock screen: Direction-only, all items, blank=0, writes COUNT_SET, locks after
- [ ] Orders: auto-generated → HOLD+alert if bad → editable only by Direction/Order Manager →
      confirmed-sent = record + learning input
- [ ] No "actual sent" page anymore; learning reads confirmed-sent orders
- [ ] ORDER_MANAGER role exists, both locations, orders-only, server-side enforced
- [ ] Packaging manager-entered, skipped if blank
