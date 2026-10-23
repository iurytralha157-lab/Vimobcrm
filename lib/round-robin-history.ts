import type { RoundRobinHistoryEvent } from '@/lib/api/round-robins';

export type QueueHistoryChange = { key: string; label: string; before: string; after: string };

const ignored = new Set(['id', 'organization_id', 'round_robin_id', 'created_at', 'updated_at', 'created_by', 'revision',
  'membership_generation', 'tombstone']);
const operational = new Set(['created_at', 'updated_at', 'deleted_at', 'tombstoned_at', 'last_distributed_at',
  'last_distribution_at', 'last_assigned_at', 'current_position', 'last_assigned_index', 'last_position',
  'leads_distributed', 'leads_count', 'lead_count', 'distributed_leads', 'distributed_count', 'distribution_count',
  'total_distributed', 'total_leads', 'assignment_count', 'assignments_count']);
const fieldName = (key: string) => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
const labels: Record<string, string> = {
  name: 'Nome', description: 'Descrição', is_active: 'Ativo', strategy: 'Estratégia', pipeline_id: 'Pipeline',
  target_pipeline_id: 'Pipeline de destino', target_stage_id: 'Etapa de destino', reentry_behavior: 'Política de reentrada',
  settings: 'Operação', enable_redistribution: 'Redistribuição ativa', redistribution_timeout_minutes: 'Prazo de redistribuição (min)',
  redistribution_warning_minutes: 'Aviso prévio (min)', redistribution_max_attempts: 'Limite de atribuições',
  operating_schedule: 'Escala da fila', timezone: 'Fuso horário', days: 'Dias e horários', day_of_week: 'Dia da semana',
  is_all_day: 'Dia inteiro', start_time: 'Início', end_time: 'Fim', ignore_availability: 'Ignorar disponibilidade',
  pool_notifications: 'Notificações do bolsão', enabled: 'Habilitado', whatsapp: 'WhatsApp', in_app: 'No aplicativo',
  user_id: 'Corretor', team_id: 'Equipe', weight: 'Peso', position: 'Ordem', priority: 'Prioridade',
  match_type: 'Tipo de critério', match_value: 'Valor do critério', match: 'Critério', type: 'Tipo', values: 'Valores',
  source: 'Origem', campaign: 'Campanha', tags: 'Tags', version: 'Versão', rules: 'Critérios', conditions: 'Condições',
  ai_agent_id: 'Agente de IA', auto_tag_ids: 'Tags automáticas', require_checkin: 'Exigir check-in',
  whatsapp_distribution_auto_reply_enabled: 'Resposta automática pelo WhatsApp',
  whatsapp_distribution_auto_reply_message: 'Mensagem automática pelo WhatsApp',
  whatsapp_distribution_auto_reply_delay_seconds: 'Espera para resposta automática (segundos)',
};
const values: Record<string, string> = { simple: 'Sequencial', weighted: 'Com pesos', redistribute: 'Redistribuir',
  keep_assignee: 'Preservar responsável', source: 'Origem', tag: 'Tag', campaign: 'Campanha' };
const weekdays = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const stable = (value: unknown): string => isRecord(value)
  ? JSON.stringify(Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] != null && !operational.has(fieldName(key))).map(key => [key, stable(value[key])])))
  : Array.isArray(value) ? JSON.stringify(value.map(stable)) : JSON.stringify(value ?? null);

function display(value: unknown, path: string, event: RoundRobinHistoryEvent): string {
  if (/password|secret|token|credential|api_?key/i.test(path)) return value == null ? 'Não definido' : '[valor protegido]';
  if (value === null || value === undefined || value === '') return 'Não definido';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (path.endsWith('user_id') && value === event.subject_user?.id && event.subject_user.name) return event.subject_user.name;
  if (path.endsWith('day_of_week') && typeof value === 'number') return weekdays[value] || String(value);
  if (Array.isArray(value)) return value.length ? value.map(item => display(item, path, event)).join(', ') : 'Nenhum';
  if (isRecord(value)) return Object.entries(value).filter(([key, item]) => item != null && !operational.has(fieldName(key)))
    .map(([key, item]) => `${labels[fieldName(key)] || key}: ${display(item, `${path}.${key}`, event)}`).join('; ');
  const text = String(value);
  return values[text] || text;
}

// Every actual configuration delta is shown, including simultaneous changes
// inside operational settings. No mutable counters or secret value is rendered.
export function distributionQueueHistoryChanges(event: RoundRobinHistoryEvent): QueueHistoryChange[] {
  const changes: Array<QueueHistoryChange & { identity: string; preference: number }> = [];
  // Modern columns and legacy rules metadata can mirror the same setting.
  // Only matching raw before/after pairs share an identity; divergent audited
  // values and legacy-only records remain available to the reader.
  function identityPath(path: string[]): string[] {
    let normalized = path.map(part => {
      const normalizedField = fieldName(part);
      return Object.prototype.hasOwnProperty.call(labels, normalizedField) ? normalizedField : part;
    });
    if (event.entity_type !== 'distribution_queue') return normalized;
    if (normalized[0] === 'rules' && ['settings', 'strategy', 'reentry_behavior', 'pipeline_id',
      'target_pipeline_id', 'target_stage_id'].includes(normalized[1])) normalized = normalized.slice(1);
    if (normalized[0] === 'pipeline_id') normalized[0] = 'target_pipeline_id';
    return normalized;
  }
  function walk(before: unknown, after: unknown, path: string[], depth = 0) {
    const field = fieldName(path[path.length - 1] || '');
    if (operational.has(field) || (path.length === 1 && ignored.has(field))) return;
    if (stable(before) === stable(after)) return;
    const key = path.join('.');
    if (depth < 10 && (isRecord(before) || isRecord(after)) && !/password|secret|token|credential|api_?key/i.test(key)) {
      const oldRecord = isRecord(before) ? before : {};
      const newRecord = isRecord(after) ? after : {};
      for (const child of Array.from(new Set([...Object.keys(oldRecord), ...Object.keys(newRecord)])).sort()) {
        walk(oldRecord[child], newRecord[child], [...path, child], depth + 1);
      }
      return;
    }
    const canonical = identityPath(path).join('.');
    changes.push({ key, label: path.map(part => labels[fieldName(part)] || fieldName(part).replaceAll('_', ' ')).join(' · '),
      before: display(before, key, event), after: display(after, key, event),
      identity: JSON.stringify([canonical, stable(before), stable(after)]),
      preference: key === canonical ? 0 : path[0] === 'rules' ? 2 : 1 });
  }
  walk(event.old_data || {}, event.new_data || {}, []);
  // Some legacy audit records retain only per-key old/new diffs.
  if (!changes.length && event.diff) for (const [key, delta] of Object.entries(event.diff)) {
    if (!isRecord(delta)) continue;
    const before = Object.prototype.hasOwnProperty.call(delta, 'old') ? delta.old : delta.before;
    const after = Object.prototype.hasOwnProperty.call(delta, 'new') ? delta.new : delta.after;
    walk(before, after, key.split('.'));
  }
  const unique = new Map<string, typeof changes[number]>();
  for (const change of changes) {
    const current = unique.get(change.identity);
    if (!current || change.preference < current.preference) unique.set(change.identity, change);
  }
  return Array.from(unique.values(), ({ key, label, before, after }) => ({ key, label, before, after }));
}
