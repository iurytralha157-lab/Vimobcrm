import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-expect-error -- the Node type-stripping runner requires the extension.
import { buildContactExportCSV, escapeContactExportCSVCell } from './export-contacts-csv.ts';

test('CSV serializer quotes delimiters and neutralizes spreadsheet formulas', () => {
  assert.equal(
    escapeContactExportCSVCell('Ana; "Silva"'),
    '"Ana; ""Silva"""',
  );
  assert.equal(
    escapeContactExportCSVCell('=HYPERLINK("https://invalid")'),
    '"\'=HYPERLINK(""https://invalid"")"',
  );
});

test('CSV serializer preserves phone numbers and leading-zero identifiers as Excel text', () => {
  assert.equal(
    escapeContactExportCSVCell('+5511999998888', true),
    '"=""+5511999998888"""',
  );
  assert.equal(
    escapeContactExportCSVCell('001234567890123456', true),
    '"=""001234567890123456"""',
  );
});

test('CSV document includes Excel separator metadata and consistent text columns', () => {
  assert.equal(
    buildContactExportCSV(
      ['Nome', 'Telefone'],
      [['Ana', '+5511999998888']],
      [false, true],
    ),
    '\uFEFFsep=;\r\n"Nome";"Telefone"\r\n"Ana";"=""+5511999998888"""',
  );
});
