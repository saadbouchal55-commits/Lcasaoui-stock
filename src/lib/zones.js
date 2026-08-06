// Storage-zone ordering + grouping. Zones run R (fridge) → C (freezer) → A
// (ambient); subcategories follow the paper-form order below, then item name.
export const ZONE_ORDER = ['R', 'C', 'A'];
export const ZONE_NAMES = { R: 'Réfrigérateur', C: 'Congélateur', A: 'Ambiant' };

export const SUBCAT_ORDER = [
  'Bases & Légumes Frais',
  'Produits Laitiers & Fromages',
  'Viandes & Préparations',
  'Sauces Fraîches & Desserts',
  'Viandes & Ingrédients Surgelés',
  'Produits Prêts à Frire / Cuire',
  'Épicerie Sèche & Pains',
  'Emballages & Packaging',
  'Consommables & Hygiène',
];

const zoneRank = (z) => { const i = ZONE_ORDER.indexOf(z); return i < 0 ? 99 : i; };
const subcatRank = (s) => { const i = SUBCAT_ORDER.indexOf(s); return i < 0 ? 98 : i; };

/** Comparator: zone (R→C→A) → subcategory (paper-form order) → name. */
export function byZoneSubName(a, b) {
  return (
    zoneRank(a.storageZone) - zoneRank(b.storageZone) ||
    subcatRank(a.subCategory) - subcatRank(b.subCategory) ||
    String(a.name || '').localeCompare(String(b.name || ''), 'fr')
  );
}

/**
 * Group items into ordered sections by zone → subcategory.
 * @param {Array<{name:string, storageZone?:string, subCategory?:string}>} items
 * @returns {Array<{zone:string, zoneName:string, subCategory:string, items:Array}>}
 */
export function groupByZoneSub(items) {
  const sorted = [...items].sort(byZoneSubName);
  const groups = [];
  let cur = null;
  for (const it of sorted) {
    const zone = it.storageZone || '—';
    const sub = it.subCategory || '—';
    if (!cur || cur.zone !== zone || cur.subCategory !== sub) {
      cur = { zone, zoneName: ZONE_NAMES[zone] || zone, subCategory: sub, items: [] };
      groups.push(cur);
    }
    cur.items.push(it);
  }
  return groups;
}

export default { ZONE_ORDER, ZONE_NAMES, SUBCAT_ORDER, byZoneSubName, groupByZoneSub };
