# UPDATES for Claude Code — batch 4 (apply to the existing L'Casaoui build)

Apply to the EXISTING project in place. Do not rebuild. One data file is included:
`data/item_categories.json` (86 items → storage zone + subcategory). Copy it into the project's
`data/` folder.

---

## 1. Add storage categories to every item (3 zones + subcategory)

Every item gets a **storage zone** and a **subcategory**, from `data/item_categories.json`:

- **Zones:** `R` = Réfrigérateur (fridge), `C` = Congélateur (freezer), `A` = Ambiant (dry/shelf).
- Each item also has a **subcategory** (e.g. "Produits Laitiers & Fromages", "Emballages &
  Packaging", "Consommables & Hygiène", etc.) — see the JSON.

Schema: add `storageZone` (enum `R | C | A`) and `subCategory` (string) to the Item model.
Seed/update these from `data/item_categories.json` (keyed by item name). Apply with `prisma db push`.

The JSON shape:
```json
{
  "Poke Bowl Salade": { "zone": "R", "zone_name": "Réfrigérateur", "subcategory": "Bases & Légumes Frais" },
  ...
}
```

## 2. Group STOCK COUNTING by zone + subcategory

On the stock count screen (Déclarer le Stock), items must be **grouped and ordered by storage
zone, then subcategory** — so staff count by physical location:

- Order zones: **R (Réfrigérateur) → C (Congélateur) → A (Ambiant)**.
- Within each zone, group by subcategory with a clear heading.
- Show each item with its unit and the (blind) count input, as before — this only changes the
  GROUPING/ORDER on the page, not the blind-count rule (still no expected numbers shown).
- Keep it mobile-friendly: collapsible zone sections work well on a phone.

This same grouping applies wherever items are listed for counting.

## 3. Group ORDERING by zone + subcategory, and add the Bon de Commande Excel export

### Grouping
On the order screens and the order data, group items by the same zone → subcategory order.

### Bon de Commande Excel export (MATCH THE PAPER FORM)
The team is used to a specific printed order form. The order export must match it so they aren't
confused. Produce an **Excel file** (printable) in this layout:

**Header block:**
- Title: "Bon de Commande : Lcasaoui Original Food"
- Date
- Establishment / location line (e.g. "LCASAOUI 2 Rte Ain Chkef" for L2, the equivalent for L1)

**Body — two side-by-side columns of items**, each column with sub-columns:
`Nom D'article | Quantité | Unité`  (so six columns total across the page, two item-blocks).
- **Nom D'article:** the product/item name — keep names exactly as in the master (French), same
  set of items.
- **Quantité:** the order quantity.
- **Unité:** auto-filled from each item's unit (kg / unité / L / pièce / paquet…).
- **Group the items by storage zone (R → C → A) and subcategory**, with zone/subcategory heading
  rows, so the printed form follows the physical storage organization (this is the new
  "récapitulatif par catégories" structure).

**Footer:** a "Remarque :" line.

### TWO versions of this export
1. **Version 1 — the order (system suggestion):** quantities = the generated/suggested order.
2. **Version 2 — confirmed sent:** identical layout, quantities = what was actually confirmed-sent.

Both exportable to Excel, both printable, same Bon de Commande layout. Label each clearly
(e.g. "Commande proposée" vs "Commande envoyée").

Keep the existing universal Excel export elsewhere; this is a specific formatted export for the
order/commande phase.

---

## Schema summary
- Item: add `storageZone` (R|C|A) and `subCategory` (string).
- Apply with `prisma db push` (migrations aren't set up; that's how the DB is managed here).

## Verify after applying
- [ ] Every item has a storageZone (R/C/A) + subCategory, loaded from item_categories.json
- [ ] Stock count screen grouped by zone → subcategory (R→C→A), still blind, mobile-friendly
- [ ] Order screens grouped by zone → subcategory
- [ ] Bon de Commande Excel export matches the paper form (header, two Nom/Quantité/Unité blocks,
      Unité auto-filled, grouped by zone/subcategory, Remarque footer)
- [ ] Two versions export: proposed order + confirmed sent
