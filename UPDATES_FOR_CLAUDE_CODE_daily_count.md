# UPDATE for Claude Code — Daily count: exclude packaging (with future scheduled-count note)

Apply to the existing build. Data file included: `data/daily_count_flags.json` (item name →
`true` = counted daily, `false` = not counted daily). Copy it into the project's `data/` folder.

## NOW (this is the change to make now)

Add a per-item flag **`countedDaily`** (boolean) on the Item model, loaded from
`data/daily_count_flags.json`.

- **The daily stock count screen must only show items where `countedDaily = true`.**
- The 22 items flagged `false` (all packaging/disposables + Glaçons + Mayonnaise) must **NOT appear
  in the daily count** at all — staff will not count them each day.
- Everything else (64 food ingredients) is counted daily as normal (still blind, grouped by
  storage zone R→C→A / subcategory).
- Reconciliation/waste for the daily-counted items is unaffected. Items not counted daily simply
  aren't part of the daily count; their stock is still tracked from orders/received as before.

Apply the schema change with `prisma db push`. Load the flags from the JSON (a targeted update
script, NOT a full re-seed — I don't want to wipe data).

## LATER (design note — do NOT build yet, just be aware)

In a future update we'll add **scheduled counting** for the non-daily items: instead of never
counting them, they'll be counted on **certain days** (e.g. packaging counted weekly on a chosen
weekday, or a custom schedule per item/group). So please implement the `countedDaily` flag in a way
that can later extend to a **count schedule** (e.g. an item could have a `countFrequency` /
`countDays` later) rather than a hard-coded boolean that would need ripping out. Keep it flexible.
For now, `countedDaily = false` just means "not in the daily count."

## Verify
- [ ] Item has a `countedDaily` flag, loaded from data/daily_count_flags.json
- [ ] Daily count screen shows ONLY countedDaily = true items (64), grouped by zone, still blind
- [ ] The 22 flagged items do not appear in the daily count
- [ ] Applied via db push + a targeted flag-loading script (no full re-seed / no data loss)
- [ ] Flag designed so a future "scheduled count" (count on certain days) can extend it
