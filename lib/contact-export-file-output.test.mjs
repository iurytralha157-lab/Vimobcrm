import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { registerHooks } from 'node:module';
import ExcelJS from '../node_modules/exceljs/dist/exceljs.js';
import { parseContactsCSVRecords } from '../components/features/contacts/parse-contacts-csv.ts';
import { parseContactsWorksheet } from '../components/features/contacts/parse-contacts-xlsx.ts';

const state = { rows: [], blobs: [], calls: [] };
globalThis.__contactExportFileOutput = state;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'exceljs') {
      return { shortCircuit: true, url: new URL('../node_modules/exceljs/dist/exceljs.js', import.meta.url).href };
    }
    if (specifier === '@/lib/api/contacts') {
      const source = `export const contactsAPI = { listPage: async (query) => {
        const state = globalThis.__contactExportFileOutput;
        state.calls.push(query);
        return { data: query.limit === 1 ? state.rows.slice(0, 1) : state.rows,
          total: state.rows.length, page: query.page, limit: query.limit, exportVersion: 'a'.repeat(64) };
      } };`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    return nextResolve(specifier, context);
  },
});
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalObjectURL = URL.createObjectURL;
before(() => {
  globalThis.document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
  globalThis.window = { setTimeout() {} };
  URL.createObjectURL = (blob) => { state.blobs.push(blob); return 'blob:synthetic-export-file'; };
});
after(() => {
  URL.createObjectURL = originalObjectURL;
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else delete globalThis.document;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete globalThis.window;
  delete globalThis.__contactExportFileOutput;
  hook.deregister();
});
const {
  exportContactsFiltered,
  CONTACT_EXPORT_COLUMN_OPTIONS,
  CONTACT_EXPORT_PRESETS,
} = await import('./export-contacts.ts');
const fixture = {
  id: '11111111-1111-4111-8111-111111111111', name: '=VIP', phone: '+5511999998888', cep: '00123456',
  message: '- Quero apartamento', source: 'manual', created_at: '2026-10-12T12:00:00Z', tags: [],
  meta_raw_payload_json: '{"fields":[{"id":"q-A","name":"Renda","value":9007199254740993},{"id":"q-B","name":"Renda","value":1234567890.1234567890123456789}]}',
};

function reset(rows = [fixture]) {
  state.rows = rows;
  state.blobs.length = 0;
  state.calls.length = 0;
}
async function readWorkbook() {
  assert.equal(state.blobs.length, 1);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await state.blobs[0].arrayBuffer());
  return workbook.getWorksheet('Contatos');
}

test('real XLSX and CSV exports reimport literal constant-formula text without changing it', async () => {
  const literal = '="Ana ""Silva"""';
  reset([{ ...fixture, name: literal, message: '="x"' }]);
  for (const exportFormat of ['xlsx', 'csv']) {
    state.blobs.length = 0;
    await exportContactsFiltered({ organizationId: 'synthetic-org', exportFormat, columnKeys: ['nome', 'mensagem'], includeDynamicFields: false });
    const rows = exportFormat === 'xlsx'
      ? parseContactsWorksheet(await readWorkbook())
      : parseContactsCSVRecords(await state.blobs[0].text());
    assert.equal(rows[0].values.nome, literal);
    assert.equal(rows[0].values.mensagem, '="x"');
  }
});

test('real XLSX bytes preserve text, leading zeros, precise dynamic numbers and distinct question identities', async () => {
  reset([{ ...fixture, message: '=' + 'a'.repeat(300) }]);
  await exportContactsFiltered({ organizationId: 'synthetic-org', columnKeys: ['nome', 'telefone', 'cep', 'mensagem'], includeDynamicFields: true });
  const sheet = await readWorkbook();
  const headers = sheet.getRow(1).values;
  const get = (label) => sheet.getRow(2).getCell(headers.indexOf(label));
  assert.equal(get('Nome').value, '=VIP');
  assert.equal(get('Nome').type, ExcelJS.ValueType.String);
  assert.equal(get('Telefone').value, fixture.phone);
  assert.equal(get('Telefone').numFmt, '@');
  assert.equal(get('CEP').value, fixture.cep);
  assert.equal(get('Mensagem').value, '=' + 'a'.repeat(300));
  const questions = headers.filter((header) => typeof header === 'string' && header.startsWith('Pergunta'));
  assert.equal(questions.length, 2);
  assert.equal(get(questions.find((header) => header.includes('q-A'))).value, '9007199254740993');
  assert.equal(get(questions.find((header) => header.includes('q-B'))).value, '1234567890.1234567890123456789');
  assert.equal(state.calls.length, 2);
  assert.equal(state.calls[1].expectedExportVersion, 'a'.repeat(64));
});

test('real CSV output round trips dangerous strings and original apostrophes without executing formulas', async () => {
  for (const name of ['=VIP', '+ Cliente', '- Cliente', '@Cliente', '="x"', "'=VIP"]) {
    reset([{ ...fixture, name }]);
    await exportContactsFiltered({ exportFormat: 'csv', organizationId: 'synthetic-org', columnKeys: ['nome', 'telefone', 'mensagem'], includeDynamicFields: false });
    const [{ values }] = parseContactsCSVRecords(await state.blobs[0].text());
    assert.equal(values.nome, name);
    assert.equal(values.telefone, fixture.phone);
    assert.equal(values.mensagem, fixture.message);
  }
});

test('XLSX column and cell bounds fail before producing an artifact; JSON fallback remains usable', async () => {
  reset(Array.from({ length: 66 }, (_, n) => ({ ...fixture, id: String(n), meta_raw_payload_json: null,
    metadata_json: JSON.stringify(Object.fromEntries(Array.from({ length: 250 }, (_, index) => [`unique-${n}-${index}`, 'value']))) })));
  await assert.rejects(exportContactsFiltered({ organizationId: 'synthetic-org', columnKeys: ['nome'], includeDynamicFields: true }), /Escolha CSV/);
  assert.equal(state.blobs.length, 0);
  reset([{ ...fixture, metadata_json: JSON.stringify({ long: 'a'.repeat(33_000) }) }]);
  await assert.rejects(exportContactsFiltered({ organizationId: 'synthetic-org', columnKeys: ['nome', 'metadata_json'], includeDynamicFields: false }), /32.767 caracteres/);
  assert.equal(state.blobs.length, 0);
  await exportContactsFiltered({ organizationId: 'synthetic-org', exportFormat: 'csv', columnKeys: ['nome', 'metadata_json'], includeDynamicFields: false });
  assert.equal(state.blobs.length, 1);
  assert.ok((await state.blobs[0].text()).includes('a'.repeat(33_000)));
});

test('expansion budget refusal permits a subsequent exact raw JSON export', async () => {
  const raw = '{"nested":' + '['.repeat(65) + '9007199254740993' + ']'.repeat(65) + '}';
  reset([{ ...fixture, metadata_json: raw }]);
  await assert.rejects(exportContactsFiltered({ organizationId: 'synthetic-org', columnKeys: ['nome'], includeDynamicFields: true }), /Desmarque a expansão/);
  assert.equal(state.blobs.length, 0);
  await exportContactsFiltered({ organizationId: 'synthetic-org', columnKeys: ['nome', 'metadata_json'], includeDynamicFields: false });
  const sheet = await readWorkbook();
  const column = sheet.getRow(1).values.indexOf('Metadados JSON');
  assert.equal(sheet.getRow(2).getCell(column).value, raw);
});

const originalStringColumns = {
  id: 'id', nome: 'name', telefone: 'phone', whatsapp: 'whatsapp', email: 'email',
  status_interno: 'status', pipeline: 'pipeline_name', pipeline_id: 'pipeline_id',
  estagio: 'stage_name', estagio_id: 'stage_id', responsavel: 'assignee_name',
  responsavel_id: 'assigned_user_id', origem: 'source', origem_detalhe: 'source_detail',
  prioridade: 'priority', motivo_perda: 'lost_reason', feedback: 'feedback',
  valor_interesse: 'valor_interesse', comissao_percentual: 'commission_percentage',
  faixa_valor_imovel: 'faixa_valor_imovel', renda_familiar: 'renda_familiar',
  finalidade_compra: 'finalidade_compra', cargo: 'cargo', empresa: 'empresa',
  profissao: 'profissao', cep: 'cep', endereco: 'endereco', numero: 'numero',
  complemento: 'complemento', bairro: 'bairro', cidade: 'cidade', uf: 'uf',
  codigo_imovel: 'property_code', imovel_id: 'property_id',
  imovel_interesse_id: 'interest_property_id', plano_interesse_id: 'interest_plan_id',
  mensagem: 'message', mensagem_inicial: 'initial_message', campanha: 'campaign_name',
  campanha_id: 'campaign_id', conjunto: 'adset_name', conjunto_id: 'adset_id',
  formulario: 'form_name', formulario_id: 'form_id', criativo: 'ad_name',
  criativo_id: 'ad_id', criativo_url: 'creative_url', video_url: 'creative_video_url',
  instagram_url: 'creative_instagram_url', plataforma: 'platform',
  meta_lead_id: 'meta_lead_id', meta_form_id: 'meta_form_id',
  meta_campaign_id: 'meta_campaign_id', meta_adset_id: 'meta_adset_id',
  meta_ad_id: 'meta_ad_id', meta_click_id: 'meta_click_id', utm_source: 'utm_source',
  utm_medium: 'utm_medium', utm_campaign: 'utm_campaign', utm_content: 'utm_content',
  utm_term: 'utm_term', primeiro_toque_canal: 'first_touch_channel',
  primeiro_toque_usuario_id: 'first_touch_actor_user_id',
  primeira_resposta_canal: 'first_response_channel',
  primeira_resposta_usuario_id: 'first_response_actor_user_id',
  source_session_id: 'source_session_id', source_webhook_id: 'source_webhook_id',
  visitor_session_id: 'visitor_session_id', criado_por: 'created_by',
};
const originalDateColumns = {
  criado_em: 'created_at', atualizado_em: 'updated_at',
  entrada_estagio: 'stage_entered_at', ultima_entrada: 'last_entry_at',
  ultimo_contato: 'last_contact_at', proximo_follow_up: 'next_follow_up_at',
  data_ganho: 'won_at', data_perda: 'lost_at', primeiro_toque_em: 'first_touch_at',
  primeira_resposta_em: 'first_response_at',
};
const originalBooleanColumns = {
  procura_financiamento: 'procura_financiamento', trabalha: 'trabalha',
  primeira_resposta_automatica: 'first_response_is_automation',
};
const originalNumberColumns = {
  primeiro_toque_segundos: 'first_touch_seconds',
  primeira_resposta_segundos: 'first_response_seconds',
  reentradas: 'reentry_count', redistribuicoes: 'redistribution_count',
};

function completeFixture() {
  const contact = {
    deal_status: 'won', tags: [{ name: 'VIP, A' }, { name: 'B;C' }],
    is_own_resource: true,
  };
  const expected = { status: 'Ganho', motivo_ganho: 'value-feedback', tags: '["VIP, A","B;C"]' };
  for (const [key, source] of Object.entries(originalStringColumns)) {
    contact[source] = `value-${source}`;
    expected[key] = contact[source];
  }
  // Local dates avoid depending on the timezone of the test machine.
  for (const [key, source] of Object.entries(originalDateColumns)) {
    contact[source] = '2026-10-20T12:21:00';
    expected[key] = '20/10/2026 12:21';
  }
  for (const [key, source] of Object.entries(originalBooleanColumns)) {
    contact[source] = false;
    expected[key] = 'Não';
  }
  for (const [key, source] of Object.entries(originalNumberColumns)) {
    contact[source] = 0;
    expected[key] = '0';
  }
  for (const key of ['metadata_json', 'meta_payload_json', 'meta_raw_payload_json']) {
    contact[key] = `{"synthetic":"${key}","precise":9007199254740993}`;
    expected[key] = contact[key];
  }
  return { contact, expected };
}

async function readOutputRows(exportFormat) {
  if (exportFormat === 'csv') {
    return parseContactsCSVRecords(await state.blobs[0].text()).map(row => row.values);
  }
  const sheet = await readWorkbook();
  const headers = sheet.getRow(1).values.slice(1);
  return Array.from({ length: sheet.rowCount - 1 }, (_, index) => Object.fromEntries(
    headers.map((header, column) => [header.toLocaleLowerCase('pt-BR'), String(sheet.getRow(index + 2).getCell(column + 1).value ?? '')]),
  ));
}

test('own resources is selectable in profile and Complete retains all original report columns', () => {
  const ownResources = CONTACT_EXPORT_COLUMN_OPTIONS.find(column => column.key === 'recursos_proprios');
  assert.deepEqual(ownResources, { key: 'recursos_proprios', label: 'Recursos próprios', group: 'profile' });
  const complete = CONTACT_EXPORT_PRESETS.find(preset => preset.key === 'complete');
  assert.equal(complete.columnKeys.length, 93);
  assert.equal(complete.includeDynamicFields, true);
  assert.equal(new Set(complete.columnKeys).size, 93);
  const { expected } = completeFixture();
  assert.equal(Object.keys(expected).length, 92);
  assert.deepEqual([...complete.columnKeys].filter(key => key !== 'recursos_proprios').sort(), Object.keys(expected).sort());
  for (const preset of CONTACT_EXPORT_PRESETS.filter(candidate => candidate.key !== 'complete')) {
    assert.ok(!preset.columnKeys.includes('recursos_proprios'));
  }
});

for (const exportFormat of ['csv', 'xlsx']) {
  test(`${exportFormat} retains the values of all original 92 fixed columns with own resources added`, async () => {
    const { contact, expected } = completeFixture();
    reset([contact]);
    const complete = CONTACT_EXPORT_PRESETS.find(preset => preset.key === 'complete');
    await exportContactsFiltered({ organizationId: 'synthetic-org', exportFormat, columnKeys: complete.columnKeys, includeDynamicFields: false });
    const [row] = await readOutputRows(exportFormat);
    assert.equal(Object.keys(row).length, 93);
    for (const [key, value] of Object.entries(expected)) {
      const column = CONTACT_EXPORT_COLUMN_OPTIONS.find(candidate => candidate.key === key);
      assert.equal(row[column.label.toLocaleLowerCase('pt-BR')], value, key);
    }
    assert.equal(row['recursos próprios'], 'Sim');
  });

  for (const completeReport of [false, true]) {
    test(`${exportFormat} preserves true, false and null own resources in ${completeReport ? 'Complete' : 'single-column selection'}`, async () => {
      reset([true, false, null].map((value, index) => ({
        ...fixture, id: `synthetic-${index}`, is_own_resource: value, meta_raw_payload_json: null,
      })));
      const complete = CONTACT_EXPORT_PRESETS.find(preset => preset.key === 'complete');
      await exportContactsFiltered({
        organizationId: 'synthetic-org', exportFormat,
        columnKeys: completeReport ? complete.columnKeys : ['recursos_proprios'],
        includeDynamicFields: completeReport,
      });
      if (exportFormat === 'csv' && !completeReport) {
        // The importer deliberately skips entirely empty records; inspect the
        // raw CSV to also prove the null contact retains its empty output row.
        assert.deepEqual((await state.blobs[0].text()).replace(/^\uFEFF/, '').split('\r\n'), [
          'sep=;', '"Recursos próprios"', '"Sim"', '"Não"', '""',
        ]);
        return;
      }
      const rows = await readOutputRows(exportFormat);
      assert.equal(rows.length, 3);
      assert.deepEqual(rows.map(row => row['recursos próprios']), ['Sim', 'Não', '']);
      assert.equal(Object.keys(rows[0]).length, completeReport ? 93 : 1);
    });
  }
}
