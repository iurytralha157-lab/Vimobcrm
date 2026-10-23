import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { evaluateProduction } from '../leads/lead-request-runtime-fixture.mjs';
import { buildLeadHistory } from './build-history.ts';
import { metadataNumber, metadataString } from './metadata.ts';
import { buildLabel, buildContent, sourceLabel } from './presentation.ts';
import { consolidateReentryProjection } from './reentry-deduplication.ts';
import { getEventTone, getOutcomeVariant } from '../../components/features/leads/lead-detail/history-event-presentation.ts';

const sourcePath = process.env.ACTIVITY_RENDER_SOURCE || 'components/features/leads/LeadUnifiedThread.tsx';
const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['getAttachmentFileName', 'metadataText', 'getStageNameFromMetadata', 'getOutcomeLabel',
  'getOutcomeActionLabel', 'getLostReason', 'getEventDetail', 'isAttachmentEvent', 'normalizeEventLabel', 'isFeedbackEvent']);
const declarations = source.statements.filter(node => (ts.isFunctionDeclaration(node) && names.has(node.name?.text))
  || (ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(source) === 'OUTCOME_LABELS')));
const presenter = evaluateProduction(declarations.map(node => node.getText(source)).join('\n'),
  { formatBRLCurrencyWithDefaultDecimals: value => `R$${value}` },
  '({metadataText,getEventDetail,normalizeEventLabel,isFeedbackEvent})');
const at = '2026-10-19T12:00:00.000Z';
const formatters = { formatCurrency: String, formatPropertyCurrency: String, formatResponseTime: String };
const malformed = [[], ['forged'], {}, { toString: null }, { valueOf: null, toString: null }, { nested: { value: 'forged' } }];
const freeze = value => {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
};
function event(type, metadata) {
  return { id: 'stored-synthetic', type, label: 'Registro armazenado', content: 'Texto legítimo', metadata,
    timestamp: at, source: 'activity', actor: { id: 'actor-a', name: 'Synthetic actor' } };
}

for (const [index, value] of malformed.entries()) {
  test(`legacy scalar readers ignore JSON object/array ${index} without coercion`, () => {
    freeze(value);
    assert.equal(metadataString(value), null);
    assert.equal(metadataNumber(value), null);
    assert.equal(presenter.metadataText(value), null);
  });
  test(`legacy manual reentry ignores malformed status ${index} without coercion`, () => {
    const row = freeze(event('lead_reentry', { entry_type: 'manual_reentry', actor_id: 'actor-a', source: 'manual',
      intake_scope_key: 'unscoped', pipeline_id: '10000000-0000-4000-8000-000000000001',
      stage_id: '20000000-0000-4000-8000-000000000001', deal_status: value }));
    assert.deepEqual(consolidateReentryProjection([], [row], 'lead-a', true).events, [row]);
  });
  for (const field of ['channel', 'source', 'kind', 'event_kind', 'outcome', 'notes', 'entry_event_id']) {
    test(`history survives stored ${field} with malformed shape ${index}`, () => {
      const raw = freeze({ activityEvents: [{ id: 'legacy', type: 'note', content: 'Texto legítimo', created_at: at,
        metadata: { [field]: value } }] });
      const before = structuredClone(raw);
      const rows = buildLeadHistory(raw, 'lead-a', formatters);
      assert.ok(rows.some(row => row.id === 'activity-legacy' && row.content === 'Texto legítimo'));
      assert.deepEqual(raw, before);
    });
  }
  for (const [type, field] of [['call', 'channel'], ['note', 'kind'], ['note', 'event_kind'], ['call', 'outcome'],
    ['call', 'notes'], ['lead_created', 'source'], ['status_change', 'to_status'], ['status_change', 'new_status'],
    ['property_selected', 'property_title'], ['property_selected', 'property_price'], ['attachment_added', 'file_name'],
    ['tag_added', 'tag_name'], ['tag_removed', 'tag_name']]) {
    test(`presenters survive ${type}.${field} with malformed shape ${index}`, () => {
      const row = freeze(event(type, { [field]: value })), before = structuredClone(row);
      for (const fn of [presenter.getEventDetail, presenter.normalizeEventLabel, presenter.isFeedbackEvent]) {
        const result = fn(row);
        if (typeof result === 'string') assert.ok(!result.includes('[object Object]'));
      }
      assert.deepEqual(row, before);
    });
  }
  for (const [type, field] of [['lead_created', 'source'], ['lead_created', 'source_label'], ['lead_created', 'form_name'],
    ['lead_assigned', 'queue_name'], ['lead_assigned', 'assigned_user_name'], ['stage_change', 'from_stage'],
    ['stage_change', 'to_stage'], ['tag_added', 'tag_name'], ['tag_removed', 'tag_name'], ['automation_message', 'channel'],
    ['assignee_changed', 'to_user_name'], ['assignee_changed', 'distribution_queue_name'], ['assignment', 'to_user_name'],
    ['lead_reentry', 'webhook_name'], ['status_change', 'to_status'], ['first_response', 'response_seconds']]) {
    test(`canonical labels, projection and tone survive malformed ${type}.${field} shape ${index}`, () => {
      const metadata = freeze({ source: 'webhook', to_user_name: 'Actor', distribution_queue_name: 'Queue', [field]: value });
      const row = freeze(event(type, metadata));
      for (const result of [buildLabel(type, metadata), buildContent(type, metadata, formatters), getEventTone(row, true),
        getEventTone(row, false), getOutcomeVariant(row)]) {
        if (typeof result === 'string') assert.ok(!result.includes('[object Object]'));
      }
      const raw = freeze({ activityEvents: [{ id: 'legacy', type, created_at: at, metadata, content: 'Texto legítimo' }] });
      assert.doesNotThrow(() => buildLeadHistory(raw, 'lead-a', formatters));
    });
  }
}

test('legitimate scalar metadata remains readable', () => {
  for (const [value, expected] of [['text', 'text'], [42, '42'], [0, '0'], [true, 'true'], [false, 'false']]) {
    assert.equal(metadataString(value), expected);
  }
  assert.equal(metadataNumber('12.5'), 12.5); assert.equal(metadataNumber(12.5), 12.5);
  assert.equal(metadataNumber(false), null); assert.equal(metadataNumber(null), null);
});

for (const [type, metadata, expected] of [
  ['status_change', { to_status: 'won' }, 'Lead marcado como ganho'],
  ['status_change', { to_status: 'lost', lost_reason: 'Preferiu outro imóvel' }, 'Lead marcado como perdido'],
  ['status_change', { to_status: 'open' }, 'Lead reaberto'],
  ['stage_change', { from_stage: 'Base', to_stage: 'Qualificados' }, 'Lead movido: Base → Qualificados'],
  ['property_selected', { property_code: 'AP-12', property_title: 'Apartamento', property_price: 250000 }, 'Imóvel selecionado: AP-12'],
  ['attachment_added', { file_name: 'proposta.pdf' }, 'Documento anexado: proposta.pdf'],
  ['tag_added', { tag_name: 'Visita' }, 'Tag adicionada: Visita'],
  ['tag_removed', { tag_name: 'Visita' }, 'Tag removida: Visita'],
  ['lead_created', { source: 'Meta Ads' }, 'Lead criado via Meta Ads'],
]) test(`canonical stored ${type} keeps its presentation`, () => {
  assert.equal(presenter.normalizeEventLabel(event(type, metadata)), expected);
});

test('stored feedback and contact outcome retain body, notes and loss reason', () => {
  assert.equal(presenter.isFeedbackEvent(event('note', { kind: 'feedback' })), true);
  assert.equal(presenter.getEventDetail(event('call', { channel: 'phone', outcome: 'answered', notes: 'Retornar amanhã' })),
    'Desfecho: Atendeu\nObservações: Retornar amanhã');
  assert.equal(presenter.getEventDetail(event('status_change', { to_status: 'lost', lost_reason: 'Preferiu outro imóvel' })),
    'Motivo: Preferiu outro imóvel');
});

for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) test(`legacy strings cannot resolve prototype properties: ${key}`, () => {
  assert.equal(sourceLabel(key), key);
  assert.equal(typeof buildLabel(key, {}), 'string');
  assert.equal(typeof buildLabel('status_change', { from_status: key, to_status: key }), 'string');
  assert.equal(typeof presenter.getEventDetail(event('call', { channel: 'call', outcome: key })), 'string');
});
