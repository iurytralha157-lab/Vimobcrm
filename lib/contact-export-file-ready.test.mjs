import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseContactsCSVRecords } from '../components/features/contacts/parse-contacts-csv.ts';

const ExcelJS = createRequire(import.meta.url)('exceljs');
const state = { list: null, calls: [], downloads: 0, urls: 0, timers: 0 };
globalThis.__contactExportHotfixFileReady = state;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'exceljs') {
      return { shortCircuit: true, url: pathToFileURL(realpathSync(fileURLToPath(new URL('../node_modules/exceljs/dist/exceljs.js', import.meta.url)))).href };
    }
    if (specifier === '@/lib/api/contacts') {
      const source = 'export const contactsAPI = { list: (...args) => globalThis.__contactExportHotfixFileReady.list(...args) };';
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    if (specifier === '@/lib/export-contacts-csv') {
      return { shortCircuit: true, url: new URL('./export-contacts-csv.ts', import.meta.url).href };
    }
    return nextResolve(specifier, context);
  },
});
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalCreate = URL.createObjectURL;
const originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async () => { throw new Error('HOTFIX_TEST_NETWORK_FORBIDDEN'); };
  globalThis.document = { createElement: () => ({ click() { state.downloads += 1; }, remove() {} }), body: { appendChild() {} } };
  globalThis.window = { setTimeout() { state.timers += 1; } };
  URL.createObjectURL = () => { state.urls += 1; return 'blob:synthetic-hotfix-file-ready'; };
});
after(() => {
  URL.createObjectURL = originalCreate;
  globalThis.fetch = originalFetch;
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else delete globalThis.document;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete globalThis.window;
  delete globalThis.__contactExportHotfixFileReady;
  hook.deregister();
});
const { exportContactsFiltered } = await import('./export-contacts.ts');
const fixture = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Synthetic Açúcar',
  phone: '+5511000000000', email: 'synthetic@example.invalid', tags: [], total_count: 1,
};
const options = {
  organizationId: 'synthetic-org', filename: 'leads-2026-10-27',
  filters: { source: 'manual', pipelineId: '22222222-2222-4222-8222-222222222222' },
  columnKeys: ['nome', 'telefone', 'email'], includeDynamicFields: false,
};
function reset() {
  state.downloads = 0;
  state.urls = 0;
  state.timers = 0;
  state.calls.length = 0;
  state.list = async (...args) => { state.calls.push(args); return [fixture]; };
}
function assertNoAutomaticDownload() {
  assert.equal(state.downloads, 0);
  assert.equal(state.urls, 0);
  assert.equal(state.timers, 0);
}

test('CSV callback receives actual reusable bytes while preserving the legacy list request', async () => {
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
  assert.deepEqual(state.calls[0][0], { ...options.filters, sortBy: 'created_at', sortDir: 'desc', page: 1, limit: 500, mode: 'export' });
  assert.equal(state.calls[0][1], options.organizationId);
  assert.equal(state.calls.length, 1);
  assertNoAutomaticDownload();
});

test('XLSX callback receives a real workbook without automatic clicking', async () => {
  reset();
  const files = [];
  assert.equal(await exportContactsFiltered({ ...options, exportFormat: 'xlsx', onFileReady: (file) => files.push(file) }), 1);
  assert.equal(files.length, 1);
  assert.equal(files[0].filename, 'leads-2026-10-27.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await files[0].blob.arrayBuffer());
  const sheet = workbook.getWorksheet('Contatos');
  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.getCell('A2').value, fixture.name);
  assert.equal(sheet.getCell('B2').value, fixture.phone);
  assert.equal(sheet.getCell('C2').value, fixture.email);
  assertNoAutomaticDownload();
});

test('legacy callers without a callback retain their automatic download in both formats', async () => {
  for (const exportFormat of ['csv', 'xlsx']) {
    reset();
    assert.equal(await exportContactsFiltered({ ...options, exportFormat }), 1);
    assert.equal(state.downloads, 1);
    assert.equal(state.urls, 1);
    assert.equal(state.timers, 1);
  }
});

test('read failure and an incomplete legacy page announce no ready file', async () => {
  for (const exportFormat of ['csv', 'xlsx']) {
    for (const incomplete of [false, true]) {
      reset();
      state.list = async () => {
        if (!incomplete) throw new Error('synthetic read failure');
        return [{ ...fixture, total_count: 2 }];
      };
      const files = [];
      await assert.rejects(exportContactsFiltered({ ...options, exportFormat, onFileReady: (file) => files.push(file) }), incomplete ? /lista de contatos mudou/ : /synthetic read failure/);
      assert.deepEqual(files, []);
      assertNoAutomaticDownload();
    }
  }
});

test('a rejected ready callback propagates without starting a download', async () => {
  reset();
  await assert.rejects(exportContactsFiltered({ ...options, exportFormat: 'csv', onFileReady() { throw new DOMException('Synthetic stale scope', 'AbortError'); } }), { name: 'AbortError' });
  assertNoAutomaticDownload();
});

test('a pre-aborted export performs no read and announces no file', async () => {
  reset();
  const controller = new AbortController();
  controller.abort();
  const files = [];
  await assert.rejects(exportContactsFiltered({ ...options, signal: controller.signal, onFileReady: (file) => files.push(file) }), { name: 'AbortError' });
  assert.deepEqual(files, []);
  assert.equal(state.calls.length, 0);
  assertNoAutomaticDownload();
});
