export type ContactExportCSVCell = string | number | boolean | null | undefined;

export function escapeContactExportCSVCell(
  value: ContactExportCSVCell,
  preserveAsText = false,
) {
  const text = value == null ? '' : String(value);

  if (preserveAsText && text) {
    const excelTextFormula = `="${text.replace(/"/g, '""')}"`;
    return `"${excelTextFormula.replace(/"/g, '""')}"`;
  }

  const safeText =
    typeof value === 'string' && /^\s*[=+\-@]/.test(text)
      ? `'${text}`
      : text;
  return `"${safeText.replace(/"/g, '""')}"`;
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
