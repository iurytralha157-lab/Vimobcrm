import { useQuery } from '@tanstack/react-query';
import { formatResponseTime } from '@/hooks/use-lead-timeline';
import { leadsAPI } from '@/lib/api/leads';

type HistoryMetadata = Record<string, string | number | boolean | null | undefined>;

type HistoryActor = {
  id: string;
  name: string;
  avatar_url?: string | null;
};

type TimelineEventRow = {
  id: string;
  event_type: string;
  metadata?: HistoryMetadata | null;
  user_id?: string | null;
  actor_user_id?: string | null;
  created_at?: string | null;
  event_at?: string | null;
  channel?: string | null;
  is_automation?: boolean | null;
};

type ActivityEventRow = {
  id: string;
  type: string;
  content?: string | null;
  created_at: string;
  metadata?: HistoryMetadata | null;
  user_id?: string | null;
  user?: HistoryActor | null;
};

type LeadEntryEventRow = {
  id: string;
  entry_type?: string | null;
  source?: string | null;
  campaign_name?: string | null;
  created_at: string;
};

type DistributionLogRow = {
  id: string;
  round_robin_id?: string | null;
  assigned_user_id?: string | null;
  reason?: string | null;
  created_at: string;
  queue?: { id: string; name?: string | null } | null;
  assigned_user?: HistoryActor | null;
};

type LeadMetaHistoryRow = {
  id?: string | null;
  lead_id?: string | null;
  page_id?: string | null;
  form_id?: string | null;
  form_name?: string | null;
  ad_id?: string | null;
  ad_name?: string | null;
  adset_id?: string | null;
  adset_name?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  platform?: string | null;
  source_type?: string | null;
  creative_url?: string | null;
  creative_video_url?: string | null;
  creative_instagram_url?: string | null;
  raw_payload?: Record<string, unknown> | null;
  created_at?: string | null;
};

type LeadHistoryLead = {
  id: string;
  source?: string | null;
  utm_source?: string | null;
  assigned_user_id?: string | null;
  assigned_at?: string | null;
  created_at: string;
  assigned_user?: HistoryActor | null;
};

type LeadHistoryRaw = {
  timelineEvents?: TimelineEventRow[];
  activityEvents?: ActivityEventRow[];
  entryEvents?: LeadEntryEventRow[];
  lead?: LeadHistoryLead | null;
  leadMeta?: LeadMetaHistoryRow | null;
  distributionLogs?: DistributionLogRow[];
  users?: HistoryActor[];
};

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
  // enriched fields
  sourceOrigin?: string | null; // 'meta_ads' | 'whatsapp' | 'website' | 'manual' | 'webhook' | etc.
  webhookName?: string | null;
  firstResponseSeconds?: number | null;
}

function asMetadata(metadata: unknown): HistoryMetadata {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return metadata as HistoryMetadata;
}

function metadataString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return null;
  return String(value);
}

function metadataNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function answerText(value: unknown): string | null {
  if (Array.isArray(value)) {
    const items = value.map(answerText).filter(Boolean);
    return items.length > 0 ? items.join(', ') : null;
  }
  if (value === null || value === undefined || value === false) return null;
  if (typeof value === 'object') {
    const values = metadataRecord(value)?.values;
    return values !== undefined ? answerText(values) : null;
  }
  const text = String(value).trim();
  return text || null;
}

function normalizeFieldKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isStandardMetaLeadField(question: string) {
  const key = normalizeFieldKey(question);
  if (!key) return true;
  return (
    key === 'nome' ||
    key === 'name' ||
    key === 'full name' ||
    key.includes('email') ||
    key.includes('e mail') ||
    key.includes('telefone') ||
    key.includes('phone') ||
    key.includes('whatsapp') ||
    key.includes('mensagem') ||
    key.includes('message') ||
    key.includes('observacao') ||
    key.includes('cargo') ||
    key.includes('empresa') ||
    key.includes('company') ||
    key.includes('cidade') ||
    key.includes('city') ||
    key.includes('bairro') ||
    key.includes('campaign') ||
    key.includes('campanha') ||
    key.includes('adset') ||
    key.includes('ad set') ||
    key.includes('anuncio') ||
    key.includes('form id') ||
    key.includes('leadgen')
  );
}

function formatMetaQuestion(question: string) {
  const trimmed = question.trim();
  return trimmed.includes('_') || trimmed.includes('-')
    ? trimmed.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    : trimmed;
}

function extractMetaFormAnswers(metadata: HistoryMetadata) {
  const answers: Array<{ question: string; answer: string }> = [];
  const seen = new Set<string>();

  const pushAnswer = (question: string, value: unknown, skipStandard: boolean) => {
    const cleanQuestion = formatMetaQuestion(question);
    if (!cleanQuestion || (skipStandard && isStandardMetaLeadField(cleanQuestion))) return;
    const answer = answerText(value);
    if (!answer) return;
    const key = `${normalizeFieldKey(cleanQuestion)}:${answer}`;
    if (seen.has(key)) return;
    seen.add(key);
    answers.push({ question: cleanQuestion, answer });
  };

  const rawMetadata = metadata as Record<string, unknown>;
  const customFields = metadataRecord(rawMetadata.custom_fields);
  if (customFields) {
    Object.entries(customFields).forEach(([question, value]) => pushAnswer(question, value, false));
  }

  const fieldData = metadataRecord(rawMetadata.field_data);
  if (fieldData) {
    Object.entries(fieldData).forEach(([question, value]) => pushAnswer(question, value, true));
  }

  return answers;
}

type MetaCreativeHistory = {
  name: string | null;
  adName: string | null;
  type: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  linkUrl: string | null;
  instagramUrl: string | null;
  destinationUrl: string | null;
};

function firstURL(...values: unknown[]) {
  for (const value of values) {
    const text = answerText(value);
    if (!text || !/^https?:\/\//i.test(text)) continue;
    return text;
  }
  return null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = answerText(value);
    if (text) return text;
  }
  return null;
}

function rawLeadDetails(source: Record<string, unknown>) {
  const rawPayload = metadataRecord(source.raw_payload);
  return metadataRecord(rawPayload?.lead_details) || metadataRecord(source.lead_details) || source;
}

function extractMetaCreative(source: Record<string, unknown> | null | undefined): MetaCreativeHistory | null {
  if (!source) return null;
  const details = rawLeadDetails(source);
  const creative = metadataRecord(details.creative);

  const imageUrl = firstURL(
    source.creative_url,
    source.creative_thumbnail_url,
    details.creative_url,
    details.creative_thumbnail_url,
    creative?.thumbnail_url,
    creative?.image_url,
  );
  const videoUrl = firstURL(source.creative_video_url, details.creative_video_url);
  const instagramUrl = firstURL(source.creative_instagram_url, details.creative_instagram_url);
  const linkUrl = firstURL(
    source.creative_permalink_url,
    details.creative_permalink_url,
    instagramUrl,
    source.creative_url,
    details.creative_url,
  );
  const destinationUrl = firstURL(source.creative_destination_url, details.creative_destination_url);

  if (!imageUrl && !videoUrl && !linkUrl && !instagramUrl && !destinationUrl) return null;

  return {
    name: firstText(source.creative_name, details.creative_name, creative?.name),
    adName: firstText(source.ad_name, details.ad_name),
    type: firstText(source.creative_type, details.creative_type),
    imageUrl,
    videoUrl,
    linkUrl,
    instagramUrl,
    destinationUrl,
  };
}

function sourceLabel(source?: string | null): string | null {
  if (!source) return null;
  const labels: Record<string, string> = {
    meta: 'Meta Ads',
    meta_ads: 'Meta Ads',
    whatsapp: 'WhatsApp',
    webhook: 'Webhook',
    website: 'Site',
    site: 'Site',
    wordpress: 'WordPress',
    manual: 'Manual',
  };
  return labels[source] || source;
}

// Types that only exist in activities (never in timeline) - no deduplication needed
const ACTIVITY_ONLY_TYPES = new Set([
  'call',
  'email',
  'note',
  'message',
  'meta_form_answer',
  'meta_creative',
  'task_completed',
  'contact_updated',
  'automation_message',
  'commission_created',
  'commission_updated',
]);

// Types where timeline is authoritative - skip activity duplicate
const TIMELINE_AUTHORITY_TYPES = new Set([
  'lead_created',
  'lead_assigned',
  'assignee_changed', // deduplica com lead_assigned da timeline
  'stage_changed',
  'stage_change',
  'first_response',
  'whatsapp_message_sent',
  'whatsapp_message_received',
  'call_initiated',
  'note_created',
  'tag_added',
  'tag_removed',
  'sla_warning',
  'sla_overdue',
  'lead_reentry',
]);

function buildLabel(type: string, metadata: HistoryMetadata): string {
  switch (type) {
    case 'lead_created': {
      const src = metadata?.source_label || metadata?.source;
      if (!src) return 'Lead criado';
      if (src === 'meta_ads' || src === 'Meta Ads') return 'Lead criado via Meta Ads';
      if (src === 'whatsapp' || src === 'WhatsApp') return 'Lead criado via WhatsApp';
      if (src === 'webhook' || src === 'Webhook') {
        const name = metadata?.form_name || metadata?.webhook_name;
        return name ? `Lead criado via "${name}"` : 'Lead criado via Webhook';
      }
      if (src === 'website' || src === 'Site') return 'Lead criado via Site';
      if (src === 'manual') return 'Lead criado manualmente';
      return `Lead criado via ${src}`;
    }
    case 'lead_assigned': {
      const queueName = metadata?.distribution_queue_name || metadata?.queue_name;
      const assignedName = metadata?.assigned_user_name;
      if (queueName && assignedName) return `Distribuído via "${queueName}" → ${assignedName}`;
      if (queueName) return `Distribuído via "${queueName}"`;
      if (metadata?.destination === 'admin_fallback') return 'Atribuído ao administrador (sem fila ativa)';
      if (metadata?.destination === 'pool') return 'Enviado para o Pool';
      if (assignedName) return `Atribuído a ${assignedName}`;
      return 'Distribuído';
    }
    case 'stage_changed':
    case 'stage_change': {
      const from = metadata?.old_stage_name || metadata?.from_stage;
      const to = metadata?.new_stage_name || metadata?.to_stage;
      if (!from || from === 'Desconhecido' || from === 'Unknown') {
        return `Iniciado no estágio ${to || 'Base'}`;
      }
      if (from && to) return `Movido: ${from} → ${to}`;
      return 'Estágio alterado';
    }
    case 'first_response':
      return 'Primeiro contato';
    case 'whatsapp_message_sent':
      return 'Mensagem enviada (WhatsApp)';
    case 'whatsapp_message_received':
      return 'Mensagem recebida (WhatsApp)';
    case 'call_initiated':
      return 'Ligação iniciada';
    case 'note_created':
    case 'note':
      return 'Nota adicionada';
    case 'tag_added':
      return metadata?.tag_name ? `Tag "${metadata.tag_name}" adicionada` : 'Tag adicionada';
    case 'tag_removed':
      return metadata?.tag_name ? `Tag "${metadata.tag_name}" removida` : 'Tag removida';
    case 'sla_warning':
      return 'SLA em alerta';
    case 'sla_overdue':
      return 'SLA estourado';
    case 'call':
      return 'Ligação realizada';
    case 'email':
      return 'Email enviado';
    case 'message':
      return 'Mensagem enviada';
    case 'meta_form_answer': {
      const question = metadataString(metadata?.question);
      return question ? `Meta: ${question}` : 'Resposta do formulario Meta';
    }
    case 'meta_creative':
      return 'Criativo Meta';
    case 'automation_message': {
      const ch = metadata?.channel || 'whatsapp';
      return `Mensagem automática (${ch === 'whatsapp' ? 'WhatsApp' : ch})`;
    }
    case 'task_completed':
      return 'Tarefa concluída';
    case 'contact_updated':
      return 'Contato atualizado';
    case 'assignee_changed': {
      if (metadata?.distribution_queue_name && metadata?.to_user_name) {
        const prefix = metadata?.is_initial_distribution === false ? 'Redistribuído' : 'Distribuído';
        return `${prefix} por "${metadata.distribution_queue_name}" → ${metadata.to_user_name}`;
      }
      if (!metadata?.to_user_id && !metadata?.to_user_name) return 'Responsável removido';
      if (metadata?.to_user_name) return `Atribuído a ${metadata.to_user_name}`;
      return 'Responsável alterado';
    }
    case 'lead_reentry': {
      if (metadata?.entry_type === 'manual_reentry') return 'Lead reentrou';
      if (metadata?.webhook_name) return `Lead reentrou via webhook "${metadata.webhook_name}"`;
      if (metadata?.source === 'whatsapp') return 'Lead reentrou via WhatsApp';
      return `Lead reentrou via ${metadata?.source || 'sistema'}`;
    }
    case 'status_change': {
      const from = metadataString(metadata?.from_status);
      const to = metadataString(metadata?.to_status);
      const statusMap: Record<string, string> = { open: 'Aberto', won: 'Ganho', lost: 'Perdido' };
      if (from && to) return `Status: ${statusMap[from] || from} → ${statusMap[to] || to}`;
      return 'Status alterado';
    }
    case 'commission_created':
      return 'Comissão registrada';
    case 'commission_updated':
      return 'Comissão atualizada';
    case 'whatsapp':
      return 'Mensagem WhatsApp';
    case 'assignment':
      return metadata?.to_user_name ? `Atribuído a ${metadata.to_user_name}` : 'Lead atribuído';
    case 'automation_stage_move':
      return 'Movido por automação';
    case 'automation_tag_added':
      return 'Tag adicionada por automação';
    case 'visit_scheduled':
      return 'Visita agendada';
    case 'visit_made':
      return 'Visita realizada';
    case 'meeting_scheduled':
      return 'Reunião agendada';
    case 'meeting_made':
      return 'Reunião realizada';
    default: {
      if (metadata?.is_automation) return `Ação automática (${type})`;
      const translations: Record<string, string> = {
        'call_made': 'Ligação realizada',
        'message_sent': 'Mensagem enviada',
        'contact_made': 'Contato realizado',
        'prospecting_report': 'Relatório de prospecção',
        'agenda_created': 'Atividade agendada',
        'agenda_rescheduled': 'Atividade remarcada',
        'agenda_completed': 'Atividade concluída',
        'agenda_cancelled': 'Atividade cancelada'
      };
      return translations[type] || type.replace(/_/g, ' ');
    }
  }
}

function buildContent(type: string, metadata: HistoryMetadata): string | undefined {
  switch (type) {
    case 'first_response': {
      const secs = metadata?.response_seconds;
      if (secs !== undefined && secs !== null) {
        return `Primeiro contato: ${formatResponseTime(Number(secs))}`;
      }
      return undefined;
    }
    case 'stage_changed':
    case 'stage_change': {
      const from = metadataString(metadata?.old_stage_name) || metadataString(metadata?.from_stage);
      const to = metadataString(metadata?.new_stage_name) || metadataString(metadata?.to_stage);
      const isInitial = !from || from === 'Desconhecido' || from === 'Unknown';
      if (!isInitial && from && to) return `${from} → ${to}`;
      return undefined;
    }
    default:
      return undefined;
  }
}

export function useLeadHistory(leadId: string | null) {

  return useQuery({
    queryKey: ['lead-history-v2', leadId],
    queryFn: async (): Promise<UnifiedHistoryEvent[]> => {
      if (!leadId) return [];

      const raw = await leadsAPI.getLeadHistoryRaw<LeadHistoryRaw>(leadId);
      const timelineEvents = raw.timelineEvents || [];
      const activityEvents = raw.activityEvents || [];
      const entryEvents = raw.entryEvents || [];
      const lead = raw.lead || null;
      const leadMeta = raw.leadMeta || null;
      const distributionLogs = raw.distributionLogs || [];

      // Collect all user IDs that need resolution from metadata
      const userIdsToResolve = new Set<string>();
      [...timelineEvents, ...activityEvents].forEach((event) => {
        const meta = asMetadata(event.metadata);
        const userId = metadataString(meta.user_id);
        const toUserId = metadataString(meta.to_user_id);
        const fromUserId = metadataString(meta.from_user_id);
        if (userId) userIdsToResolve.add(userId);
        if (toUserId) userIdsToResolve.add(toUserId);
        if (fromUserId) userIdsToResolve.add(fromUserId);
        if (event.user_id) userIdsToResolve.add(event.user_id);
        if ('actor_user_id' in event && event.actor_user_id) userIdsToResolve.add(event.actor_user_id);
      });
      distributionLogs.forEach((log) => {
        if (log.assigned_user_id && typeof log.assigned_user_id === 'string') userIdsToResolve.add(log.assigned_user_id);
      });
      if (lead?.assigned_user_id) userIdsToResolve.add(lead.assigned_user_id);

      // Resolve users
      const userMap = new Map<string, HistoryActor>();
      if (userIdsToResolve.size > 0) {
        (raw.users || []).forEach((user) => {
          if (!userIdsToResolve.has(user.id)) return;
          userMap.set(user.id, {
            id: user.id,
            name: user.name || 'Usuário',
            avatar_url: user.avatar_url || null,
          });
        });
      }

      // -- Deduplication fingerprint for activities (handles backend double-writes) --
      function getActivityFingerprint(activity: ActivityEventRow): string {
        const meta = asMetadata(activity.metadata);
        const ts = Math.floor(new Date(activity.created_at).getTime() / 2000); // 2-second window
        if (activity.type === 'stage_change' || activity.type === 'stage_changed') {
          const from = metadataString(meta.from_stage_id) || metadataString(meta.old_stage_id) || metadataString(meta.from_stage) || metadataString(meta.old_stage_name) || '';
          const to = metadataString(meta.to_stage_id) || metadataString(meta.new_stage_id) || metadataString(meta.to_stage) || metadataString(meta.new_stage_name) || '';
          return `${activity.type}-${from}->${to}-${ts}`;
        }
        return `${activity.type}-${metadataString(meta.to_stage) || metadataString(meta.to_user_id) || metadataString(meta.new_stage_name) || ''}-${ts}`;
      }

      function getActivityDetailScore(activity: ActivityEventRow): number {
        const meta = asMetadata(activity.metadata);
        let score = 0;
        if (metadataString(meta.from_stage) || metadataString(meta.old_stage_name)) score += 3;
        if (metadataString(meta.to_stage) || metadataString(meta.new_stage_name)) score += 3;
        if (/movido de\s+"/i.test(activity.content || '')) score += 2;
        if (activity.user_id || metadataString(meta.actor_id)) score += 1;
        return score;
      }

      const dedupedActivityMap = new Map<string, ActivityEventRow>();
      activityEvents.forEach((activity) => {
        const fp = getActivityFingerprint(activity);
        const existing = dedupedActivityMap.get(fp);
        if (!existing || getActivityDetailScore(activity) > getActivityDetailScore(existing)) {
          dedupedActivityMap.set(fp, activity);
        }
      });
      const dedupedActivityEvents = Array.from(dedupedActivityMap.values()).sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      // Build unified events from timeline
      const timelineMapped: UnifiedHistoryEvent[] = timelineEvents.map((event) => {
        const meta = asMetadata(event.metadata);
        const actorId = event.user_id || event.actor_user_id;
        const actor = actorId ? (userMap.get(actorId) || null) : null;
        const responseSeconds = metadataNumber(meta.response_seconds);

        return {
          id: `timeline-${event.id}`,
          type: event.event_type,
          label: buildLabel(event.event_type, meta),
          content: buildContent(event.event_type, meta),
          timestamp: event.created_at || event.event_at || new Date().toISOString(),
          actor: actor ? { id: actor.id, name: actor.name, avatar_url: actor.avatar_url } : null,
          source: 'timeline' as const,
          metadata: meta,
          channel: event.channel || metadataString(meta.channel),
          isAutomation: event.is_automation || false,
          sourceOrigin: metadataString(meta.source) || metadataString(meta.source_label),
          webhookName: metadataString(meta.webhook_name) || metadataString(meta.form_name),
          firstResponseSeconds: event.event_type === 'first_response' ? responseSeconds : null,
        };
      });

      // Track which timeline types exist for deduplication
      const timelineTypesPresent = new Set(timelineEvents.map((event) => event.event_type));
      const activityTypesPresent = new Set(dedupedActivityEvents.map((activity) => activity.type));

      // Enrich timeline lead_created with webhook_name from activity if missing
      const activityLeadCreated = dedupedActivityEvents.find((activity) => activity.type === 'lead_created');
      timelineMapped.forEach((event) => {
        if (event.type === 'lead_created' && !event.webhookName && activityLeadCreated) {
          const actMeta = asMetadata(activityLeadCreated.metadata);
          const wn = metadataString(actMeta.webhook_name) || metadataString(actMeta.form_name);
          if (wn) {
            event.webhookName = wn;
            // Re-build label with enriched metadata
            event.label = buildLabel('lead_created', { ...asMetadata(event.metadata), webhook_name: wn });
          }
        }
      });

      // Build unified events from activities (with deduplication)
      const activityMapped: UnifiedHistoryEvent[] = dedupedActivityEvents
        .filter((activity) => {
          // Always include activity-only types
          if (ACTIVITY_ONLY_TYPES.has(activity.type)) return true;
          if (activity.type === 'lead_reentry' && asMetadata(activity.metadata).entry_type === 'manual_reentry') return true;
          // Skip if timeline already has authority over this type
          if (TIMELINE_AUTHORITY_TYPES.has(activity.type) && timelineTypesPresent.has(activity.type)) return false;
          // Also map stage_change → stage_changed
          if (activity.type === 'stage_change' && timelineTypesPresent.has('stage_changed')) return false;
          return true;
        })
        .map((activity) => {
          const meta = asMetadata(activity.metadata);
          const actorId = activity.user_id;
          const actorFromQuery = activity.user;
          const actor = actorFromQuery || (actorId ? userMap.get(actorId) || null : null);

          return {
            id: `activity-${activity.id}`,
            type: activity.type,
            label: buildLabel(activity.type, meta),
            content: activity.content || buildContent(activity.type, meta),
            timestamp: activity.created_at,
            actor: actor ? { id: actor.id, name: actor.name, avatar_url: actor.avatar_url || undefined } : null,
            source: 'activity' as const,
            metadata: meta,
            channel: metadataString(meta.channel),
            isAutomation: Boolean(meta.is_automation) || activity.type.startsWith('automation_'),
          };
        });

      const metaFormAnswerMapped: UnifiedHistoryEvent[] = dedupedActivityEvents.flatMap((activity) => {
        if (activity.type !== 'lead_created' && activity.type !== 'lead_reentry') return [];
        const meta = asMetadata(activity.metadata);
        const source = metadataString(meta.source);
        const sourceType = metadataString(meta.source_type);
        if (source !== 'meta' && sourceType !== 'meta_lead_ads') return [];

        const baseTime = new Date(activity.created_at).getTime();
        return extractMetaFormAnswers(meta).map((answer, index) => {
          const timestamp = Number.isFinite(baseTime)
            ? new Date(baseTime + index + 1).toISOString()
            : activity.created_at;
          const answerMetadata: HistoryMetadata = {
            source: 'meta',
            source_type: 'meta_lead_ads',
            question: answer.question,
            answer: answer.answer,
            form_name: metadataString(meta.form_name),
            form_id: metadataString(meta.form_id),
            leadgen_id: metadataString(meta.leadgen_id),
          };

          return {
            id: `meta-answer-${activity.id}-${index}`,
            type: 'meta_form_answer',
            label: buildLabel('meta_form_answer', answerMetadata),
            content: answer.answer,
            timestamp,
            actor: null,
            source: 'activity' as const,
            metadata: answerMetadata,
            channel: 'meta',
            isAutomation: false,
            sourceOrigin: 'meta',
          };
        });
      });

      const metaCreativeMappedFromActivities: UnifiedHistoryEvent[] = dedupedActivityEvents.flatMap((activity) => {
        if (activity.type !== 'lead_created' && activity.type !== 'lead_reentry') return [];
        const meta = asMetadata(activity.metadata);
        const source = metadataString(meta.source);
        const sourceType = metadataString(meta.source_type);
        if (source !== 'meta' && sourceType !== 'meta_lead_ads') return [];

        const creative = extractMetaCreative(meta as Record<string, unknown>);
        if (!creative) return [];

        const baseTime = new Date(activity.created_at).getTime();
        const timestamp = Number.isFinite(baseTime)
          ? new Date(baseTime + 1).toISOString()
          : activity.created_at;
        const creativeMetadata: HistoryMetadata = {
          source: 'meta',
          source_type: 'meta_lead_ads',
          creative_name: creative.name,
          ad_name: creative.adName,
          creative_type: creative.type,
          creative_url: creative.imageUrl,
          creative_video_url: creative.videoUrl,
          creative_link_url: creative.linkUrl,
          creative_instagram_url: creative.instagramUrl,
          creative_destination_url: creative.destinationUrl,
          form_name: metadataString(meta.form_name),
          form_id: metadataString(meta.form_id),
          leadgen_id: metadataString(meta.leadgen_id),
        };

        return [{
          id: `meta-creative-${activity.id}`,
          type: 'meta_creative',
          label: buildLabel('meta_creative', creativeMetadata),
          content: creative.name || creative.adName || 'Criativo do anuncio',
          timestamp,
          actor: null,
          source: 'activity' as const,
          metadata: creativeMetadata,
          channel: 'meta',
          isAutomation: false,
          sourceOrigin: 'meta',
        }];
      });

      const metaCreativeMappedFromLeadMeta: UnifiedHistoryEvent[] = (() => {
        if (metaCreativeMappedFromActivities.length > 0) return [];
        const creative = extractMetaCreative(leadMeta as Record<string, unknown> | null);
        if (!creative) return [];

        const createdAt = leadMeta?.created_at || lead?.created_at || new Date().toISOString();
        const baseTime = new Date(createdAt).getTime();
        const timestamp = Number.isFinite(baseTime) ? new Date(baseTime + 1).toISOString() : createdAt;
        const metadata: HistoryMetadata = {
          source: 'meta',
          source_type: 'meta_lead_ads',
          creative_name: creative.name,
          ad_name: creative.adName,
          creative_type: creative.type,
          creative_url: creative.imageUrl,
          creative_video_url: creative.videoUrl,
          creative_link_url: creative.linkUrl,
          creative_instagram_url: creative.instagramUrl,
          creative_destination_url: creative.destinationUrl,
          form_name: leadMeta?.form_name || null,
          form_id: leadMeta?.form_id || null,
        };

        return [{
          id: `meta-creative-lead-meta-${leadMeta?.id || lead?.id || leadId}`,
          type: 'meta_creative',
          label: buildLabel('meta_creative', metadata),
          content: creative.name || creative.adName || 'Criativo do anuncio',
          timestamp,
          actor: null,
          source: 'activity' as const,
          metadata,
          channel: 'meta',
          isAutomation: false,
          sourceOrigin: 'meta',
        }];
      })();

      // Build entry events mapped to unified format
      const entriesMapped: UnifiedHistoryEvent[] = entryEvents
        .filter((entry) => entry.entry_type !== 'initial') // Remove redundancy with "Lead criado"
        .map((entry, index) => ({
          id: `entry-${entry.id}`,
          type: 'lead_reentry',
          label: `${index + 2}ª Entrada`, // First re-entry is the 2nd entry
          content: `Origem: ${entry.source}${entry.campaign_name ? ` | Campanha: ${entry.campaign_name}` : ''}`,
          timestamp: entry.created_at,
          actor: null,
          source: 'timeline' as const,
          metadata: { ...entry },
          channel: entry.source,
          isAutomation: false,
        }));

      const distributionMapped: UnifiedHistoryEvent[] = distributionLogs
        .filter((log) => {
          if (!log.round_robin_id && !log.assigned_user_id && !log.reason) return false;
          const hasTimelineQueue = timelineEvents.some((event) => {
            const meta = asMetadata(event.metadata);
            return event.event_type === 'lead_assigned'
              && (meta.distribution_queue_id === log.round_robin_id || meta.queue_id === log.round_robin_id);
          });
          return !hasTimelineQueue;
        })
        .map((log) => {
          const queueName = log.queue?.name || null;
          const assignedUser = log.assigned_user || (log.assigned_user_id ? userMap.get(log.assigned_user_id) : null);
          const assignedName = assignedUser?.name || null;
          const success = !!log.assigned_user_id;
          const reason = log.reason || null;
          const metadata: HistoryMetadata = {
            queue_id: log.round_robin_id,
            distribution_queue_id: log.round_robin_id,
            queue_name: queueName,
            distribution_queue_name: queueName,
            assigned_user_id: log.assigned_user_id,
            assigned_user_name: assignedName,
            to_user_id: log.assigned_user_id,
            to_user_name: assignedName,
            reason,
            is_initial_distribution: true,
          };

          return {
            id: `distribution-${log.id}`,
            type: 'lead_assigned',
            label: success
              ? buildLabel('lead_assigned', metadata)
              : queueName
                ? `Fila "${queueName}" sem distribuição`
                : 'Sem fila de distribuição compatível',
            content: success ? undefined : reason || undefined,
            timestamp: log.created_at,
            actor: assignedUser ? { id: assignedUser.id, name: assignedUser.name, avatar_url: assignedUser.avatar_url || null } : null,
            source: 'timeline' as const,
            metadata,
            channel: null,
            isAutomation: true,
          };
        });

      const fallbackEvents: UnifiedHistoryEvent[] = [];
      const hasLeadCreated = timelineTypesPresent.has('lead_created') || activityTypesPresent.has('lead_created');
      if (lead && !hasLeadCreated) {
        const label = sourceLabel(lead.source);
        fallbackEvents.push({
          id: `lead-fallback-created-${lead.id}`,
          type: 'lead_created',
          label: buildLabel('lead_created', { source: lead.source, source_label: label }),
          content: label ? `Origem: ${label}` : undefined,
          timestamp: lead.created_at,
          actor: null,
          source: 'timeline' as const,
          metadata: { source: lead.source, source_label: label, utm_source: lead.utm_source },
          channel: lead.source || null,
          isAutomation: false,
          sourceOrigin: lead.source || null,
        });
      }

      const hasAssignmentEvent =
        timelineTypesPresent.has('lead_assigned') ||
        timelineTypesPresent.has('assignee_changed') ||
        activityTypesPresent.has('assignee_changed') ||
        distributionMapped.length > 0;
      if (lead?.assigned_user_id && !hasAssignmentEvent) {
        const assignedUser = lead.assigned_user || userMap.get(lead.assigned_user_id);
        const assignedName = assignedUser?.name || 'Responsável atual';
        fallbackEvents.push({
          id: `lead-fallback-assigned-${lead.id}`,
          type: 'lead_assigned',
          label: `Atribuído a ${assignedName}`,
          content: 'Registro sem fila de distribuição vinculada',
          timestamp: lead.assigned_at || lead.created_at,
          actor: assignedUser ? { id: assignedUser.id, name: assignedUser.name, avatar_url: assignedUser.avatar_url || null } : null,
          source: 'timeline' as const,
          metadata: {
            assigned_user_id: lead.assigned_user_id,
            assigned_user_name: assignedName,
            to_user_id: lead.assigned_user_id,
            to_user_name: assignedName,
            source: lead.source,
            source_label: sourceLabel(lead.source),
          },
          channel: null,
          isAutomation: false,
        });
      }

      // Merge and sort chronologically (oldest first)
      return [
        ...fallbackEvents,
        ...timelineMapped,
        ...activityMapped,
        ...metaCreativeMappedFromActivities,
        ...metaCreativeMappedFromLeadMeta,
        ...metaFormAnswerMapped,
        ...entriesMapped,
        ...distributionMapped,
      ].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    },
    enabled: !!leadId,
    staleTime: 0,
    refetchInterval: 5000,
  });
}
