// Group items by storage zone → subcategory, ordered R → C → A then the
// paper-form subcategory order, then item name. Mirrors src/lib/zones.js.
const ZONE_ORDER = ['R', 'C', 'A'];
const SUBCAT_ORDER = [
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
const subRank = (s) => { const i = SUBCAT_ORDER.indexOf(s); return i < 0 ? 98 : i; };

/**
 * @param {Array<{name:string, storageZone?:string, subCategory?:string}>} items
 * @returns {Array<{zone:string, subs:Array<{sub:string, items:Array}>}>}
 */
export function groupByZone(items) {
  const sorted = [...items].sort(
    (a, b) =>
      zoneRank(a.storageZone) - zoneRank(b.storageZone) ||
      subRank(a.subCategory) - subRank(b.subCategory) ||
      String(a.name || '').localeCompare(String(b.name || ''), 'fr'),
  );
  const zones = [];
  let curZone = null;
  let curSub = null;
  for (const it of sorted) {
    const z = it.storageZone || '—';
    const s = it.subCategory || '—';
    if (!curZone || curZone.zone !== z) { curZone = { zone: z, subs: [] }; zones.push(curZone); curSub = null; }
    if (!curSub || curSub.sub !== s) { curSub = { sub: s, items: [] }; curZone.subs.push(curSub); }
    curSub.items.push(it);
  }
  return zones;
}

export default groupByZone;
