import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLeadHistory } from './build-history';
import { mergeQueueHistory } from './queue-events';
import type { LeadHistoryRaw, QueueRuntimeEventRow } from './types';

const at = '2026-10-16T17:00:00.000Z';
const formatters = { formatCurrency: String, formatPropertyCurrency: String, formatResponseTime: String };
const event = (type: string, metadata = {}): QueueRuntimeEventRow => ({ id: 'event-1', event_type: type, created_at: at,
  round_robin_id: 'queue-1', episode_id: 'episode-1', round_number: 2, from_user_id: 'u1', to_user_id: 'u2',
  queue: { id: 'queue-1', name: 'Fila A' }, from_user: { id: 'u1', name: 'Ana' }, to_user: { id: 'u2', name: 'Bruno' }, metadata });

test('enriquece a timeline com nome autorizado e redistribuição sem duplicar o evento exato', () => {
  const raw: LeadHistoryRaw = { timelineEvents: [{ id: 't1', event_type: 'lead_assigned', created_at: at,
    metadata: { distribution_event_id: 'event-1', queue_id: 'queue-1', assigned_user_id: 'u2' } }],
    distributionLogs: [{ id: 'l1', round_robin_id: 'queue-1', assigned_user_id: 'u2', created_at: at,
      assigned_user: { id: 'u2', name: 'Bruno' }, queue: { id: 'queue-1', name: 'Fila A' }, metadata: { distribution_event_id: 'event-1' } }],
    queueRuntimeEvents: [event('assigned', { assignment_count: 6, is_initial_distribution: false })] };
  const rows = buildLeadHistory(raw, 'lead', formatters);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'Redistribuído para Bruno');
  assert.match(rows[0].content!, /Ana → Bruno.*Rodada 2.*6 redistribuições automáticas/);
  assert.equal(rows[0].actor, null);
});

test('retomada enriquece a mesma atribuição, inclusive quando carregada em outra página', () => {
  const assigned = event('assigned', { assignment_count: 2, is_initial_distribution: false });
  const resumed = { ...event('resumed', { distribution_event_id: assigned.id, assignment_count: 2 }), id: 'resume' };
  for (const events of [[resumed], [resumed, assigned], [assigned, resumed]]) {
    const rows = mergeQueueHistory({ queueRuntimeEvents: events }, []);
    assert.equal(rows.length, 1); assert.equal(rows[0].label, 'Retomado do bolsão para Bruno');
  }
});

test('retomada inicial do bolsão consolida o marcador de runtime e preserva a criação real do lead', () => {
  const createdAt = '2026-10-16T16:00:00.000Z';
  const assigned = event('assigned', { assignment_count: 0, is_initial_distribution: true, reason: 'initial_assignment' });
  const rows = buildLeadHistory({ activityEvents: [{ id: 'intake', type: 'lead_created', created_at: createdAt,
    metadata: { source: 'meta_ads' } }], timelineEvents: [
    { id: 'runtime-created', event_type: 'lead_created', created_at: at,
      metadata: { source: 'queue_runtime', source_label: 'Queue Runtime', distribution_event_id: assigned.id } },
    { id: 'initial-assignment', event_type: 'lead_assigned', created_at: at,
      metadata: { queue_id: 'queue-1', assigned_user_id: 'u2', distribution_event_id: assigned.id } },
  ], queueRuntimeEvents: [{ ...event('entered_pool', { reason: 'queue_closed' }), id: 'pool', created_at: createdAt },
    { ...event('resumed', { distribution_event_id: assigned.id, is_initial_distribution: true, assignment_count: 0 }), id: 'resume' }, assigned] }, 'lead', formatters);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.filter(row => row.type === 'lead_created').map(row => [row.id, row.timestamp, row.label]),
    [['activity-intake', createdAt, 'Lead criado via Meta Ads']]);
  assert.equal(rows.filter(row => row.type === 'lead_assigned').length, 1);
  assert.match(rows.find(row => row.type === 'lead_assigned')!.label, /Distribuição inicial após o bolsão/);
  assert.doesNotMatch(rows.map(row => row.label).join(' '), /criado via Queue Runtime/);
});

test('marcador isolado na página não inventa criação, atribuição concluída ou autoria humana', () => {
  const rows = mergeQueueHistory({}, [{ id: 'marker', type: 'lead_created', label: 'Lead criado via Queue Runtime',
    content: 'Não tratar como nascimento', timestamp: at, source: 'timeline', actor: { id: 'u2', name: 'Bruno' },
    metadata: { source: 'queue_runtime', distribution_event_id: 'pending-event' } }]);
  assert.equal(rows.length, 1); assert.equal(rows[0].id, 'marker');
  assert.equal(rows[0].type, 'queue_distribution_started'); assert.equal(rows[0].label, 'Distribuição automática iniciada');
  assert.equal(rows[0].actor, null); assert.equal(rows[0].isAutomation, true); assert.equal(rows[0].content, undefined);
});

test('marcador e resultado consolidam apenas por ID exato, inclusive ao completar outra página', () => {
  const marker = { id: 'marker', type: 'lead_created', label: 'Lead criado', timestamp: at, source: 'timeline' as const,
    metadata: { source: 'queue_runtime', distribution_event_id: 'event-2' } };
  const other = event('assigned');
  const partial = mergeQueueHistory({ queueRuntimeEvents: [other] }, [marker]);
  assert.equal(partial.length, 2); assert.equal(partial[0].type, 'queue_distribution_started');
  const complete = mergeQueueHistory({ queueRuntimeEvents: [other, { ...other, id: 'event-2' }] }, [marker]);
  assert.equal(complete.length, 2); assert.ok(complete.every(row => row.type === 'lead_assigned'));
});

test('criação de outra origem não é reinterpretada pelo rótulo e marcador sem ID não é apagado', () => {
  const rows = mergeQueueHistory({ queueRuntimeEvents: [event('assigned')] }, [
    { id: 'real-created', type: 'lead_created', label: 'Lead criado', timestamp: at, source: 'timeline',
      metadata: { source: 'meta', source_label: 'Queue Runtime', distribution_event_id: 'event-1' } },
    { id: 'no-id', type: 'lead_created', label: 'Lead criado', timestamp: at, source: 'timeline', metadata: { source: 'queue_runtime' } },
  ]);
  assert.equal(rows.length, 3); assert.equal(rows[0].type, 'lead_created'); assert.equal(rows[1].type, 'queue_distribution_started');
});

test('mantém ocorrências diferentes mesmo no mesmo instante e não inventa distribuição inicial', () => {
  const rows = mergeQueueHistory({ queueRuntimeEvents: [event('assigned'), { ...event('assigned'), id: 'event-2' }] }, []);
  assert.equal(rows.length, 2); assert.equal(rows[0].label, 'Lead atribuído para Bruno');
  assert.equal(rows[0].metadata?.is_initial_distribution, undefined);
});

test('claim usa ator autenticado e correlação exata; não duplica assignment log correspondente', () => {
  const claimed = { ...event('manual_claim', { assignment_log_id: 'a1' }), actor: { id: 'u2', name: 'Bruno' } };
  const rows = mergeQueueHistory({ queueRuntimeEvents: [claimed], assignmentLogs: [{ id: 'a1', reason: 'queue_pool_claim',
    created_at: at, assigned_at: at, round_robin_id: 'queue-1', new_user_id: 'u2' }] }, [{ id: 'assignment-a1',
    type: 'assignee_changed', label: 'Antigo', timestamp: at, source: 'timeline' }]);
  assert.equal(rows.length, 1); assert.equal(rows[0].label, 'Lead assumido por Bruno'); assert.equal(rows[0].actor?.id, 'u2');
});

test('explica bolsão, limite, proteção, espera, reabertura e etapa com nomes seguros', () => {
  const rows = mergeQueueHistory({ queueRuntimeEvents: ['entered_pool', 'human_protected', 'waiting_for_alternative',
    'queue_reopened', 'stage_rule_assigned', 'quarantined'].map((type, index) => ({ ...event(type, { reason: 'queue_limit_reached',
      to_user_name: 'NOME NÃO AUTORIZADO', secret: 'never-render' }), id: String(index), to_user: null, from_user: null })) }, []);
  assert.equal(rows.length, 6); assert.match(rows[0].label, /Limite atingido/);
  assert.match(rows[1].label, /humano/); assert.match(rows[3].label, /reaberta/);
  for (const row of rows) assert.doesNotMatch(`${row.label} ${row.content}`, /NOME NÃO AUTORIZADO|never-render/);
});

test('não cria fallback do responsável quando há claim canônico, mesmo sem fonte timeline', () => {
  const rows = buildLeadHistory({ queueRuntimeEvents: [event('manual_claim')], lead: { id: 'lead', assigned_user_id: 'u2',
    created_at: at } }, 'lead', formatters);
  assert.equal(rows.filter(row => /assumido|Atribuído/.test(row.label)).length, 1);
});

test('transferência manual usa destino da ocorrência e UUID do log, independente do dono atual', () => {
  const rows = mergeQueueHistory({ queueRuntimeEvents: [{ ...event('manual_transfer', { assignment_log_id: 'a1' }),
    actor: { id: 'admin', name: 'Gestor' } }], lead: { id: 'l', created_at: at, assigned_user_id: 'owner-later',
    assigned_user: { id: 'owner-later', name: 'Responsável posterior' } } }, [{ id: 'assignment-a1', type: 'assignee_changed',
      label: 'Transferido', timestamp: at, source: 'timeline' }]);
  assert.equal(rows.length, 1); assert.match(rows[0].label, /para Bruno/);
  assert.equal(rows[0].actor?.name, 'Gestor'); assert.match(rows[0].content!, /Ana → Bruno/);
  assert.doesNotMatch(JSON.stringify(rows), /Responsável posterior/);
});

test('eventos canônicos de erro e quarentena mostram tentativas sem expor SQL interno', () => {
  const rows = mergeQueueHistory({ queueRuntimeEvents: [{ ...event('runtime_error', { retry_count: 1, sqlstate: 'sensitive' }), id: 'error' },
    { ...event('runtime_quarantined', { retry_count: 5, sqlstate: 'sensitive' }), id: 'quarantine' }] }, []);
  assert.equal(rows.length, 2); assert.match(rows[0].label, /nova tentativa agendada/);
  assert.match(rows[1].label, /pausada por segurança/); assert.match(rows[1].content!, /5 tentativas técnicas/);
  assert.doesNotMatch(rows.map(row => `${row.label} ${row.content}`).join(' '), /sensitive/);
});

test('regra de etapa consolida timeline e log canônicos preservando a causa e o contexto completos', () => {
  const rows = buildLeadHistory({ timelineEvents: [{ id: 't-stage', event_type: 'lead_assigned', created_at: at,
    metadata: { distribution_event_id: 'stage-event', queue_id: 'queue-1', assigned_user_id: 'u2' } }],
  distributionLogs: [{ id: 'l-stage', round_robin_id: 'queue-1', assigned_user_id: 'u2', created_at: at,
    metadata: { distribution_event_id: 'stage-event' } }],
  assignmentLogs: [{ id: 'a-stage', reason: 'auto_redistribution', new_user_id: 'u2', old_user_id: 'u1', created_at: at }],
  queueRuntimeEvents: [{ ...event('stage_rule_assigned', { assignment_log_id: 'a-stage', assignment_count: 2,
    stage_id: 'stage-2', stage_automation_id: 'rule-1', automatic: true }), id: 'stage-event' }] }, 'lead', formatters);
  assert.equal(rows.length, 1); assert.equal(rows[0].type, 'queue_stage_rule_assigned');
  assert.equal(rows[0].label, 'Responsável definido pela regra da etapa: Bruno');
  assert.equal(rows[0].metadata?.episode_id, 'episode-1'); assert.equal(rows[0].metadata?.stage_automation_id, 'rule-1');
  assert.match(rows[0].content!, /Fila A.*Ana → Bruno.*Rodada 2.*2 redistribuições automáticas/);
  assert.equal(rows[0].isAutomation, true); assert.equal(rows[0].actor, null);
});

test('proteção por procedência incerta não afirma atendimento humano nem atribui autoria ao responsável', () => {
  const rows = mergeQueueHistory({ queueRuntimeEvents: [event('legacy_activity_review_required', {
    reason: 'legacy_activity_requires_review', authorship_verified: false })] }, []);
  assert.equal(rows.length, 1); assert.match(rows[0].label, /responsável preservado para revisão/);
  assert.doesNotMatch(rows[0].label, /humano confirmado|assumido/); assert.equal(rows[0].actor, null);
});

for (const complete of [true, false]) for (const kind of ['assigned', 'stage_rule_assigned', 'resumed']) {
  test(`log e runtime ${kind} sem timeline consolidam a identidade exata com histórico ${complete ? 'completo' : 'parcial'}`, () => {
    const assigned = event(kind === 'stage_rule_assigned' ? kind : 'assigned', { is_initial_distribution: false });
    const runtime = kind === 'resumed'
      ? { ...event('resumed', { distribution_event_id: assigned.id }), id: 'resume-1' }
      : assigned;
    const log = { id: 'log-1', created_at: at, round_robin_id: 'queue-1', assigned_user_id: 'u2',
      metadata: { distribution_event_id: assigned.id }, queue: { id: 'queue-1', name: 'Fila A' } };
    const raw: LeadHistoryRaw = { distributionLogs: [log], queueRuntimeEvents: [runtime],
      historyCoverage: { complete, canonicalPresence: { leadCreated: false, firstResponse: false, assignment: true } } };
    const before = structuredClone(raw);
    const rows = buildLeadHistory(raw, 'lead', formatters);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].metadata?.distribution_event_id, assigned.id);
    assert.equal(rows[0].metadata?.queue_runtime_event_id, runtime.id);
    assert.equal(rows[0].actor, null);
    assert.match(rows[0].label, kind === 'stage_rule_assigned' ? /regra da etapa/ : kind === 'resumed' ? /Retomado do bolsão/ : /Redistribuído/);
    assert.deepEqual(raw, before, 'fontes brutas de auditoria permanecem intactas');
    const distinct = buildLeadHistory({ ...raw, distributionLogs: [log, { ...log, id: 'log-2',
      metadata: { distribution_event_id: 'event-2' } }], queueRuntimeEvents: [runtime, { ...assigned, id: 'event-2' }] }, 'lead', formatters);
    assert.equal(distinct.length, 2, 'mesmo horário, fila e destino não apagam outra operação');
    assert.deepEqual(new Set(distinct.map(row => row.metadata?.distribution_event_id)), new Set([assigned.id, 'event-2']));
  });
}

test('log sem identidade segura não é absorvido por semelhança de horário, fila ou corretor', () => {
  const runtime = event('assigned');
  for (const distribution_event_id of [undefined, '', { id: runtime.id }, 42]) {
    const rows = buildLeadHistory({ distributionLogs: [{ id: 'legacy-log', created_at: at,
      assigned_user_id: 'u2', round_robin_id: 'queue-1', metadata: { distribution_event_id } }],
    queueRuntimeEvents: [{ ...runtime, id: distribution_event_id ? String(distribution_event_id) : runtime.id }] }, 'lead', formatters);
    assert.equal(rows.length, 2, 'sem prova exata não se apaga uma ocorrência de auditoria');
  }
});
