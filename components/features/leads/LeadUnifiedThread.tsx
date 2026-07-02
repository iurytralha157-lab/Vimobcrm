import { useEffect, useMemo, useRef, useState } from 'react';
import { format, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Bot, Loader2, MessageCircle, Mic, Paperclip } from 'lucide-react';
import { MessageBox } from '@/components/ui/message-box';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useLeadHistory, type UnifiedHistoryEvent } from '@/hooks/use-lead-history';
import {
  useSendWhatsAppMessage,
  useWhatsAppConversations,
  useWhatsAppMessages,
  type WhatsAppConversation,
  type WhatsAppMessage,
} from '@/hooks/use-whatsapp-conversations';
import { useWhatsAppSessions } from '@/hooks/use-whatsapp-sessions';
import { useStartConversation } from '@/hooks/use-start-conversation';

type LeadUnifiedThreadProps = {
  leadId: string;
  leadName: string;
  leadAvatarUrl?: string | null;
  leadPhone?: string | null;
  whatsappVerified?: boolean | null;
  leadCreatedAt?: string | null;
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
      message: WhatsAppMessage;
    };

function getAttachmentFileName(event: UnifiedHistoryEvent) {
  const metadata = event.metadata || {};
  const metadataName =
    metadata.file_name ||
    metadata.fileName ||
    metadata.filename ||
    metadata.attachment_name ||
    metadata.document_name;

  if (metadataName) return String(metadataName);

  const text = `${event.label || ''} ${event.content || ''}`;
  const match = text.match(/(?:documento|arquivo)\s+anexad[oa]:?\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

const OUTCOME_LABELS: Record<string, string> = {
  answered: 'Atendeu',
  not_answered: 'Nao atendeu',
  invalid_number: 'Numero invalido',
  busy: 'Linha ocupada',
  scheduled: 'Agendou retorno',
  replied: 'Respondeu',
  seen_no_reply: 'Visualizou e nao respondeu',
  not_seen: 'Nao visualizou',
  no_whatsapp: 'Lead sem WhatsApp',
  not_replied: 'Nao respondeu',
  bounced: 'E-mail invalido',
  done: 'Concluido',
};

function metadataText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (value === null || value === undefined || value === false) return null;
  return String(value);
}

function getOutcomeLabel(event: UnifiedHistoryEvent) {
  const outcome = metadataText(event.metadata?.outcome);
  if (!outcome) return null;
  return OUTCOME_LABELS[outcome] || outcome;
}

function getOutcomeVariant(event: UnifiedHistoryEvent): 'success' | 'warning' | 'error' | 'default' {
  const outcome = metadataText(event.metadata?.outcome);
  if (!outcome) return 'default';
  if (['answered', 'replied', 'scheduled', 'done'].includes(outcome)) return 'success';
  if (['invalid_number', 'no_whatsapp', 'bounced'].includes(outcome)) return 'error';
  if (['not_answered', 'busy', 'seen_no_reply', 'not_seen', 'not_replied'].includes(outcome)) return 'warning';
  return 'default';
}

function getOutcomeActionLabel(event: UnifiedHistoryEvent) {
  const outcomeLabel = getOutcomeLabel(event);
  if (!outcomeLabel) return null;

  const channel = String(event.metadata?.channel || event.channel || '').toLowerCase();
  if (event.type === 'call' || channel === 'call' || channel === 'phone') return `Ligacao: ${outcomeLabel}`;
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
  const metadata = event.metadata || {};
  const toStatus = String(metadata.to_status || '').toLowerCase();
  const isLostStatusEvent =
    (event.type === 'status_change' && toStatus === 'lost') ||
    /marcado como perdido/i.test(`${event.label || ''} ${event.content || ''}`);
  if (isLostStatusEvent) {
    const lostReason = getLostReason(event);
    return lostReason ? `Motivo: ${lostReason}` : null;
  }

  const notes =
    metadataText(metadata.notes) ||
    metadataText(metadata.outcome_notes) ||
    metadataText(metadata.outcomeNotes) ||
    metadataText(metadata.feedback) ||
    metadataText(metadata.comment);

  const outcomeLabel = getOutcomeLabel(event);
  const channel = String(event.metadata?.channel || event.channel || '').toLowerCase();
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
  const label = (event.label || '').replace(/^Lead\s+"[^"]+"\s+/i, 'Lead ').trim();
  const content = event.content?.trim();
  const metadata = event.metadata || {};
  const searchable = `${label} ${content || ''}`;

  if (isAttachmentEvent(event)) {
    const fileName = getAttachmentFileName(event);
    return fileName ? `Documento anexado: ${fileName}` : 'Documento anexado';
  }

  if (event.type === 'first_response') {
    return content || label || 'Primeiro contato';
  }

  const outcomeLabel = getOutcomeLabel(event);
  const channel = String(event.metadata?.channel || event.channel || '').toLowerCase();
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

    if (!taskName && label && !/tarefa concluida|ligacao realizada|email enviado|mensagem enviada/i.test(label)) {
      taskName = label;
    }

    return taskName ? `${typePrefix}: ${taskName}` : `${typePrefix}: ${outcomeLabel}`;
  }

  const outcomeActionLabel = getOutcomeActionLabel(event);
  if (outcomeActionLabel) return outcomeActionLabel;

  if (event.type === 'lead_created' || /foi criado/i.test(label)) {
    const source = String(metadata.source_label || metadata.source || event.sourceOrigin || '').trim();
    return source && !/manual/i.test(source) ? `Lead criado via ${source}` : 'Lead criado';
  }

  if (event.type === 'tag_added') {
    return metadata.tag_name ? `Tag adicionada: ${metadata.tag_name}` : 'Tag adicionada';
  }

  if (event.type === 'tag_removed') {
    return metadata.tag_name ? `Tag removida: ${metadata.tag_name}` : 'Tag removida';
  }

  if (event.type === 'status_change') {
    const toStatus = String(metadata.to_status || '').toLowerCase();
    if (toStatus === 'won') return 'Lead marcado como ganho';
    if (toStatus === 'lost') return 'Lead marcado como perdido';
    if (toStatus === 'open') return 'Lead reaberto';
  }

  if (event.type === 'lead_reentry') return 'Lead reentrou';
  if (/movido/i.test(label) || event.type === 'stage_changed' || event.type === 'stage_change') {
    const from = String(metadata.old_stage_name || metadata.from_stage || '').trim();
    const to = String(metadata.new_stage_name || metadata.to_stage || '').trim();
    const isInitial = !from || from.toLowerCase() === 'desconhecido' || from.toLowerCase() === 'unknown';
    if (!isInitial && from && to) {
      return `Etapa: ${from} ➔ ${to}`;
    }
    if (to) {
      return `Iniciado no estágio ${to}`;
    }
    return 'Etapa alterada';
  }
  if (/marcado como ganho|venda conclu/i.test(searchable)) return 'Lead marcado como ganho';
  if (/marcado como perdido|perdido/i.test(searchable)) return 'Lead marcado como perdido';
  if (/reaberto/i.test(searchable)) return 'Lead reaberto';

  return content && content.length <= 72 ? content : label;
}

function eventSearchText(event: UnifiedHistoryEvent) {
  return `${event.type || ''} ${event.label || ''} ${event.content || ''}`.toLowerCase();
}

function shouldShowEvent(event: UnifiedHistoryEvent) {
  const text = eventSearchText(event);
  if (event.type === 'lead_assigned' && text.includes('registro sem fila')) return false;
  if (text.includes('sem fila de distribui')) return false;
  if (text.includes('fila "') && text.includes('sem distribui')) return false;
  return true;
}

function isWonStatusEvent(event: UnifiedHistoryEvent) {
  const toStatus = String(event.metadata?.to_status || '').toLowerCase();
  return toStatus === 'won' || /marcado como ganho/i.test(`${event.label || ''} ${event.content || ''}`);
}

function isSaleConclusionEvent(event: UnifiedHistoryEvent) {
  return /venda conclu/i.test(`${event.label || ''} ${event.content || ''}`);
}

function isNearbyEvent(event: UnifiedHistoryEvent, candidate: UnifiedHistoryEvent) {
  const eventTime = new Date(event.timestamp).getTime();
  const candidateTime = new Date(candidate.timestamp).getTime();
  if (!Number.isFinite(eventTime) || !Number.isFinite(candidateTime)) return false;
  return Math.abs(eventTime - candidateTime) <= 5 * 60 * 1000;
}

function removeRedundantEvents(events: UnifiedHistoryEvent[]) {
  return events.filter((event) => {
    if (!isSaleConclusionEvent(event)) return true;
    return !events.some((candidate) => candidate.id !== event.id && isWonStatusEvent(candidate) && isNearbyEvent(event, candidate));
  });
}

function isFeedbackEvent(event: UnifiedHistoryEvent) {
  const kind = String(event.metadata?.kind || event.metadata?.event_kind || '').toLowerCase();
  if (kind === 'feedback') return Boolean(event.content?.trim());
  return (event.type === 'note' || event.type === 'note_created') && Boolean(event.content?.trim()) && !isAttachmentEvent(event);
}

function getEventTone(event: UnifiedHistoryEvent) {
  const text = `${event.type} ${event.label} ${event.content || ''}`.toLowerCase();
  const toStatus = String(event.metadata?.to_status || '').toLowerCase();

  if (event.type === 'lead_created' || text.includes('foi criado')) {
    return 'bg-green-600 !text-white ring-1 ring-green-700';
  }

  if (event.type === 'first_response') {
    return 'bg-sky-500/10 !text-sky-700 ring-1 ring-sky-500/20 dark:bg-sky-500/15 dark:!text-sky-300 dark:ring-sky-500/25';
  }

  if (event.type === 'task_completed') {
    return 'bg-[var(--app-surface-soft)] !text-[var(--app-text-secondary)] ring-1 ring-[var(--app-border)]';
  }

  if (toStatus === 'lost' || text.includes('perdido') || text.includes('perda')) {
    return 'bg-red-600 !text-white ring-1 ring-red-700';
  }

  if (toStatus === 'won' || text.includes('ganho') || text.includes('venda conclu')) {
    return 'bg-emerald-600 !text-white ring-1 ring-emerald-700';
  }

  const outcomeVariant = getOutcomeVariant(event);
  if (outcomeVariant === 'success') return 'bg-emerald-600 !text-white ring-1 ring-emerald-700';
  if (outcomeVariant === 'warning') return 'bg-amber-600 !text-white ring-1 ring-amber-700';
  if (outcomeVariant === 'error') return 'bg-red-600 !text-white ring-1 ring-red-700';

  if (event.type === 'stage_changed' || event.type === 'stage_change') {
    return 'bg-[var(--app-surface-soft)] !text-[var(--app-text-secondary)]';
  }

  if (event.type.includes('tag')) {
    return 'bg-primary/12 !text-primary ring-1 ring-primary/16';
  }

  return 'bg-[var(--app-surface-soft)] !text-[var(--app-text-secondary)]';
}

function messagePreview(message: WhatsAppMessage) {
  if (message.content?.trim()) return message.content;
  if (message.message_type && message.message_type !== 'text') return `Mensagem ${message.message_type}`;
  return 'Mensagem';
}

function DatePill({ date }: { date: Date }) {
  return (
    <div className="my-2 flex justify-center">
      <span className="rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] font-medium text-[var(--app-text-tertiary)]">
        {isSameDay(date, new Date()) ? 'Hoje' : format(date, "dd/MM/yyyy", { locale: ptBR })}
      </span>
    </div>
  );
}

function EventActor({ event }: { event: UnifiedHistoryEvent }) {
  if (!event.actor) return null;

  return (
    <Avatar className="h-5 w-5 shrink-0 border-0" title={event.actor.name}>
      <AvatarImage src={event.actor.avatar_url || undefined} />
      <AvatarFallback className="bg-[var(--app-surface-soft)] text-[9px] text-[var(--app-text-secondary)]">
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

function EventBubble({ event }: { event: UnifiedHistoryEvent }) {
  const alignment = getEventAlignment(event);
  const detail = getEventDetail(event);
  const toneClass = getEventTone(event);
  const isSolidTone = toneClass.includes('!text-white');

  const bubble = (
    <div
      className={cn(
        'rounded-[6px] px-3 py-1.5 text-[10px]',
        alignment === 'center' ? 'text-center' : 'text-right',
        toneClass,
      )}
      title={alignment !== 'center' && event.actor ? `${event.actor.name} fez esta acao` : undefined}
    >
      <div className="uppercase tracking-wide">
        <span>{normalizeEventLabel(event)}</span>
        <span className={cn('ml-2', isSolidTone ? 'text-white/70' : 'text-[var(--app-text-tertiary)]')}>
          {format(new Date(event.timestamp), 'HH:mm', { locale: ptBR })}
        </span>
        {event.isAutomation && <Bot className="ml-1 inline h-3 w-3 align-[-2px]" />}
      </div>
      {detail && (
        <div className={cn('mt-1 max-w-[15rem] whitespace-pre-wrap break-words text-[11px] normal-case leading-snug', isSolidTone ? 'text-white/90' : 'opacity-80', alignment === 'center' ? 'text-center' : 'text-right')}>
          {detail}
        </div>
      )}
    </div>
  );

  if (alignment === 'center') {
    return (
      <div className="flex justify-center px-2">
        <div className="max-w-[84%]">{bubble}</div>
      </div>
    );
  }

  return (
    <div className="flex justify-end px-2">
      <div className="flex max-w-[88%] items-end gap-1.5">
        {bubble}
        <EventActor event={event} />
      </div>
    </div>
  );
}

function FeedbackBubble({ event }: { event: UnifiedHistoryEvent }) {
  const actorName = event.actor?.name || 'Equipe';

  return (
    <div className="flex items-end justify-end gap-2 px-2">
      <div className="max-w-[82%] rounded-[8px] bg-primary/12 px-3 py-2 text-xs leading-relaxed text-[var(--app-text-primary)] ring-1 ring-primary/14">
        <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-medium text-[var(--app-text-tertiary)]">
          <span>Feedback</span>
          <span>{format(new Date(event.timestamp), 'HH:mm', { locale: ptBR })}</span>
        </div>
        <div className="whitespace-pre-wrap break-words">{event.content}</div>
      </div>
      <Avatar className="h-6 w-6 shrink-0 border-0" title={actorName}>
        <AvatarImage src={event.actor?.avatar_url || undefined} />
        <AvatarFallback className="bg-[var(--app-surface)] text-[10px] text-[var(--app-text-secondary)]">
          {actorName[0]?.toUpperCase() || 'F'}
        </AvatarFallback>
      </Avatar>
    </div>
  );
}

function MessageBubble({
  message,
  leadName,
  leadAvatarUrl,
}: {
  message: WhatsAppMessage;
  leadName: string;
  leadAvatarUrl?: string | null;
}) {
  const fromMe = message.from_me;
  const label = fromMe ? (message.sender_name || 'Equipe') : leadName;

  return (
    <div className={cn('flex items-end gap-2 px-2', fromMe ? 'justify-end' : 'justify-start')}>
      {!fromMe && (
        <Avatar className="h-6 w-6 shrink-0 border-0">
          <AvatarImage src={leadAvatarUrl || undefined} />
          <AvatarFallback className="bg-primary text-[10px] text-white">
            {leadName?.[0]?.toUpperCase() || '?'}
          </AvatarFallback>
        </Avatar>
      )}
      <div
        className={cn(
          'max-w-[78%] rounded-[8px] px-3 py-2 text-xs leading-relaxed',
          fromMe
            ? 'bg-primary text-white'
            : 'bg-[var(--app-surface-soft)] text-[var(--app-text-primary)]',
        )}
      >
        <div className={cn('mb-1 text-[10px] font-medium', fromMe ? 'text-white/72' : 'text-[var(--app-text-tertiary)]')}>
          {label}
        </div>
        <div className="whitespace-pre-wrap break-words">{messagePreview(message)}</div>
        <div className={cn('mt-1 text-right text-[9px]', fromMe ? 'text-white/66' : 'text-[var(--app-text-tertiary)]')}>
          {format(new Date(message.sent_at), 'HH:mm', { locale: ptBR })}
          {fromMe && message.status ? ` - ${message.status}` : ''}
        </div>
      </div>
      {fromMe && (
        <Avatar className="h-6 w-6 shrink-0 border-0">
          <AvatarFallback className="bg-[var(--app-surface-soft)] text-[10px] text-[var(--app-text-secondary)]">
            V
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}

export function LeadUnifiedThread({ leadId, leadName, leadAvatarUrl, leadPhone, whatsappVerified, leadCreatedAt }: LeadUnifiedThreadProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const { data: history = [], isLoading: loadingHistory } = useLeadHistory(leadId);
  const { data: conversations = [] } = useWhatsAppConversations(undefined, { hideGroups: true });
  const { data: sessions = [] } = useWhatsAppSessions();

  const conversation = useMemo<WhatsAppConversation | null>(() => {
    return conversations.find((item) => item.lead_id === leadId || item.lead?.id === leadId) || null;
  }, [conversations, leadId]);

  const { data: messages = [], isLoading: loadingMessages } = useWhatsAppMessages(conversation?.id ?? null, leadId, 80);
  const sendMessage = useSendWhatsAppMessage();
  const startConversation = useStartConversation();

  const hasLeadPhone = Boolean(leadPhone?.replace(/\D/g, ''));
  const leadHasNoWhatsApp = whatsappVerified === false;
  const embeddedSessionConnected = conversation?.session?.status === 'connected' || conversation?.session?.status === 'connecting';
  const hasConnectedSession = embeddedSessionConnected || sessions.some((session) => session.status === 'connected' || session.status === 'connecting');
  const linkedSession = conversation ? sessions.find((session) => session.id === conversation.session_id) : null;
  const conversationSessionStatus = conversation?.session?.status || linkedSession?.status || null;
  const conversationSessionConnected = conversation
    ? conversationSessionStatus === 'connected' || conversationSessionStatus === 'connecting' || (!conversationSessionStatus && hasConnectedSession)
    : false;
  const canSendMessage = Boolean(
    hasLeadPhone &&
      !leadHasNoWhatsApp &&
      hasConnectedSession &&
      (!conversation || conversationSessionConnected),
  );
  const isSendingMessage = sendMessage.isPending || startConversation.isPending;
  const inputPlaceholder = !hasLeadPhone
    ? 'Lead sem telefone cadastrado'
    : leadHasNoWhatsApp
      ? 'Este lead nao tem WhatsApp'
      : !hasConnectedSession
        ? 'Conecte uma conta de WhatsApp para enviar'
        : !conversation
          ? 'Digite para iniciar a conversa com este lead'
          : !conversationSessionConnected
            ? 'A conexao deste WhatsApp esta desconectada'
            : 'Digite sua mensagem...';

  const items = useMemo<ThreadItem[]>(() => {
    const visibleEvents = removeRedundantEvents(history.filter(shouldShowEvent));
    const hasLeadCreated = visibleEvents.some(
      (e) => e.type === 'lead_created' || /foi criado/i.test(e.label || '')
    );

    const finalEventItems: ThreadItem[] = visibleEvents.map((event) => ({
      id: `event-${event.id}`,
      kind: 'event',
      timestamp: event.timestamp,
      event,
    }));

    if (!hasLeadCreated && leadCreatedAt) {
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

    const messageItems: ThreadItem[] = messages.map((message) => ({
      id: `message-${message.id}`,
      kind: 'message',
      timestamp: message.sent_at,
      message,
    }));

    const sorted = [...finalEventItems, ...messageItems]
      .filter((item) => item.timestamp)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

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
  }, [history, messages, leadCreatedAt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [items.length]);

  const handleSend = async () => {
    const content = text.trim();
    if (!content || !canSendMessage || isSendingMessage) return;

    setText('');
    try {
      const targetConversation =
        conversation ||
        (await startConversation.mutateAsync({
          phone: leadPhone || '',
          leadId,
          leadName,
        }));

      await sendMessage.mutateAsync({ conversation: targetConversation, text: content });
    } catch {
      setText(content);
    }
  };

  const isLoading = loadingHistory || loadingMessages;

  return (
    <section className="lead-thread-panel flex h-full min-h-0 flex-col bg-transparent p-3">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-soft)]">
        <div className="lead-thread-scroll flex-1 space-y-3 overflow-y-auto px-1 pb-3 pt-3">
          {isLoading && (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--app-text-tertiary)]" />
            </div>
          )}

          {!isLoading && items.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center text-[var(--app-text-tertiary)]">
              <MessageCircle className="h-7 w-7" />
              <p className="text-xs">Nenhum evento ou mensagem registrado ainda.</p>
            </div>
          )}

          {!isLoading && items.map((item, index) => {
            const previous = index > 0 ? items[index - 1] : null;
            const showDate = !previous || !isSameDay(new Date(previous.timestamp), new Date(item.timestamp));

            return (
              <div key={item.id} className="space-y-3">
                {showDate && <DatePill date={new Date(item.timestamp)} />}
                {item.kind === 'event' ? (
                  isFeedbackEvent(item.event) ? (
                    <FeedbackBubble event={item.event} />
                  ) : (
                    <EventBubble event={item.event} />
                  )
                ) : (
                  <MessageBubble message={item.message} leadName={leadName} leadAvatarUrl={leadAvatarUrl} />
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-[var(--app-border)] bg-[var(--app-surface-solid)] p-3">
          <MessageBox
            value={text}
            onChange={setText}
            onSend={handleSend}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder={inputPlaceholder}
            disabled={!canSendMessage || isSendingMessage}
            isSending={isSendingMessage}
            multiline
            inputRef={textareaRef}
            compact
            showRightActionsWhenEmpty
            className="bg-[var(--app-surface-soft)] focus-within:bg-[var(--app-surface-hover)] dark:bg-[#242424] dark:focus-within:bg-[#292929]"
            leftActions={
              <button type="button" disabled title="Anexar midia">
                <Paperclip className="h-4 w-4" />
              </button>
            }
            rightActions={
              <button type="button" disabled title="Audio">
                <Mic className="h-4 w-4" />
              </button>
            }
          />
        </div>
      </div>
    </section>
  );
}
