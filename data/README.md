# Seed data notes
- Quantities in recipes.json are in the item's native unit; weight items use grams ("g"),
  converted to kg (/1000) at reconciliation. Frites applies yield 0.65 (fried→raw).
- Package items (Cheddar 88, Oreo 144, sauces 220): recipe qty is in pieces; convert to
  packages via pack_size for stock.
- Packaging items are NOT in recipes.json (order-tracked only).
- sales_history_L1: "Frites Maison"/"Frites Maison Epicees" → Frites at 150g fried each.
  Ignore "MENU 79 COUPE DU MONDE", drinks, and trivial one-off typo lines.
