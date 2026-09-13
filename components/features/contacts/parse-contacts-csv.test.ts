import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-expect-error -- the Node type-stripping runner requires the extension.
import { decodeContactsCSV, excelCellValueToText, normalizeContactImportCellText, parseContactsCSV, parseContactsCSVRecords } from './parse-contacts-csv.ts';
// @ts-expect-error -- the Node type-stripping runner requires the extension.
import { buildContactExportCSV } from '../../../lib/export-contacts-csv.ts';

test('parses semicolon CSV with quoted delimiters and escaped quotes', () => {
  assert.deepEqual(
    parseContactsCSV('Nome;Mensagem\r\n"Ana; Maria";"Disse ""olá"""\r\n'),
    [{ nome: 'Ana; Maria', mensagem: 'Disse "olá"' }],
  );
});

test('parses comma CSV with line breaks inside quoted fields', () => {
  assert.deepEqual(
    parseContactsCSV('\uFEFFname,message\nJoão,"linha 1\nlinha 2"\n'),
    [{ name: 'João', message: 'linha 1\nlinha 2' }],
  );
});

test('rejects an unterminated quoted field', () => {
  assert.throws(() => parseContactsCSV('name,message\nAna,"incompleto'), /CSV_INVALID_QUOTES/);
});

test('parses tab-delimited exports and keeps the physical source row', () => {
  assert.deepEqual(
    parseContactsCSVRecords('Nome\tTelefone\r\n\r\nAna\t05511999998888\r\n'),
    [{
      rowNumber: 3,
      values: { nome: 'Ana', telefone: '05511999998888' },
    }],
  );
});

test('round-trips the CRM CSV export into import-ready contact values', () => {
  const unsafeFormula = '=HYPERLINK("https://invalid")';
  const csv = buildContactExportCSV(
    ['Nome', 'Telefone', 'Email', 'Documento', 'Observacao'],
    [['Ana; Silva', '+5511999998888', 'ana@example.com', '001234567890123456', unsafeFormula]],
    [false, true, false, true, false],
  );

  assert.match(csv, /^\uFEFFsep=;\r\n/);
  assert.deepEqual(parseContactsCSVRecords(csv), [{
    rowNumber: 3,
    values: {
      nome: 'Ana; Silva',
      telefone: '+5511999998888',
      email: 'ana@example.com',
      documento: '001234567890123456',
      observacao: `'${unsafeFormula}`,
    },
  }]);
});

test('honors a comma separator directive produced by Excel', () => {
  assert.deepEqual(
    parseContactsCSVRecords('SEP=,\r\nNome,Telefone\r\n"Ana; Maria",+5511999998888\r\n'),
    [{
      rowNumber: 3,
      values: { nome: 'Ana; Maria', telefone: '+5511999998888' },
    }],
  );
});

test('unwraps only constant text formulas and does not evaluate expressions', () => {
  assert.equal(normalizeContactImportCellText('="0012"'), '0012');
  assert.equal(normalizeContactImportCellText('="Ana ""Silva"""'), 'Ana "Silva"');
  assert.equal(
    normalizeContactImportCellText('="seguro"&HYPERLINK("https://invalid")'),
    '="seguro"&HYPERLINK("https://invalid")',
  );
  assert.equal(normalizeContactImportCellText('=2+2'), '=2+2');
});

test('falls back to Windows-1252 when the CSV is not valid UTF-8', () => {
  const bytes = Uint8Array.from([0x4a, 0x6f, 0xe3, 0x6f]).buffer;
  assert.equal(decodeContactsCSV(bytes), 'João');
});

test('decodes UTF-16 CSV files exported by spreadsheet applications', () => {
  const bytes = Uint8Array.from([0xff, 0xfe, 0x4e, 0x00, 0x6f, 0x00, 0x6d, 0x00, 0x65, 0x00]).buffer;
  assert.equal(decodeContactsCSV(bytes), 'Nome');
});

test('normalizes rich text, formula results and formatted numeric spreadsheet cells', () => {
  assert.equal(excelCellValueToText({ richText: [{ text: 'Ana' }, { text: ' Silva' }] }), 'Ana Silva');
  assert.equal(excelCellValueToText({ formula: '1+1', result: 2 }), '2');
  assert.equal(excelCellValueToText(5511999998888, '05511999998888'), '05511999998888');
  assert.equal(excelCellValueToText(5511999998888, '5.5112E+12'), '5511999998888');
  assert.equal(excelCellValueToText({ formula: '"001234"' }), '001234');
  assert.equal(excelCellValueToText({ formula: '2+2' }), '');
  assert.equal(excelCellValueToText(0), '0');
});
