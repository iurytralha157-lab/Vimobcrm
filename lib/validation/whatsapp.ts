import { z } from 'zod'
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from './common'

export const whatsAppProviderSchema = z.enum(['evolution', 'evolution_go'])
export const whatsAppAccessModeSchema = z.literal('assigned_leads_only')

export const createWhatsAppSessionInputSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  provider: z.literal('evolution_go').optional(),
}).strict()

export const whatsAppSessionAccessInputSchema = z.object({
  userId: uuidSchema,
  canView: z.boolean().optional(),
  canSend: z.boolean().optional(),
  accessMode: whatsAppAccessModeSchema.optional(),
}).strict()

export const whatsAppAIAutoReplyInputSchema = z.object({
  enabled: z.boolean(),
  agentId: uuidSchema.nullish(),
  followUpEnabled: z.boolean().optional(),
  followUpIntervalDays: z.number().int().min(1).max(30).optional(),
  followUpTemplate: z.string().trim().max(4_000).optional(),
}).strict()

export const startWhatsAppConversationInputSchema = z.object({
  phone: z.string().trim().min(8).max(40),
  sessionId: uuidSchema.optional(),
  leadId: uuidSchema.optional(),
  leadName: z.string().trim().max(180).optional(),
}).strict()

export const sendWhatsAppMessageInputSchema = z.object({
  text: z.string().max(10_000),
  mediaUrl: z.string().trim().max(4_000).optional(),
  mediaType: z.enum(['text', 'image', 'video', 'document', 'audio', 'sticker']).optional(),
  base64: z.string().min(1).optional(),
  mimetype: z.string().trim().max(255).optional(),
  filename: z.string().trim().max(255).optional(),
  sendSessionId: uuidSchema.optional(),
  clientMessageId: z.string().trim().min(1).max(200).optional(),
}).strict().refine(
  (input) => input.text.trim().length > 0 || Boolean(input.mediaUrl || input.base64),
  'Informe texto ou midia',
)

export const whatsAppSessionSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  owner_user_id: uuidSchema,
  instance_name: z.string().min(1),
  display_name: z.string().nullable(),
  instance_id: z.string().nullable(),
  status: z.string(),
  phone_number: z.string().nullable(),
  profile_name: z.string().nullable(),
  profile_picture: z.string().nullable(),
  is_active: z.boolean(),
  is_notification_session: z.boolean().optional(),
  provider: whatsAppProviderSchema.optional(),
  advanced_settings: z.unknown().nullable().optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  last_connected_at: timestampSchema.nullable().optional(),
  owner: z.object({
    id: uuidSchema,
    name: z.string(),
    email: z.string().email(),
  }).passthrough().optional(),
}).passthrough()

export const whatsAppSessionAccessSchema = z.object({
  id: uuidSchema,
  session_id: uuidSchema,
  user_id: uuidSchema,
  access_mode: whatsAppAccessModeSchema.optional(),
  can_view: z.boolean(),
  can_read: z.boolean().optional(),
  can_send: z.boolean(),
  only_leads_access: z.boolean(),
  granted_by: uuidSchema.nullable(),
  created_at: timestampSchema,
  user: z.object({
    id: uuidSchema,
    name: z.string(),
    email: z.string().email(),
  }).passthrough().optional(),
}).passthrough()

const whatsAppConversationLeadSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  whatsapp_avatar_url: z.string().nullable().optional(),
  pipeline_id: uuidSchema.nullable().optional(),
  stage_id: uuidSchema.nullable().optional(),
  pipeline: z.object({ id: uuidSchema, name: z.string() }).passthrough().nullable().optional(),
  stage: z.object({ id: uuidSchema, name: z.string(), color: z.string().nullable() }).passthrough().nullable().optional(),
  assignee: z.object({
    id: uuidSchema,
    name: z.string(),
    avatar_url: z.string().nullable().optional(),
  }).passthrough().nullable().optional(),
  tags: z.array(z.object({
    tag: z.object({
      id: uuidSchema,
      name: z.string(),
      color: z.string(),
    }).passthrough(),
  }).passthrough()).optional(),
}).passthrough()

export const whatsAppConversationSchema = z.object({
  id: uuidSchema,
  session_id: uuidSchema,
  lead_id: uuidSchema.nullable(),
  remote_jid: z.string().min(1),
  contact_name: z.string().nullable(),
  contact_phone: z.string().nullable(),
  contact_picture: z.string().nullable(),
  contact_presence: z.string().nullable(),
  presence_updated_at: timestampSchema.nullable(),
  last_message: z.string().nullable(),
  last_message_at: timestampSchema.nullable(),
  unread_count: nonNegativeIntegerSchema,
  is_group: z.boolean(),
  archived_at: timestampSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  session: z.object({
    id: uuidSchema,
    instance_name: z.string(),
    phone_number: z.string().nullable(),
    status: z.string(),
    organization_id: uuidSchema,
    provider: whatsAppProviderSchema.nullable().optional(),
  }).passthrough().optional(),
  lead: whatsAppConversationLeadSchema.optional(),
}).passthrough()

export const whatsAppMessageSchema = z.object({
  id: uuidSchema,
  conversation_id: uuidSchema,
  session_id: uuidSchema,
  message_id: z.string().min(1),
  client_message_id: z.string().nullable().optional(),
  from_me: z.boolean(),
  content: z.string().nullable(),
  message_type: z.string().min(1),
  media_url: z.string().nullable(),
  media_mime_type: z.string().nullable(),
  media_status: z.enum(['pending', 'ready', 'failed']).nullable().optional(),
  media_error: z.string().nullable().optional(),
  media_size: nonNegativeIntegerSchema.nullable().optional(),
  media_storage_path: z.string().nullable().optional(),
  remote_jid: z.string().nullable().optional(),
  reaction_to_message_id: z.string().nullable().optional(),
  reaction_emoji: z.string().nullable().optional(),
  reaction_sender_jid: z.string().nullable().optional(),
  reaction_sender_name: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.string(),
  sent_at: timestampSchema,
  delivered_at: timestampSchema.nullable(),
  read_at: timestampSchema.nullable(),
  sender_jid: z.string().nullable(),
  sender_name: z.string().nullable(),
}).passthrough()

export const whatsAppSessionsResponseSchema = z.object({
  data: z.array(whatsAppSessionSchema),
  meta: z.object({
    maxSessions: z.number().int().nullable().optional(),
    currentSessions: nonNegativeIntegerSchema,
    canCreate: z.boolean(),
  }).passthrough().optional(),
}).passthrough()

export const whatsAppSessionResponseSchema = apiEnvelopeSchema(whatsAppSessionSchema)
export const whatsAppSessionOperationResponseSchema = z.object({
  session: whatsAppSessionSchema,
  evolutionData: z.unknown().optional(),
}).passthrough()
export const whatsAppSessionAccessResponseSchema = apiEnvelopeSchema(z.array(whatsAppSessionAccessSchema))
export const whatsAppConversationsResponseSchema = apiEnvelopeSchema(z.array(whatsAppConversationSchema))
export const whatsAppConversationResponseSchema = apiEnvelopeSchema(whatsAppConversationSchema)
export const whatsAppOptionalConversationResponseSchema = apiEnvelopeSchema(whatsAppConversationSchema.nullable())
export const whatsAppMessagesPageSchema = z.object({
  messages: z.array(whatsAppMessageSchema),
  nextCursor: timestampSchema.nullable(),
}).passthrough()
export const whatsAppMessagesResponseSchema = apiEnvelopeSchema(whatsAppMessagesPageSchema)
export const whatsAppHistoryResponseSchema = apiEnvelopeSchema(z.object({
  conversation: whatsAppConversationSchema.optional(),
  conversations: z.array(whatsAppConversationSchema).optional(),
  messages: z.array(whatsAppMessageSchema),
}).passthrough())

export const sendWhatsAppMessageResponseSchema = z.object({
  clientMessageId: z.string().min(1),
  conversationId: uuidSchema,
  providerData: z.record(z.unknown()).optional(),
}).passthrough()
