import { useEffect, useMemo, useRef, useState } from 'react';
import { format, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Bot, Loader2, MessageCircle, Paperclip, Timer } from 'lucide-react';
import { MessageBox } from '@/components/ui/message-box';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MessageBubble as WhatsAppMessageBubble } from '@/components/features/whatsapp/MessageBubble';
import { MessageErrorBoundary } from '@/components/features/whatsapp/MessageErrorBoundary';
import { AudioRecorderButton } from '@/components/features/whatsapp/AudioRecorderButton';
import { cn } from '@/lib/utils';
import { useLeadHistory, type UnifiedHistoryEvent } from '@/hooks/use-lead-history';
import { useAccessibleSessions } from '@/hooks/use-accessible-sessions';
import {
  useSendWhatsAppMessage,
  useReactToWhatsAppMessage,
  useWhatsAppConversations,
  useWhatsAppRealtimeConversations,
  type WhatsAppConversation,
  type WhatsAppMessage,
} from '@/hooks/use-whatsapp-conversations';
import { useLeadMessages } from '@/hooks/use-lead-messages';
import { useStartConversation } from '@/hooks/use-start-conversation';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { toast } from 'sonner';
import { whatsappAPI } from '@/lib/api/whatsapp';
import { getWhatsAppMessageInputState } from '@/lib/whatsapp-message-input';
import { groupLatestWhatsAppReactions } from '@/lib/whatsapp-reactions';

const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_QUALITY = 0.82;

type LeadUnifiedThreadProps = {
  leadId: string;
  leadName: string;
  leadAvatarUrl?: string | null;
  leadPhone?: string | null;
  whatsappVerified?: boolean | null;
  leadCreatedAt?: string | null;
  composerRequest?: { id: number; text?: string } | null;
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

const mimeExtension = (mimetype: string, fallback = 'bin') => {
  const clean = mimetype.split(';')[0].toLowerCase();
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'audio/mpeg': 'mp3',
    'video/mp4': 'mp4',
    'application/pdf': 'pdf',
  };
  return map[clean] || fallback;
};

const fileToBase64 = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = reject;
    });
    image.src = imageUrl;
    await loaded;

    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height));
    if (scale >= 1 && file.size < 900_000) return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const targetType = file.type === 'image/png' ? 'image/webp' : file.type;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, targetType, IMAGE_QUALITY));
    if (!blob || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'imagem';
    return new File([blob], `${baseName}.${mimeExtension(targetType, 'webp')}`, { type: targetType });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

const getMediaTypeFromFile = (file: File) => {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'document';
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

  if (metadataName) return String(metadataName);

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

function isInternalNotificationMessage(message: WhatsAppMessage) {
  const metadata = (message.metadata || {}) as Record<string, unknown>;
  const notificationType = String(metadata.notification_type || metadata.notificationType || '').toLowerCase();

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
  if (event.type === 'meta_form_answer' || event.type === 'webhook_form_answer') {
    return metadataText(metadata.answer) || event.content || null;
  }
  if (event.type === 'lead_updated') {
    return event.content?.trim() || null;
  }

  const toStatus = String(metadata.to_status || '').toLowerCase();
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
    const rawPrice = Number(metadata.property_price);
    const price = Number.isFinite(rawPrice) && rawPrice > 0 ? `R$ ${rawPrice.toLocaleString('pt-BR')}` : null;
    return [title, code, price].filter(Boolean).join('\n') || null;
  }

  if (
    event.type === 'agenda_created' ||
    event.type === 'agenda_rescheduled' ||
    event.type === 'agenda_completed' ||
    event.type === 'agenda_cancelled' ||
    event.type === 'visit_scheduled' ||
    event.type === 'visit_confirmed' ||
    event.type === 'meeting_scheduled' ||
    event.type === 'meeting_held'
  ) {
    const title = metadataText(metadata.title) || metadataText(metadata.event_title);
    const startsAt =
      metadataText(metadata.starts_at) ||
      metadataText(metadata.start_at) ||
      metadataText(metadata.start_time) ||
      metadataText(metadata.scheduled_at);
    return [title, startsAt].filter(Boolean).join('\n') || null;
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

  if (event.type === 'lead_updated') {
    return 'Dados do lead atualizados';
  }

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

  if (event.type === 'agenda_created') return 'Atividade agendada';
  if (event.type === 'agenda_rescheduled') return 'Atividade remarcada';
  if (event.type === 'agenda_completed') return 'Atividade concluída';
  if (event.type === 'agenda_cancelled') return 'Atividade cancelada';
  if (event.type === 'visit_scheduled') return 'Visita agendada';
  if (event.type === 'visit_confirmed') return 'Visita realizada';
  if (event.type === 'meeting_scheduled') return 'Reunião agendada';
  if (event.type === 'meeting_held') return 'Reunião realizada';

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

    if (!taskName && label && !/tarefa concluida|tarefa concluída|ligacao realizada|ligação realizada|email enviado|mensagem enviada/i.test(label)) {
      taskName = label;
    }

    return taskName ? `${typePrefix}: ${taskName}` : `${typePrefix}: ${outcomeLabel}`;
  }

  const outcomeActionLabel = getOutcomeActionLabel(event);
  if (outcomeActionLabel) return outcomeActionLabel;

  if (event.type === 'lead_created' || /foi criado/i.test(label)) {
    let source = String(metadata.source_label || metadata.source || event.sourceOrigin || '').trim();
    if (source === 'generic_webhook') source = 'Webhook';
    return source && !/manual/i.test(source) ? `Lead criado via ${source}` : 'Lead criado';
  }

  if (event.type === 'tag_added') {
    return metadata.tag_name ? `Tag adicionada: ${metadata.tag_name}` : 'Tag adicionada';
  }

  if (event.type === 'tag_removed') {
    return metadata.tag_name ? `Tag removida: ${metadata.tag_name}` : 'Tag removida';
  }

  if (event.type === 'status_change') {
    const toStatus = String(metadata.to_status || metadata.new_status || '').toLowerCase();
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
      return `Etapa: ${from} -> ${to}`;
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

function isWonStatusEvent(event: UnifiedHistoryEvent) {
  const toStatus = String(event.metadata?.to_status || event.metadata?.new_status || '').toLowerCase();
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
  const toStatus = String(event.metadata?.to_status || event.metadata?.new_status || '').toLowerCase();

  if (event.type === 'lead_created' || text.includes('foi criado')) {
    return 'bg-green-600 !text-white';
  }

  if (event.type === 'first_response') {
    return 'bg-amber-400 !text-amber-950';
  }

  if (event.type === 'task_completed') {
    return 'bg-[var(--app-surface-soft)] !text-[var(--app-text-secondary)]';
  }

  if (event.type === 'meta_form_answer') {
    return 'bg-[#1877F2] !text-white';
  }

  if (event.type === 'webhook_form_answer') {
    return 'bg-[#FF4529] !text-white';
  }

  if (event.type === 'property_selected' || event.type === 'property_linked') {
    return 'bg-[color-mix(in_srgb,#FF4529_14%,var(--app-surface-solid))] !text-[color-mix(in_srgb,#FF4529_72%,var(--app-text-primary))]';
  }

  if (
    event.type === 'agenda_created' ||
    event.type === 'agenda_rescheduled' ||
    event.type === 'visit_scheduled' ||
    event.type === 'visit_confirmed' ||
    event.type === 'meeting_scheduled' ||
    event.type === 'meeting_held'
  ) {
    return 'bg-[color-mix(in_srgb,#3b82f6_14%,var(--app-surface-solid))] !text-[color-mix(in_srgb,#3b82f6_72%,var(--app-text-primary))]';
  }

  if (event.type === 'proposal_sent') {
    return 'bg-[color-mix(in_srgb,#f59e0b_16%,var(--app-surface-solid))] !text-[color-mix(in_srgb,#f59e0b_72%,var(--app-text-primary))]';
  }

  if (toStatus === 'won') {
    return 'bg-emerald-600 !text-white';
  }

  if (toStatus === 'lost') {
    return 'bg-red-600 !text-white';
  }

  if (toStatus === 'open') {
    return 'bg-[color-mix(in_srgb,#f59e0b_16%,var(--app-surface-solid))] !text-[color-mix(in_srgb,#f59e0b_72%,var(--app-text-primary))]';
  }

  if (text.includes('ganho') || text.includes('venda conclu')) {
    return 'bg-emerald-600 !text-white';
  }

  if (text.includes('perdido') || text.includes('perda')) {
    return 'bg-red-600 !text-white';
  }

  if (text.includes('reaberto')) {
    return 'bg-[color-mix(in_srgb,#f59e0b_16%,var(--app-surface-solid))] !text-[color-mix(in_srgb,#f59e0b_72%,var(--app-text-primary))]';
  }

  const outcomeVariant = getOutcomeVariant(event);
  if (outcomeVariant === 'success') return 'bg-emerald-600 !text-white';
  if (outcomeVariant === 'warning') return 'bg-amber-600 !text-white';
  if (outcomeVariant === 'error') return 'bg-red-600 !text-white';

  if (event.type === 'stage_changed' || event.type === 'stage_change') {
    return 'bg-[var(--app-surface-soft)] !text-[var(--app-text-secondary)]';
  }

  if (event.type.includes('tag')) {
    return 'bg-primary/12 !text-primary';
  }

  return 'bg-[var(--app-surface-soft)] !text-[var(--app-text-secondary)]';
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
      <AvatarFallback className="bg-[#FF4529] text-[9px] text-white">
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
  const isFirstResponse = event.type === 'first_response';

  if (event.type === 'meta_form_answer' || event.type === 'webhook_form_answer') {
    const metadata = event.metadata || {};
    const isWebhookAnswer = event.type === 'webhook_form_answer';
    const question = metadataText(metadata.question) || normalizeEventLabel(event).replace(isWebhookAnswer ? /^Webhook:\s*/i : /^Meta:\s*/i, '');
    const answer = detail || event.content || '';

    return (
      <div className="flex justify-end px-2">
        <div className={cn(
          "min-w-0 max-w-[88%] overflow-hidden rounded-[8px] px-3 py-2 text-right text-white shadow-sm",
          isWebhookAnswer ? "bg-[#FF4529]" : "bg-[#1877F2]",
        )}>
          <div className="text-[9px] font-medium uppercase tracking-wide text-white/70">
            {isWebhookAnswer ? 'Webhook' : 'Meta Lead Ads'}
          </div>
          <div className="mt-0.5 break-words text-[10px] font-medium uppercase leading-snug text-white/90">
            {question}
          </div>
          {answer && (
            <div className="mt-2 max-w-full overflow-hidden rounded-[6px] bg-white/[0.16] px-2.5 py-1.5 text-[11px] font-semibold leading-snug text-white [overflow-wrap:anywhere]">
              {answer}
            </div>
          )}
          <div className="mt-1.5 text-[9px] text-white/65">
            {format(new Date(event.timestamp), 'HH:mm', { locale: ptBR })}
          </div>
        </div>
      </div>
    );
  }

  if (event.type === 'meta_creative') {
    const metadata = event.metadata || {};
    const imageUrl = metadataText(metadata.creative_url);
    const videoUrl = metadataText(metadata.creative_video_url);
    const linkUrl =
      metadataText(metadata.creative_link_url) ||
      metadataText(metadata.creative_destination_url) ||
      metadataText(metadata.creative_instagram_url);

    return (
      <div className="flex justify-end px-2">
        <div className="max-w-[88%] overflow-hidden rounded-[8px] bg-[#1877F2] text-right text-white shadow-sm">
          {(videoUrl || imageUrl) && (
            <div className="flex max-h-[260px] items-center justify-center bg-black/15">
              {videoUrl ? (
                <video
                  src={videoUrl}
                  poster={imageUrl || undefined}
                  controls
                  preload="metadata"
                  className="max-h-[260px] w-full bg-black object-contain"
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

          <div className="flex items-center justify-end gap-2 px-3 py-2 text-[9px] text-white/65">
            {linkUrl && (
              <a
                href={linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-[5px] bg-white/15 px-2 py-1 text-[9px] font-medium text-white/85 hover:bg-white/20"
              >
                Abrir
              </a>
            )}
            <span>{format(new Date(event.timestamp), 'HH:mm', { locale: ptBR })}</span>
          </div>
        </div>
      </div>
    );
  }

  const bubble = (
    <div
      className={cn(
        'rounded-[6px] px-3 py-1.5 text-[10px]',
        alignment === 'center' ? 'text-center' : 'text-right',
        toneClass,
      )}
      title={alignment !== 'center' && event.actor ? `${event.actor.name} fez esta acao` : undefined}
    >
      <div className={cn('uppercase tracking-wide', isFirstResponse && 'inline-flex items-center justify-end gap-1.5')}>
        {isFirstResponse && <Timer className="h-3 w-3" />}
        <span>{normalizeEventLabel(event)}</span>
        <span className={cn('ml-2', isFirstResponse ? 'text-amber-950/65' : isSolidTone ? 'text-white/70' : 'text-[var(--app-text-tertiary)]')}>
          {format(new Date(event.timestamp), 'HH:mm', { locale: ptBR })}
        </span>
        {event.isAutomation && <Bot className="ml-1 inline h-3 w-3 align-[-2px]" />}
      </div>
      {detail && (
        <div className={cn('mt-1 max-w-[15rem] whitespace-pre-wrap break-words text-[10px] normal-case leading-snug', isSolidTone ? 'text-white/90' : 'opacity-80', alignment === 'center' ? 'text-center' : 'text-right')}>
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
      <div className="max-w-[82%] rounded-[8px] bg-primary/12 px-3 py-2 text-[11px] leading-relaxed text-[var(--app-text-primary)]">
        <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-medium text-[var(--app-text-tertiary)]">
          <span>Feedback</span>
          <span>{format(new Date(event.timestamp), 'HH:mm', { locale: ptBR })}</span>
        </div>
        <div className="whitespace-pre-wrap break-words">{event.content}</div>
      </div>
      <Avatar className="h-6 w-6 shrink-0 border-0" title={actorName}>
        <AvatarImage src={event.actor?.avatar_url || undefined} />
        <AvatarFallback className="bg-[#FF4529] text-[10px] text-white">
          {actorName[0]?.toUpperCase() || 'F'}
        </AvatarFallback>
      </Avatar>
    </div>
  );
}

export function LeadUnifiedThread({ leadId, leadName, leadAvatarUrl, leadPhone, whatsappVerified, leadCreatedAt, composerRequest }: LeadUnifiedThreadProps) {
  const [text, setText] = useState('');
  const [composerHighlighted, setComposerHighlighted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastHandledComposerRequestRef = useRef<number | null>(null);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastThreadItemIdRef = useRef<string | null>(null);
  const { profile } = useAuth();
  const { hasPermission } = useUserPermissions();
  const canViewWhatsApp = hasPermission('whatsapp_view') || hasPermission('whatsapp_operate');
  const canOperateWhatsApp = hasPermission('whatsapp_operate');
  const { data: history = [], isLoading: loadingHistory } = useLeadHistory(leadId);
  const { data: sessions = [], isLoading: loadingSessions } = useAccessibleSessions({ enabled: canViewWhatsApp });
  const accessibleSessionIds = useMemo(() => sessions.map((session) => session.id), [sessions]);
  const { data: conversations = [] } = useWhatsAppConversations(
    undefined,
    { hideGroups: true },
    !canViewWhatsApp ? [] : loadingSessions ? undefined : accessibleSessionIds,
  );
  useWhatsAppRealtimeConversations(canViewWhatsApp, loadingSessions ? undefined : accessibleSessionIds, [leadId]);

  const conversation = useMemo<WhatsAppConversation | null>(() => {
    return conversations.find((item) => item.lead_id === leadId || item.lead?.id === leadId) || null;
  }, [conversations, leadId]);

  const {
    data: messages = [],
    isLoading: loadingMessages,
    refetch: refetchMessages,
    hasOlderMessages,
    loadOlderMessages,
    isLoadingOlder,
  } = useLeadMessages(leadId, { pageSize: 40, enabled: canViewWhatsApp });
  const sendMessage = useSendWhatsAppMessage();
  const reactToMessage = useReactToWhatsAppMessage();
  const startConversation = useStartConversation();

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

  const hasLeadPhone = Boolean(leadPhone?.replace(/\D/g, ''));
  const leadHasNoWhatsApp = whatsappVerified === false;
  const messageInputConversation = useMemo(
    () =>
      conversation ||
      (hasLeadPhone
        ? {
            session_id: null,
            contact_phone: leadPhone,
            remote_jid: null,
            is_group: false,
            session: null,
          }
        : null),
    [conversation, hasLeadPhone, leadPhone],
  );
  const whatsappMessageInputState = useMemo(
    () => getWhatsAppMessageInputState(messageInputConversation, null, sessions),
    [messageInputConversation, sessions],
  );
  const canSendMessage = Boolean(
    canOperateWhatsApp &&
      hasLeadPhone &&
      !leadHasNoWhatsApp &&
      !whatsappMessageInputState.disabled,
  );
  const isSendingMessage = sendMessage.isPending || startConversation.isPending;
  const inputPlaceholder = !hasLeadPhone
    ? 'Lead sem telefone cadastrado'
    : leadHasNoWhatsApp
      ? 'Este lead nao tem WhatsApp'
      : !conversation && !whatsappMessageInputState.disabled
        ? 'Digite para iniciar a conversa com este lead'
        : whatsappMessageInputState.placeholder;

  useEffect(() => {
    if (!composerRequest || loadingSessions || lastHandledComposerRequestRef.current === composerRequest.id) return;
    lastHandledComposerRequestRef.current = composerRequest.id;

    if (!hasLeadPhone) {
      toast.error('Lead sem telefone', {
        description: 'Cadastre um telefone antes de iniciar uma conversa.',
      });
      return;
    }

    if (leadHasNoWhatsApp) {
      toast.error('Telefone sem WhatsApp', {
        description: 'Este número foi identificado como indisponível no WhatsApp.',
      });
      return;
    }

    if (whatsappMessageInputState.disabled) {
      toast.error('WhatsApp não conectado', {
        description: whatsappMessageInputState.placeholder,
      });
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (composerRequest.text) setText(composerRequest.text);
      setComposerHighlighted(true);
      textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      textareaRef.current?.focus();
    });
    const timeout = window.setTimeout(() => setComposerHighlighted(false), 1600);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [composerRequest, hasLeadPhone, leadHasNoWhatsApp, loadingSessions, whatsappMessageInputState.disabled, whatsappMessageInputState.placeholder]);

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

    const messageItems: ThreadItem[] = visibleMessages
      .filter((message) => !isInternalNotificationMessage(message))
      .map((message) => ({
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
  }, [history, visibleMessages, leadCreatedAt]);

  useEffect(() => {
    const lastItemId = items.at(-1)?.id ?? null;
    if (!lastItemId || lastItemId === lastThreadItemIdRef.current) return;

    const isInitialPosition = lastThreadItemIdRef.current === null;
    lastThreadItemIdRef.current = lastItemId;
    bottomRef.current?.scrollIntoView({
      behavior: isInitialPosition ? 'auto' : 'smooth',
      block: 'end',
    });
  }, [items]);

  const ensureConversationForSend = async () => {
    if (!canSendMessage) {
      throw new Error(inputPlaceholder);
    }

    if (conversation) return conversation;

    return startConversation.mutateAsync({
      phone: leadPhone || '',
      leadId,
      leadName,
      sessionId: whatsappMessageInputState.sendSessionId,
    });
  };

  const handleSend = async () => {
    const content = text.trim();
    if (!content || !canSendMessage || isSendingMessage) return;

    setText('');
    try {
      const targetConversation = await ensureConversationForSend();

      await sendMessage.mutateAsync({
        conversation: targetConversation,
        text: content,
        sendSessionId: whatsappMessageInputState.sendSessionId,
      });
    } catch {
      setText(content);
    }
  };

  const handleSendAudio = async (base64: string, mimetype: string) => {
    if (!canSendMessage || isSendingMessage) {
      toast.error('Áudio não enviado', {
        description: inputPlaceholder,
      });
      return;
    }

    const targetConversation = await ensureConversationForSend();
    await sendMessage.mutateAsync({
      conversation: targetConversation,
      text: '',
      mediaType: 'audio',
      base64,
      mimetype,
      filename: `audio.${mimeExtension(mimetype, 'webm')}`,
      previewMediaUrl: `data:${mimetype || 'audio/webm'};base64,${base64}`,
      sendSessionId: whatsappMessageInputState.sendSessionId,
    });
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!canSendMessage || isSendingMessage) {
      toast.error('Arquivo não enviado', {
        description: inputPlaceholder,
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    try {
      const processedFile = await compressImageFile(file);
      const base64 = await fileToBase64(processedFile);
      const mediaType = getMediaTypeFromFile(processedFile);
      const targetConversation = await ensureConversationForSend();

      await sendMessage.mutateAsync({
        conversation: targetConversation,
        text: processedFile.name,
        mediaType,
        base64,
        mimetype: processedFile.type || file.type || 'application/octet-stream',
        filename: processedFile.name,
        previewMediaUrl: `data:${processedFile.type || file.type || 'application/octet-stream'};base64,${base64}`,
        sendSessionId: whatsappMessageInputState.sendSessionId,
      });
    } catch (error) {
      toast.error('Erro ao enviar arquivo', {
        description: error instanceof Error && error.message.length < 160
          ? error.message
          : 'Não foi possível enviar o arquivo.',
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const retryMediaDownload = async (messageId: string) => {
    try {
      await whatsappAPI.retryMediaDownload(messageId, profile?.organization_id);
      await refetchMessages();
    } catch {
      toast.error('Mídia não atualizada', {
        description: 'Não foi possível buscar a mídia agora.',
      });
    }
  };

  const handleLoadOlderMessages = async () => {
    const scrollElement = threadScrollRef.current;
    const previousScrollHeight = scrollElement?.scrollHeight ?? 0;
    const previousScrollTop = scrollElement?.scrollTop ?? 0;

    await loadOlderMessages();

    window.requestAnimationFrame(() => {
      if (!scrollElement) return;
      scrollElement.scrollTop = previousScrollTop + scrollElement.scrollHeight - previousScrollHeight;
    });
  };

  const isLoading = (loadingHistory && history.length === 0) || (loadingMessages && messages.length === 0);

  return (
    <section className="lead-thread-panel flex h-full min-h-0 flex-col bg-transparent p-3">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-soft)]">
        <div ref={threadScrollRef} className="lead-thread-scroll flex-1 space-y-3 overflow-y-auto px-1 pb-3 pt-3">
          {isLoading && (
            <div className="flex h-full flex-col items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--app-text-tertiary)]" />
              <span className="text-[11px] text-[var(--app-text-tertiary)]">Carregando histórico e mensagens...</span>
            </div>
          )}

          {!isLoading && hasOlderMessages && (
            <div className="flex justify-center px-2 pb-1">
              <button
                type="button"
                className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] px-3 text-[11px] font-medium text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void handleLoadOlderMessages()}
                disabled={isLoadingOlder}
              >
                {isLoadingOlder && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isLoadingOlder ? 'Carregando...' : 'Carregar mensagens anteriores'}
              </button>
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
                  <MessageErrorBoundary messageId={item.message.id}>
                    <WhatsAppMessageBubble
                      content={item.message.content}
                      messageType={item.message.message_type || 'text'}
                      mediaUrl={item.message.media_url ?? null}
                      mediaMimeType={item.message.media_mime_type ?? null}
                      mediaStatus={toMessageMediaStatus(item.message.media_status)}
                      mediaError={item.message.media_error ?? null}
                      mediaSize={item.message.media_size ?? null}
                      fromMe={item.message.from_me}
                      status={item.message.status || ''}
                      sentAt={item.message.sent_at}
                      senderName={item.message.from_me ? item.message.sender_name ?? 'Equipe' : item.message.sender_name ?? null}
                      isGroup={conversation?.is_group ?? false}
                      onRetryMedia={() => retryMediaDownload(item.message.id)}
                      messageId={item.message.id}
                      leadId={leadId}
                      leadName={leadName}
                      contactAvatarUrl={leadAvatarUrl}
                      conversationRemoteJid={conversation?.remote_jid ?? item.message.remote_jid ?? null}
                      conversationSessionId={conversation?.session_id ?? item.message.session_id ?? null}
                      compact
                      reactions={(item.message.message_id
                        ? reactionsByMessageId.get(item.message.message_id)
                        : undefined)
                        || reactionsByMessageId.get(item.message.id)
                        || []}
                      onReact={canOperateWhatsApp ? (emoji) => reactToMessage.mutateAsync({
                        conversation: {
                          ...(conversation || {}),
                          id: item.message.conversation_id,
                          session_id: item.message.session_id,
                          lead_id: leadId,
                          remote_jid: item.message.remote_jid || conversation?.remote_jid || '',
                        } as WhatsAppConversation,
                        targetMessage: item.message as WhatsAppMessage,
                        emoji,
                      }) : undefined}
                      isReacting={reactToMessage.isPending}
                    />
                  </MessageErrorBoundary>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {canViewWhatsApp && <div className="bg-transparent px-3 pb-3 pt-2">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
            className="hidden"
          />
          <div className={cn('rounded-[8px] transition-shadow duration-300', composerHighlighted && 'ring-2 ring-primary/35 ring-offset-2 ring-offset-transparent')}>
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
              showRightActionsWhenEmpty={!isSendingMessage}
              leftActions={
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!canSendMessage || isSendingMessage}
                  title="Anexar midia"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
              }
              rightActions={
                <AudioRecorderButton
                  onSend={handleSendAudio}
                  disabled={!canSendMessage || isSendingMessage}
                />
              }
            />
          </div>
        </div>}
      </div>
    </section>
  );
}
