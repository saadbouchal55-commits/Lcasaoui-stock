// Universal Excel export. EVERY table/report in the app funnels through here so
// exports are consistent and always include the active filters / date range and
// the scope of what the user could see.
import ExcelJS from 'exceljs';

/**
 * Build an .xlsx workbook buffer.
 *
 * @param {object} opts
 * @param {string} opts.sheetName
 * @param {string} opts.title                 human title printed on row 1
 * @param {Array<{key:string,header:string,width?:number}>} opts.columns
 * @param {Array<Object>} opts.rows           row objects keyed by column.key
 * @param {Object<string,string>} [opts.meta] filters/context, e.g. {Restaurant:'L1', Période:'…'}
 * @returns {Promise<Buffer>}
 */
export async function buildWorkbook({ sheetName = 'Export', title, columns, rows, meta = {} }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "L'Casaoui Stock Tool";
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.substring(0, 31));

  let r = 1;

  if (title) {
    ws.getCell(`A${r}`).value = title;
    ws.getCell(`A${r}`).font = { bold: true, size: 14 };
    r += 1;
  }

  // Context / active filters block.
  const metaEntries = Object.entries(meta);
  metaEntries.push(['Exporté le', new Date().toLocaleString('fr-FR')]);
  for (const [k, v] of metaEntries) {
    ws.getCell(`A${r}`).value = `${k}:`;
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`B${r}`).value = v;
    r += 1;
  }
  r += 1; // blank spacer

  // Header row.
  const headerRow = ws.getRow(r);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6F43' } };
    cell.alignment = { vertical: 'middle' };
  });
  headerRow.commit?.();
  const headerRowNumber = r;
  r += 1;

  // Data rows.
  for (const row of rows) {
    const dataRow = ws.getRow(r);
    columns.forEach((col, i) => {
      dataRow.getCell(i + 1).value = row[col.key] ?? '';
    });
    r += 1;
  }

  // Column widths.
  columns.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width || Math.max(12, col.header.length + 2);
  });

  // Freeze header.
  ws.views = [{ state: 'frozen', ySplit: headerRowNumber }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Express helper: set headers and send an xlsx buffer as a download. */
export function sendXlsx(res, filename, buffer) {
  const safe = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  res.send(buffer);
}

export default { buildWorkbook, sendXlsx };
