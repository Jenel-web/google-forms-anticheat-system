// CSV for Sheets and Excel: UTF-8 with a BOM, CRLF line ends, quoted when needed, and spreadsheet formulas defused.

// A text cell starting with = + - @ tab or CR is run as a formula by Excel and Sheets. A leading apostrophe keeps it text.
function cell(value) {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// columns = [{key, label}], rows = array of objects. Returns the CSV text (no BOM; see downloadCsv).
export function toCsv(columns, rows) {
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c.key])).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function downloadCsv(filename, text) {
  const blob = new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Reads one column of a CSV and keeps nothing else. `pickColumn(headerCells)` returns the index to keep (or -1).
// Every other cell is dropped as soon as it is read, so answer text from a Forms responses file is never stored (NFR-1).
// Handles quoted fields with commas, doubled quotes and line breaks inside them.
export function readCsvColumn(text, pickColumn) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const values = [];
  let header = [];
  let keep = -2; // -2: still reading the header row
  let row = 0;
  let col = 0;
  let field = '';
  let quoted = false;

  const endField = () => {
    if (row === 0) header.push(field);
    else if (col === keep) values.push(field);
    col += 1;
    field = '';
  };
  const endRow = () => {
    endField();
    if (row === 0) {
      keep = pickColumn(header);
      header = [];
    }
    row += 1;
    col = 0;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') endField();
    else if (ch === '\n') endRow();
    else if (ch === '\r') { if (src[i + 1] !== '\n') endRow(); }
    else field += ch;
    if (row > 0 && keep === -1) return { found: false, values: [], rows: 0 };
  }
  if (field !== '' || col > 0) endRow();
  if (row === 0 || keep === -2 || keep === -1) return { found: false, values: [], rows: Math.max(0, row - 1) };
  return { found: true, values, rows: row - 1 };
}
