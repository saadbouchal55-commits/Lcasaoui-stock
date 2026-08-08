# UPDATES for Claude Code — Smart Order Engine (apply to the existing L'Casaoui build)

Replace the current food-order suggestion logic with the smarter engine below. This affects the
auto-generated **food** order only. **Packaging stays manual** (manager-entered) — do not change
that. Apply to the existing build; the app is now on a VPS (Node + Prisma + MySQL, PM2 + Nginx).

## Scope

- Applies **per (restaurant, food item, target date)**. Food = items with `in_recipes = true`.
- Packaging (`in_recipes = false`) is unchanged — manager enters it, skipped if blank.
- Runs when the daily food order is generated (then goes through the existing flow: HOLD+alert on
  low confidence → Direction/Order Manager review/edit → confirm sent → learning).

## The algorithm (in order)

### 1. Predict the day's consumption (weekday-aware, recent-weighted)
- Use the **same weekday** as the target date, over the **last 4 occurrences** (last 4 same-weekdays)
  at that restaurant.
- **Weight recent weeks more** (e.g. weights 4/3/2/1 for the last four same-weekdays, normalized).
- Each restaurant learns its OWN weekday pattern from its own data — no hardcoded weekend rule.
- If fewer than 4 same-weekdays of history exist, use what's available. If almost none, fall back to
  overall recent daily average and mark **low confidence** (see step 7).

### 2. Baseline = recipe-based use, gradually corrected by real counts
- Baseline consumption = Σ(dishes sold that weekday historically × recipe qty per item), i.e. the
  recipe-based prediction. This is reliable from day one (already validated).
- **Correction factor (applied gradually):** compare recipe-based use vs **actual usage from stock
  counts** = `opening + received − closing − declared_ingredient_waste`, over recent history.
  - Only compute a correction once there are **enough stable count days** (e.g. ≥ ~10 count days for
    that item and the day-to-day counts aren't wildly inconsistent). Until then, correction = 1.0
    (pure recipe).
  - When stable, correction = median(actual / recipe) over recent days, **clamped** to a sane range
    (e.g. 0.7–1.5) so one bad count can't blow it up. Blend, don't replace: predicted = recipe ×
    correction.
- Store the correction factor per (restaurant, item) and keep updating it as more counts arrive.

### 3. Coverage
- Daily food items: cover **1 day + a morning-gap fraction** (config constant, Direction-adjustable;
  default e.g. 1.0 day + 0.25 for the pre-delivery morning). Order at night → made next morning →
  delivered midday, so the order must cover until the next delivery plus that morning gap.

### 4. Per-item buffer (Direction-editable, smart default)
- Every item has its **own buffer %** stored and editable by Direction.
- The engine proposes a **smart default** per item = f(demand variability, perishability):
  - Higher day-to-day variability → larger buffer.
  - **Perishable / fridge (zone R)** → keep buffer smaller (spoilage risk).
  - **Ambient/dry (zone A)** → can tolerate a larger buffer.
- Direction can override any item's buffer; the override wins.

### 5. Subtract what's on hand and inbound
```
need = predicted_consumption × coverage × (1 + buffer_pct)
suggested_qty = need − current_stock_on_hand − already_ordered_not_yet_delivered
```
- `current_stock_on_hand` from the ledger (latest count carried forward + movements).
- `already_ordered_not_yet_delivered` = confirmed-sent orders for that item not yet received.
- Never suggest negative → floor at 0.

### 6. Round to real order units
- Package items → whole packages. Unit items → whole units. kg → sensible increment (e.g. 0.5 kg,
  or item-configurable). Show the suggestion in the item's real order unit.

### 7. Confidence gate → flag, don't guess
- Compute a simple confidence signal. LOW confidence if: little history (step 1 fallback), unstable
  counts, missing sales/stock for recent days, or the suggestion deviates a lot from the item's
  recent norm (e.g. > 2× or < 0.5×).
- On LOW confidence or missing inputs → **HOLD the order and alert Direction** (existing guardrail),
  and mark the specific lines that are uncertain so the reviewer sees which to check.

### 8. Learn continuously
- Every **confirmed-sent order** and every **stock count** feeds back: update the weekday averages
  and the per-item correction factor. The engine improves automatically over time.

## Notes / constraints
- Keep the existing order lifecycle (GENERATED → HELD → CONFIRMED_SENT) and roles (Direction /
  Order Manager edit; managers no order access).
- All new tunables (coverage constant, buffer defaults/overrides, correction clamp range, confidence
  thresholds) should be config or Direction-editable, not hardcoded magic numbers buried in code.
- Show the reviewer a short "why" per suggested line if feasible (e.g. "avg Fri 11.2kg ×1.25 cover
  ×1.1 buffer − 3kg stock"). Helps trust and debugging.

## Schema/notes
- Add per-(restaurant,item) storage for: bufferPct (override), correctionFactor, and enough to
  compute weekday averages (can be derived from existing sales/count history — no need to
  precompute if queries are fast enough; otherwise cache).
- Apply any schema changes with `prisma db push` (no migration files in this project).

## Verify after applying
- [ ] Food order predicts by same-weekday, recent-weighted, per restaurant
- [ ] Recipe baseline; correction from counts applied only when stable, clamped, blended
- [ ] Coverage = 1 day + morning gap (config)
- [ ] Per-item buffer, Direction-editable, smart default (perishable-aware)
- [ ] Subtracts stock on hand + pending deliveries; floored at 0; rounded to order units
- [ ] Low-confidence / missing-input lines HOLD+flag for Direction/Order Manager
- [ ] Learns from confirmed orders + counts
- [ ] Packaging still manual, unchanged
