// "Bon de Commande" — a printable, fully-bordered Excel that mirrors the team's
// paper order form. Header block (title / establishment / date + version), then a
// single bordered table grouped by storage zone → subcategory with bold heading
// rows, columns: Article | Unité | Suggéré | Commandé | Réellement envoyé, and a
// "Remarque :" footer.
import ExcelJS from 'exceljs';

const GREEN = 'FF1F6F43';
const ZONE_FILL = 'FFCDE2D6';   // zone heading row
const SUB_FILL = 'FFEDF3EF';    // subcategory heading row
const THIN = { style: 'thin', color: { argb: 'FF8A968E' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const NCOLS = 4;

/**
 * @param {object} o
 * @param {string} o.title
 * @param {string} o.establishment
 * @param {string} o.dateStr
 * @param {string} o.versionLabel
 * @param {Array<{zone:string, zoneName:string, subCategory:string, items:Array<{name:string, unit:string, suggested?:number|string, ordered?:number|string}>}>} o.groups
 * @param {string} [o.remarque]
 * @returns {Promise<Buffer>}
 */
export async function buildBonCommande({ title, establishment, dateStr, versionLabel, groups, remarque = 'Remarque :' }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "L'Casaoui";
  const ws = wb.addWorksheet('Bon de Commande', {
    // Scale to fit 1 page wide × 2 pages tall — Excel shrinks the print just enough
    // to fit two pages (won't stretch a short bon). fitToHeight:0 let it overflow.
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 2, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
  });
  ws.getColumn(1).width = 34; // Article
  ws.getColumn(2).width = 12; // Unité
  ws.getColumn(3).width = 13; // Commandé
  ws.getColumn(4).width = 20; // Réellement envoyé

  let r = 1;
  const banner = (text, { size = 11, align = 'center' } = {}) => {
    ws.mergeCells(r, 1, r, NCOLS);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { bold: true, size };
    c.alignment = { horizontal: align, vertical: 'middle' };
    r += 1;
  };
  banner(title, { size: 14 });
  banner(`Établissement : ${establishment}`, { align: 'left' });
  banner(`Date : ${dateStr}     —     ${versionLabel}`, { align: 'left' });
  r += 1; // spacer

  const borderRow = (row) => { for (let c = 1; c <= NCOLS; c++) ws.getCell(row, c).border = BORDER; };
  const mergedHeadingRow = (text, fill, { size = 11 } = {}) => {
    ws.mergeCells(r, 1, r, NCOLS);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { bold: true, size };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    c.alignment = { horizontal: 'left', vertical: 'middle' };
    borderRow(r);
    r += 1;
  };

  // Column header row.
  ['Article', 'Unité', 'Commandé', 'Réellement envoyé'].forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
    c.alignment = { horizontal: i === 0 ? 'left' : 'center', vertical: 'middle', wrapText: true };
  });
  borderRow(r);
  r += 1;

  // Grouped body: zone heading (on change) → subcategory heading → item rows.
  let lastZone = null;
  for (const g of groups) {
    if (g.zone !== lastZone) {
      lastZone = g.zone;
      mergedHeadingRow(`${String(g.zoneName || g.zone).toUpperCase()} — ${g.zone}`, ZONE_FILL, { size: 12 });
    }
    mergedHeadingRow(g.subCategory || '—', SUB_FILL);
    for (const it of g.items) {
      ws.getCell(r, 1).value = it.name;
      ws.getCell(r, 2).value = it.unit;
      ws.getCell(r, 3).value = it.ordered ?? '';
      ws.getCell(r, 4).value = ''; // Réellement envoyé — filled by hand
      ws.getCell(r, 1).alignment = { horizontal: 'left' };
      for (let c = 2; c <= NCOLS; c++) ws.getCell(r, c).alignment = { horizontal: 'center' };
      borderRow(r);
      r += 1;
    }
  }

  r += 1; // spacer
  ws.mergeCells(r, 1, r, NCOLS);
  const rem = ws.getCell(r, 1);
  rem.value = remarque;
  rem.font = { bold: true };
  rem.alignment = { horizontal: 'left', vertical: 'top' };
  ws.getRow(r).height = 46;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export default buildBonCommande;
