export type ContactCSVRow = Record<string, string>;

export type ContactCSVRecord = {
  rowNumber: number;
  values: ContactCSVRow;
};

type ContactCSVDelimiter = ',' | ';' | '\t';

type ParsedCSVRow = {
  rowNumber: number;
  values: string[];
};

type PreparedCSV = {
  delimiter: ContactCSVDelimiter;
  firstLineNumber: number;
  text: string;
};

function detectDelimiter(text: string): ContactCSVDelimiter {
  let commas = 0;
  let semicolons = 0;
  let tabs = 0;
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
    if (!quoted && character === '\t') tabs += 1;
  }

  if (tabs > commas && tabs > semicolons) return '\t';
  return semicolons > commas ? ';' : ',';
}

function prepareCSV(text: string): PreparedCSV {
  const normalizedText = text.replace(/^\uFEFF/, '');
  const lineBreak = /\r\n|\n|\r/.exec(normalizedText);
  const firstLineEnd = lineBreak?.index ?? normalizedText.length;
  const firstLine = normalizedText
    .slice(0, firstLineEnd)
    .replace(/^[ \f\v]+|[ \f\v]+$/g, '');
  const separatorDirective = /^(?:sep=([,;\t])|"sep=([,;\t])")$/i.exec(firstLine);
  const declaredDelimiter = separatorDirective?.[1] ?? separatorDirective?.[2];

  if (!declaredDelimiter) {
    return {
      delimiter: detectDelimiter(normalizedText),
      firstLineNumber: 1,
      text: normalizedText,
    };
  }

  const contentStart = lineBreak
    ? firstLineEnd + lineBreak[0].length
    : normalizedText.length;
  return {
    delimiter: declaredDelimiter as ContactCSVDelimiter,
    firstLineNumber: 2,
    text: normalizedText.slice(contentStart),
  };
}

export function normalizeContactImportCellText(value: string): string {
  const text = value.trim();
  const constantTextFormula = /^="((?:[^"]|"")*)"$/.exec(text);

  if (!constantTextFormula) return text;
  return constantTextFormula[1].replace(/""/g, '"');
}

function parseRows(
  text: string,
  delimiter: ContactCSVDelimiter,
  firstLineNumber = 1,
) {
  const rows: ParsedCSVRow[] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let lineNumber = firstLineNumber;
  let rowNumber = firstLineNumber;

  const finishRow = () => {
    row.push(field.trim());
    if (row.some((value) => value.length > 0)) {
      rows.push({ rowNumber, values: row });
    }
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
        if (character === '\n') lineNumber += 1;
        if (character === '\r') {
          if (text[index + 1] === '\n') index += 1;
          field += text[index] === '\n' ? '\n' : '';
          lineNumber += 1;
        }
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
      lineNumber += 1;
      rowNumber = lineNumber;
    } else if (character === '\r') {
      if (text[index + 1] === '\n') index += 1;
      finishRow();
      lineNumber += 1;
      rowNumber = lineNumber;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('CSV_INVALID_QUOTES');
  if (field.length > 0 || row.length > 0) finishRow();
  return rows;
}

export function parseContactsCSVRecords(text: string): ContactCSVRecord[] {
  const prepared = prepareCSV(text);
  const rows = parseRows(
    prepared.text,
    prepared.delimiter,
    prepared.firstLineNumber,
  );
  if (rows.length < 2) return [];

  const headers = rows[0].values.map((header) => header.toLowerCase().trim());
  return rows.slice(1).flatMap(({ rowNumber, values }) => {
    const record: ContactCSVRow = {};
    headers.forEach((header, index) => {
      if (header && values[index] !== undefined) {
        record[header] = normalizeContactImportCellText(values[index]);
      }
    });
    return Object.keys(record).length > 0 ? [{ rowNumber, values: record }] : [];
  });
}

export function parseContactsCSV(text: string): ContactCSVRow[] {
  return parseContactsCSVRecords(text).map((record) => record.values);
}

export function decodeContactsCSV(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  if (view[0] === 0xff && view[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (view[0] === 0xfe && view[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes);
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function excelCellValueToText(value: unknown, formattedText = ''): string {
  const displayText = formattedText.trim();
  if (displayText && !/^#+$/.test(displayText)) {
    if (
      typeof value === 'number'
      && Number.isSafeInteger(value)
      && /^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(displayText)
    ) {
      return String(value);
    }
    return normalizeContactImportCellText(displayText);
  }
  if (value == null) return '';
  if (typeof value === 'string') return normalizeContactImportCellText(value);
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value).trim();

  const cellValue = value as {
    formula?: unknown;
    text?: unknown;
    hyperlink?: unknown;
    result?: unknown;
    richText?: Array<{ text?: unknown }>;
    error?: unknown;
  };
  if (typeof cellValue.text === 'string') {
    return normalizeContactImportCellText(cellValue.text);
  }
  if (Array.isArray(cellValue.richText)) {
    return normalizeContactImportCellText(
      cellValue.richText.map((part) => String(part.text ?? '')).join(''),
    );
  }
  if ('result' in cellValue && cellValue.result != null) {
    return excelCellValueToText(cellValue.result);
  }
  if (typeof cellValue.formula === 'string') {
    const formula = cellValue.formula.startsWith('=')
      ? cellValue.formula
      : `=${cellValue.formula}`;
    const normalizedFormula = normalizeContactImportCellText(formula);
    if (normalizedFormula !== formula) return normalizedFormula;
  }
  if (typeof cellValue.hyperlink === 'string') return cellValue.hyperlink.trim();
  if (typeof cellValue.error === 'string') return cellValue.error.trim();
  return '';
}
