// "Bon de Commande" — a printable Excel that mirrors the team's paper order form.
// Header (title / establishment / date + version), then TWO side-by-side blocks of
// [Nom D'article | Quantité | Unité] grouped by storage zone → subcategory, and a
// "Remarque :" footer. Layout is deliberately form-like (borders, landscape print).
import ExcelJS from 'exceljs';

const GREEN = 'FF1F6F43';
const HEAD_FILL = 'FFE8F0EB';
const THIN = { style: 'thin', color: { argb: 'FFBFC7C1' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

/**
 * @param {object} o
 * @param {string} o.title
 * @param {string} o.establishment
 * @param {string} o.dateStr
 * @param {string} o.versionLabel
 * @param {Array<{zoneName:string, subCategory:string, items:Array<{name:string, qty:number, unit:string}>}>} o.groups
 * @param {string} [o.remarque]
 * @returns {Promise<Buffer>}
 */
export async function buildBonCommande({ title, establishment, dateStr, versionLabel, groups, remarque = 'Remarque :' }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "L'Casaoui";
  const ws = wb.addWorksheet('Bon de Commande', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
  });
  ws.getColumn(1).width = 30; ws.getColumn(2).width = 10; ws.getColumn(3).width = 9;
  ws.getColumn(4).width = 3;
  ws.getColumn(5).width = 30; ws.getColumn(6).width = 10; ws.getColumn(7).width = 9;

  let r = 1;
  const bannerRow = (text, { size = 11, align = 'center' } = {}) => {
    ws.mergeCells(r, 1, r, 7);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { bold: true, size };
    c.alignment = { horizontal: align, vertical: 'middle' };
    r += 1;
  };
  bannerRow(title, { size: 14 });
  bannerRow(`Établissement : ${establishment}`, { align: 'left' });
  bannerRow(`Date : ${dateStr}     —     ${versionLabel}`, { align: 'left' });
  r += 1; // spacer

  // Column sub-headers for both blocks.
  const head = (col, text) => {
    const c = ws.getCell(r, col);
    c.value = text;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
    c.alignment = { horizontal: 'center' };
    c.border = BORDER;
  };
  head(1, "Nom D'article"); head(2, 'Quantité'); head(3, 'Unité');
  head(5, "Nom D'article"); head(6, 'Quantité'); head(7, 'Unité');
  r += 1;

  // Flatten groups to entries (header + items), keeping whole groups together when
  // splitting into the left/right columns.
  const entriesOf = (g) => [
    { header: `${g.zoneName} — ${g.subCategory}` },
    ...g.items.map((it) => ({ name: it.name, qty: it.qty, unit: it.unit })),
  ];
  const total = groups.reduce((n, g) => n + 1 + g.items.length, 0);
  const half = Math.ceil(total / 2);
  const left = [];
  const right = [];
  let count = 0;
  for (const g of groups) {
    const e = entriesOf(g);
    if (count < half) { left.push(...e); count += e.length; } else right.push(...e);
  }

  const writeEntry = (row, base, entry) => {
    if (!entry) {
      for (let c = base; c < base + 3; c++) ws.getCell(row, c).border = BORDER;
      return;
    }
    if (entry.header) {
      ws.mergeCells(row, base, row, base + 2);
      const c = ws.getCell(row, base);
      c.value = entry.header;
      c.font = { bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
      c.alignment = { horizontal: 'left' };
      for (let cc = base; cc < base + 3; cc++) ws.getCell(row, cc).border = BORDER;
    } else {
      ws.getCell(row, base).value = entry.name;
      ws.getCell(row, base + 1).value = entry.qty;
      ws.getCell(row, base + 2).value = entry.unit;
      ws.getCell(row, base + 1).alignment = { horizontal: 'center' };
      ws.getCell(row, base + 2).alignment = { horizontal: 'center' };
      for (let cc = base; cc < base + 3; cc++) ws.getCell(row, cc).border = BORDER;
    }
  };

  const maxLen = Math.max(left.length, right.length);
  for (let i = 0; i < maxLen; i++) {
    writeEntry(r + i, 1, left[i]);
    writeEntry(r + i, 5, right[i]);
  }
  r += maxLen + 1; // + spacer

  ws.mergeCells(r, 1, r, 7);
  const rem = ws.getCell(r, 1);
  rem.value = remarque;
  rem.font = { bold: true };
  rem.alignment = { horizontal: 'left', vertical: 'top' };
  ws.getRow(r).height = 46;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export default buildBonCommande;
