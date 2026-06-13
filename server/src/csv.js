// Minimal RFC-4180-ish CSV parser. Handles quoted fields, embedded commas
// (e.g. "1,200"), and escaped double-quotes (""). No external dependency, so
// every line of parsing is ours to explain. Returns an array of row objects
// keyed by the header.
export function parseCsv(text) {
  const rows = parseRows(text);
  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1)
    // Skip fully-empty trailing lines.
    .filter((cells) => cells.some((c) => c !== ''))
    .map((cells, i) => {
      const obj = { __rowNumber: i + 1 }; // 1-based data row number (header excluded)
      headers.forEach((h, j) => { obj[h] = cells[j] ?? ''; });
      return obj;
    });

  return { headers, records };
}

// Split raw text into an array of arrays of cells, respecting quotes.
function parseRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* ignore, handled by \n */ }
    else { field += c; }
  }
  // Flush the last field/row if the file doesn't end with a newline.
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
