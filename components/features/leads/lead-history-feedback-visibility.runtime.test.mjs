import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { evaluateProduction } from '../../../hooks/leads/lead-request-runtime-fixture.mjs';
import { buildLeadHistory } from '../../../hooks/lead-history/build-history.ts';

const sourcePath = process.env.HISTORY_VISIBILITY_SOURCE || 'components/features/leads/LeadUnifiedThread.tsx';
const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['metadataText', 'eventSearchText', 'isTechnicalMetaAnswerEvent', 'shouldShowEvent']);
const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.ok(declarations.some(node => node.name.text === 'shouldShowEvent'));
const shouldShowEvent = evaluateProduction(declarations.map(node => node.getText(source)).join('\n'), {}, 'shouldShowEvent');
const at = '2026-10-19T12:00:00.000Z';
const formatters = { formatCurrency: String, formatPropertyCurrency: String, formatResponseTime: String };
const phrases = [
  'Cliente veio sem fila de distribuição e pediu retorno amanhã',
  'Sem fila de distribuição compatível',
  'SEM FILA DE DISTRIBUIÇÃO',
  'Fila "Equipe A" sem distribuição',
  'Registro sem fila de distribuição vinculada',
  'fila "A" sem distribui',
];
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
function event(patch = {}) {
  return { id: 'activity-synthetic', type: 'note', label: 'Nota adicionada', content: 'Retornar amanhã',
    source: 'activity', timestamp: at, actor: { id: 'actor-a', name: 'Synthetic actor' }, metadata: {}, ...patch };
}
function visible(row) {
  const before = structuredClone(row); freeze(row);
  const result = shouldShowEvent(row); assert.deepEqual(row, before, 'presentation never mutates its event'); return result;
}
function project(raw) {
  const before = structuredClone(raw); freeze(raw);
  const history = buildLeadHistory(raw, 'lead-a', formatters), projection = structuredClone(history);
  const shown = history.filter(shouldShowEvent);
  assert.deepEqual(raw, before, 'raw audit sources remain unchanged');
  assert.deepEqual(history, projection, 'visibility leaves canonical projection intact');
  return { history, shown };
}

for (const type of ['feedback', 'note', 'note_created']) for (const phrase of phrases) {
  for (const field of ['content', 'label']) test(`${type}: free ${field} remains visible for ${JSON.stringify(phrase)}`, () => {
    assert.equal(visible(event({ type, [field]: phrase, metadata: { kind: 'feedback' } })), true);
  });
  test(`${type}: real history builder preserves stored text ${JSON.stringify(phrase)}`, () => {
    const raw = { activityEvents: [{ id: 'feedback-a', type, content: phrase, created_at: at, user_id: 'actor-a', metadata: { kind: 'feedback' } }],
      users: [{ id: 'actor-a', name: 'Synthetic actor' }] };
    const { history, shown } = project(raw), note = history.find(row => row.id === 'activity-feedback-a');
    assert.ok(note); assert.equal(note.content, phrase); assert.equal(shown.includes(note), true);
  });
}

for (const phrase of phrases) {
  test(`successful distribution preserves recipient name ${JSON.stringify(phrase)}`, () => {
    const { shown } = project({ distributionLogs: [{ id: 'assigned', created_at: at, assigned_user_id: 'broker-a',
      round_robin_id: 'queue-a', assigned_user: { id: 'broker-a', name: phrase }, queue: { id: 'queue-a', name: 'Queue A' } }] });
    assert.equal(shown.length, 1); assert.equal(shown[0].id, 'distribution-assigned'); assert.ok(shown[0].label.includes(phrase));
  });
  test(`successful distribution preserves queue name ${JSON.stringify(phrase)}`, () => {
    const { shown } = project({ distributionLogs: [{ id: 'queue-name', created_at: at, assigned_user_id: 'broker-a',
      round_robin_id: 'queue-a', assigned_user: { id: 'broker-a', name: 'Synthetic broker' }, queue: { id: 'queue-a', name: phrase } }] });
    assert.equal(shown.length, 1); assert.equal(shown[0].id, 'distribution-queue-name'); assert.ok(shown[0].label.includes(phrase));
  });
  test(`manual transfer preserves actor name ${JSON.stringify(phrase)}`, () => {
    const { shown } = project({ assignmentLogs: [{ id: 'manual', old_user_id: 'broker-a', new_user_id: 'broker-b', created_by: 'actor-a',
      reason: 'manual_transfer', created_at: at }], users: [{ id: 'actor-a', name: phrase }, { id: 'broker-b', name: 'Synthetic broker' }] });
    assert.equal(shown.length, 1); assert.equal(shown[0].id, 'assignment-manual'); assert.ok(shown[0].label.includes(phrase));
  });
}

for (const reason of ['no_available_members', 'no_matching_queue']) {
  for (const withQueue of [true, false]) test(`known pending distribution ${reason}, queue=${withQueue}, stays visible`, () => {
    const { history, shown } = project({ distributionLogs: [{ id: 'pending', reason, created_at: at,
      assigned_user_id: null, round_robin_id: withQueue ? 'queue-a' : null, queue: withQueue ? { id: 'queue-a', name: phrases[0] } : null }] });
    assert.equal(history.length, 1); assert.equal(shown.length, 1); assert.equal(shown[0].metadata.reason, reason);
  });
  for (const type of ['lead_assigned', 'lead_distribution_pending']) test(`timeline ${type} retains structured pending reason ${reason}`, () => {
    const { history, shown } = project({ timelineEvents: [{ id: 'pending-timeline', event_type: type, created_at: at,
      metadata: { reason, queue_name: phrases[0] } }] });
    assert.equal(history.length, 1); assert.equal(shown.length, 1); assert.equal(shown[0].metadata.reason, reason);
  });
}

test('the real synthetic assignment fallback stays hidden even with its current recipient', () => {
  const { history, shown } = project({ lead: { id: 'lead-a', assigned_user_id: 'broker-a', assigned_at: at, created_at: at, source: 'manual' },
    users: [{ id: 'broker-a', name: 'Synthetic broker' }] });
  const fallback = history.find(row => row.id === 'lead-fallback-assigned-lead-a');
  assert.ok(fallback); assert.equal(fallback.metadata.assigned_user_id, 'broker-a'); assert.equal(shown.includes(fallback), false);
  assert.ok(shown.some(row => row.type === 'lead_created'));
});

for (const reason of [null, 'legacy_unknown', 'queue_closed', 'round_robin']) test(`unassigned legacy distribution placeholder ${String(reason)} stays hidden`, () => {
  const { history, shown } = project({ distributionLogs: [{ id: 'placeholder', created_at: at, round_robin_id: 'queue-a',
    assigned_user_id: null, reason, queue: { id: 'queue-a', name: 'Queue A' } }] });
  assert.equal(history.length, 1); assert.equal(history[0].id, 'distribution-placeholder'); assert.equal(shown.length, 0);
});

test('a real runtime merge preserves a masked recipient under the legacy distribution ID', () => {
  const { history, shown } = project({ distributionLogs: [{ id: 'legacy-masked', created_at: at, round_robin_id: 'queue-a', assigned_user_id: null,
    reason: 'legacy_unknown', metadata: { distribution_event_id: 'runtime-a' }, queue: { id: 'queue-a', name: phrases[0] } }],
    queueRuntimeEvents: [{ id: 'runtime-a', event_type: 'assigned', created_at: at, round_robin_id: 'queue-a',
      to_user_id: null, to_user: null, queue: { id: 'queue-a', name: phrases[0] }, metadata: {} }] });
  assert.equal(history.length, 1); assert.equal(history[0].id, 'distribution-legacy-masked');
  assert.equal(history[0].metadata.queue_runtime_event_id, 'runtime-a');
  assert.equal(history[0].metadata.assigned_user_id ?? null, null); assert.equal(history[0].metadata.to_user_id ?? null, null);
  assert.equal(shown.length, 1);
});

for (const patch of [
  { id: 'timeline-manual', type: 'lead_assigned', source: 'timeline', metadata: { reason: 'manual_transfer' } },
  { id: 'distribution-user-note', type: 'note', source: 'timeline' },
  { id: 'lead-fallback-assigned-user-note', type: 'note', source: 'activity' },
  { id: 'distribution-activity', type: 'lead_assigned', source: 'activity' },
  { id: 'distribution-recipient', type: 'lead_assigned', source: 'timeline', metadata: { assigned_user_id: 'broker-a' } },
  { id: 'distribution-to-user', type: 'lead_assigned', source: 'timeline', metadata: { to_user_id: 'broker-a' } },
  { id: 'distribution-not-created', type: 'not_created', source: 'activity' },
]) test(`text cannot override the structured contract for ${patch.id}`, () => {
  assert.equal(visible(event({ content: phrases[4], label: phrases[1], ...patch })), true);
});

for (const question of ['inbox_url', 'creative-url', 'creative_video_url', 'creative_instagram_url', 'link do anuncio', 'url do anuncio', 'ad url']) {
  test(`technical Meta field remains hidden: ${question}`, () => {
    assert.equal(visible(event({ type: 'meta_form_answer', metadata: { question }, label: question })), false);
  });
}
test('technical Meta provider link remains hidden', () => {
  assert.equal(visible(event({ type: 'meta_form_answer', content: 'https://business.facebook.com/latest/inbox/all' })), false);
});
test('a meaningful Meta form answer is visible despite a queue-related answer', () => {
  assert.equal(visible(event({ type: 'meta_form_answer', label: 'Observações', metadata: { question: 'Observações' }, content: phrases[0] })), true);
});
test('a feedback mentioning the Meta inbox is still user content', () => {
  assert.equal(visible(event({ type: 'note_created', metadata: { kind: 'feedback' }, content: 'Cliente citou https://business.facebook.com/latest/inbox/all' })), true);
});
