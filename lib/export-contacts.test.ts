import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-expect-error -- the Node type-stripping runner requires the extension.
import { buildContactExportCSV, escapeContactExportCSVCell } from './export-contacts-csv.ts';
// @ts-expect-error -- Node's type-stripping runner needs the extension.
import { normalizeContactImportCellText } from '../components/features/contacts/parse-contacts-csv.ts';

test('CSV serializer quotes delimiters and neutralizes spreadsheet formulas', () => {
  assert.equal(
    escapeContactExportCSVCell('Ana; "Silva"'),
    '"Ana; ""Silva"""',
  );
  const encoded = escapeContactExportCSVCell('=HYPERLINK("https://invalid")');
  const cell = encoded.slice(1, -1).replace(/""/g, '"');
  assert.match(cell, /^="(?:[^"]|"")*"$/);
  assert.equal(normalizeContactImportCellText(cell), '=HYPERLINK("https://invalid")');
});

test('formula-like strings round trip exactly, including literal formulas and original apostrophes', () => {
  for (const value of ['=VIP', '+ Cliente', '- Quero apartamento', '@Olá', '\t =DDE()', '="x"', "'=VIP", '="x"&HYPERLINK("bad")']) {
    const encoded = escapeContactExportCSVCell(value);
    const cell = encoded.slice(1, -1).replace(/""/g, '"');
    assert.equal(normalizeContactImportCellText(cell), value);
    if (/^\s*[=+\-@]/.test(value)) assert.match(cell, /^="(?:[^"]|"")*"$/);
  }
});

test('long safe JSON/text remains exportable; oversized dangerous/numeric literals fail without truncation', () => {
  const safe = JSON.stringify({ message: 'a'.repeat(2_000) });
  assert.equal(escapeContactExportCSVCell(safe, true).slice(1, -1).replace(/""/g, '"'), safe);
  assert.throws(() => escapeContactExportCSVCell('='.repeat(256)), /255 caracteres/);
  assert.throws(() => escapeContactExportCSVCell('0'.repeat(256), true), /255 caracteres/);
  assert.doesNotThrow(() => escapeContactExportCSVCell('a'.repeat(10_000)));
  assert.doesNotThrow(() => escapeContactExportCSVCell('2 quartos: ' + 'a'.repeat(1_000), true));
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
