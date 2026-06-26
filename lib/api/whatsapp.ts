import type { Json } from '@/integrations/supabase/types'
import { vimobAPIRequest } from './vimob-client'

type Envelope<T> = {
  data: T
}

export type WhatsAppProvider = 'evolution' | 'evolution_go'

export interface WhatsAppSession {
  id: string
  organization_id: string
  owner_user_id: string
  instance_name: string
  display_name: string | null
  instance_id: string | null
  status: string
  phone_number: string | null
  profile_name: string | null
  profile_picture: string | null
  is_active: boolean
  is_notification_session?: boolean
  provider?: WhatsAppProvider
  advanced_settings?: Json | null
  created_at: string
  updated_at: string
  last_connected_at?: string | null
  owner?: {
    id: string
    name: string
    email: string
  }
}

export type WhatsAppAccessMode = 'assigned_leads_only' | 'team_leads' | 'all_leads' | 'full_inbox'

export interface WhatsAppSessionAccess {
  id: string
  session_id: string
  user_id: string
  access_mode?: WhatsAppAccessMode
  can_view: boolean
  can_read?: boolean
  can_send: boolean
  only_leads_access: boolean
  granted_by: string | null
  created_at: string
  user?: {
    id: string
    name: string
    email: string
  }
}

export interface WhatsAppConversation {
  id: string
  session_id: string
  lead_id: string | null
  remote_jid: string
  contact_name: string | null
  contact_phone: string | null
  contact_picture: string | null
  contact_presence: string | null
  presence_updated_at: string | null
  last_message: string | null
  last_message_at: string | null
  unread_count: number
  is_group: boolean
  archived_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  session?: {
    id: string
    instance_name: string
    phone_number: string | null
    status: string
    organization_id: string
    provider?: WhatsAppProvider | null
  }
  lead?: {
    id: string
    name: string
    whatsapp_avatar_url?: string | null
    pipeline_id?: string | null
    stage_id?: string | null
    pipeline?: {
      id: string
      name: string
    } | null
    stage?: {
      id: string
      name: string
      color: string | null
    } | null
    tags?: Array<{
      tag: {
        id: string
        name: string
        color: string
      }
    }>
  }
}

export interface WhatsAppMessage {
  id: string
  conversation_id: string
  session_id: string
  message_id: string
  client_message_id?: string | null
  from_me: boolean
  content: string | null
  message_type: string
  media_url: string | null
  media_mime_type: string | null
  media_status?: 'pending' | 'ready' | 'failed' | null
  media_error?: string | null
  media_size?: number | null
  media_storage_path?: string | null
  remote_jid?: string | null
  reaction_to_message_id?: string | null
  reaction_emoji?: string | null
  reaction_sender_jid?: string | null
  reaction_sender_name?: string | null
  metadata?: Record<string, unknown>
  status: string
  sent_at: string
  delivered_at: string | null
  read_at: string | null
  sender_jid: string | null
  sender_name: string | null
}

export interface ConversationFilters {
  hideGroups?: boolean
  showArchived?: boolean
}

export type WhatsAppMessagesPage = {
  messages: WhatsAppMessage[]
  nextCursor: string | null
}

export type SendWhatsAppMessageInput = {
  text: string
  mediaUrl?: string
  mediaType?: string
  base64?: string
  mimetype?: string
  filename?: string
  sendSessionId?: string
  clientMessageId?: string
}

export type SendWhatsAppMessageResult = Record<string, unknown> & {
  clientMessageId: string
  conversationId: string
  providerData?: Record<string, unknown>
}

export type WhatsAppQRCode = {
  base64?: string
  qrcode?: string
}

export type WhatsAppConnectionStatus = {
  connected: boolean
  status: string
  state?: string
  instanceNotFound?: boolean
  instance?: { wuid?: string | null }
  rawResponse?: unknown
  rawStatus?: unknown
}

export interface WhatsAppLabel {
  id: string
  session_id: string
  organization_id: string
  remote_label_id: string
  name: string
  color: number | null
  predefined: boolean
  created_at: string
}

export interface WhatsAppGroup {
  id: string
  session_id: string
  organization_id: string
  group_jid: string
  subject: string | null
  description: string | null
  picture_url: string | null
  participants: Array<string | { id?: string; jid?: string; admin?: string | null }>
  owner_jid: string | null
  is_announce: boolean
  updated_at: string
}

export const whatsappAPI = {
  async getSessions(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<WhatsAppSession[]>>('/v1/whatsapp/sessions', {
      organizationId,
    })
    return response.data
  },

  async createSession(input: { displayName: string; provider?: WhatsAppProvider }, organizationId?: string | null) {
    return vimobAPIRequest<{ session: WhatsAppSession; evolutionData?: unknown }>('/v1/whatsapp/sessions', {
      method: 'POST',
      organizationId,
      body: input,
    })
  },

  async getSession(sessionId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<WhatsAppSession>>(`/v1/whatsapp/sessions/${sessionId}`, {
      organizationId,
    })
    return response.data
  },

  async deleteSession(sessionId: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/whatsapp/sessions/${sessionId}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async getQRCode(sessionId: string, organizationId?: string | null) {
    return vimobAPIRequest<WhatsAppQRCode>(`/v1/whatsapp/sessions/${sessionId}/qr`, {
      method: 'POST',
      organizationId,
    })
  },

  async getConnectionStatus(sessionId: string, organizationId?: string | null) {
    return vimobAPIRequest<WhatsAppConnectionStatus>(`/v1/whatsapp/sessions/${sessionId}/status`, {
      method: 'POST',
      organizationId,
    })
  },

  async recreateSession(sessionId: string, organizationId?: string | null) {
    return vimobAPIRequest<{ session: WhatsAppSession; evolutionData?: unknown }>(
      `/v1/whatsapp/sessions/${sessionId}/recreate`,
      { method: 'POST', organizationId },
    )
  },

  async logoutSession(sessionId: string, organizationId?: string | null) {
    return vimobAPIRequest<{ ok: boolean; data?: unknown }>(`/v1/whatsapp/sessions/${sessionId}/logout`, {
      method: 'POST',
      organizationId,
    })
  },

  async toggleNotificationSession(sessionId: string, enabled: boolean, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/whatsapp/sessions/${sessionId}/notification-session`, {
      method: 'POST',
      organizationId,
      body: { enabled },
    })
  },

  async getSessionAccess(sessionId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<WhatsAppSessionAccess[]>>(
      `/v1/whatsapp/sessions/${sessionId}/access`,
      { organizationId },
    )
    return response.data
  },

  async grantSessionAccess(
    sessionId: string,
    input: {
      userId: string
      canView?: boolean
      canSend?: boolean
      accessMode?: WhatsAppAccessMode
    },
    organizationId?: string | null,
  ) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/whatsapp/sessions/${sessionId}/access`, {
      method: 'POST',
      organizationId,
      body: input,
    })
  },

  async revokeSessionAccess(sessionId: string, userId: string, organizationId?: string | null) {
    await vimobAPIRequest<null>(`/v1/whatsapp/sessions/${sessionId}/access/${userId}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async getConversations(params: {
    organizationId?: string | null
    sessionId?: string
    filters?: ConversationFilters
    accessibleSessionIds?: string[]
  }) {
    const response = await vimobAPIRequest<Envelope<WhatsAppConversation[]>>('/v1/whatsapp/conversations', {
      organizationId: params.organizationId,
      query: {
        sessionId: params.sessionId,
        hideGroups: params.filters?.hideGroups,
        showArchived: params.filters?.showArchived,
        sessionIds: params.accessibleSessionIds?.join(','),
      },
    })
    return response.data
  },

  async startConversation(input: {
    phone: string
    sessionId: string
    leadId?: string
    leadName?: string
  }, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<WhatsAppConversation>>('/v1/whatsapp/conversations/start', {
      method: 'POST',
      organizationId,
      body: input,
    })
    return response.data
  },

  async findConversation(params: {
    phone: string
    leadId?: string
    sessionId?: string
    organizationId?: string | null
  }) {
    const response = await vimobAPIRequest<Envelope<WhatsAppConversation | null>>('/v1/whatsapp/conversations/find', {
      organizationId: params.organizationId,
      query: {
        phone: params.phone,
        leadId: params.leadId,
        sessionId: params.sessionId,
      },
    })
    return response.data
  },

  async getHistoryAccess(params: {
    conversationId?: string | null
    leadId?: string | null
    allMessages?: boolean
    organizationId?: string | null
  }) {
    const response = await vimobAPIRequest<Envelope<{ conversation?: WhatsAppConversation; messages: WhatsAppMessage[] }>>(
      '/v1/whatsapp/history',
      {
        organizationId: params.organizationId,
        query: {
          conversationId: params.conversationId || undefined,
          leadId: params.leadId || undefined,
          allMessages: params.allMessages,
        },
      },
    )
    return response.data
  },

  async getConversation(conversationId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<WhatsAppConversation>>(
      `/v1/whatsapp/conversations/${conversationId}`,
      { organizationId },
    )
    return response.data
  },

  async getMessages(params: {
    conversationId: string
    organizationId?: string | null
    limit?: number
    cursor?: string | null
  }) {
    const response = await vimobAPIRequest<Envelope<WhatsAppMessagesPage>>(
      `/v1/whatsapp/conversations/${params.conversationId}/messages`,
      {
        organizationId: params.organizationId,
        query: {
          limit: params.limit,
          cursor: params.cursor,
        },
      },
    )
    return response.data
  },

  async markConversationAsRead(conversationId: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/whatsapp/conversations/${conversationId}/mark-read`, {
      method: 'POST',
      organizationId,
    })
  },

  async sendMessage(conversationId: string, input: SendWhatsAppMessageInput, organizationId?: string | null) {
    return vimobAPIRequest<SendWhatsAppMessageResult>(`/v1/whatsapp/conversations/${conversationId}/send-message`, {
      method: 'POST',
      organizationId,
      body: input,
    })
  },

  async markAsSeenOnWhatsApp(conversationId: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/whatsapp/conversations/${conversationId}/mark-seen`, {
      method: 'POST',
      organizationId,
    })
  },

  async archiveConversation(conversationId: string, archive: boolean, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/whatsapp/conversations/${conversationId}/archive`, {
      method: 'POST',
      organizationId,
      body: { archive },
    })
  },

  async deleteConversation(conversationId: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/whatsapp/conversations/${conversationId}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async linkConversationToLead(conversationId: string, leadId: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/whatsapp/conversations/${conversationId}/link-lead`, {
      method: 'POST',
      organizationId,
      body: { leadId },
    })
  },

  async retryMediaDownload(messageId: string, organizationId?: string | null) {
    return vimobAPIRequest<{ ok: boolean; data?: unknown }>(`/v1/whatsapp/messages/${messageId}/retry-media`, {
      method: 'POST',
      organizationId,
    })
  },

  async getLabels(sessionId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<WhatsAppLabel[]>>(`/v1/whatsapp/sessions/${sessionId}/labels`, {
      organizationId,
    })
    return response.data
  },

  async getChatLabels(conversationId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<WhatsAppLabel[]>>(
      `/v1/whatsapp/conversations/${conversationId}/labels`,
      { organizationId },
    )
    return response.data
  },

  async syncLabels(sessionId: string, organizationId?: string | null) {
    return vimobAPIRequest<{ raw?: unknown; synced: number }>(`/v1/whatsapp/sessions/${sessionId}/labels/sync`, {
      method: 'POST',
      organizationId,
    })
  },

  async assignLabel(sessionId: string, input: {
    remoteJid: string
    labelId: string
    conversationId: string
    add: boolean
  }, organizationId?: string | null) {
    return vimobAPIRequest<{ ok: boolean; data?: unknown }>(`/v1/whatsapp/sessions/${sessionId}/labels/assign`, {
      method: 'POST',
      organizationId,
      body: input,
    })
  },

  async getGroups(sessionId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<WhatsAppGroup[]>>(`/v1/whatsapp/sessions/${sessionId}/groups`, {
      organizationId,
    })
    return response.data
  },

  async syncGroups(sessionId: string, organizationId?: string | null) {
    return vimobAPIRequest<{ ok: boolean; data?: unknown }>(`/v1/whatsapp/sessions/${sessionId}/groups/sync`, {
      method: 'POST',
      organizationId,
    })
  },

  async groupInfo(sessionId: string, jid: string, organizationId?: string | null) {
    return vimobAPIRequest<{ ok: boolean; data?: unknown }>(`/v1/whatsapp/sessions/${sessionId}/groups/info`, {
      method: 'POST',
      organizationId,
      body: { jid },
    })
  },

  async groupInviteLink(sessionId: string, jid: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<{ ok: boolean; data?: unknown }>(
      `/v1/whatsapp/sessions/${sessionId}/groups/invite-link`,
      {
        method: 'POST',
        organizationId,
        body: { jid },
      },
    )
    return response.data
  },

  async updateGroup(sessionId: string, input: {
    jid: string
    field: 'name' | 'description' | 'photo'
    value: string
  }, organizationId?: string | null) {
    return vimobAPIRequest<{ ok: boolean; data?: unknown }>(`/v1/whatsapp/sessions/${sessionId}/groups/update`, {
      method: 'POST',
      organizationId,
      body: input,
    })
  },

  async checkNumbers(sessionId: string, numbers: string[], organizationId?: string | null) {
    const response = await vimobAPIRequest<{ ok: boolean; data?: unknown }>(
      `/v1/whatsapp/sessions/${sessionId}/contacts/check`,
      {
        method: 'POST',
        organizationId,
        body: { numbers },
      },
    )
    return response.data
  },

  async fetchAvatar(sessionId: string, jid: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<{ ok: boolean; data?: unknown }>(
      `/v1/whatsapp/sessions/${sessionId}/contacts/avatar`,
      {
        method: 'POST',
        organizationId,
        body: { jid },
      },
    )
    return response.data
  },

  async syncContactsAvatars(sessionId: string, organizationId?: string | null) {
    return vimobAPIRequest<{ ok: boolean; data?: unknown }>(`/v1/whatsapp/sessions/${sessionId}/contacts/sync`, {
      method: 'POST',
      organizationId,
    })
  },

  async historySync(sessionId: string, jid?: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<{ ok: boolean; data?: unknown }>(
      `/v1/whatsapp/sessions/${sessionId}/history-sync`,
      {
        method: 'POST',
        organizationId,
        body: { jid },
      },
    )
    return response.data
  },

  async providerAction<T = unknown>(input: {
    action: string
    session_id: string
    instance_id?: string
    body?: Record<string, unknown>
  }, organizationId?: string | null) {
    return vimobAPIRequest<{ ok: boolean; data?: T; error?: string }>('/v1/whatsapp/provider-action', {
      method: 'POST',
      organizationId,
      body: input,
    })
  },
}
