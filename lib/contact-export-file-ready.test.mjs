import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { registerHooks } from 'node:module';
import { parseContactsCSVRecords } from '../components/features/contacts/parse-contacts-csv.ts';

const state = { fetchPage: null, downloads: 0, urls: 0, timers: 0 };
globalThis.__contactExportFileReady = state;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'exceljs') {
      return nextResolve(new URL('../node_modules/exceljs/dist/exceljs.js', import.meta.url).href, context);
    }
    if (specifier === '@/lib/api/contacts') {
      const source = 'export const contactsAPI = { listPage: (...args) => globalThis.__contactExportFileReady.fetchPage(...args) };';
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    return nextResolve(specifier, context);
  },
});
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalCreate = URL.createObjectURL;
before(() => {
  globalThis.document = { createElement: () => ({ click() { state.downloads += 1; }, remove() {} }), body: { appendChild() {} } };
  globalThis.window = { setTimeout() { state.timers += 1; } };
  URL.createObjectURL = () => { state.urls += 1; return 'blob:synthetic-file-ready'; };
});
after(() => {
  URL.createObjectURL = originalCreate;
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else delete globalThis.document;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete globalThis.window;
  delete globalThis.__contactExportFileReady;
  hook.deregister();
});
const { default: ExcelJS } = await import('exceljs');
const { exportContactsFiltered } = await import('./export-contacts.ts');
const fixture = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Ana Açúcar', phone: '+5511999998888', email: 'ana@example.test', tags: [],
};
const options = {
  organizationId: 'synthetic-org', filename: 'leads-2026-10-27',
  columnKeys: ['nome', 'telefone', 'email'], includeDynamicFields: false,
};
function reset() {
  state.downloads = 0;
  state.urls = 0;
  state.timers = 0;
  state.fetchPage = async (query) => ({
    data: [fixture], total: 1, page: query.page, limit: query.limit,
    exportVersion: 'a'.repeat(64),
  });
}
function assertNoAutomaticDownload() {
  assert.equal(state.downloads, 0);
  assert.equal(state.urls, 0);
  assert.equal(state.timers, 0);
}

test('CSV callback receives reusable bytes and a filename without clicking or starting URL cleanup', async () => {
  reset();
  const files = [];
  const count = await exportContactsFiltered({ ...options, exportFormat: 'csv', onFileReady: (file) => files.push(file) });
  assert.equal(count, 1);
  assert.equal(files.length, 1);
  assert.equal(files[0].filename, 'leads-2026-10-27.csv');
  assert.equal(files[0].blob.type, 'text/csv;charset=utf-8;');
  const [{ values }] = parseContactsCSVRecords(await files[0].blob.text());
  assert.equal(values.nome, fixture.name);
  assert.equal(values.telefone, fixture.phone);
  assert.equal(values.email, fixture.email);
  assertNoAutomaticDownload();
});

test('XLSX callback receives real workbook bytes without an automatic download', async () => {
  reset();
  const files = [];
  const count = await exportContactsFiltered({ ...options, exportFormat: 'xlsx', onFileReady: (file) => files.push(file) });
  assert.equal(count, 1);
  assert.equal(files.length, 1);
  assert.equal(files[0].filename, 'leads-2026-10-27.xlsx');
  assert.equal(files[0].blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await files[0].blob.arrayBuffer());
  const sheet = workbook.getWorksheet('Contatos');
  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.getCell('A2').value, fixture.name);
  assert.equal(sheet.getCell('B2').value, fixture.phone);
  assert.equal(sheet.getCell('C2').value, fixture.email);
  assertNoAutomaticDownload();
});

test('read failure does not announce a file as ready', async () => {
  reset();
  state.fetchPage = async () => { throw new Error('synthetic read failure'); };
  const files = [];
  await assert.rejects(exportContactsFiltered({ ...options, exportFormat: 'csv', onFileReady: (file) => files.push(file) }), /synthetic read failure/);
  assert.deepEqual(files, []);
  assertNoAutomaticDownload();
});

test('final integrity failure prevents either format from announcing a ready file', async () => {
  for (const exportFormat of ['csv', 'xlsx']) {
    reset();
    const fetchPage = state.fetchPage;
    state.fetchPage = async (query) => ({
      ...await fetchPage(query), exportVersion: (query.limit === 1 ? 'b' : 'a').repeat(64),
    });
    const files = [];
    await assert.rejects(exportContactsFiltered({ ...options, exportFormat, onFileReady: (file) => files.push(file) }), /lista de contatos mudou/);
    assert.deepEqual(files, []);
    assertNoAutomaticDownload();
  }
});
