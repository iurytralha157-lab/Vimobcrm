import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { parseContactsWorksheet } from './parse-contacts-xlsx';
import { normalizeContactImportRows } from './contact-import-columns';
import { parseContactTags, serializeContactTags } from '@/lib/contact-tag-transfer';

test('real XLSX cells preserve contact values, physical row and JSON tag names', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Contatos').addRows([['Nome', 'Telefone', 'Estágio', 'Mensagem', 'Tags'], [], ['Ana', '+351912345678', 'Negociação', 'linha 1\nlinha 2', serializeContactTags(['Quente, investidor'])]]);
  const copy = new ExcelJS.Workbook();
  await copy.xlsx.load(await workbook.xlsx.writeBuffer());
  const rows = normalizeContactImportRows(parseContactsWorksheet(copy.worksheets[0]));
  assert.equal(rows[0].rowNumber, 3);
  assert.equal(rows[0].telefone, '+351912345678');
  assert.equal(rows[0].mensagem, 'linha 1\nlinha 2');
  assert.deepEqual(parseContactTags(rows[0].tags || ''), { names: ['Quente, investidor'] });
});

test('XLSX duplicate and equivalent headers fail rather than overwrite cells', () => {
  for (const headers of [['Nome', 'Email', 'Email'], ['Nome', 'Email', 'E-mail']]) {
    const worksheet = new ExcelJS.Workbook().addWorksheet('Contatos');
    worksheet.addRows([headers, ['Ana', 'one@example.com', 'two@example.com']]);
    assert.throws(() => parseContactsWorksheet(worksheet), /duplicada/);
  }
});

test('XLSX data without a header fails with its physical row and column', () => {
  const worksheet = new ExcelJS.Workbook().addWorksheet('Contatos');
  worksheet.addRows([['Nome'], ['Ana', 'valor sem cabeçalho']]);
  assert.throws(() => parseContactsWorksheet(worksheet), /Linha 2: coluna 2/);
});
