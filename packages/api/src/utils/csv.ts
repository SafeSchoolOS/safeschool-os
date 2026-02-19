/**
 * Minimal CSV parser that handles BOM, CRLF, quoted fields, and escaped quotes.
 * Returns an array of records keyed by lowercase header names.
 */
export function parseCsv(raw: string): Record<string, string>[] {
  // Strip UTF-8 BOM
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  const rows = parseRows(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const records: Record<string, string>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    // Skip blank rows
    if (cells.length === 1 && cells[0].trim() === '') continue;

    const record: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = (cells[j] ?? '').trim();
    }
    records.push(record);
  }

  return records;
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const { row, nextIndex } = parseRow(text, i);
    rows.push(row);
    i = nextIndex;
  }

  return rows;
}

function parseRow(text: string, start: number): { row: string[]; nextIndex: number } {
  const cells: string[] = [];
  let i = start;
  const len = text.length;

  while (i < len) {
    if (text[i] === '"') {
      // Quoted field
      const { value, nextIndex } = parseQuoted(text, i);
      cells.push(value);
      i = nextIndex;
    } else {
      // Unquoted field — read until comma or newline
      let end = i;
      while (end < len && text[end] !== ',' && text[end] !== '\r' && text[end] !== '\n') {
        end++;
      }
      cells.push(text.slice(i, end));
      i = end;
    }

    if (i < len && text[i] === ',') {
      i++; // skip comma, continue to next cell
    } else {
      // End of row — skip \r\n or \n
      if (i < len && text[i] === '\r') i++;
      if (i < len && text[i] === '\n') i++;
      break;
    }
  }

  return { row: cells, nextIndex: i };
}

function parseQuoted(text: string, start: number): { value: string; nextIndex: number } {
  let i = start + 1; // skip opening quote
  const len = text.length;
  let value = '';

  while (i < len) {
    if (text[i] === '"') {
      if (i + 1 < len && text[i + 1] === '"') {
        // Escaped quote
        value += '"';
        i += 2;
      } else {
        // End of quoted field
        i++; // skip closing quote
        break;
      }
    } else {
      value += text[i];
      i++;
    }
  }

  return { value, nextIndex: i };
}
