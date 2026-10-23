import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLeadHistory } from './build-history';
import { extractMetaCreative, extractMetaFormAnswers, extractWebhookFormAnswers } from './forms';
import { answerText, FORM_ANSWER_VALUE_KEYS } from './metadata';
import type { LeadHistoryFormatters, LeadHistoryRaw } from './types';

const at = '2026-10-19T12:00:00.000Z';
const formatters: LeadHistoryFormatters = {
  formatCurrency: String, formatPropertyCurrency: String, formatResponseTime: String,
};
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
const values: Array<{ name: string; input: unknown; expected: string | null; legacy: string | null }> = [
  { name: 'false', input: false, expected: 'false', legacy: null },
  { name: 'true', input: true, expected: 'true', legacy: 'true' },
  { name: 'zero', input: 0, expected: '0', legacy: '0' },
  { name: 'negative zero', input: -0, expected: '0', legacy: '0' },
  { name: 'literal false', input: 'false', expected: 'false', legacy: 'false' },
  { name: 'literal true', input: ' true ', expected: 'true', legacy: 'true' },
  { name: 'literal Não', input: 'Não', expected: 'Não', legacy: 'Não' },
  { name: 'ordinary text', input: ' Resposta ', expected: 'Resposta', legacy: 'Resposta' },
  { name: 'empty', input: '', expected: null, legacy: null },
  { name: 'blank', input: ' \t\n ', expected: null, legacy: null },
  { name: 'null', input: null, expected: null, legacy: null },
  { name: 'absent', input: undefined, expected: null, legacy: null },
  { name: 'empty array', input: [], expected: null, legacy: null },
  { name: 'false array', input: [false], expected: 'false', legacy: null },
  { name: 'mixed array', input: [false, true, 0, '', null], expected: 'false, true, 0', legacy: 'true, 0' },
  { name: 'nested array', input: [[false], [true, 0]], expected: 'false, true, 0', legacy: 'true, 0' },
  { name: 'false wrapper', input: { value: false }, expected: 'false', legacy: null },
  { name: 'nested false wrapper', input: { value: { answer: false } }, expected: 'false', legacy: null },
  { name: 'false wrapper has priority', input: { value: false, answer: true }, expected: 'false', legacy: 'true' },
  { name: 'blank wrapper falls through', input: { value: '', answer: false }, expected: 'false', legacy: null },
  { name: 'empty object', input: {}, expected: null, legacy: null },
  { name: 'unrecognized object', input: { custom: false }, expected: null, legacy: null },
];
for (const item of values) {
  test(`explicit form value preserves ${item.name}`, () => {
    const input = freeze(item.input), before = structuredClone(input);
    assert.equal(answerText(input, { preserveFalse: true }), item.expected);
    assert.deepEqual(input, before);
  });
  test(`default text conversion keeps existing ${item.name} behavior`, () => {
    assert.equal(answerText(freeze(item.input)), item.legacy);
    assert.equal(answerText(item.input, { preserveFalse: false }), item.legacy);
  });
}
for (const key of FORM_ANSWER_VALUE_KEYS) {
  test(`recognized own ${key} wrapper preserves false recursively`, () => {
    assert.equal(answerText(freeze({ [key]: [false, { value: false }] }), { preserveFalse: true }), 'false, false');
  });
}
test('inherited wrapper answers are not treated as stored own values', () => {
  const inherited = Object.create({ value: false, answer: true });
  assert.equal(answerText(inherited, { preserveFalse: true }), null);
  assert.deepEqual(extractWebhookFormAnswers({ fields: [inherited] }), []);
});

type WebhookSource = 'activity-payload' | 'activity-raw-payload' | 'lead-meta';
const webhookSources: WebhookSource[] = ['activity-payload', 'activity-raw-payload', 'lead-meta'];
function webhookRaw(source: WebhookSource, payload: Record<string, unknown>): LeadHistoryRaw {
  if (source === 'lead-meta') return {
    lead: { id: 'lead-a', source: 'webhook', created_at: at },
    leadMeta: { id: 'meta-a', platform: 'webhook', created_at: at, raw_payload: payload },
  };
  return { activityEvents: [{ id: 'created-a', type: 'lead_created', created_at: at,
    metadata: { source: 'webhook', [source === 'activity-payload' ? 'payload' : 'raw_payload']: payload } }] };
}
function webhookAnswers(raw: LeadHistoryRaw) {
  return buildLeadHistory(raw, 'lead-a', formatters).filter(event => event.type === 'webhook_form_answer');
}
const webhookCases: Array<[string, unknown, string | null]> = [
  ['boolean false', false, 'false'], ['boolean true', true, 'true'], ['zero', 0, '0'],
  ['literal false', 'false', 'false'], ['blank', '', null], ['null', null, null],
  ['false wrapper', { value: false }, 'false'],
  ['array wrapper', { values: [false, true, 0, null, ''] }, 'false, true, 0'],
];
for (const source of webhookSources) for (const [name, value, expected] of webhookCases) {
  test(`${source} projects ${name} without changing stored payload`, () => {
    const raw = freeze(webhookRaw(source, { custom_fields: { financiamento: value } })), before = structuredClone(raw);
    const rows = webhookAnswers(raw);
    assert.equal(rows.length, expected === null ? 0 : 1);
    if (expected !== null) {
      assert.equal(rows[0].content, expected); assert.equal(rows[0].metadata?.answer, expected);
      assert.equal(rows[0].metadata?.question, 'Financiamento'); assert.equal(rows[0].channel, 'webhook');
    }
    assert.deepEqual(raw, before);
  });
}
for (const source of webhookSources) {
  test(`${source} keeps technical filters and deduplicates equal false answers`, () => {
    const raw = freeze(webhookRaw(source, { email: false, token: false, utm_source: false,
      custom_fields: [{ label: 'financiamento', value: false }, { label: 'financiamento', value: false },
        { label: 'financiamento', value: true }, { label: 'dependentes', value: 0 }] }));
    const before = structuredClone(raw), rows = webhookAnswers(raw);
    assert.deepEqual(rows.map(event => [event.metadata?.question, event.content]), [
      ['Financiamento', 'false'], ['Financiamento', 'true'], ['Dependentes', '0'],
    ]);
    assert.deepEqual(raw, before);
  });
}
for (const container of ['custom_fields', 'field_data']) for (const value of [false, true, 0, { value: false }]) {
  test(`Meta ${container} preserves explicit ${JSON.stringify(value)}`, () => {
    const metadata = freeze({ source: 'meta', [container]: { financiamento: value } }), before = structuredClone(metadata);
    const expected = value === true ? 'true' : value === 0 ? '0' : 'false';
    assert.deepEqual(extractMetaFormAnswers(metadata), [{ question: 'financiamento', answer: expected }]);
    const raw: LeadHistoryRaw = { activityEvents: [{ id: 'meta-created', type: 'lead_created', created_at: at, metadata }] };
    const rows = buildLeadHistory(raw, 'lead-a', formatters).filter(event => event.type === 'meta_form_answer');
    assert.deepEqual(rows.map(event => [event.metadata?.question, event.content]), [['financiamento', expected]]);
    assert.deepEqual(metadata, before);
  });
}
test('Meta technical fields and value priority remain compatible', () => {
  const metadata = freeze({ field_data: { email: false, phone: false, financiamento: { value: false, answer: true } },
    custom_fields: { financiamento: false } });
  assert.deepEqual(extractMetaFormAnswers(metadata), [{ question: 'financiamento', answer: 'false' }]);
});
test('incomplete history does not invent fallback answers from lead metadata', () => {
  const raw = freeze({ ...webhookRaw('lead-meta', { financiamento: false }), historyCoverage: { complete: false } });
  assert.deepEqual(webhookAnswers(raw), []);
});
test('canonical activity answers take precedence over lead-meta fallback', () => {
  const raw = freeze({ ...webhookRaw('activity-payload', { financiamento: false }),
    lead: { id: 'lead-a', source: 'webhook', created_at: at },
    leadMeta: { id: 'meta-a', platform: 'webhook', raw_payload: { financiamento: true }, created_at: at } });
  assert.deepEqual(webhookAnswers(raw).map(event => event.content), ['false']);
});
test('boolean labels are not reinterpreted as answer values', () => {
  assert.deepEqual(extractWebhookFormAnswers({ fields: [{ label: false, value: false }] }), []);
  assert.deepEqual(extractWebhookFormAnswers({ fields: [{ label: ' financiamento ', value: false, answer: true }] }), [
    { question: 'Financiamento', answer: 'false' },
  ]);
});
test('creative text selection keeps false absent and later text authoritative', () => {
  const source = freeze({ creative_name: false, campaign_name: false,
    raw_payload: { lead_details: { creative_name: 'Criativo real', campaign_name: 'Campanha real' } } });
  const creative = extractMetaCreative(source);
  assert.equal(creative?.name, 'Criativo real'); assert.equal(creative?.campaignName, 'Campanha real');
});
test('false-only creative metadata still produces no creative event', () => {
  assert.equal(extractMetaCreative(freeze({ creative_name: false, campaign_name: false, creative_type: false })), null);
});
