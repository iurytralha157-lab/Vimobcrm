import { VimobAPIError } from '@/lib/api/vimob-error'
import { whatsAppPhoneChangeConfirmationSchema } from '@/lib/validation/whatsapp'

export type WhatsAppPhoneChangeConfirmation = {
  conversationId: string; leadId: string; sessionId: string
  destinationConversationId?: string
  requiresDestinationHistoryConfirmation?: true
}
export function decodeWhatsAppPhoneChangeConfirmation(code: string, payload: unknown): WhatsAppPhoneChangeConfirmation | undefined {
  if (code !== 'whatsapp_phone_change_confirmation_required') return undefined
  const parsed = whatsAppPhoneChangeConfirmationSchema.safeParse(payload)
  return parsed.success ? parsed.data : undefined
}
export function getWhatsAppPhoneChangeConfirmation(error: unknown): WhatsAppPhoneChangeConfirmation | null {
  if (!(error instanceof VimobAPIError)) return null
  return decodeWhatsAppPhoneChangeConfirmation(error.code, error.responseData) ?? null
}
