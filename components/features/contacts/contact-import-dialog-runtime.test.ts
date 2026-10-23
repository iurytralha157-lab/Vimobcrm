import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import ExcelJS from 'exceljs';
import { assignContactImportKeys, ContactImportFileError, ignoredContactImportColumns, normalizeContactImportRows, type ParsedContact } from './contact-import-columns';
import { decodeContactsCSV, parseContactsCSVRecords } from './parse-contacts-csv';
import { parseContactsWorksheet } from './parse-contacts-xlsx';

// Run the actual dialog handler, with browser state/toasts replaced. This covers
// wiring to the file parsers without rendering React or contacting any server.
const source = readFileSync(new URL('./ImportContactsDialog.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('ImportContactsDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations: ts.VariableDeclaration[] = [];
const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node)) declarations.push(node); ts.forEachChild(node, visit); };
visit(ast);
const initializer = declarations.find((node) => node.name.getText(ast) === 'parseFile')?.initializer;
assert.ok(initializer);
const handler = ts.transpileModule(`const handler = ${initializer.getText(ast)}; return handler;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function parserHarness() {
  const state = { rows: [] as ParsedContact[], ignored: [] as string[], errors: [] as string[], parsing: true };
  const parseRequestRef = { current: 1 };
  let sequence = 0;
  const dependencies = {
    ExcelJS, decodeContactsCSV, parseContactsCSVRecords, parseContactsWorksheet, ContactImportFileError,
    assignContactImportKeys, ignoredContactImportColumns, normalizeContactImportRows,
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` },
    parseRequestRef, setFile: () => {}, setParsedData: (rows: ParsedContact[]) => { state.rows = rows; },
    setIgnoredColumns: (columns: string[]) => { state.ignored = columns; }, setIsParsing: (value: boolean) => { state.parsing = value; },
    formatPtBRNumber: String, toast: { success: () => {}, info: () => {}, error: (message: string) => { state.errors.push(message); } },
    console: { error: () => {} },
  };
  const parse = new Function(...Object.keys(dependencies), handler)(...Object.values(dependencies)) as (file: File, requestId: number) => Promise<void>;
  return { state, parseRequestRef, parse };
}

test('actual dialog parser keeps previous export aliases and lists ignored columns', async () => {
  const harness = parserHarness();
  await harness.parse(new File(['Nome;Atendimento/Estágio;Mensagem do lead;Cidade\nAna;Negociação;Detalhes;Curitiba'], 'contacts.csv'), 1);
  assert.equal(harness.state.rows[0].estagio, 'Negociação');
  assert.equal(harness.state.rows[0].mensagem, 'Detalhes');
  assert.ok(harness.state.rows[0].importRequestKey);
  assert.deepEqual(harness.state.ignored, ['cidade']);
  assert.deepEqual(harness.state.errors, []);
});

test('actual dialog parser accepts 150,000 rows below 10 MB without spreading arguments', async () => {
  const harness = parserHarness();
  await harness.parse(new File(['Nome;Telefone\n' + 'Contato;\n'.repeat(150_000)], 'large.csv'), 1);
  assert.equal(harness.state.rows.length, 150_000);
  assert.deepEqual(harness.state.errors, []);
  assert.equal(harness.state.parsing, false);
});

test('actual XLSX dialog path rejects duplicate aliases before showing import rows', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Contatos').addRows([['Nome', 'Email', 'E-mail'], ['Ana', 'one@example.com', 'two@example.com']]);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer()).slice().buffer;
  const harness = parserHarness();
  await harness.parse(new File([bytes], 'contacts.xlsx'), 1);
  assert.equal(harness.state.rows.length, 0);
  assert.match(harness.state.errors[0], /duplicada/);
});

test('stale file reads cannot replace a newer file selection', async () => {
  const harness = parserHarness();
  harness.parseRequestRef.current = 2;
  await harness.parse(new File(['Nome\nAna'], 'old.csv'), 1);
  assert.equal(harness.state.rows.length, 0);
  assert.deepEqual(harness.state.errors, []);
});

