import { z } from 'zod'
import { apiEnvelopeSchema, timestampSchema, uuidSchema } from './common'

export const WHATSAPP_QUICK_REPLY_LIMIT = 200
export const WHATSAPP_QUICK_REPLY_CONTENT_LIMIT = 4000

export const whatsAppQuickReplyShortcutSchema = z.string()
  .transform(value => value.trim().replace(/^\//, '').replace(/[A-Z]/g, letter => letter.toLowerCase()))
  .pipe(z.string().min(1).max(40).regex(/^[a-z0-9][a-z0-9_-]*$/, 'Use letras, números, hífen ou sublinhado.'))

// Count Unicode code points like the Go rune limit; preserve intentional spaces/newlines.
export const whatsAppQuickReplyContentSchema = z.string().refine(value => value.trim().length > 0,
  'Digite o texto da resposta.').refine(value => !value.includes('\u0000') && !/[\uD800-\uDFFF]/u.test(value),
  'O texto contém um caractere inválido.').refine(value => Array.from(value).length <= WHATSAPP_QUICK_REPLY_CONTENT_LIMIT,
  'A resposta pode ter até 4000 caracteres.')

export const whatsAppQuickReplyInputSchema = z.object({
  shortcut: whatsAppQuickReplyShortcutSchema,
  content: whatsAppQuickReplyContentSchema,
}).strict()

export const whatsAppQuickReplySchema = z.object({
  id: uuidSchema,
  shortcut: z.string().min(1).max(40).regex(/^[a-z0-9][a-z0-9_-]*$/),
  content: whatsAppQuickReplyContentSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).strict()

export const whatsAppQuickReplyResponseSchema = apiEnvelopeSchema(whatsAppQuickReplySchema)
export const whatsAppQuickReplyListResponseSchema = apiEnvelopeSchema(z.array(whatsAppQuickReplySchema).max(WHATSAPP_QUICK_REPLY_LIMIT))
export type QuickReply = z.infer<typeof whatsAppQuickReplySchema>
export type WhatsAppQuickReplyInput = z.infer<typeof whatsAppQuickReplyInputSchema>
