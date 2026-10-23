import { vimobAPIRequest, type VimobAPIRequestIntent } from '@/lib/api/vimob-client'
import { parseDomainInput, uuidSchema, validateDomainResponse } from '@/lib/validation/common'
import {
  whatsAppQuickReplyInputSchema, whatsAppQuickReplyListResponseSchema, whatsAppQuickReplyResponseSchema,
  type QuickReply, type WhatsAppQuickReplyInput,
} from '@/lib/validation/whatsapp-quick-replies'

export type { QuickReply, WhatsAppQuickReplyInput } from '@/lib/validation/whatsapp-quick-replies'

const endpoint = '/v1/whatsapp/quick-replies'

/** Personal ownership comes exclusively from the authenticated API actor. */
export const whatsappQuickRepliesAPI = {
  async list(organizationId: string, intent: VimobAPIRequestIntent) {
    const response = await vimobAPIRequest<unknown>(endpoint, { organizationId, ...intent, retry: false })
    return validateDomainResponse(whatsAppQuickReplyListResponseSchema, response, 'whatsapp.quick-replies.list').data
  },
  async create(input: WhatsAppQuickReplyInput, organizationId: string, intent: VimobAPIRequestIntent): Promise<QuickReply> {
    const body = parseDomainInput(whatsAppQuickReplyInputSchema, input, 'whatsapp.quick-replies.create')
    const response = await vimobAPIRequest<unknown>(endpoint, { method: 'POST', organizationId, ...intent, body, retry: false })
    return validateDomainResponse(whatsAppQuickReplyResponseSchema, response, 'whatsapp.quick-replies.create').data
  },
  async update(id: string, input: WhatsAppQuickReplyInput, organizationId: string, intent: VimobAPIRequestIntent): Promise<QuickReply> {
    const itemId = parseDomainInput(uuidSchema, id, 'whatsapp.quick-replies.update.id')
    const body = parseDomainInput(whatsAppQuickReplyInputSchema, input, 'whatsapp.quick-replies.update')
    const response = await vimobAPIRequest<unknown>(`${endpoint}/${itemId}`, { method: 'PATCH', organizationId, ...intent, body, retry: false })
    return validateDomainResponse(whatsAppQuickReplyResponseSchema, response, 'whatsapp.quick-replies.update').data
  },
  async remove(id: string, organizationId: string, intent: VimobAPIRequestIntent): Promise<void> {
    const itemId = parseDomainInput(uuidSchema, id, 'whatsapp.quick-replies.remove.id')
    await vimobAPIRequest<unknown>(`${endpoint}/${itemId}`, { method: 'DELETE', organizationId, ...intent, retry: false })
  },
}
