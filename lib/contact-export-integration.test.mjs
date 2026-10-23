import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { registerHooks } from 'node:module';
import { parseContactsCSVRecords } from '../components/features/contacts/parse-contacts-csv.ts';
import { parseContactTags } from './contact-tag-transfer.ts';

const state = { blobs: [], fetchPage: null, makeWorkbook: null };
globalThis.__contactExportIntegration = state;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    let source;
    if (specifier === 'exceljs') {
      source = 'export default { Workbook: class { constructor() { return globalThis.__contactExportIntegration.makeWorkbook(); } } };';
    } else if (specifier === '@/lib/api/contacts') {
      source = 'export const contactsAPI = { listPage: (...args) => globalThis.__contactExportIntegration.fetchPage(...args) };';
    } else if (specifier === 'date-fns') {
      // These fixtures exercise transfer fields; date formatting has no values here.
      source = 'export const format = () => "";';
    } else if (specifier === 'date-fns/locale') {
      source = 'export const ptBR = {};';
    }
    return source ? { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` } : nextResolve(specifier, context);
  },
});

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalObjectURL = URL.createObjectURL;
before(() => {
  globalThis.document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
  globalThis.window = { setTimeout() {} };
  URL.createObjectURL = (blob) => { state.blobs.push(blob); return 'blob:synthetic-export'; };
});
after(() => {
  URL.createObjectURL = originalObjectURL;
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else delete globalThis.document;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete globalThis.window;
  delete globalThis.__contactExportIntegration;
  hook.deregister();
});

const { exportContactsFiltered } = await import('./export-contacts.ts');
const version = 'a'.repeat(64);
const fixture = {
  id: '001234567890123456', name: 'Ana; Açúcar', phone: '+5511999998888',
  source: 'meta', stage_name: 'Visita agendada', message: 'Mensagem original', cep: '00123456',
  valor_interesse: '0', commission_percentage: '0', first_touch_seconds: 0,
  tags: [{ name: 'VIP, São Paulo' }, { name: 'Nome; especial| "aspas"' }],
};

function serveFixture(onCall) {
  state.blobs.length = 0;
  state.fetchPage = async (query, organizationId) => {
    assert.equal(organizationId, 'organization-A');
    assert.equal(query.mode, 'export');
    assert.deepEqual(query.campaignIds, ['campaign-A', 'campaign-B']);
    const override = onCall?.(query);
    return { data: [fixture], total: 1, page: query.page, limit: query.limit, exportVersion: version, ...override };
  };
}

const options = {
  organizationId: 'organization-A', filters: { campaignIds: ['campaign-A', 'campaign-B'] },
  includeDynamicFields: false,
};

test('filtered CSV preserves canonical origin, compatible headers, reversible tags and zero/text values', async () => {
  let calls = 0;
  serveFixture((query) => {
    calls += 1;
    assert.equal(query.expectedExportVersion, calls === 1 ? undefined : version);
  });
  const count = await exportContactsFiltered({ ...options, exportFormat: 'csv', columnKeys: ['id', 'nome', 'telefone', 'cep', 'origem', 'estagio', 'mensagem', 'tags', 'valor_interesse', 'comissao_percentual', 'primeiro_toque_segundos'] });
  assert.equal(count, 1);
  assert.equal(calls, 2);
  assert.equal(state.blobs.length, 1);
  const [{ values }] = parseContactsCSVRecords(await state.blobs[0].text());
  assert.equal(values['id do lead'], fixture.id);
  assert.equal(values.nome, fixture.name);
  assert.equal(values.telefone, fixture.phone);
  assert.equal(values.cep, fixture.cep);
  assert.equal(values.origem, 'meta');
  assert.equal(values['estágio'], fixture.stage_name);
  assert.equal(values.mensagem, fixture.message);
  assert.deepEqual(parseContactTags(values.tags).names, fixture.tags.map((tag) => tag.name));
  assert.equal(values['valor de interesse'], '0');
  assert.equal(values['comissão %'], '0');
  assert.equal(values['primeiro toque segundos'], '0');
});

test('a version change at final verification prevents CSV download and success', async () => {
  let calls = 0;
  serveFixture(() => ++calls === 1 ? undefined : { exportVersion: 'b'.repeat(64) });
  await assert.rejects(exportContactsFiltered({ ...options, exportFormat: 'csv', columnKeys: ['nome'] }), /lista de contatos mudou/);
  assert.equal(state.blobs.length, 0);
});

test('export forwards the initiating actor and SID on all page reads and final verification', async () => {
  serveFixture();
  const fetchPage = state.fetchPage;
  const requestIntent = { expectedUserId: 'actor-A', expectedSessionId: 'session-A' };
  let calls = 0;
  state.fetchPage = async (query, organizationId, intent) => {
    calls += 1;
    assert.equal(intent.expectedUserId, requestIntent.expectedUserId);
    assert.equal(intent.expectedSessionId, requestIntent.expectedSessionId);
    return fetchPage(query, organizationId);
  };
  await exportContactsFiltered({ ...options, exportFormat: 'csv', columnKeys: ['nome'], requestIntent });
  assert.equal(calls, 2);
  assert.equal(state.blobs.length, 1);
});

test('same actor and organization with a changed session cannot finish a previous export', async () => {
  let currentSession = 'session-A';
  serveFixture((query) => { if (query.limit === 1) currentSession = 'session-B'; });
  await assert.rejects(exportContactsFiltered({
    ...options, exportFormat: 'csv', columnKeys: ['nome'],
    shouldContinue: () => currentSession === 'session-A',
  }), { name: 'AbortError' });
  assert.equal(state.blobs.length, 0);
});

test('cancel during XLSX writeBuffer prevents download and success', async () => {
  const controller = new AbortController();
  serveFixture();
  state.makeWorkbook = () => ({
    addWorksheet: () => ({ columns: [], columnCount: 0, addRow: () => ({ getCell: () => ({}) }), getRow: () => ({}) }),
    xlsx: { writeBuffer: async () => { controller.abort(); return new Uint8Array([1]); } },
  });
  await assert.rejects(exportContactsFiltered({ ...options, exportFormat: 'xlsx', columnKeys: ['nome'], signal: controller.signal }), { name: 'AbortError' });
  assert.equal(state.blobs.length, 0);
});

test('lifecycle cancellation while a page is in flight prevents later generation and download', async () => {
  const controller = new AbortController();
  serveFixture(() => { controller.abort(); });
  await assert.rejects(exportContactsFiltered({ ...options, exportFormat: 'csv', columnKeys: ['nome'], signal: controller.signal }), { name: 'AbortError' });
  assert.equal(state.blobs.length, 0);
});

test('CSV preparation yields to cancellation before building the complete file', async () => {
  const controller = new AbortController();
  state.blobs.length = 0;
  state.fetchPage = async (query) => ({
    data: Array.from({ length: 500 }, (_, index) => ({ ...fixture, id: String(index) })),
    total: 500, page: query.page, limit: query.limit, exportVersion: version,
  });
  await assert.rejects(exportContactsFiltered({
    ...options, exportFormat: 'csv', columnKeys: ['nome'], signal: controller.signal,
    onProgress: (progress) => {
      if (progress.phase === 'downloading') setTimeout(() => controller.abort(), 0);
    },
  }), { name: 'AbortError' });
  assert.equal(state.blobs.length, 0);
});
