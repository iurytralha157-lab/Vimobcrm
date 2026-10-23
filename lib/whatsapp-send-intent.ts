import type { SendWhatsAppMessageResult, WhatsAppMessage } from '@/lib/api/whatsapp'
import type { WhatsAppQueryScope } from '@/lib/whatsapp-query-cache'

export type WhatsAppSendIntentResolution = NonNullable<SendWhatsAppMessageResult['fileIntentResolution']>

// A successful HTTP response can already contain the worker's failure. Keep
// the recorder's original ID for uncertain outcomes and its preview on a
// definitive rejection; neither outcome is a queued success.
export function getWhatsAppAudioSendResult(response: SendWhatsAppMessageResult, clientMessageId: string):
  false | { state: 'queued' | 'unconfirmed'; clientMessageId: string } {
  const status = response.message?.status ?? response.status
  const code = response.message?.delivery_error_code
  if (code === 'outcome_unknown' || ['confirming', 'unconfirmed'].includes(status ?? '')) {
    return { state: 'unconfirmed', clientMessageId }
  }
  if (status === 'failed' || status === 'error') {
    return code === 'recipient_not_registered' || code === 'send_failed'
      ? false : { state: 'unconfirmed', clientMessageId }
  }
  return { state: ['queued', 'pending', 'sending', 'sent', 'delivered', 'read', 'played'].includes(status ?? '')
    ? 'queued' : 'unconfirmed', clientMessageId }
}

export function isWhatsAppSendScopeCurrent(sent: WhatsAppQueryScope, current: WhatsAppQueryScope): boolean {
  return sent.organizationId === current.organizationId && sent.userId === current.userId
    && sent.accessScope === current.accessScope
}

// Only an exact authorized server lookup can settle an uncertain POST. Absence
// from a bounded timeline, a local optimistic row, or an unknown provider
// outcome must never be interpreted as permission to send the bytes again.
export function getWhatsAppSendIntentResolution(
  response: SendWhatsAppMessageResult,
  expected: { conversationId: string; clientMessageId: string },
): WhatsAppSendIntentResolution {
  const message = response.message
  if (response.conversationId !== expected.conversationId
    || response.clientMessageId !== expected.clientMessageId
    || !message || !message.from_me || message.conversation_id !== expected.conversationId
    || message.client_message_id !== expected.clientMessageId
    || message.metadata?.local_delivery_state) return 'pending'

  if (message.delivery_error_code === 'outcome_unknown') return 'pending'
  if (message.status === 'failed' || message.status === 'error') {
    return message.delivery_error_code === 'recipient_not_registered'
      || message.delivery_error_code === 'send_failed' ? 'failed' : 'pending'
  }
  return ['queued', 'pending', 'sending', 'sent', 'delivered', 'read', 'played'].includes(message.status)
    ? 'accepted' : 'pending'
}

export function getWhatsAppFileSendFeedback(
  response: SendWhatsAppMessageResult,
  expected: { conversationId: string; clientMessageId: string },
): { state: 'queued' | 'unconfirmed' | 'failed' | 'cancelled'; title: string; description: string; variant: 'default' | 'destructive' } {
  // A checking gesture has already performed the exact authorized GET. Keep
  // its explicit result without inventing a canonical message or new enqueue.
  const resolution = response.fileIntentChecked === true
    ? response.conversationId === expected.conversationId && response.clientMessageId === expected.clientMessageId
      ? response.fileIntentResolution ?? 'pending' : 'pending'
    : getWhatsAppSendIntentResolution(response, expected)
  if (resolution === 'cancelled') return { state: 'cancelled', title: 'Verificação encerrada',
    description: 'O contexto do atendimento mudou. Reabra a conversa antes de continuar.', variant: 'default' }
  if (resolution === 'accepted') return { state: 'queued',
    title: response.fileIntentChecked ? 'Envio verificado' : 'Arquivo na fila',
    description: response.fileIntentChecked ? 'O envio original está registrado na conversa.' : 'Acompanhe o status do envio na conversa.', variant: 'default' }
  if (resolution === 'failed') return { state: 'failed', title: 'Arquivo não enviado',
    description: response.message?.delivery_error_code === 'recipient_not_registered'
      ? 'Este número não possui WhatsApp. Confira o telefone do lead e inicie uma nova conversa após corrigir.'
      : 'O envio deste arquivo falhou. Confira o status na conversa antes de tentar novamente.', variant: 'destructive' }
  return { state: 'unconfirmed', title: 'Confirmando envio',
    description: 'Ainda não recebemos a confirmação deste arquivo. Verifique o envio na conversa; não anexe novamente agora.', variant: 'default' }
}

export type WhatsAppConversationSelection = {
  conversationId: string | null;
  previousConversationId: string | null;
  generation: number;
};

/** A prepared new conversation may replace null once; another route or ABA may not. */
export function isWhatsAppConversationSelectionCurrent(
  current: WhatsAppConversationSelection,
  captured: WhatsAppConversationSelection,
  preparedConversationId: string | null,
): boolean {
  if (captured.conversationId && preparedConversationId
    && captured.conversationId !== preparedConversationId) return false;
  if (current.generation === captured.generation
    && current.conversationId === captured.conversationId) return true;
  return captured.conversationId === null && preparedConversationId !== null
    && current.conversationId === preparedConversationId
    && current.previousConversationId === null
    && current.generation === captured.generation + 1;
}

export function canDiscardFailedLocalWhatsAppMessage(message: WhatsAppMessage): boolean {
  return message.status === 'failed' && message.metadata?.local_delivery_state === 'failed'
    && Boolean(message.client_message_id) && message.id === message.client_message_id
    && message.message_id === message.client_message_id
}
