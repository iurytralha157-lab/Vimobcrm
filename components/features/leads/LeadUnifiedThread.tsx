import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { format, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Bot, Loader2, MessageCircle, RefreshCw, Timer } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MessageBubble as WhatsAppMessageBubble } from '@/components/features/whatsapp/MessageBubble';
import { MessageErrorBoundary } from '@/components/features/whatsapp/MessageErrorBoundary';
import { DateSeparator, LoadOlderMessagesButton, ScrollToLatestButton } from '@/components/features/whatsapp';
import { useWhatsAppThreadScroll } from '@/hooks/use-whatsapp-thread-scroll';
import { useWhatsAppMessageNavigation } from '@/hooks/use-whatsapp-message-navigation';
import { useWhatsAppMediaGallery } from '@/hooks/use-whatsapp-media-gallery';
import { cn } from '@/lib/utils';
import { getSafeHttpUrl } from '@/lib/safe-http-url';
import { isWhatsAppAccessUnavailable } from '@/lib/whatsapp-access-revocation';
import { flattenWhatsAppMessagePages } from '@/lib/whatsapp-query-cache';
import { sortWhatsAppTimelineItems } from '@/lib/whatsapp-message-order';
import { getWhatsAppMessageGrouping, isWhatsAppMessageBlockStart } from '@/lib/whatsapp-message-grouping';
import { formatBRLCurrencyWithDefaultDecimals } from '@/lib/utils/formatting';
import { getEventTone } from '@/components/features/leads/lead-detail/history-event-presentation';
import { useLeadHistory, type UnifiedHistoryEvent } from '@/hooks/use-lead-history';
import { leadThreadInitialLoading, leadThreadWindow, LEAD_HISTORY_RENDER_PAGE_SIZE } from '@/hooks/lead-history/thread-state';
import { useWhatsAppConversations, useWhatsAppLeadRealtime, type WhatsAppMessage } from '@/hooks/use-whatsapp-conversations';
import { useLeadMessages, type LeadMessage } from '@/hooks/use-lead-messages';
import { useWhatsAppQueryScope } from '@/hooks/use-whatsapp-query-scope';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { useOrganizationModules } from '@/hooks/use-organization-modules';
import { toast } from 'sonner';
import { whatsappAPI } from '@/lib/api/whatsapp';
import { groupLatestWhatsAppReactions } from '@/lib/whatsapp-reactions';

type LeadUnifiedThreadProps = {
  leadId: string;
  leadName: string;
  leadAvatarUrl?: string | null;
  leadCreatedAt?: string | null;
  historyPagination?: boolean;
};

type ThreadItem =
  | {
      id: string;
      kind: 'event';
      timestamp: string;
      event: UnifiedHistoryEvent;
    }
  | {
      id: string;
      kind: 'message';
      timestamp: string;
      message: WhatsAppMessage & Pick<LeadMessage, 'session_owner_name' | 'session_instance_name'>;
    };

type MessageMediaStatus = 'pending' | 'ready' | 'failed' | null;

const toMessageMediaStatus = (status: WhatsAppMessage['media_status']): MessageMediaStatus => {
  return status === 'pending' || status === 'ready' || status === 'failed' ? status : null;
};

function getAttachmentFileName(event: UnifiedHistoryEvent) {
  const metadata = event.metadata || {};
  const metadataName =
    metadata.file_name ||
    metadata.fileName ||
    metadata.filename ||
    metadata.attachment_name ||
    metadata.document_name;

  const fileName = metadataText(metadataName);
  if (fileName) return fileName;

  const text = `${event.label || ''} ${event.content || ''}`;
  const match = text.match(/(?:documento|arquivo)\s+anexad[oa]:?\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

const OUTCOME_LABELS: Record<string, string> = {
  answered: 'Atendeu',
  not_answered: 'Não atendeu',
  invalid_number: 'Número inválido',
  busy: 'Linha ocupada',
  scheduled: 'Agendou retorno',
  replied: 'Respondeu',
  seen_no_reply: 'Visualizou e não respondeu',
  not_seen: 'Não visualizou',
  no_whatsapp: 'Lead sem WhatsApp',
  not_replied: 'Não respondeu',
  bounced: 'E-mail inválido',
  done: 'Concluído',
};

function metadataText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (value === true || (typeof value === 'number' && Number.isFinite(value))) return String(value);
  return null;
}

function safeEventDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatEventTime(value: string | null | undefined) {
  const date = safeEventDate(value);
  return date ? format(date, 'HH:mm', { locale: ptBR }) : '--:--';
}

function isInternalNotificationMessage(message: WhatsAppMessage) {
  const metadata = (message.metadata || {}) as Record<string, unknown>;
  const notificationType = (metadataText(metadata.notification_type) || metadataText(metadata.notificationType) || '').toLowerCase();

  return Boolean(
    metadata.internal_notification ||
      metadata.internalNotification ||
      metadata.notification_lead_id ||
      metadata.notificationLeadId ||
      notificationType === 'new_lead_received' ||
      notificationType === 'lead_received' ||
      notificationType === 'new_lead'
  );
}

function getStageNameFromMetadata(metadata: Record<string, unknown> | null | undefined, direction: 'from' | 'to') {
  const source: Record<string, unknown> = metadata || {};
  const keys = direction === 'from'
    ? ['old_stage_name', 'from_stage_name', 'from_stage', 'old_stage', 'previous_stage_name']
    : ['new_stage_name', 'to_stage_name', 'to_stage', 'new_stage', 'next_stage_name'];

  for (const key of keys) {
    const value = metadataText(source[key]);
    if (value) return value;
  }

  return '';
}

function getOutcomeLabel(event: UnifiedHistoryEvent) {
  const outcome = metadataText(event.metadata?.outcome);
  if (!outcome) return null;
  return Object.hasOwn(OUTCOME_LABELS, outcome) ? OUTCOME_LABELS[outcome] : 'Resultado registrado';
}

function getOutcomeActionLabel(event: UnifiedHistoryEvent) {
  const outcomeLabel = getOutcomeLabel(event);
  if (!outcomeLabel) return null;

  const channel = (metadataText(event.metadata?.channel) || event.channel || '').toLowerCase();
  if (event.type === 'call' || channel === 'call' || channel === 'phone') return `Ligação: ${outcomeLabel}`;
  if (event.type === 'email' || channel === 'email') return `E-mail: ${outcomeLabel}`;
  if (event.type === 'message' || channel === 'message' || channel === 'whatsapp') return `Mensagem: ${outcomeLabel}`;
  if (event.type === 'task_completed') return `Tarefa: ${outcomeLabel}`;

  return outcomeLabel;
}

function getLostReason(event: UnifiedHistoryEvent) {
  const metadata = event.metadata || {};
  const metadataReason =
    metadataText(metadata.lost_reason) ||
    metadataText(metadata.lostReason) ||
    metadataText(metadata.loss_reason) ||
    metadataText(metadata.reason);
  if (metadataReason) return metadataReason;

  const text = `${event.content || ''} ${event.label || ''}`;
  const match = text.match(/motivo:\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

function getEventDetail(event: UnifiedHistoryEvent) {
  // Agenda context is projected once by the history builder. Re-reading raw
  // notes or timestamps here would bypass that projection and its timezone.
  if (event.type.startsWith('agenda_') || ['visit_scheduled', 'visit_made', 'visit_confirmed',
    'meeting_scheduled', 'meeting_made', 'meeting_held'].includes(event.type)) {
    return event.content?.trim() || null;
  }
  const metadata = event.metadata || {};
  if (metadataText(metadata.audit_action)
    && (Object.hasOwn(metadata, 'lost_reason') || Object.hasOwn(metadata, 'deal_status'))) {
    return event.content?.trim() || null;
  }
  if (event.type === 'meta_form_answer' || event.type === 'webhook_form_answer') {
    return metadataText(metadata.answer) || event.content || null;
  }
  if (event.type === 'lead_updated') {
    return event.content?.trim() || null;
  }
  if (event.type === 'property_interests_changed') return event.content?.trim() || null;

  const toStatus = (metadataText(metadata.to_status) || '').toLowerCase();
  const isStageChangeEvent = event.type === 'stage_changed' || event.type === 'stage_change';
  if (isStageChangeEvent) {
    const from = getStageNameFromMetadata(metadata, 'from');
    const to = getStageNameFromMetadata(metadata, 'to');
    const isInitial = !from || ['desconhecido', 'unknown'].includes(from.toLowerCase());
    if (!isInitial && from && to && !normalizeEventLabel(event).includes(from)) {
      return `${from} -> ${to}`;
    }
  }

  const isLostStatusEvent =
    (event.type === 'status_change' && toStatus === 'lost') ||
    /marcado como perdido/i.test(`${event.label || ''} ${event.content || ''}`);
  if (isLostStatusEvent) {
    const lostReason = getLostReason(event);
    return lostReason ? `Motivo: ${lostReason}` : null;
  }

  if (event.type === 'property_selected' || event.type === 'property_linked') {
    const title = metadataText(metadata.property_title) || metadataText(metadata.property_name);
    const code = metadataText(metadata.property_code) || metadataText(metadata.property_ref);
    const rawPrice = Number(metadataText(metadata.property_price));
    const price = Number.isFinite(rawPrice) && rawPrice > 0
      ? formatBRLCurrencyWithDefaultDecimals(rawPrice)
      : null;
    return [title, code, price].filter(Boolean).join('\n') || null;
  }

  const notes =
    metadataText(metadata.notes) ||
    metadataText(metadata.outcome_notes) ||
    metadataText(metadata.outcomeNotes) ||
    metadataText(metadata.feedback) ||
    metadataText(metadata.comment);

  const outcomeLabel = getOutcomeLabel(event);
  const channel = (metadataText(event.metadata?.channel) || event.channel || '').toLowerCase();
  const isTaskOrCommunication = ['call', 'email', 'message', 'task_completed'].includes(event.type) || ['call', 'phone', 'email', 'message', 'whatsapp'].includes(channel);

  if (outcomeLabel && isTaskOrCommunication) {
    const outcomeText = `Desfecho: ${outcomeLabel}`;
    return notes ? `${outcomeText}\nObservações: ${notes}` : outcomeText;
  }

  if (notes) return notes;

  const hasOutcome = Boolean(getOutcomeActionLabel(event));
  const content = event.content?.trim();
  if (!hasOutcome || !content) return null;

  const generic = ['tentativa de ligacao', 'ligacao realizada', 'email enviado', 'mensagem enviada', 'tarefa concluida'];
  const normalized = content.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return generic.includes(normalized) ? null : content;
}

function isAttachmentEvent(event: UnifiedHistoryEvent) {
  const metadata = event.metadata || {};
  const text = `${event.type || ''} ${event.label || ''} ${event.content || ''}`.toLowerCase();

  return Boolean(
    event.type.includes('attachment') ||
      event.type.includes('document') ||
      metadata.attachment_id ||
      metadata.file_id ||
      metadata.file_url ||
      metadata.file_name ||
      metadata.fileName ||
      metadata.filename ||
      /documento\s+anexad[oa]/i.test(text) ||
      /arquivo\s+anexad[oa]/i.test(text),
  );
}

function normalizeEventLabel(event: UnifiedHistoryEvent) {
  if (event.type.startsWith('agenda_') || ['visit_scheduled', 'visit_made', 'visit_confirmed',
    'meeting_scheduled', 'meeting_made', 'meeting_held'].includes(event.type)) {
    return event.label;
  }
  const label = (event.label || '').replace(/^Lead\s+"[^"]+"\s+/i, 'Lead ').trim();
  const content = event.content?.trim();
  const metadata = event.metadata || {};
  const searchable = `${label} ${content || ''}`;

  if (event.type === 'lead_updated') {
    return 'Dados do lead atualizados';
  }
  if (event.type === 'property_interests_changed') return 'Imóveis de interesse atualizados';

  if (event.type === 'meta_form_answer') {
    const question = metadataText(metadata.question) || label.replace(/^Meta:\s*/i, '');
    return question ? `Meta: ${question}` : 'Resposta do formulário Meta';
  }

  if (event.type === 'webhook_form_answer') {
    const question = metadataText(metadata.question) || label.replace(/^Webhook:\s*/i, '');
    return question ? `Webhook: ${question}` : 'Resposta do formulário';
  }

  if (isAttachmentEvent(event)) {
    const fileName = getAttachmentFileName(event);
    return fileName ? `Documento anexado: ${fileName}` : 'Documento anexado';
  }

  if (event.type === 'property_selected' || event.type === 'property_linked') {
    const code = metadataText(metadata.property_code) || metadataText(metadata.property_ref);
    return code ? `Imóvel selecionado: ${code}` : 'Imóvel selecionado';
  }

  if (event.type === 'proposal_sent') {
    return 'Proposta registrada';
  }

  if (event.type === 'first_response') {
    return content || label || 'Primeiro contato';
  }

  const outcomeLabel = getOutcomeLabel(event);
  const channel = (metadataText(event.metadata?.channel) || event.channel || '').toLowerCase();
  const isTaskOrCommunication = ['call', 'email', 'message', 'task_completed'].includes(event.type) || ['call', 'phone', 'email', 'message', 'whatsapp'].includes(channel);

  if (outcomeLabel && isTaskOrCommunication) {
    let typePrefix = 'Tarefa';
    if (event.type === 'call' || channel === 'call' || channel === 'phone') typePrefix = 'Ligação';
    else if (event.type === 'email' || channel === 'email') typePrefix = 'E-mail';
    else if (event.type === 'message' || channel === 'message' || channel === 'whatsapp') typePrefix = 'Mensagem';

    let taskName = '';
    if (content) {
      taskName = content.replace(/^Cadencia concluida:\s+/i, '').trim();
    }

    if (!taskName && label && !/tarefa concluida|tarefa concluída|ligacao realizada|ligação realizada|email enviado|mensagem enviada/i.test(label)) {
      taskName = label;
    }

    return taskName ? `${typePrefix}: ${taskName}` : `${typePrefix}: ${outcomeLabel}`;
  }

  const outcomeActionLabel = getOutcomeActionLabel(event);
  if (outcomeActionLabel) return outcomeActionLabel;

  if (event.type === 'lead_created' || /foi criado/i.test(label)) {
    let source = (metadataText(metadata.source_label) || metadataText(metadata.source) || event.sourceOrigin || '').trim();
    if (source === 'generic_webhook') source = 'Webhook';
    return source && !/manual/i.test(source) ? `Lead criado via ${source}` : 'Lead criado';
  }

  if (event.type === 'tag_added') {
    const name = metadataText(metadata.tag_name);
    return name ? `Tag adicionada: ${name}` : 'Tag adicionada';
  }

  if (event.type === 'tag_removed') {
    const name = metadataText(metadata.tag_name);
    return name ? `Tag removida: ${name}` : 'Tag removida';
  }

  if (event.type === 'status_change') {
    const toStatus = (metadataText(metadata.to_status) || metadataText(metadata.new_status) || '').toLowerCase();
    if (toStatus === 'won') return 'Lead marcado como ganho';
    if (toStatus === 'lost') return 'Lead marcado como perdido';
    if (toStatus === 'open') return 'Lead reaberto';
  }

  if (event.type === 'lead_reentry') return 'Lead reentrou';
  if (/movido/i.test(label) || event.type === 'stage_changed' || event.type === 'stage_change') {
    const from = getStageNameFromMetadata(metadata, 'from');
    const to = getStageNameFromMetadata(metadata, 'to');
    const isInitial = !from || from.toLowerCase() === 'desconhecido' || from.toLowerCase() === 'unknown';
    if (!isInitial && from && to) {
      return `Lead movido: ${from} → ${to}`;
    }
    if (to) {
      return `Lead iniciado em ${to}`;
    }
    return 'Etapa alterada';
  }
  if (/marcado como ganho|venda conclu/i.test(searchable)) return 'Lead marcado como ganho';
  if (/marcado como perdido|perdido/i.test(searchable)) return 'Lead marcado como perdido';
  if (/reaberto/i.test(searchable)) return 'Lead reaberto';

  return content && content.length <= 72 ? content : label;
}

function shouldShowEvent(event: UnifiedHistoryEvent) {
  if ((event.type === 'lead_assigned' || event.type === 'lead_distribution_pending')
    && ['no_available_members', 'no_matching_queue'].includes(metadataText(event.metadata?.reason) || '')) return true;
  // Distribution visibility follows reserved projection IDs, not user text.
  if (event.type === 'lead_assigned' && event.source === 'timeline'
    && !metadataText(event.metadata?.queue_runtime_event_id)) {
    if (event.id.startsWith('lead-fallback-assigned-')) return false;
    if (event.id.startsWith('distribution-')
      && !metadataText(event.metadata?.assigned_user_id) && !metadataText(event.metadata?.to_user_id)) return false;
  }
  if (isTechnicalMetaAnswerEvent(event)) return false;
  return true;
}

function isTechnicalMetaAnswerEvent(event: UnifiedHistoryEvent) {
  if (event.type !== 'meta_form_answer') return false;

  const metadata = event.metadata || {};
  const question = [
    metadataText(metadata.question),
    metadataText(metadata.field_name),
    metadataText(metadata.fieldName),
    metadataText(metadata.key),
    event.label,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  const answer = `${metadataText(metadata.answer) || ''} ${event.content || ''}`.toLowerCase();

  const technicalFields = [
    'inbox url',
    'creative url',
    'creative video url',
    'creative instagram url',
    'link do anuncio',
    'url do anuncio',
    'ad url',
  ];

  return technicalFields.some((field) => question.includes(field)) || answer.includes('business.facebook.com/latest/');
}

function isFeedbackEvent(event: UnifiedHistoryEvent) {
  const kind = (metadataText(event.metadata?.kind) || metadataText(event.metadata?.event_kind) || '').toLowerCase();
  if (kind === 'feedback') return Boolean(event.content?.trim());
  return (event.type === 'note' || event.type === 'note_created') && Boolean(event.content?.trim()) && !isAttachmentEvent(event);
}

function EventActor({ event }: { event: UnifiedHistoryEvent }) {
  if (!event.actor) return null;

  return (
    <Avatar className="h-6 w-6 shrink-0 border-0" title={event.actor.name}>
      <AvatarImage src={event.actor.avatar_url || undefined} alt={event.actor.name || 'Responsável'} />
      <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
        {event.actor.name?.[0]?.toUpperCase() || 'U'}
      </AvatarFallback>
    </Avatar>
  );
}

function getEventAlignment(event: UnifiedHistoryEvent) {
  if (event.type === 'lead_created') return 'center';
  if (!event.actor && event.type === 'tag_added') return 'center';
  return 'right';
}

function getPendingDistribution(event: UnifiedHistoryEvent) {
  if (event.type !== 'lead_assigned' && event.type !== 'lead_distribution_pending') return null;
  const metadata = event.metadata || {};
  const reason = metadataText(metadata.reason);
  if (reason !== 'no_available_members' && reason !== 'no_matching_queue') return null;
  if (metadataText(metadata.assigned_user_id) || metadataText(metadata.to_user_id)) return null;
  return {
    reason,
    queue: metadataText(metadata.distribution_queue_name) || metadataText(metadata.queue_name),
  };
}

function getAutomaticAssignment(event: UnifiedHistoryEvent) {
  if (event.type !== 'lead_assigned' && event.type !== 'assignee_changed') return null;

  const metadata = event.metadata || {};
  const queue = metadataText(metadata.distribution_queue_name) || metadataText(metadata.queue_name);
  const distributionType = metadataText(metadata.distribution_type);
  const isAutomatic = event.isAutomation
    || metadata.is_automation === true
    || (event.type === 'lead_assigned' && (Boolean(queue) || distributionType === 'canonical_round_robin'));
  if (!isAutomatic) return null;

  const recipient = metadataText(metadata.assigned_user_name) || metadataText(metadata.to_user_name);
  const recipientId = metadataText(metadata.assigned_user_id) || metadataText(metadata.to_user_id);
  if (!recipient && !recipientId) return null;
  const reason = metadataText(metadata.reason);
  const action = reason === 'auto_redistribution' || metadata.is_initial_distribution === false
    ? 'Lead redistribuído'
    : queue ? 'Lead distribuído' : 'Lead atribuído';

  return { action, recipient, queue };
}

function getManualTransfer(event: UnifiedHistoryEvent) {
  if (event.type !== 'assignee_changed' || metadataText(event.metadata?.reason) !== 'manual_transfer') return null;
  const recipient = metadataText(event.metadata?.to_user_name);
  if (!recipient) return null;
  const actor = metadataText(event.metadata?.transferred_by_name) || event.actor?.name || null;
  return { recipient, actor };
}

function EventBubble({ event, plainHistory }: { event: UnifiedHistoryEvent; plainHistory: boolean }) {
  const pendingDistribution = getPendingDistribution(event);
  if (pendingDistribution) {
    return (
      <div className="flex justify-end px-2">
        <div className="min-w-0 max-w-[88%] rounded-[6px] border-l-2 border-primary bg-zinc-700 px-2.5 py-1.5 text-right text-[11px] font-light leading-4 text-primary-foreground [overflow-wrap:anywhere]">
          <div className="[overflow-wrap:anywhere]">
            {pendingDistribution.reason === 'no_matching_queue'
              ? 'Nenhuma fila de distribuição compatível para este lead'
              : pendingDistribution.queue
                ? <>Tentativa de distribuição via <span>{pendingDistribution.queue}</span>: nenhum responsável disponível</>
                : 'Tentativa de distribuição: nenhum responsável disponível'}
          </div>
          <div className="mt-1 flex items-center justify-end gap-1 text-[10px] leading-none text-primary-foreground/80">
            <span>{formatEventTime(event.timestamp)}</span>
            <Bot aria-hidden="true" className="h-3 w-3 shrink-0" />
          </div>
        </div>
      </div>
    );
  }

  const automaticAssignment = getAutomaticAssignment(event);
  if (automaticAssignment) {
    return (
      <div className="flex justify-end px-2">
        <div className="relative min-w-0 max-w-[88%] rounded-[6px] px-2.5 py-1.5 text-right text-[11px] font-light leading-4 text-primary-foreground [overflow-wrap:anywhere]">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[6px] bg-primary opacity-50" />
          <div className="relative min-w-0">
            <div className="[overflow-wrap:anywhere]">
              {automaticAssignment.action}
              {automaticAssignment.recipient && <> <span aria-hidden="true">→</span> <span>{automaticAssignment.recipient}</span></>}
            </div>
            {automaticAssignment.queue && <div className="mt-0.5 text-[11px] text-primary-foreground/90 [overflow-wrap:anywhere]">Fila: {automaticAssignment.queue}</div>}
            <div className="mt-1 flex items-center justify-end gap-1 text-[10px] leading-none text-primary-foreground/90">
              <span>{formatEventTime(event.timestamp)}</span>
              <Bot aria-hidden="true" className="h-3 w-3 shrink-0" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const manualTransfer = getManualTransfer(event);
  if (manualTransfer) {
    return (
      <div className="flex justify-end px-2">
        <div className="flex min-w-0 max-w-[88%] items-end gap-1.5">
          <div className="min-w-0 rounded-[6px] bg-violet-600 px-2.5 py-1.5 text-right text-[11px] font-light leading-4 text-primary-foreground [overflow-wrap:anywhere]">
            <div className="[overflow-wrap:anywhere]">Lead transferido para <span>{manualTransfer.recipient}</span></div>
            <div className="mt-1 text-[10px] leading-none text-primary-foreground/80">
              {manualTransfer.actor && <span>Por {manualTransfer.actor} · </span>}
              <span>{formatEventTime(event.timestamp)}</span>
            </div>
          </div>
          <EventActor event={event} />
        </div>
      </div>
    );
  }

  const alignment = getEventAlignment(event);
  const detail = getEventDetail(event);
  const toneClass = getEventTone(event, plainHistory);
  const isSolidTone = toneClass.includes('!text-white');
  const isFirstResponse = event.type === 'first_response';

  if (event.type === 'meta_form_answer' || event.type === 'webhook_form_answer') {
    const metadata = event.metadata || {};
    const isWebhookAnswer = event.type === 'webhook_form_answer';
    const question = metadataText(metadata.question) || normalizeEventLabel(event).replace(isWebhookAnswer ? /^Webhook:\s*/i : /^Meta:\s*/i, '');
    const answer = detail || event.content || '';

    return (
      <div className="flex justify-end px-2">
        <div className={cn(
          'min-w-0 max-w-[88%] overflow-hidden rounded-[8px] px-3 py-2 text-right text-primary-foreground shadow-none [overflow-wrap:anywhere]',
          isWebhookAnswer ? 'bg-primary' : 'bg-blue-600',
        )}>
          <div className="text-[10px] font-light leading-none text-primary-foreground/70">
            {isWebhookAnswer ? 'Webhook' : 'Meta Lead Ads'}
          </div>
          <div className="mt-1 text-[12px] font-[200] leading-[17px] text-primary-foreground/90 [overflow-wrap:anywhere]">
            {question}
          </div>
          {answer && (
            <div className="mt-1 max-w-full overflow-hidden rounded-[6px] bg-primary-foreground/15 px-2.5 py-1.5 text-[12px] font-[200] leading-[17px] text-primary-foreground [overflow-wrap:anywhere]">
              {answer}
            </div>
          )}
          <div className="mt-1.5 text-[10px] font-light leading-none text-primary-foreground/65">
            {formatEventTime(event.timestamp)}
          </div>
        </div>
      </div>
    );
  }

  if (event.type === 'meta_creative') {
    const metadata = event.metadata || {};
    const imageUrl = getSafeHttpUrl(metadataText(metadata.creative_url));
    const videoUrl = getSafeHttpUrl(metadataText(metadata.creative_video_url));
    const linkUrl =
      getSafeHttpUrl(metadataText(metadata.creative_link_url)) ||
      getSafeHttpUrl(metadataText(metadata.creative_destination_url)) ||
      getSafeHttpUrl(metadataText(metadata.creative_instagram_url));
    const creativeTitle =
      metadataText(metadata.creative_name) ||
      metadataText(metadata.ad_name) ||
      metadataText(metadata.campaign_name) ||
      metadataText(metadata.adset_name) ||
      metadataText(metadata.form_name) ||
      normalizeEventLabel(event) ||
      'Criativo Meta registrado';

    return (
      <div className="flex justify-end px-2">
        <div className="min-w-0 max-w-[88%] overflow-hidden rounded-[8px] bg-blue-600 text-right text-primary-foreground shadow-none [overflow-wrap:anywhere]">
          {(videoUrl || imageUrl) && (
            <div className="flex max-h-[260px] items-center justify-center bg-[var(--app-surface-soft)]">
              {videoUrl ? (
                <video
                  src={videoUrl}
                  poster={imageUrl || undefined}
                  controls
                  preload="metadata"
                  className="max-h-[260px] w-full bg-[var(--app-surface-soft)] object-contain"
                />
              ) : imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Meta creative URLs are external, signed and not part of Next image config.
                <img
                  src={imageUrl}
                  alt="Criativo Meta"
                  className="max-h-[260px] w-full object-contain"
                />
              ) : null}
            </div>
          )}

          {!videoUrl && !imageUrl && (
            <div className="px-3 pt-2 text-[12px] font-[200] leading-[17px] text-primary-foreground/90 [overflow-wrap:anywhere]">
              {creativeTitle}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 px-3 py-2 text-[10px] font-light leading-none text-primary-foreground/65">
            {linkUrl && (
              <a
                href={linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-[6px] bg-primary-foreground/15 px-2 py-1 text-[10px] font-light text-primary-foreground/85 hover:bg-primary-foreground/20"
              >
                Abrir
              </a>
            )}
            <span>{formatEventTime(event.timestamp)}</span>
          </div>
        </div>
      </div>
    );
  }

  const bubble = (
    <div
      className={cn(
        'min-w-0 rounded-[6px] px-2.5 py-1.5 text-[11px] font-light leading-4 [overflow-wrap:anywhere]',
        alignment === 'center' ? 'text-center' : 'text-right',
        toneClass,
      )}
      title={alignment !== 'center' && event.actor ? `${event.actor.name} fez esta acao` : undefined}
    >
      <div className={cn(isFirstResponse && 'inline-flex items-center justify-end gap-1.5')}>
        {isFirstResponse && <Timer className="h-3 w-3" />}
        <span>{normalizeEventLabel(event)}</span>
      </div>
      {detail && (
        <div className={cn('mt-1 min-w-0 max-w-[15rem] whitespace-pre-wrap text-[11px] font-light normal-case leading-4 [overflow-wrap:anywhere]', isSolidTone ? 'text-primary-foreground/90' : 'opacity-80', alignment === 'center' ? 'text-center' : 'text-right')}>
          {detail}
        </div>
      )}
      <div className={cn('mt-1 flex items-center gap-1 text-[10px] leading-none', isFirstResponse ? 'text-amber-950/65' : isSolidTone ? 'text-primary-foreground/70' : 'text-[var(--app-text-tertiary)]', alignment === 'center' ? 'justify-center' : 'justify-end')}>
        <span>{formatEventTime(event.timestamp)}</span>
        {event.isAutomation && <Bot aria-hidden="true" className="h-3 w-3 shrink-0" />}
      </div>
    </div>
  );

  if (alignment === 'center') {
    return (
      <div className="flex justify-center px-2">
        <div className="min-w-0 max-w-[84%]">{bubble}</div>
      </div>
    );
  }

  return (
    <div className="flex justify-end px-2">
      <div className="flex min-w-0 max-w-[88%] items-end gap-1.5">
        {bubble}
        {!event.isAutomation && <EventActor event={event} />}
      </div>
    </div>
  );
}

function FeedbackBubble({ event, plainHistory }: { event: UnifiedHistoryEvent; plainHistory: boolean }) {
  const actorName = event.actor?.name || 'Equipe';

  return (
    <div className="flex items-end justify-end gap-2 px-2">
      <div className={cn('min-w-0 max-w-[82%] rounded-[8px] px-3 py-2 text-[var(--app-text-primary)] [overflow-wrap:anywhere]', plainHistory ? 'bg-[var(--app-surface-solid)]' : 'bg-primary/12')}>
        <div className="mb-0.5 text-[10px] font-light leading-none text-[var(--app-text-tertiary)]">Feedback</div>
        <div className="whitespace-pre-wrap text-[12px] font-[200] leading-[17px] [overflow-wrap:anywhere]">{event.content}</div>
        <div className="mt-1 text-right text-[10px] font-light leading-none text-[var(--app-text-tertiary)]">{formatEventTime(event.timestamp)}</div>
      </div>
      <Avatar className="h-6 w-6 shrink-0 border-0" title={actorName}>
        <AvatarImage src={event.actor?.avatar_url || undefined} alt={actorName} />
        <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
          {actorName[0]?.toUpperCase() || 'F'}
        </AvatarFallback>
      </Avatar>
    </div>
  );
}

export function LeadUnifiedThread({ leadId, leadName, leadAvatarUrl, leadCreatedAt, historyPagination = false }: LeadUnifiedThreadProps) {
  const [renderWindow, setRenderWindow] = useState({ leadId, count: LEAD_HISTORY_RENDER_PAGE_SIZE });
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const { activeOrganization, profile, user } = useAuth();
  const whatsappScope = useWhatsAppQueryScope();
  const currentUserId = profile?.id || user?.id || null;
  const { hasPermission } = useUserPermissions();
  const { hasModule } = useOrganizationModules();
  const hasWhatsAppModule = hasModule('whatsapp');
  const canViewWhatsApp = hasWhatsAppModule && (hasPermission('whatsapp_view') || hasPermission('whatsapp_operate'));
  const {
    data: history = [],
    isLoading: loadingHistory,
    isFetching: fetchingHistory,
    isError: historyError,
    refetch: refetchHistory,
    hasOlderHistory,
    isFetchingOlderHistory,
    olderHistoryError,
    fetchOlderHistory,
  } = useLeadHistory(leadId, { paginated: historyPagination });
  const audioSenderAvatars = useMemo(() => {
    const avatars = new Map<string, { userId: string; url: string }>();
    for (const event of history) {
      if (event.actor?.id && event.actor.avatar_url) {
        avatars.set(event.actor.id.trim().toLowerCase(), { userId: event.actor.id, url: event.actor.avatar_url });
      }
    }
    return avatars;
  }, [history]);
  // Disabled queries can still return scoped cached data. Keep this passive
  // observer for existing message group/session/JID fallbacks, without loading
  // conversations or sessions to prepare a send.
  const { data: conversations = [] } = useWhatsAppConversations(
    undefined, { hideGroups: true }, [], 80, { enabled: false },
  );
  useWhatsAppLeadRealtime(canViewWhatsApp, [leadId], { reconcileOnSubscribe: false });
  const displayConversation = useMemo(
    () => conversations.find((item) => item.lead_id === leadId || item.lead?.id === leadId) || null,
    [conversations, leadId],
  );

  const {
    data: messages = [],
    isLoading: loadingMessages,
    isError: messagesError,
    error: messagesReadError,
    refetch: refetchMessages,
    hasOlderMessages,
    loadOlderMessages,
    isLoadingOlder,
    isFetchNextPageError: olderMessagesFailed,
  } = useLeadMessages(leadId, { pageSize: 40, enabled: canViewWhatsApp });
  const reactionMessages = useMemo(
    () => messages.filter((message) => message.message_type === 'reaction'),
    [messages],
  );
  const reactionsByMessageId = useMemo(
    () => groupLatestWhatsAppReactions(reactionMessages),
    [reactionMessages],
  );
  const visibleMessages = useMemo(
    () => messages.filter((message) => message.message_type !== 'reaction'),
    [messages],
  );

  const items = useMemo<ThreadItem[]>(() => {
    const renderedMessages = visibleMessages.filter((message) => !isInternalNotificationMessage(message));
    const renderedMessageIds = new Set(renderedMessages.map((message) => message.id));
    const visibleEvents = history.filter((event) => {
      if (!shouldShowEvent(event)) return false;
      if (!['whatsapp_message_queued', 'whatsapp_message_sent', 'whatsapp_message_failed'].includes(event.type)) {
        return true;
      }
      const messageRowId = metadataText(event.metadata?.message_row_id);
      // Keep the timeline fallback when the actual message is not loaded.
      return !messageRowId || !renderedMessageIds.has(messageRowId);
    });
    const hasLeadCreated = visibleEvents.some(
      (e) => e.type === 'lead_created' || /foi criado/i.test(e.label || '')
    );

    const finalEventItems: ThreadItem[] = visibleEvents.map((event) => ({
      id: `event-${event.id}`,
      kind: 'event',
      timestamp: event.timestamp,
      event,
    }));

    // Paged history establishes canonical absence across the snapshot on the server.
    // A creation row outside the loaded suffix must never become a synthetic event.
    if (!historyPagination && !hasLeadCreated && leadCreatedAt) {
      finalEventItems.push({
        id: 'event-synthetic-created',
        kind: 'event',
        timestamp: leadCreatedAt,
        event: {
          id: 'synthetic-created',
          type: 'lead_created',
          label: 'Lead criado',
          timestamp: leadCreatedAt,
          metadata: {},
          actor: null,
          source: 'activity',
        },
      });
    }

    const messageItems: ThreadItem[] = renderedMessages
      .map((message) => ({
        id: `message-${message.id}`,
        kind: 'message',
        timestamp: message.sent_at,
        message,
      }));

    const sorted = sortWhatsAppTimelineItems([...finalEventItems, ...messageItems]
      .filter((item) => item.timestamp));

    const createdIndex = sorted.findIndex(
      (item) =>
        item.kind === 'event' &&
        (item.event.type === 'lead_created' || /foi criado/i.test(item.event.label || ''))
    );

    if (createdIndex > 0) {
      const [createdItem] = sorted.splice(createdIndex, 1);
      sorted.unshift(createdItem);
    }

    return sorted;
  }, [history, visibleMessages, leadCreatedAt, historyPagination]);

  const threadIdentity = JSON.stringify([activeOrganization.organizationId, currentUserId, leadId, canViewWhatsApp]);
  const threadScroll = useWhatsAppThreadScroll(
    JSON.stringify([threadIdentity, whatsappScope.accessScope]), items.at(-1)?.id ?? null,
    threadScrollRef, bottomRef, { firstItemId: items[0]?.id ?? null },
  );
  // Read lifetime includes actor, organization, lead, permissions and Auth SID.
  // A-B-A or unmount must retire old pagination callbacks without send state.
  const audioContextKey = JSON.stringify([threadIdentity, whatsappScope.accessScope]);
  const mediaGallery = useWhatsAppMediaGallery({ messages: visibleMessages.map(message => ({ ...message,
    media_status: toMessageMediaStatus(message.media_status) })), scopeKey: audioContextKey });
  const audioAuthorizationScope = audioContextKey;
  const audioAuthorizationRef = useRef(audioAuthorizationScope);
  const audioAuthorizationGenerationRef = useRef(0);
  useLayoutEffect(() => {
    audioAuthorizationRef.current = audioAuthorizationScope;
    audioAuthorizationGenerationRef.current += 1;
    return () => { audioAuthorizationRef.current = ''; audioAuthorizationGenerationRef.current += 1; };
  }, [audioAuthorizationScope]);

  const handleLoadOlderMessages = async () => {
    const authorizedScope = audioAuthorizationRef.current;
    const generation = audioAuthorizationGenerationRef.current;
    const current = () => audioAuthorizationRef.current === authorizedScope && audioAuthorizationGenerationRef.current === generation;
    try {
      await threadScroll.loadOlderPreservingPosition(async () => {
        const result = await loadOlderMessages();
        if (!current() || result.isError || result.isFetchNextPageError) return;
        setRenderWindow((window) => ({ leadId, count: (window.leadId === leadId ? window.count : LEAD_HISTORY_RENDER_PAGE_SIZE) + 40 }));
      });
    } catch {
      if (!current()) return;
      toast.error('Histórico não carregado', {
        description: 'Não foi possível buscar as mensagens anteriores agora.',
      });
      return;
    }

  };

  const isLoading = leadThreadInitialLoading(items.length, loadingHistory, loadingMessages);
  const visibleCount = renderWindow.leadId === leadId ? renderWindow.count : LEAD_HISTORY_RENDER_PAGE_SIZE;
  const displayed = leadThreadWindow(items, visibleCount);
  const hiddenMessage = canViewWhatsApp && !isWhatsAppAccessUnavailable(messagesReadError) && displayed.hiddenCount > 0
    && !displayed.items.some((item) => item.kind === 'message')
    ? items.findLast((item) => item.kind === 'message')?.message
    : undefined;
  const messageNavigation = useWhatsAppMessageNavigation({
    scopeKey: JSON.stringify([threadIdentity, whatsappScope.accessScope, true]),
    messages: displayed.items.flatMap(item => item.kind === 'message' ? [item.message as WhatsAppMessage] : []),
    logRef: threadScrollRef,
    readPage: canViewWhatsApp ? async (cursor, signal) => {
      if (!whatsappScope.organizationId) return { messages: [], nextCursor: null };
      const page = await whatsappAPI.getHistoryAccess({ leadId, organizationId: whatsappScope.organizationId,
        limit: 40, cursor, signal });
      return { messages: page.messages as WhatsAppMessage[], nextCursor: page.nextCursor };
    } : undefined,
    loadOlder: async () => {
      if (visibleCount < items.length) {
        setRenderWindow({ leadId, count: items.length });
        // Only return messages that this expansion actually renders and can focus.
        const loadedMessages = items.flatMap((item) => item.kind === 'message' ? [item.message] : []);
        return { messages: loadedMessages, hasMore: Boolean(hasOlderMessages) };
      }
      const authorizedScope = audioAuthorizationRef.current;
      const generation = audioAuthorizationGenerationRef.current;
      const result = await loadOlderMessages();
      if (result.isError || result.isFetchNextPageError || audioAuthorizationRef.current !== authorizedScope
        || audioAuthorizationGenerationRef.current !== generation) throw Error('History page unavailable');
      const allMessages = flattenWhatsAppMessagePages(result.data?.pages ?? []);
      setRenderWindow({ leadId, count: allMessages.length + history.length });
      return { messages: allMessages, hasMore: Boolean(result.hasNextPage) };
    },
  });
  const showEarlierItems = () => {
    void threadScroll.loadOlderPreservingPosition(async () => {
      setRenderWindow({ leadId, count: visibleCount + LEAD_HISTORY_RENDER_PAGE_SIZE });
    });
  };
  const loadEarlierHistory = () => {
    const authorizedScope = audioAuthorizationRef.current;
    const generation = audioAuthorizationGenerationRef.current;
    void threadScroll.loadOlderPreservingPosition(async () => {
      if (await fetchOlderHistory() && audioAuthorizationRef.current === authorizedScope && audioAuthorizationGenerationRef.current === generation) {
        setRenderWindow({ leadId, count: visibleCount + LEAD_HISTORY_RENDER_PAGE_SIZE });
      }
    });
  };

  return (
      <section className="lead-thread-panel flex h-full min-h-0 flex-col bg-transparent p-3 [--lead-history-message-bg:var(--app-surface-soft)]"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'none';
          }
        }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}>
      {messageNavigation.error && <p role="status" className="px-3 py-2 text-[length:var(--app-font-size-caption)] font-light text-muted-foreground">{messageNavigation.error}</p>}
      {hiddenMessage && (
        <button type="button" disabled={messageNavigation.navigating}
          onClick={() => void messageNavigation.navigateTo(hiddenMessage.id)}
          className="mb-2 inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs hover:bg-[var(--app-surface-hover)] disabled:opacity-50">
          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
          Ver mensagens do WhatsApp
        </button>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-soft)]">
        <div ref={threadScrollRef} onScroll={threadScroll.onScroll} role="log" aria-label="Histórico de mensagens do lead" aria-live="polite" aria-relevant="additions" aria-atomic={false} className="lead-thread-scroll flex-1 overflow-y-auto px-1 pb-3 pt-3 lead-thread-scroll-readable">
          {isLoading && (
            <div className="flex h-full flex-col items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--app-text-tertiary)]" />
              <span className="text-[11px] text-[var(--app-text-tertiary)]">Carregando histórico e mensagens...</span>
            </div>
          )}

          {!isLoading && (historyError || messagesError) && (
            <div role="alert" className="mx-2 rounded-[8px] bg-destructive/10 px-3 py-2.5 text-[11px] text-destructive">
              <p>
                {historyError && messagesError
                  ? 'Não foi possível carregar o histórico e as mensagens.'
                  : historyError
                    ? 'Não foi possível carregar o histórico de atividades.'
                    : 'Não foi possível carregar as mensagens.'}
              </p>
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11px] hover:bg-destructive/10"
                onClick={() => void Promise.all([
                  ...(historyError ? [refetchHistory()] : []),
                  ...(messagesError ? [refetchMessages()] : []),
                ])}
              >
                <RefreshCw className="h-3 w-3" />
                Tentar novamente
              </button>
            </div>
          )}

          {!isLoading && displayed.hiddenCount > 0 && (
            <div className="flex flex-col items-center justify-center gap-1.5 px-2 pb-1">
              <button type="button" onClick={showEarlierItems} className="h-8 rounded-[6px] bg-[var(--app-surface-solid)] px-3 text-xs">
                Ver eventos anteriores ({displayed.hiddenCount})
              </button>
            </div>
          )}

          {!isLoading && hasOlderHistory && (
            <div className="space-y-2 px-2 pb-1 text-center">
              <p role="status" className="text-xs text-[var(--app-text-secondary)]">Há atividades anteriores ainda não carregadas.</p>
              {olderHistoryError && (
                <p role="alert" className="text-xs text-destructive">
                  Não foi possível carregar as atividades anteriores. Tente novamente ou atualize o histórico.
                </p>
              )}
              <button type="button" disabled={fetchingHistory || isFetchingOlderHistory}
                onClick={loadEarlierHistory}
                className="inline-flex h-8 items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-3 text-xs disabled:opacity-50">
                {isFetchingOlderHistory && <Loader2 className="h-3 w-3 animate-spin" />}
                {isFetchingOlderHistory ? 'Carregando atividades anteriores...' : olderHistoryError ? 'Tentar atividades anteriores novamente' : 'Carregar atividades anteriores'}
              </button>
              {olderHistoryError && <button type="button" onClick={() => void refetchHistory()}
                className="ml-2 h-8 rounded-[6px] bg-[var(--app-surface-solid)] px-3 text-xs">Atualizar histórico</button>}
            </div>
          )}

          {!isLoading && hasOlderMessages && (
            <div className="flex justify-center px-2 pb-1">
              <LoadOlderMessagesButton
                onClick={() => void handleLoadOlderMessages()}
                loading={isLoadingOlder}
                error={olderMessagesFailed}
              />
              {olderMessagesFailed && <p role="alert" className="text-center text-xs text-destructive">Não foi possível carregar mensagens anteriores. O histórico atual foi mantido.</p>}
            </div>
          )}

          {!isLoading && !historyError && !messagesError && items.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center text-[var(--app-text-tertiary)]">
              <MessageCircle className="h-7 w-7" />
              <p className="text-xs">Nenhum evento ou mensagem registrado ainda.</p>
            </div>
          )}

          {!isLoading && displayed.items.map((item, index) => {
            const previous = index > 0 ? displayed.items[index - 1] : null;
            const next = displayed.items[index + 1];
            const grouping = item.kind === 'message' ? getWhatsAppMessageGrouping(
              previous?.kind === 'message' ? previous.message : null, item.message,
              next?.kind === 'message' ? next.message : null,
            ) : 'single';
            const itemDate = safeEventDate(item.timestamp);
            const previousDate = safeEventDate(previous?.timestamp);
            const showDate = Boolean(itemDate && (!previousDate || !isSameDay(previousDate, itemDate)));

            return (
              <div key={item.id} data-thread-item-id={item.id} className={cn('mt-2 first:mt-0', (grouping === 'middle' || grouping === 'last') && '!mt-0.5')}>
                {showDate && itemDate && <DateSeparator date={itemDate} />}
                {item.kind === 'event' ? (
                  isFeedbackEvent(item.event) ? (
                    <FeedbackBubble event={item.event} plainHistory />
                  ) : (
                    <EventBubble event={item.event} plainHistory />
                  )
                ) : (
                  <MessageErrorBoundary messageId={item.message.id}>
                    <WhatsAppMessageBubble
                      grouping={grouping}
                      showSenderName={isWhatsAppMessageBlockStart(grouping)}
                      content={item.message.content}
                      messageType={item.message.message_type || 'text'}
                      mediaUrl={item.message.media_url ?? null}
                      mediaMimeType={item.message.media_mime_type ?? null}
                      mediaFilename={item.message.media_filename ?? null}
                      storedMedia={Boolean(item.message.media_storage_path)}
                      contacts={item.message.contacts}
                      location={item.message.location}
                      quotedMessage={item.message.quoted_message}
                      mediaGallery={mediaGallery}
                      mediaGalleryScopeKey={audioContextKey}
                      onNavigateQuoted={(id) => messageNavigation.navigateTo(id, { conversationId: item.message.conversation_id, sessionId: item.message.session_id })}
                      mediaStatus={toMessageMediaStatus(item.message.media_status)}
                      mediaError={item.message.media_error ?? null}
                      mediaSize={item.message.media_size ?? null}
                      fromMe={item.message.from_me}
                      status={item.message.status || ''}
                      sentAt={item.message.sent_at}
                      deliveryErrorCode={item.message.delivery_error_code ?? null}
                      deliveryErrorReason={item.message.delivery_error_reason}
                      deliveryFailedAt={item.message.delivery_failed_at ?? null}
                      senderName={item.message.sender_name ?? null}
                      senderUserId={item.message.sender_user_id ?? null}
                      viewerUserId={currentUserId}
                      viewerAvatarUrl={profile?.id === user?.id ? profile?.avatar_url ?? null : null}
                      viewerAvatarName={profile?.id === user?.id ? profile?.name ?? null : null}
                      senderAvatarUrl={audioSenderAvatars.get(item.message.sender_user_id?.trim().toLowerCase() || '')?.url ?? null}
                      senderAvatarUserId={audioSenderAvatars.get(item.message.sender_user_id?.trim().toLowerCase() || '')?.userId ?? null}
                      isGroup={displayConversation?.is_group ?? false}
                      messageId={item.message.id}
                      leadId={leadId}
                      canAttachToLead={false}
                      leadName={leadName}
                      contactAvatarUrl={leadAvatarUrl}
                      conversationRemoteJid={item.message.remote_jid ?? displayConversation?.remote_jid ?? null}
                      conversationSessionId={item.message.session_id ?? displayConversation?.session_id ?? null}
                      compact
                      plainHistory
                      leadHistory
                      reactionPickerPosition="outside"
                      reactions={(item.message.message_id
                        ? reactionsByMessageId.get(item.message.message_id)
                        : undefined)
                        || reactionsByMessageId.get(item.message.id)
                        || []}
                    />
                  </MessageErrorBoundary>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {threadScroll.showScrollToLatest && <ScrollToLatestButton onClick={threadScroll.scrollToLatest} />}

      </div>
      </section>
  );
}
