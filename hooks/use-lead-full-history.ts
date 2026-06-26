import { useMemo } from 'react';
import { useActivities, Activity } from '@/hooks/use-activities';
import { useLeadTimeline, LeadTimelineEvent } from '@/hooks/use-lead-timeline';

type HistoryMetadataValue = string | number | boolean | null | undefined;
type HistoryMetadata = Record<string, HistoryMetadataValue>;

export interface UnifiedHistoryEvent {
  id: string;
  type: string;
  label: string;
  content?: string | null;
  timestamp: string;
  actor?: {
    id: string;
    name: string;
    avatar_url?: string | null;
  } | null;
  source: 'timeline' | 'activity';
  metadata?: HistoryMetadata | null;
  channel?: string | null;
  isAutomation?: boolean;
}

// Mapping for timeline event types (base labels - will be enhanced dynamically)
const timelineEventLabels: Record<string, string> = {
  lead_created: 'Lead criado',
  lead_assigned: 'Distribuído',
  first_response: 'Primeiro contato',
  whatsapp_message_sent: 'Mensagem enviada',
  whatsapp_message_received: 'Mensagem recebida',
  call_initiated: 'Ligação iniciada',
  stage_changed: 'Estágio alterado',
  note_created: 'Nota adicionada',
  tag_added: 'Tag adicionada',
  tag_removed: 'Tag removida',
  sla_warning: 'SLA em alerta',
  sla_overdue: 'SLA estourado',
};

// Mapping for activity types (base labels, will be enhanced dynamically)
const activityLabels: Record<string, string> = {
  stage_change: 'Movido para',
  note: 'Nota adicionada',
  call: 'Ligação realizada',
  email: 'Email enviado',
  message: 'Mensagem enviada',
  automation_message: 'Mensagem automática',
  task_completed: 'Tarefa concluída',
  lead_created: 'Lead criado',
  contact_updated: 'Contato atualizado',
  tag_added: 'Tag adicionada',
  tag_removed: 'Tag removida',
  assignee_changed: 'Responsável alterado',
  lead_reentry: 'Lead reentrou',
  automation_stage_move: 'Movido por automação',
  automation_tag_added: 'Tag adicionada por automação',
};

function asHistoryMetadata(metadata: unknown): HistoryMetadata {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as HistoryMetadata;
  }

  return {};
}

// Dynamic label for lead_created based on source
function getLeadCreatedLabel(metadata: HistoryMetadata | null): string {
  const sourceLabel = metadata?.source_label || metadata?.source;

  if (sourceLabel) {
    if (sourceLabel === 'meta_ads' || sourceLabel === 'Meta Ads') {
      return '🎯 Lead criado via Meta Ads';
    }
    if (sourceLabel === 'whatsapp' || sourceLabel === 'WhatsApp') {
      return '📱 Lead criado via WhatsApp';
    }
    if (sourceLabel === 'webhook' || sourceLabel === 'Webhook') {
      const formName = metadata?.form_name || metadata?.webhook_name;
      return formName ? `🔗 Lead criado via "${formName}"` : '🔗 Lead criado via Webhook';
    }
    if (sourceLabel === 'website' || sourceLabel === 'Site') {
      return '🌐 Lead criado via Site';
    }
    if (sourceLabel === 'manual') {
      return '✏️ Lead criado manualmente';
    }
    return `Lead criado via ${sourceLabel}`;
  }

  return 'Lead criado';
}

function getTimelineEventLabel(event: LeadTimelineEvent): string {
  const metadata = asHistoryMetadata(event.metadata);

  switch (event.event_type) {
    case 'lead_created':
      return getLeadCreatedLabel(metadata);
    case 'lead_assigned': {
      // Show distribution queue name explicitly
      const queueName = metadata.distribution_queue_name || metadata.queue_name;
      const assignedName = metadata.assigned_user_name;
      if (queueName && assignedName) {
        return `📦 Distribuído via "${queueName}" → ${assignedName}`;
      }
      if (queueName) {
        return `📦 Distribuído via "${queueName}"`;
      }
      if (metadata.destination === 'admin_fallback') {
        return `⚠️ Atribuído ao administrador (sem fila ativa)`;
      }
      if (metadata.destination === 'pool') {
        return `📥 Enviado para o Pool`;
      }
      if (assignedName) {
        return `Atribuído a ${assignedName}`;
      }
      return 'Distribuído';
    }
    case 'stage_changed': {
      const from = metadata.old_stage_name;
      const to = metadata.new_stage_name;
      if (!from || from === 'Desconhecido' || from === 'Unknown') {
        return `Iniciado no estágio ${to || 'Base'}`;
      }
      return 'Estágio alterado';
    }
    default:
      return timelineEventLabels[event.event_type] || event.event_type;
  }
}

function getTimelineEventDetails(event: LeadTimelineEvent): string | undefined {
  const metadata = asHistoryMetadata(event.metadata);

  switch (event.event_type) {
    case 'lead_created':
      return metadata.source_label ? `Origem: ${metadata.source_label}` : (metadata.source ? `Origem: ${metadata.source}` : undefined);
    case 'lead_assigned':
      // Description already has the details from DB
      return undefined;
    case 'stage_changed': {
      const from = metadata.old_stage_name;
      const to = metadata.new_stage_name;
      // Se teve estágio anterior real, mostrar a transição
      if (from && from !== 'Desconhecido' && from !== 'Unknown' && to) {
        return `${from} → ${to}`;
      }
      return undefined;
    }
    case 'first_response': {
      const responseTime = metadata.response_seconds;
      if (typeof responseTime === 'number') {
        const minutes = Math.floor(responseTime / 60);
        const seconds = responseTime % 60;
        return `Tempo: ${minutes}m ${seconds}s`;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

// Dynamic label generation based on activity metadata
function getActivityLabel(activity: Activity): string {
  const meta = asHistoryMetadata(activity.metadata);

  switch (activity.type) {
    case 'automation_message': {
      const channel = meta.channel || 'whatsapp';
      return `📤 Mensagem automática (${channel === 'whatsapp' ? 'WhatsApp' : channel})`;
    }

    case 'lead_created':
      return getLeadCreatedLabel(meta);

    case 'assignee_changed':
      // Check if it's a distribution activity with queue name
      if (meta.distribution_queue_name && meta.to_user_name) {
        const prefix = meta.is_initial_distribution === false ? 'Redistribuído' : 'Distribuído';
        return `${prefix} por "${meta.distribution_queue_name}" → ${meta.to_user_name}`;
      }
      // Check for removal (no to_user_id)
      if (!meta.to_user_id && !meta.to_user_name) {
        return 'Responsável removido';
      }
      // Manual assignment
      if (meta.to_user_name) {
        return `Atribuído a ${meta.to_user_name}`;
      }
      return 'Responsável alterado';

    case 'lead_reentry':
      if (meta.entry_type === 'manual_reentry') {
        return 'Lead reentrou';
      }
      if (meta.webhook_name) {
        return `Lead reentrou via webhook "${meta.webhook_name}"`;
      }
      if (meta.source === 'whatsapp') {
        return 'Lead reentrou via WhatsApp';
      }
      return `Lead reentrou via ${meta.source || 'sistema'}`;

    case 'stage_change':
      if (meta.from_stage && meta.to_stage) {
        return `Movido: ${meta.from_stage} → ${meta.to_stage}`;
      }
      return 'Estágio alterado';

    case 'automation_stage_move':
      return `🤖 Movido por automação`;

    case 'automation_tag_added':
      return `🤖 Tag adicionada por automação`;

    default:
      // Check if it's an automation activity via metadata
      if (meta.is_automation) {
        return `🤖 ${activityLabels[activity.type] || activity.type}`;
      }
      return activityLabels[activity.type] || activity.type;
  }
}

function getActivityDetails(activity: Activity): string | undefined {
  // For activities with dynamic labels, content is already in the label
  if (['lead_created', 'assignee_changed', 'lead_reentry'].includes(activity.type)) {
    // Return content if it exists and is different from what we'd generate
    if (activity.content) {
      return activity.content;
    }
    return undefined;
  }

  if (activity.content) return activity.content;

  if (activity.metadata && typeof activity.metadata === 'object') {
    const meta = asHistoryMetadata(activity.metadata);
    if (meta.from_stage && meta.to_stage) {
      return `${meta.from_stage} → ${meta.to_stage}`;
    }
  }

  return undefined;
}

export function useLeadFullHistory(leadId: string) {
  const { data: timeline = [], isLoading: timelineLoading } = useLeadTimeline(leadId);
  const { data: activities = [], isLoading: activitiesLoading } = useActivities(leadId);

  const merged = useMemo(() => {
    // Convert timeline events
    const timelineEvents: UnifiedHistoryEvent[] = timeline.map((e) => ({
      id: `timeline-${e.id}`,
      type: e.event_type,
      label: getTimelineEventLabel(e),
      content: getTimelineEventDetails(e),
      timestamp: e.event_at,
      actor: e.actor ? {
        id: e.actor.id,
        name: e.actor.name,
        avatar_url: e.actor.avatar_url,
      } : null,
      source: 'timeline' as const,
      metadata: asHistoryMetadata(e.metadata),
      channel: e.channel,
      isAutomation: e.is_automation,
    }));

    // Convert activities with dynamic labels
    const activityEvents: UnifiedHistoryEvent[] = activities.map((a) => ({
      id: `activity-${a.id}`,
      type: a.type,
      label: getActivityLabel(a),
      content: getActivityDetails(a),
      timestamp: a.created_at,
      actor: a.user ? {
        id: a.user.id,
        name: a.user.name,
        avatar_url: undefined,
      } : null,
      source: 'activity' as const,
      metadata: asHistoryMetadata(a.metadata),
    }));

    // Merge and deduplicate by similar events (same type + close timestamp)
    const all = [...timelineEvents, ...activityEvents];

    // Sort by timestamp (most recent first)
    return all.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [timeline, activities]);

  return {
    data: merged,
    isLoading: timelineLoading || activitiesLoading,
  };
}
