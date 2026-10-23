import { VimobAPIError } from '@/lib/api/vimob-error'
import type { WhatsAppRequestIntent } from '@/lib/api/whatsapp'
import type { WhatsAppQueryScope } from '@/lib/whatsapp-query-cache'

export async function runWhatsAppRequestIntent<T>(
  scope: WhatsAppQueryScope,
  controllers: Set<AbortController>,
  request: (intent: WhatsAppRequestIntent) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  controllers.add(controller)
  let transportStarted = false
  try {
    return await request({
      signal: controller.signal,
      expectedUserId: scope.userId,
      onRequestStart: () => { transportStarted = true },
    })
  } catch (error) {
    // Before HTTP there was no server effect. After HTTP an aborted response
    // cannot prove delivery failed; preserve the existing uncertain-send flow.
    if (controller.signal.aborted && !transportStarted) {
      throw new VimobAPIError('O contexto do atendimento mudou. Reabra a conversa antes de continuar.', {
        status: 409,
        code: 'whatsapp_send_context_changed',
      })
    }
    throw error
  } finally {
    controllers.delete(controller)
  }
}

export function abortWhatsAppRequestIntents(controllers: Set<AbortController>) {
  for (const controller of controllers) controller.abort()
  controllers.clear()
}
