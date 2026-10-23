import { asMetadata, metadataNumber } from './metadata';
import type { HistoryMetadata, LeadHistoryRaw, QueueRuntimeEventRow, UnifiedHistoryEvent } from './types';

const reasons: Record<string, string> = {
  queue_closed: 'Escala da fila encerrada', no_available_members: 'Nenhum participante elegível disponível',
  member_unavailable: 'Escala do responsável encerrada', queue_limit_reached: 'Limite configurado de atribuições atingido',
  waiting_for_alternative: 'Aguardando outro participante elegível nesta janela', human_action: 'Atendimento humano confirmado',
  manual_claim: 'Lead assumido no bolsão', manual_transfer: 'Transferência manual autorizada',
  queue_inactive: 'Fila desativada', assigned: 'Próximo participante elegível', queue_waiting: 'Aguardando distribuição',
  max_retries: 'Limite de tentativas técnicas atingido', invalid_configuration: 'Configuração inválida',
  round_assignment: 'Atribuição automática da fila', initial_assignment: 'Distribuição inicial da fila',
  manual_assignment: 'Distribuição solicitada manualmente', deal_closed: 'Negócio encerrado',
  legacy_activity_requires_review: 'Atendimento registrado sem procedência confirmada',
};

function text(value: unknown) { return typeof value === 'string' && value.trim() ? value : null; }
function eventKey(event: UnifiedHistoryEvent) { return text(asMetadata(event.metadata).distribution_event_id); }
function assignmentLabel(metadata: HistoryMetadata, resumed = false) {
  const name = text(metadata.to_user_name);
  const initial = metadata.is_initial_distribution;
  const verb = resumed ? (initial === true ? 'Distribuição inicial após o bolsão' : 'Retomado do bolsão')
    : initial === true ? 'Distribuição inicial' : initial === false ? 'Redistribuído' : 'Lead atribuído';
  return `${verb}${name ? ` para ${name}` : ''}`;
}

function queueContext(metadata: HistoryMetadata) {
  const parts: string[] = [];
  const queue = text(metadata.distribution_queue_name);
  const from = text(metadata.from_user_name);
  const to = text(metadata.to_user_name);
  const round = metadataNumber(metadata.round_number);
  const reason = text(metadata.reason);
  if (queue) parts.push(`Fila: ${queue}`);
  if (from && to && from !== to) parts.push(`${from} → ${to}`);
  if (round && round > 0) parts.push(`Rodada ${round}`);
  if (reason && reasons[reason]) parts.push(reasons[reason]);
  const count = metadataNumber(metadata.assignment_count);
  if (count !== null) parts.push(`${count} ${count === 1 ? 'redistribuição automática' : 'redistribuições automáticas'} no episódio`);
  const retries = metadataNumber(metadata.retry_count);
  if (retries !== null && retries > 0) parts.push(`${retries} ${retries === 1 ? 'tentativa técnica' : 'tentativas técnicas'}`);
  return parts.join(' · ') || undefined;
}

function runtimeMetadata(event: QueueRuntimeEventRow): HistoryMetadata {
  return {
    ...asMetadata(event.metadata), queue_runtime_event_id: event.id, episode_id: event.episode_id,
    distribution_event_id: ['assigned', 'stage_rule_assigned'].includes(event.event_type) ? event.id : asMetadata(event.metadata).distribution_event_id,
    distribution_queue_id: event.round_robin_id, distribution_queue_name: event.queue?.name,
    round_number: event.round_number, from_user_id: event.from_user_id, from_user_name: event.from_user?.name,
    to_user_id: event.to_user_id, to_user_name: event.to_user?.name,
  };
}

function runtimeEvent(event: QueueRuntimeEventRow): UnifiedHistoryEvent {
  const metadata = runtimeMetadata(event);
  const target = event.to_user?.name;
  const reason = text(metadata.reason);
  const labels: Record<string, string> = {
    assigned: assignmentLabel(metadata), resumed: assignmentLabel(metadata, true),
    entered_pool: reason === 'queue_limit_reached' ? 'Limite atingido; lead no bolsão' : 'Lead enviado ao bolsão',
    manual_claim: `Lead assumido${target ? ` por ${target}` : ''}`,
    stage_rule_assigned: `Responsável definido pela regra da etapa${target ? `: ${target}` : ''}`,
    human_protected: 'Atendimento humano registrado; rotação protegida',
    manual_transfer: `Transferência manual${target ? ` para ${target}` : ''}; rotação protegida`,
    queue_reopened: 'Fila reaberta; lead aguardando distribuição',
    waiting_for_alternative: 'Aguardando outro participante elegível',
    rotation_closed: 'Rotação automática encerrada', quarantined: 'Rotação pausada por segurança',
    runtime_error: 'Falha técnica na rotação; nova tentativa agendada', runtime_quarantined: 'Falhas técnicas consecutivas; rotação pausada por segurança',
    legacy_activity_review_required: 'Atendimento anterior sem confirmação; responsável preservado para revisão',
    manual_recovery: 'Proteção técnica encerrada por ação manual',
    legacy_initial_handoff: 'Distribuição pendente retomada pelo motor da fila',
    legacy_assignment_handoff: 'Rotação existente incorporada ao motor da fila',
  };
  const automatic = !['manual_claim', 'manual_transfer', 'manual_recovery', 'human_protected'].includes(event.event_type);
  return { id: `queue-runtime-${event.id}`, type: event.event_type === 'assigned' || event.event_type === 'resumed' ? 'lead_assigned' : `queue_${event.event_type}`,
    label: labels[event.event_type] || 'Evento da distribuição', content: queueContext(metadata),
    timestamp: event.created_at, actor: event.actor || null, source: 'timeline', metadata, isAutomation: automatic };
}

// Merge only durable occurrence IDs (or the exact claim assignment timestamp),
// never a time window that could collapse two legitimate rotations.
export function mergeQueueHistory(raw: LeadHistoryRaw, existing: UnifiedHistoryEvent[]) {
  const runtime = raw.queueRuntimeEvents || [];
  const distributionOccurrences = new Set([
    ...existing.filter(event => ['lead_assigned', 'lead_distribution_pending'].includes(event.type)).map(eventKey),
    ...runtime.filter(event => ['assigned', 'stage_rule_assigned'].includes(event.event_type)).map(event => event.id),
    ...runtime.filter(event => event.event_type === 'resumed').map(event => text(asMetadata(event.metadata).distribution_event_id)),
  ].filter((key): key is string => Boolean(key)));
  const output = existing.flatMap(event => {
    // The legacy distributor can write lead_created on its first runtime call
    // even when intake created the lead earlier as an activity. This reserved
    // source is a distribution marker, never evidence of another lead birth.
    if (event.type !== 'lead_created' || text(asMetadata(event.metadata).source) !== 'queue_runtime') return [{ ...event }];
    const key = eventKey(event);
    if (key && distributionOccurrences.has(key)) return [];
    return [{ ...event, type: 'queue_distribution_started', label: 'Distribuição automática iniciada',
      content: undefined, actor: null, isAutomation: true }];
  });
  const resumes = new Map(runtime.filter(event => event.event_type === 'resumed')
    .map(event => [text(asMetadata(event.metadata).distribution_event_id), event]));
  for (const log of raw.distributionLogs || []) {
    const key = text(asMetadata(log.metadata).distribution_event_id);
    if (!key) continue;
    const index = output.findIndex(event => event.type === 'lead_assigned' && eventKey(event) === key);
    if (index < 0) continue;
    const previous = output[index];
    const meta = { ...asMetadata(previous.metadata), ...asMetadata(log.metadata),
      distribution_queue_name: log.queue?.name || text(asMetadata(log.metadata).queue_name) || asMetadata(previous.metadata).distribution_queue_name,
      to_user_name: log.assigned_user?.name || asMetadata(previous.metadata).to_user_name,
      to_user_id: log.assigned_user_id, reason: log.reason };
    output[index] = { ...previous, metadata: meta, label: assignmentLabel(meta), content: queueContext(meta) };
  }
  for (const event of runtime) {
    if (event.event_type === 'resumed' && runtime.some(item => item.id === text(asMetadata(event.metadata).distribution_event_id))) continue;
    const resume = event.event_type === 'assigned' ? resumes.get(event.id) : undefined;
    const mapped = runtimeEvent(resume ? { ...event, event_type: 'resumed', metadata: { ...event.metadata, ...resume.metadata } } : event);
    const key = ['assigned', 'stage_rule_assigned'].includes(event.event_type) ? event.id : text(asMetadata(event.metadata).distribution_event_id);
    let index = key ? output.findIndex(item => item.type === 'lead_assigned' && eventKey(item) === key) : -1;
    const assignmentLogId = text(asMetadata(event.metadata).assignment_log_id);
    const assignmentIndex = assignmentLogId ? output.findIndex(item => item.id === `assignment-${assignmentLogId}`) : -1;
    if (index < 0 && assignmentIndex >= 0) index = assignmentIndex;
    if (index >= 0) output[index] = { ...mapped, id: output[index].id };
    else output.push(mapped);
    if (assignmentIndex >= 0 && assignmentIndex !== index) output.splice(assignmentIndex, 1);
  }
  return output;
}
