// Tiny dependency-free CSV parser/writer. The seed and import files are simple
// comma-separated data with a header row; this handles quoted fields and commas
// inside quotes, which is all we need.

/**
 * Parse CSV text into an array of row objects keyed by header.
 * @param {string} text
 * @returns {Array<Object>}
 */
export function parseCsv(text) {
  const rows = parseRows(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((cells) => {
    const obj = {};
    header.forEach((h, i) => {
      obj[h.trim()] = (cells[i] ?? '').trim();
    });
    return obj;
  });
}

function parseRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  // trailing field / row
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((x) => x !== '')) rows.push(row);
  }
  return rows;
}

export default parseCsv;
