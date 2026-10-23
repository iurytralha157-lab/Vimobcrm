import type { Worksheet } from 'exceljs';
import { ContactImportFileError, validateContactImportHeaders } from '@/components/features/contacts/contact-import-columns';
import { excelCellValueToText, type ContactCSVRecord } from '@/components/features/contacts/parse-contacts-csv';

export function parseContactsWorksheet(worksheet: Worksheet): ContactCSVRecord[] {
  const headerRow = worksheet.getRow(1);
  const headers = Array.from({ length: headerRow.cellCount }, (_, index) => {
    const cell = headerRow.getCell(index + 1);
    return excelCellValueToText(cell.value, cell.text).toLowerCase().trim();
  });
  validateContactImportHeaders(headers);
  const rows: ContactCSVRecord[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell((cell, column) => {
      if (!headers[column - 1] && excelCellValueToText(cell.value, cell.text)) {
        throw new ContactImportFileError(`Linha ${rowNumber}: coluna ${column} preenchida sem cabeçalho`);
      }
    });
    const values = Object.fromEntries(headers.flatMap((header, index) => {
      if (!header) return [];
      const cell = row.getCell(index + 1);
      return [[header, excelCellValueToText(cell.value, cell.text)]];
    }));
    if (Object.values(values).some(Boolean)) rows.push({ rowNumber, values });
  });
  return rows;
}
