export type ContactExportCSVCell = string | number | boolean | null | undefined;

export function escapeContactExportCSVCell(
  value: ContactExportCSVCell,
  preserveAsText = false,
) {
  const text = value == null ? '' : String(value);

  const dangerousText = typeof value === 'string' && /^\s*[=+\-@]/.test(text);
  const numericText = /^\s*[+\-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+\-]?\d+)?\s*$/.test(text);
  if (text && (dangerousText || preserveAsText)) {
    // Excel constant string literals support at most 255 characters.
    if (text.length > 255 && (dangerousText || numericText)) {
      throw new Error('Um texto exige proteção como literal, mas ultrapassa 255 caracteres no CSV do Excel. Escolha Excel (.xlsx) ou remova essa coluna. Nenhum conteúdo foi cortado e nenhum arquivo foi gerado.');
    }
    if (text.length > 255) return `"${text.replace(/"/g, '""')}"`;
    const excelTextFormula = `="${text.replace(/"/g, '""')}"`;
    return `"${excelTextFormula.replace(/"/g, '""')}"`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

export function buildContactExportCSV(
  headers: readonly ContactExportCSVCell[],
  rows: ReadonlyArray<readonly ContactExportCSVCell[]>,
  preserveTextColumns: readonly boolean[] = [],
) {
  const body = [headers, ...rows]
    .map((row, rowIndex) =>
      row
        .map((value, columnIndex) =>
          escapeContactExportCSVCell(
            value,
            rowIndex > 0 && preserveTextColumns[columnIndex] === true,
          ),
        )
        .join(';'),
    )
    .join('\r\n');

  return `\uFEFFsep=;\r\n${body}`;
}
