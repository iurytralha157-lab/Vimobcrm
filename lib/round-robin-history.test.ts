import assert from 'node:assert/strict';
import test from 'node:test';
import { distributionQueueHistoryChanges } from './round-robin-history';
import type { RoundRobinHistoryEvent } from './api/round-robins';

const event: RoundRobinHistoryEvent = { id: 'e', action: 'update', entity_type: 'distribution_queue', entity_id: 'q', created_at: '2026-10-16T17:00:00Z' };
test('apresenta todas mudanças simultâneas com antes/depois, inclusive settings aninhado', () => {
  const rows = distributionQueueHistoryChanges({ ...event, old_data: { name: 'A', is_active: true, settings: {
    redistribution_timeout_minutes: 10, operating_schedule: { timezone: 'UTC' } } }, new_data: { name: 'B', is_active: false,
    settings: { redistribution_timeout_minutes: 20, operating_schedule: { timezone: 'America/Sao_Paulo' } } } });
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.find(row => row.key === 'name'), { key: 'name', label: 'Nome', before: 'A', after: 'B' });
  assert.equal(rows.find(row => row.key === 'is_active')?.after, 'Não');
  assert.equal(rows.find(row => row.key.endsWith('timezone'))?.after, 'America/Sao_Paulo');
});
test('não produz diffs por ordem de objeto e protege campos sensíveis sem ocultar o restante', () => {
  const rows = distributionQueueHistoryChanges({ ...event, old_data: { updated_at: 'a', settings: { name: 'A', token: 'before' } },
    new_data: { updated_at: 'b', settings: { token: 'after', name: 'A' } } });
  assert.equal(rows.length, 1); assert.equal(rows[0].before, '[valor protegido]'); assert.equal(rows[0].after, '[valor protegido]');
});
test('criação/remoção e dias da escala preservam valores auditados, com ator atual apenas quando corresponde', () => {
  const rows = distributionQueueHistoryChanges({ ...event, action: 'create', subject_user: { id: 'u1', name: 'Ana' }, new_data: {
    user_id: 'u1', weight: 3, settings: { operating_schedule: { days: [{ day_of_week: 1, is_all_day: false, start_time: '08:00', end_time: '23:00' }] } } } });
  assert.equal(rows.find(row => row.key === 'user_id')?.after, 'Ana');
  assert.match(rows.find(row => row.key.endsWith('days'))!.after, /Segunda.*08:00.*23:00/);
  assert.ok(rows.every(row => row.before === 'Não definido'));
});
test('diferença legado old/new continua visível quando snapshots faltam', () => {
  const rows = distributionQueueHistoryChanges({ ...event, diff: { weight: { old: 1, new: 4 }, position: { before: 3, after: 1 } } });
  assert.deepEqual(rows.map(row => [row.key, row.before, row.after]), [['weight', '1', '4'], ['position', '3', '1']]);
});

test('criação com espelhos modernos e legados mostra cada configuração uma única vez', () => {
  const settings = { enable_redistribution: true, redistribution_timeout_minutes: 20,
    operating_schedule: { timezone: 'America/Sao_Paulo', days: [{ day_of_week: 1, is_all_day: true }] } };
  const rows = distributionQueueHistoryChanges({ ...event, action: 'create', new_data: {
    id: 'q', name: 'Fila', is_active: true, current_position: 0, last_assigned_index: 0, leads_distributed: 0,
    pipeline_id: 'p', target_pipeline_id: 'p', target_stage_id: 's', strategy: 'simple', reentry_behavior: 'redistribute',
    ai_agent_id: null, deleted_at: null, tombstone: null, settings,
    rules: { settings, target_stage_id: 's', strategy: 'simple', reentry_behavior: 'redistribute' },
  } });
  assert.deepEqual(rows.map(row => row.key).sort(), ['is_active', 'name', 'reentry_behavior',
    'settings.enable_redistribution', 'settings.operating_schedule.days', 'settings.operating_schedule.timezone',
    'settings.redistribution_timeout_minutes', 'strategy', 'target_pipeline_id', 'target_stage_id']);
  assert.ok(rows.every(row => !row.key.startsWith('rules.')));
  assert.ok(rows.every(row => !['pipeline_id', 'ai_agent_id', 'deleted_at', 'tombstone'].includes(row.key)));
  assert.equal(rows.filter(row => row.key === 'target_pipeline_id').length, 1);
});

test('contadores e horários operacionais são omitidos em snake_case e camelCase sem esconder ordem do participante', () => {
  const before = { current_position: 1, currentPosition: 1, last_assigned_index: 1, lastAssignedIndex: 1,
    leads_count: 1, leadsCount: 1, leads_distributed: 1, last_assigned_at: 'a', lastDistributedAt: 'a',
    updatedAt: 'a', deleted_at: null, settings: { currentPosition: 1, nested: { leads_count: 1 } }, position: 1 };
  const after = { current_position: 2, currentPosition: 2, last_assigned_index: 2, lastAssignedIndex: 2,
    leads_count: 2, leadsCount: 2, leads_distributed: 2, last_assigned_at: 'b', lastDistributedAt: 'b',
    updatedAt: 'b', deleted_at: 'b', settings: { currentPosition: 2, nested: { leads_count: 2 } }, position: 2 };
  assert.deepEqual(distributionQueueHistoryChanges({ ...event, entity_type: 'distribution_queue_member', old_data: before, new_data: after }),
    [{ key: 'position', label: 'Ordem', before: '1', after: '2' }]);
});

test('ausência e null não geram mudanças vazias em snapshots nem no fallback antigo', () => {
  assert.deepEqual(distributionQueueHistoryChanges({ ...event, old_data: {}, new_data: {
    ai_agent_id: null, deleted_at: null, tombstone: null, settings: { missing: null },
  }, diff: { ai_agent_id: { old: undefined, new: null }, unknown: { before: null, after: undefined } } }), []);
  assert.deepEqual(distributionQueueHistoryChanges({ ...event, old_data: { is_active: false }, new_data: { is_active: null } }),
    [{ key: 'is_active', label: 'Ativo', before: 'Não', after: 'Não definido' }]);
});

test('metadados exclusivamente legados preservam as configurações e seus valores', () => {
  const rows = distributionQueueHistoryChanges({ ...event,
    old_data: { rules: { settings: { redistribution_timeout_minutes: 10 }, strategy: 'simple' }, pipeline_id: 'p1' },
    new_data: { rules: { settings: { redistribution_timeout_minutes: 20 }, strategy: 'weighted' }, pipeline_id: 'p2' } });
  assert.deepEqual(rows.map(row => [row.key, row.before, row.after]), [
    ['pipeline_id', 'p1', 'p2'], ['rules.settings.redistribution_timeout_minutes', '10', '20'],
    ['rules.strategy', 'Sequencial', 'Com pesos'],
  ]);
});

test('aliases com antes ou depois diferentes continuam visíveis sem deduplicação por rótulo', () => {
  const rows = distributionQueueHistoryChanges({ ...event, old_data: {
    pipeline_id: 'p1', target_pipeline_id: 'p2', settings: { redistribution_timeout_minutes: 10 },
    rules: { settings: { redistribution_timeout_minutes: 5 } },
  }, new_data: { pipeline_id: 'p3', target_pipeline_id: 'p3', settings: { redistribution_timeout_minutes: 20 },
    rules: { settings: { redistribution_timeout_minutes: 20 } } } });
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.filter(row => row.key.endsWith('redistribution_timeout_minutes')).map(row => row.before), ['5', '10']);
});

test('deduplicação usa apenas aliases conhecidos e não combina campos independentes ou tipos distintos', () => {
  const rows = distributionQueueHistoryChanges({ ...event, old_data: { name: 'A', description: 'A',
    settings: { redistribution_timeout_minutes: 10 }, rules: { settings: { redistribution_timeout_minutes: '10' } } },
    new_data: { name: 'B', description: 'B', settings: { redistribution_timeout_minutes: 20 },
      rules: { settings: { redistribution_timeout_minutes: '20' } } } });
  assert.equal(rows.length, 4);
  assert.ok(rows.some(row => row.key === 'name') && rows.some(row => row.key === 'description'));
});

test('campos personalizados com grafias diferentes não se tornam aliases por coincidência', () => {
  const rows = distributionQueueHistoryChanges({ ...event,
    old_data: { settings: { customValue: 1, custom_value: 1 }, rules: { settings: { customValue: 1 } } },
    new_data: { settings: { customValue: 2, custom_value: 2 }, rules: { settings: { customValue: 2 } } } });
  assert.deepEqual(rows.map(row => row.key).sort(), ['settings.customValue', 'settings.custom_value']);
});

test('aliases camelCase equivalentes preferem a coluna canônica com rótulos em português', () => {
  const rows = distributionQueueHistoryChanges({ ...event, old_data: { targetPipelineId: 'p1', target_pipeline_id: 'p1', ai_agent_id: null },
    new_data: { targetPipelineId: 'p2', target_pipeline_id: 'p2', ai_agent_id: 'agent' } });
  assert.deepEqual(rows, [{ key: 'ai_agent_id', label: 'Agente de IA', before: 'Não definido', after: 'agent' },
    { key: 'target_pipeline_id', label: 'Pipeline de destino', before: 'p1', after: 'p2' }]);
});

test('fallback de diffs deduplica espelhos equivalentes e preserva null explícito', () => {
  const rows = distributionQueueHistoryChanges({ ...event, diff: {
    'rules.settings.enable_redistribution': { old: false, new: true },
    'settings.enable_redistribution': { old: false, new: true },
    currentPosition: { old: 1, new: 2 }, ai_agent_id: { old: null, before: 'não usar', new: 'agent' },
  } });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].key, 'settings.enable_redistribution');
  assert.equal(rows[1].before, 'Não definido');
});

test('diferenças somente em contadores dentro de arrays não viram uma configuração aparentemente alterada', () => {
  assert.deepEqual(distributionQueueHistoryChanges({ ...event,
    old_data: { settings: { days: [{ day_of_week: 1, current_position: 1 }] } },
    new_data: { settings: { days: [{ day_of_week: 1, current_position: 2 }] } } }), []);
});

test('opções operacionais de WhatsApp e tags têm rótulos do domínio', () => {
  const rows = distributionQueueHistoryChanges({ ...event, new_data: { settings: {
    whatsapp_distribution_auto_reply_enabled: true, whatsapp_distribution_auto_reply_message: 'Olá',
    whatsapp_distribution_auto_reply_delay_seconds: 10, auto_tag_ids: ['tag'], require_checkin: true,
  } } });
  assert.ok(rows.every(row => !row.label.includes('_')));
  assert.ok(rows.some(row => row.label === 'Operação · Resposta automática pelo WhatsApp'));
});
