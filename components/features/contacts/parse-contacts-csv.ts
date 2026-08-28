export type ContactCSVRow = Record<string, string>;

function detectDelimiter(text: string): ',' | ';' {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && (character === '\n' || character === '\r')) break;
    if (!quoted && character === ',') commas += 1;
    if (!quoted && character === ';') semicolons += 1;
  }

  return semicolons > commas ? ';' : ',';
}

function parseRows(text: string, delimiter: ',' | ';') {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const finishRow = () => {
    row.push(field.trim());
    if (row.some((value) => value.length > 0)) rows.push(row);
    row = [];
    field = '';
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (character === '\n') {
      finishRow();
    } else if (character === '\r') {
      if (text[index + 1] === '\n') index += 1;
      finishRow();
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('CSV_INVALID_QUOTES');
  if (field.length > 0 || row.length > 0) finishRow();
  return rows;
}

export function parseContactsCSV(text: string): ContactCSVRow[] {
  const normalizedText = text.replace(/^\uFEFF/, '');
  const rows = parseRows(normalizedText, detectDelimiter(normalizedText));
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => header.toLowerCase().trim());
  return rows.slice(1).flatMap((values) => {
    const record: ContactCSVRow = {};
    headers.forEach((header, index) => {
      if (header && values[index] !== undefined) record[header] = values[index];
    });
    return Object.keys(record).length > 0 ? [record] : [];
  });
}
