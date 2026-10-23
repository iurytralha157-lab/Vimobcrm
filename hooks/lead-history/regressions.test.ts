import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLeadHistory } from './build-history';
import { dedupeActivityEvents } from './activity-deduplication';
import { sameHistoryOccurrence } from './occurrence';
import { leadThreadInitialLoading, leadThreadWindow } from './thread-state';
import type { LeadHistoryFormatters } from './types';

const formatters: LeadHistoryFormatters = { formatCurrency: String, formatPropertyCurrency: String, formatResponseTime: String };
const time = '2026-10-12T12:00:00.100Z';

test('dois feedbacks iguais de atores diferentes e repetição do mesmo ator permanecem', () => {
  const events = [
    { id: 'a', user_id: 'broker-a', type: 'note', content: 'Retornar amanhã', created_at: time },
    { id: 'b', user_id: 'broker-b', type: 'note', content: 'Retornar amanhã', created_at: time },
    { id: 'c', user_id: 'broker-a', type: 'note', content: 'Retornar amanhã', created_at: time },
  ];
  assert.deepEqual(dedupeActivityEvents([...events, events[0]]).map(e => e.id), ['a', 'b', 'c']);
});

test('timeline de fila não elimina outra distribuição posterior da mesma fila', () => {
  const history = buildLeadHistory({
    timelineEvents: [{ id: 't', event_type: 'lead_assigned', created_at: time,
      metadata: { queue_id: 'queue-a', assigned_user_id: 'broker-a' } }],
    distributionLogs: [
      { id: 'same', round_robin_id: 'queue-a', assigned_user_id: 'broker-a', created_at: time },
      { id: 'later', round_robin_id: 'queue-a', assigned_user_id: 'broker-b', created_at: '2026-10-12T14:00:00Z' },
    ],
  }, 'lead-a', formatters);
  assert.equal(history.some(e => e.id === 'distribution-same'), false);
  assert.equal(history.some(e => e.id === 'distribution-later'), true);
});

test('evento de distribuição distinto não colapsa só por horário e destinatário', () => {
  const history = buildLeadHistory({
    timelineEvents: [{ id: 't', event_type: 'lead_assigned', created_at: time,
      metadata: { queue_id: 'queue-a', assigned_user_id: 'broker-a', distribution_event_id: 'event-a' } }],
    distributionLogs: [{ id: 'distinct', round_robin_id: 'queue-a', assigned_user_id: 'broker-a', created_at: time,
      metadata: { distribution_event_id: 'event-b' } }],
  }, 'lead-a', formatters);
  assert.equal(history.some(e => e.id === 'distribution-distinct'), true);
});

test('atribuição repetida ao mesmo usuário em outro horário permanece', () => {
  const history = buildLeadHistory({
    timelineEvents: [{ id: 't', event_type: 'lead_assigned', created_at: time,
      metadata: { queue_id: 'queue-a', assigned_user_id: 'broker-a', reason: 'round_robin' } }],
    assignmentLogs: [{ id: 'later', new_user_id: 'broker-a', reason: 'round_robin', created_at: '2026-10-12T14:00:00Z' }],
  }, 'lead-a', formatters);
  assert.equal(history.some(e => e.id === 'assignment-later'), true);
});

test('uma mudança de etapa na timeline não esconde uma atividade posterior', () => {
  const history = buildLeadHistory({
    timelineEvents: [{ id: 't', event_type: 'stage_changed', created_at: time,
      metadata: { old_stage_id: 's1', new_stage_id: 's2' } }],
    activityEvents: [{ id: 'later', type: 'stage_change', created_at: '2026-10-12T14:00:00Z',
      metadata: { old_stage_id: 's1', new_stage_id: 's2' } }],
  }, 'lead-a', formatters);
  assert.equal(history.some(e => e.id === 'activity-later'), true);
});

test('identidade explícita distingue mensagens e atores distintos não colapsam', () => {
  assert.equal(sameHistoryOccurrence({ type: 'whatsapp_message_sent', timestamp: time, metadata: { message_id: 'm1' } },
    { type: 'whatsapp_message_sent', timestamp: time, metadata: { message_id: 'm2' } }), false);
  assert.equal(sameHistoryOccurrence({ type: 'note_created', timestamp: time, actorId: 'a', content: 'Igual' },
    { type: 'note_created', timestamp: time, actorId: 'b', content: 'Igual' }), false);
});

test('canal pendente não bloqueia os itens disponíveis do outro canal', () => {
  assert.equal(leadThreadInitialLoading(10, false, true), false);
  assert.equal(leadThreadInitialLoading(10, true, false), false);
  assert.equal(leadThreadInitialLoading(0, false, true), true);
});

test('janela inicial é limitada e todos os anteriores continuam recuperáveis', () => {
  const items = Array.from({ length: 301 }, (_, id) => ({ id }));
  const initial = leadThreadWindow(items, 100);
  assert.equal(initial.items.length, 100);
  assert.equal(initial.hiddenCount, 201);
  assert.equal(initial.items[0].id, 201);
  assert.deepEqual(leadThreadWindow(items, 400).items, items);
  assert.equal(items.length, 301);
});
