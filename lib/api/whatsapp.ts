import type { Json } from '@/lib/supabase/types'
import { whatsAppConversationListQuerySchema, whatsAppConversationOptionsQuerySchema } from '@/lib/validation/whatsapp-conversation-filters'
import { WHATSAPP_MESSAGE_ORDERING_VERSION } from '@/lib/whatsapp-message-order'
import {
  createWhatsAppSessionInputSchema,
  linkWhatsAppConversationLeadInputSchema,
  parseDomainInput,
  reactWhatsAppMessageInputSchema,
  reactWhatsAppMessageResponseSchema,
  sendWhatsAppMessageInputSchema,
  sendWhatsAppMessageResponseSchema,
  startWhatsAppConversationInputSchema,
  validateDomainResponse,
  whatsAppAttendanceRequestSchema,
  whatsAppAttendanceResponseSchema,
  whatsAppAIAutoReplyInputSchema,
  whatsAppConversationResponseSchema,
  whatsAppConversationsResponseSchema,
  whatsAppConversationFilterOptionsResponseSchema,
  whatsAppConversationLinkPreviewResponseSchema,
  whatsAppConversationLinkResultResponseSchema,
  whatsAppHistoryResponseSchema,
  whatsAppMessageMediaURLResponseSchema,
  whatsAppMessagesResponseSchema,
  whatsAppOptionalConversationResponseSchema,
  whatsAppSessionAccessInputSchema,
  whatsAppSessionAccessResponseSchema,
  whatsAppSessionOperationResponseSchema,
  whatsAppSessionResponseSchema,
  whatsAppSessionStatusesResponseSchema,
  whatsAppSessionsResponseSchema,
  whatsAppSendStatusQuerySchema,
  whatsAppSendStatusResponseSchema,
  whatsAppUnreadCountResponseSchema,
} from '@/lib/validation'
import { vimobAPIRequest, getVimobAPIAccessTokenUserId } from '@/lib/api/vimob-client'
import { VimobAPIError } from '@/lib/api/vimob-error'
import { decodeWhatsAppPhoneChangeConfirmation } from '@/lib/whatsapp-phone-change'
export { getWhatsAppPhoneChangeConfirmation, type WhatsAppPhoneChangeConfirmation } from '@/lib/whatsapp-phone-change'

type Envelope<T> = {
  data: T
  meta?: unknown
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
  can_send?: boolean
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

export interface WhatsAppSessionQuota {
  maxSessions?: number | null
  currentSessions: number
  canCreate: boolean
}

export type WhatsAppSessionsResponse = Envelope<WhatsAppSession[]> & {
  meta?: WhatsAppSessionQuota
}

export type WhatsAppSessionStatusScope = 'organization' | 'team' | 'self'

export interface WhatsAppSessionStatusSummary {
  id: string
  display_name: string
  status: string
  phone_number: string | null
  profile_name: string | null
  last_connected_at: string | null
  updated_at: string
  owner: {
    id: string
    name: string
    avatar_url: string | null
  }
  capabilities: {
    can_manage: boolean
    can_set_notification_sender: boolean
  }
}

export type WhatsAppSessionStatusesResponse = {
  data: WhatsAppSessionStatusSummary[]
  meta: {
    scope: WhatsAppSessionStatusScope
  }
}

export type WhatsAppAccessMode = 'assigned_leads_only'

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
  session_id: string | null
  lead_id: string | null
  remote_jid: string
  contact_name: string | null
  contact_phone: string | null
  contact_picture: string | null
  contact_presence: string | null
  presence_updated_at: string | null
  last_message: string | null
  last_message_at: string | null
  last_message_from_me?: boolean | null
  last_message_status?: string | null
  last_message_id?: string | null
  last_message_sent_at?: string | null
  unread_count: number
  is_group: boolean
  archived_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
	historical_lead_view?: boolean
  supervisory_lead_view?: boolean
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
    source?: string | null
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
    assignee?: {
      id: string
      name: string
      avatar_url?: string | null
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

export interface WhatsAppConversationLinkPreview {
  conversationId: string
  sessionId: string
  sessionDisplayName: string
  contactDisplayName: string
  leadId: string | null
  expectedPreviousLeadId: string
  eligibleMessageCount: number
  firstEligibleAt: string | null
  lastEligibleAt: string | null
  expiresAt: string | null
  bindingMode: 'active' | 'history_only'
  futureOnly?: true
}

export interface WhatsAppConversationLinkResult {
  bindingMode: 'active' | 'history_only'
  attachedMessageCount: number
  historyFirstAt?: string | null
  historyLastAt?: string | null
  expiresAt?: string | null
  confirmedAt?: string | null
}

export type WhatsAppContactCard = { display_name: string; phones?: string[] }
export type WhatsAppLocation = { latitude: number; longitude: number; name?: string; address?: string }
export type WhatsAppQuotedMessage = {
  message_id: string
  available: boolean
  id?: string
  from_me?: boolean
  content?: string
  message_type?: string
  sender_name?: string
  sender_user_id?: string | null
  media_filename?: string
}

export interface WhatsAppMessage {
  id: string
  conversation_id: string
  session_id: string | null
  message_id: string
  client_message_id?: string | null
  from_me: boolean
  content: string | null
  message_type: string
  media_url: string | null
  media_mime_type: string | null
  media_filename?: string | null
  contacts?: WhatsAppContactCard[]
  location?: WhatsAppLocation
  quoted_message?: WhatsAppQuotedMessage
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
  can_quote?: boolean
  can_react?: boolean
  delivery_error_code?: 'recipient_not_registered' | 'outcome_unknown' | 'send_failed' | null
  delivery_error_reason?: 'media_integrity_unverified'
  delivery_failed_at?: string | null
  sent_at: string
  delivered_at: string | null
  read_at: string | null
  sender_jid: string | null
  sender_name: string | null
  sender_user_id?: string | null
}

export type WhatsAppMediaDownloadRequestData = {
  ok?: boolean
  message_id?: string
  queued?: boolean
  job_id?: string
  deduplicated?: boolean
  media_status?: 'pending' | 'ready' | 'failed'
  media_error?: string | null
  media_url?: string | null
  media_storage_path?: string | null
  already_ready?: boolean
}

export type WhatsAppMediaDownloadRequestResult = {
  ok: boolean
  data?: WhatsAppMediaDownloadRequestData
}

export interface ConversationFilters {
  pipelineId?: string
  teamId?: string
  userId?: string
  leadSource?: string
  tagIds?: string[]
  dealStatus?: 'open' | 'won' | 'lost'
  pageId?: string
  campaignIds?: string[]
  adSetId?: string
  adId?: string
  leadCreatedFrom?: string
  leadCreatedTo?: string
  hideGroups?: boolean
  showArchived?: boolean
  onlyLeads?: boolean
  withoutLead?: boolean
  pendingReply?: boolean
  search?: string
  lastMessageFrom?: string
  lastMessageTo?: string
}

export type WhatsAppConversationsPage = {
  conversations: WhatsAppConversation[]
  nextCursor: string | null
}

export type WhatsAppConversationFilterOptions = {
  pipelines: { id: string; name: string }[]
  teams: { id: string; name: string }[]
  users: { id: string; name: string }[]
  sources: string[]
  tags: { id: string; name: string; color?: string }[]
  pages: { id: string; name: string }[]
  campaigns: { id: string; name: string }[]
  adSets?: { id: string; name: string; campaignId: string }[]
  ads?: { id: string; name: string; campaignId: string; adsetId: string }[]
  hasMore?: boolean
  nextOffset?: number | null
}

export type WhatsAppUnreadCountResponse = {
  count: number
}

export type WhatsAppMessagesPage = {
  messages: WhatsAppMessage[]
  nextCursor: string | null
}

export type WhatsAppMessageMediaURL = {
  messageId: string
  url: string
  expiresIn: number
}

export type SendWhatsAppMessageInput = {
	text: string
	expectedLeadId: string
  mediaUrl?: string
  mediaType?: string
  base64?: string
  mimetype?: string
  filename?: string
  sendSessionId?: string
  clientMessageId?: string
  quotedMessageId?: string
}

export type SendWhatsAppMessageResult = Record<string, unknown> & {
  clientMessageId: string
  conversationId: string
  status?: string
  message?: WhatsAppMessage
  providerData?: Record<string, unknown>
  /** Local hook metadata: an explicit lookup of the original file intent. */
  fileIntentChecked?: boolean
  fileIntentResolution?: 'pending' | 'accepted' | 'failed' | 'cancelled'
}

export type WhatsAppAttendanceEntry = {
  id: string
  userId: string
  userName: string
  sessionId: string
  joinedAt: string
  entrySource: 'manual' | 'ctwa_auto'
  markerAt?: string | null
  markerKind?: 'started' | 'joined' | null
}

export type WhatsAppAttendanceState = {
  joined: boolean
  currentEntry: WhatsAppAttendanceEntry | null
  entries: WhatsAppAttendanceEntry[]
  created?: boolean
}

export type WhatsAppAttendanceRequest = {
  expectedLeadId: string
  sendSessionId: string
}

export type ReactWhatsAppMessageInput = {
	emoji: string
	clientReactionId: string
	expectedLeadId: string
}

export type ReactWhatsAppMessageResult = {
  clientReactionId: string
  conversationId: string
  targetMessageId: string
  targetProviderMessageId: string
  status: string
  reaction: WhatsAppMessage
}

export type AIAutoReplySessionInput = {
  enabled: boolean
  agentId?: string | null
  followUpEnabled?: boolean
  followUpIntervalDays?: number
  followUpTemplate?: string
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

export type WhatsAppRequestIntent = {
  signal?: AbortSignal
  expectedUserId?: string | null
  onRequestStart?: () => void
}

// Pin the actor before token resolution. The intent stays private to transport.
function requestWhatsAppAPI<T>(
  path: string,
  options: Parameters<typeof vimobAPIRequest>[1],
  intent?: WhatsAppRequestIntent,
) {
  return vimobAPIRequest<T>(path, {
    ...options,
    ...intent,
    expectedUserId: intent?.expectedUserId === undefined
      ? getVimobAPIAccessTokenUserId()
      : intent.expectedUserId,
  })
}

export const whatsappAPI = {
  async getSessions(organizationId?: string | null, timeoutMs?: number, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<WhatsAppSessionsResponse>('/v1/whatsapp/sessions', {
      organizationId,
      timeoutMs,
    }, transport)
    validateDomainResponse(whatsAppSessionsResponseSchema, response, 'whatsapp.sessions.list')
    return response
  },

  async getSessionStatuses(organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<WhatsAppSessionStatusesResponse>(
      '/v1/whatsapp/session-statuses',
      { organizationId }, transport,
    )
    validateDomainResponse(
      whatsAppSessionStatusesResponseSchema,
      response,
      'whatsapp.sessions.statuses',
    )
    return response
  },

  async createSession(input: { displayName: string; provider?: WhatsAppProvider }, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    const body = parseDomainInput(createWhatsAppSessionInputSchema, input, 'whatsapp.sessions.create')
    const response = await requestWhatsAppAPI<{ session: WhatsAppSession; evolutionData?: unknown }>('/v1/whatsapp/sessions', {
      method: 'POST',
      organizationId,
      body,
      timeoutMs: 30_000,
    }, transport)
    validateDomainResponse(whatsAppSessionOperationResponseSchema, response, 'whatsapp.sessions.create')
    return response
  },

  async getSession(sessionId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<Envelope<WhatsAppSession>>(`/v1/whatsapp/sessions/${sessionId}`, {
      organizationId,
    }, transport)
    validateDomainResponse(whatsAppSessionResponseSchema, response, 'whatsapp.sessions.get')
    return response.data
  },

  async deleteSession(sessionId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    await requestWhatsAppAPI<{ ok: boolean }>(`/v1/whatsapp/sessions/${sessionId}`, {
      method: 'DELETE',
      organizationId,
      skipTelemetry: true,
      timeoutMs: 15_000,
    }, transport)
  },

  async getQRCode(sessionId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    return requestWhatsAppAPI<WhatsAppQRCode>(`/v1/whatsapp/sessions/${sessionId}/qr`, {
      method: 'POST',
      organizationId,
      skipTelemetry: true,
      timeoutMs: 20_000,
    }, transport)
  },

  async getConnectionStatus(sessionId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    return requestWhatsAppAPI<WhatsAppConnectionStatus>(`/v1/whatsapp/sessions/${sessionId}/status`, {
      method: 'POST',
      organizationId,
      skipTelemetry: true,
      timeoutMs: 8_000,
    }, transport)
  },

  async recreateSession(sessionId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<{ session: WhatsAppSession; evolutionData?: unknown }>(
      `/v1/whatsapp/sessions/${sessionId}/recreate`,
      { method: 'POST', organizationId, skipTelemetry: true, timeoutMs: 30_000 }, transport,
    )
    validateDomainResponse(whatsAppSessionOperationResponseSchema, response, 'whatsapp.sessions.recreate')
    return response
  },

  async logoutSession(sessionId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    return requestWhatsAppAPI<{ ok: boolean; data?: unknown }>(`/v1/whatsapp/sessions/${sessionId}/logout`, {
      method: 'POST',
      organizationId,
      skipTelemetry: true,
      timeoutMs: 15_000,
    }, transport)
  },

  async toggleNotificationSession(sessionId: string, enabled: boolean, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    await requestWhatsAppAPI<{ ok: boolean }>(`/v1/whatsapp/sessions/${sessionId}/notification-session`, {
      method: 'POST',
      organizationId,
      body: { enabled },
    }, transport)
  },

  async toggleAIAutoReplySession(sessionId: string, input: AIAutoReplySessionInput, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    const body = parseDomainInput(whatsAppAIAutoReplyInputSchema, input, 'whatsapp.sessions.ai-auto-reply')
    await requestWhatsAppAPI<{ ok: boolean }>(`/v1/whatsapp/sessions/${sessionId}/ai-auto-reply`, {
      method: 'POST',
      organizationId,
      body,
    }, transport)
  },

  async getSessionAccess(sessionId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<Envelope<WhatsAppSessionAccess[]>>(
      `/v1/whatsapp/sessions/${sessionId}/access`,
      { organizationId }, transport,
    )
    validateDomainResponse(whatsAppSessionAccessResponseSchema, response, 'whatsapp.sessions.access.list')
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
    organizationId?: string | null, transport?: WhatsAppRequestIntent,
  ) {
    const body = parseDomainInput(whatsAppSessionAccessInputSchema, input, 'whatsapp.sessions.access.grant')
    await requestWhatsAppAPI<{ ok: boolean }>(`/v1/whatsapp/sessions/${sessionId}/access`, {
      method: 'POST',
      organizationId,
      body,
    }, transport)
  },

  async revokeSessionAccess(sessionId: string, userId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    await requestWhatsAppAPI<null>(`/v1/whatsapp/sessions/${sessionId}/access/${userId}`, {
      method: 'DELETE',
      organizationId,
    }, transport)
  },

  async getConversationsPage(params: {
    includeSupervisoryLeads?: boolean
    organizationId?: string | null
    sessionId?: string
    filters?: ConversationFilters
    accessibleSessionIds?: string[]
    limit?: number
    cursor?: string | null
  }, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<Envelope<WhatsAppConversation[]> & {
      meta?: { nextCursor?: string | null }
    }>('/v1/whatsapp/conversations', {
      organizationId: params.organizationId,
      query: parseDomainInput(whatsAppConversationListQuerySchema, {
        sessionId: params.sessionId,
        includeSupervisoryLeads: params.includeSupervisoryLeads,
        pipelineId: params.filters?.pipelineId,
        teamId: params.filters?.teamId,
        userId: params.filters?.userId,
        leadSource: params.filters?.leadSource,
        tagIds: params.filters?.tagIds,
        dealStatus: params.filters?.dealStatus,
        pageId: params.filters?.pageId,
        campaignIds: params.filters?.campaignIds,
        adSetId: params.filters?.adSetId,
        adId: params.filters?.adId,
        leadCreatedFrom: params.filters?.leadCreatedFrom,
        leadCreatedTo: params.filters?.leadCreatedTo,
        hideGroups: params.filters?.hideGroups,
        showArchived: params.filters?.showArchived,
        onlyLeads: params.filters?.onlyLeads,
        withoutLead: params.filters?.withoutLead,
        pendingReply: params.filters?.pendingReply,
        search: params.filters?.search,
        lastMessageFrom: params.filters?.lastMessageFrom,
        lastMessageTo: params.filters?.lastMessageTo,
        sessionIds: params.accessibleSessionIds?.join(','),
        limit: params.limit,
        cursor: params.cursor,
      }, 'whatsapp.conversations.list.filters'),
    }, transport)
    validateDomainResponse(whatsAppConversationsResponseSchema, response, 'whatsapp.conversations.list')
    return {
      conversations: response.data,
      nextCursor: response.meta?.nextCursor ?? null,
    } satisfies WhatsAppConversationsPage
  },

  async getConversations(params: {
    organizationId?: string | null
    sessionId?: string
    filters?: ConversationFilters
    accessibleSessionIds?: string[]
    limit?: number
  }, transport?: WhatsAppRequestIntent) {
    const page = await this.getConversationsPage(params, transport)
    return page.conversations
  },

  async getConversationFilterOptions(params: {
    includeSupervisoryLeads?: boolean
    organizationId?: string | null
    sessionId?: string
    accessibleSessionIds?: string[]
    showArchived?: boolean
    lastMessageFrom?: string
    lastMessageTo?: string
    pageId?: string
    campaignIds?: string[]
    adSetId?: string
    leadCreatedFrom?: string
    leadCreatedTo?: string
    optionsSearch?: string
    optionsOffset?: number
    optionsLimit?: number
  }, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<Envelope<WhatsAppConversationFilterOptions>>(
      '/v1/whatsapp/conversations/filter-options',
      {
        organizationId: params.organizationId,
        timeoutMs: 8_000,
        query: parseDomainInput(whatsAppConversationOptionsQuerySchema, {
          sessionId: params.sessionId,
          includeSupervisoryLeads: params.includeSupervisoryLeads,
          sessionIds: params.accessibleSessionIds?.join(','),
          hideGroups: true,
          showArchived: params.showArchived,
          lastMessageFrom: params.lastMessageFrom,
          lastMessageTo: params.lastMessageTo,
          pageId: params.pageId,
          campaignIds: params.campaignIds,
          adSetId: params.adSetId,
          leadCreatedFrom: params.leadCreatedFrom,
          leadCreatedTo: params.leadCreatedTo,
          expandedOptions: true,
          optionsSearch: params.optionsSearch,
          optionsOffset: params.optionsOffset,
          optionsLimit: params.optionsLimit,
        }, 'whatsapp.conversations.filter-options.filters'),
      }, transport,
    )
    validateDomainResponse(whatsAppConversationFilterOptionsResponseSchema, response, 'whatsapp.conversations.filter-options')
    return response.data
  },

  async getUnreadCount(params: {
    organizationId?: string | null
    sessionId?: string
    filters?: ConversationFilters
    accessibleSessionIds?: string[]
  }, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<WhatsAppUnreadCountResponse>(
      '/v1/whatsapp/conversations/unread-count',
      {
        organizationId: params.organizationId,
        query: parseDomainInput(whatsAppConversationListQuerySchema, {
          sessionId: params.sessionId,
          pipelineId: params.filters?.pipelineId,
          teamId: params.filters?.teamId,
          userId: params.filters?.userId,
          leadSource: params.filters?.leadSource,
          tagIds: params.filters?.tagIds,
          dealStatus: params.filters?.dealStatus,
          pageId: params.filters?.pageId,
          campaignIds: params.filters?.campaignIds,
          adSetId: params.filters?.adSetId,
          adId: params.filters?.adId,
          leadCreatedFrom: params.filters?.leadCreatedFrom,
          leadCreatedTo: params.filters?.leadCreatedTo,
          hideGroups: params.filters?.hideGroups,
          showArchived: params.filters?.showArchived,
          onlyLeads: params.filters?.onlyLeads,
          withoutLead: params.filters?.withoutLead,
          pendingReply: params.filters?.pendingReply,
          search: params.filters?.search,
          lastMessageFrom: params.filters?.lastMessageFrom,
          lastMessageTo: params.filters?.lastMessageTo,
          sessionIds: params.accessibleSessionIds?.join(','),
        }, 'whatsapp.conversations.unread-count.filters'),
      }, transport,
    )
    validateDomainResponse(whatsAppUnreadCountResponseSchema, response, 'whatsapp.conversations.unread-count')
    return response.count
  },

  async startConversation(input: {
    phone: string
    sessionId?: string
    leadId?: string
    leadName?: string
    expectedPreviousLeadId: string
    ownSessionOnly?: boolean
    startAttendance?: boolean
    confirmPhoneChange?: boolean
    expectedPreviousConversationId?: string
    confirmDestinationHistory?: boolean
    expectedDestinationConversationId?: string
  }, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    const body = parseDomainInput(startWhatsAppConversationInputSchema, input, 'whatsapp.conversations.start')
    const response = await requestWhatsAppAPI<Envelope<WhatsAppConversation>>('/v1/whatsapp/conversations/start', {
      method: 'POST',
      organizationId,
      body,
      decodeErrorData: decodeWhatsAppPhoneChangeConfirmation,
    }, transport)
    validateDomainResponse(whatsAppConversationResponseSchema, response, 'whatsapp.conversations.start')
    return response.data
  },

  async findConversation(params: {
    phone: string
    leadId?: string
    sessionId?: string
    organizationId?: string | null
  }, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<Envelope<WhatsAppConversation | null>>('/v1/whatsapp/conversations/find', {
      organizationId: params.organizationId,
      query: {
        phone: params.phone,
        leadId: params.leadId,
        sessionId: params.sessionId,
      },
    }, transport)
    validateDomainResponse(whatsAppOptionalConversationResponseSchema, response, 'whatsapp.conversations.find')
    return response.data
  },

  async getHistoryAccess(params: {
    conversationId?: string | null
    leadId: string
    allMessages?: boolean
    limit?: number
    cursor?: string | null
    includeMediaUrls?: boolean
    includeConversations?: boolean
    organizationId?: string | null
    signal?: AbortSignal
  }, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<Envelope<{
      conversation?: WhatsAppConversation
      conversations?: WhatsAppConversation[]
      messages: WhatsAppMessage[]
      nextCursor: string | null
    }>>(
      '/v1/whatsapp/history',
      {
        organizationId: params.organizationId,
        signal: params.signal,
        query: {
          conversationId: params.conversationId || undefined,
          leadId: params.leadId || undefined,
          allMessages: params.allMessages,
          includeMediaUrls: params.includeMediaUrls,
          includeConversations: params.includeConversations,
          limit: params.limit,
          cursor: params.cursor || undefined,
          orderingVersion: WHATSAPP_MESSAGE_ORDERING_VERSION,
        },
      }, transport,
    )
    validateDomainResponse(whatsAppHistoryResponseSchema, response, 'whatsapp.history')
    return response.data
  },

	async getConversation(conversationId: string, expectedLeadId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<Envelope<WhatsAppConversation>>(
      `/v1/whatsapp/conversations/${conversationId}`,
	  { organizationId, query: { expectedLeadId } }, transport,
    )
    validateDomainResponse(whatsAppConversationResponseSchema, response, 'whatsapp.conversations.get')
    return response.data
  },

  async getConversationSnapshot(conversationId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<Envelope<WhatsAppConversation>>(
      `/v1/whatsapp/conversations/${conversationId}/snapshot`,
      { organizationId }, transport,
    )
    validateDomainResponse(whatsAppConversationResponseSchema, response, 'whatsapp.conversations.snapshot')
    return response.data
  },

  async getMessages(params: {
    conversationId: string
    organizationId?: string | null
    limit?: number
    cursor?: string | null
    includeMediaUrls?: boolean
	expectedLeadId: string
  }, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<Envelope<WhatsAppMessagesPage>>(
      `/v1/whatsapp/conversations/${params.conversationId}/messages`,
      {
        organizationId: params.organizationId,
        query: {
          limit: params.limit,
          cursor: params.cursor,
          includeMediaUrls: params.includeMediaUrls,
          orderingVersion: WHATSAPP_MESSAGE_ORDERING_VERSION,
		  expectedLeadId: params.expectedLeadId,
        },
      }, transport,
    )
    validateDomainResponse(whatsAppMessagesResponseSchema, response, 'whatsapp.messages.list')
    return response.data
  },

  async getMessageMediaURL(messageId: string, organizationId?: string | null, options?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<Envelope<WhatsAppMessageMediaURL>>(
      `/v1/whatsapp/messages/${messageId}/media-url`,
      { organizationId, signal: options?.signal }, options,
    )
    validateDomainResponse(whatsAppMessageMediaURLResponseSchema, response, 'whatsapp.messages.media-url')
    return response.data
  },

	async markConversationAsRead(conversationId: string, expectedLeadId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
		await requestWhatsAppAPI<{ ok: boolean }>(`/v1/whatsapp/conversations/${conversationId}/mark-read`, {
			method: 'POST',
			organizationId,
			query: { expectedLeadId },
    }, transport)
  },

  async sendMessage(conversationId: string, input: SendWhatsAppMessageInput, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    const body = parseDomainInput(sendWhatsAppMessageInputSchema, input, 'whatsapp.messages.send')
    const response = await requestWhatsAppAPI<SendWhatsAppMessageResult>(`/v1/whatsapp/conversations/${conversationId}/send-message`, {
      method: 'POST',
      organizationId,
      body,
      timeoutMs: 30_000,
    }, transport)
    validateDomainResponse(sendWhatsAppMessageResponseSchema, response, 'whatsapp.messages.send')
    return response
  },

  async getSendStatus(params: {
    conversationId: string
    expectedLeadId: string
    clientMessageId: string
    organizationId?: string | null
    signal?: AbortSignal
  }, transport?: WhatsAppRequestIntent) {
    const query = parseDomainInput(whatsAppSendStatusQuerySchema, {
      expectedLeadId: params.expectedLeadId, clientMessageId: params.clientMessageId,
    }, 'whatsapp.messages.send-status')
    const response = await requestWhatsAppAPI<SendWhatsAppMessageResult>(
      `/v1/whatsapp/conversations/${params.conversationId}/send-status`,
      {
        organizationId: params.organizationId,
        signal: params.signal,
        query,
      }, transport,
    )
    validateDomainResponse(whatsAppSendStatusResponseSchema, response, 'whatsapp.messages.send-status')
    return response
  },

  async getConversationAttendance(
    conversationId: string,
    input: WhatsAppAttendanceRequest,
    organizationId?: string | null, transport?: WhatsAppRequestIntent,
  ) {
    const query = parseDomainInput(
      whatsAppAttendanceRequestSchema,
      input,
      'whatsapp.attendance.get',
    )
    const response = await requestWhatsAppAPI<Envelope<WhatsAppAttendanceState>>(
      `/v1/whatsapp/conversations/${conversationId}/attendance`,
      {
        organizationId,
        query,
      }, transport,
    )
    validateDomainResponse(
      whatsAppAttendanceResponseSchema,
      response,
      'whatsapp.attendance.get',
    )
    return response.data
  },

  async joinConversationAttendance(
    conversationId: string,
    input: WhatsAppAttendanceRequest,
    organizationId?: string | null, transport?: WhatsAppRequestIntent,
  ) {
    const body = parseDomainInput(
      whatsAppAttendanceRequestSchema,
      input,
      'whatsapp.attendance.join',
    )
    const response = await requestWhatsAppAPI<Envelope<WhatsAppAttendanceState>>(
      `/v1/whatsapp/conversations/${conversationId}/attendance`,
      {
        method: 'POST',
        organizationId,
        body,
      }, transport,
    )
    validateDomainResponse(
      whatsAppAttendanceResponseSchema,
      response,
      'whatsapp.attendance.join',
    )
    return response.data
  },

  async reactToMessage(
    conversationId: string,
    messageId: string,
    input: ReactWhatsAppMessageInput,
    organizationId?: string | null, transport?: WhatsAppRequestIntent,
  ) {
    const body = parseDomainInput(reactWhatsAppMessageInputSchema, input, 'whatsapp.messages.react')
    const response = await requestWhatsAppAPI<ReactWhatsAppMessageResult>(
      `/v1/whatsapp/conversations/${conversationId}/messages/${messageId}/reaction`,
      {
        method: 'POST',
        organizationId,
        body,
        timeoutMs: 30_000,
      }, transport,
    )
    validateDomainResponse(reactWhatsAppMessageResponseSchema, response, 'whatsapp.messages.react')
    return response
  },

	async markAsSeenOnWhatsApp(conversationId: string, expectedLeadId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
		await requestWhatsAppAPI<{ ok: boolean }>(`/v1/whatsapp/conversations/${conversationId}/mark-seen`, {
			method: 'POST',
			organizationId,
			query: { expectedLeadId },
		}, transport)
	},

	async archiveConversation(conversationId: string, archive: boolean, expectedLeadId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
		const response = await requestWhatsAppAPI<{ ok: boolean }>(`/v1/whatsapp/conversations/${conversationId}/archive`, {
			method: 'POST',
			organizationId,
			body: { archive, expectedLeadId },
		}, transport)
		if (response?.ok !== true) throw new VimobAPIError('O arquivamento não foi confirmado. Atualize a conversa e tente novamente.', {
			code: 'whatsapp_archive_not_confirmed', status: 502,
		})
	},

	async deleteConversation(conversationId: string, expectedLeadId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
		await requestWhatsAppAPI<{ ok: boolean }>(`/v1/whatsapp/conversations/${conversationId}`, {
			method: 'DELETE',
			organizationId,
			query: { expectedLeadId },
		}, transport)
  },

  async linkConversationToLead(
    conversationId: string,
    leadId: string,
    expectedPreviousLeadId: string,
    organizationId?: string | null, transport?: WhatsAppRequestIntent,
    ownSessionOnly?: boolean,
    futureOnly?: true,
  ) {
    const body = parseDomainInput(linkWhatsAppConversationLeadInputSchema, {
      leadId,
      expectedPreviousLeadId,
      ownSessionOnly,
      futureOnly,
    }, 'whatsapp.conversations.link-lead')
    const response = await requestWhatsAppAPI<{ ok: true; data: WhatsAppConversationLinkResult }>(`/v1/whatsapp/conversations/${conversationId}/link-lead`, {
      method: 'POST',
      organizationId,
      body,
    }, transport)
    validateDomainResponse(
      whatsAppConversationLinkResultResponseSchema,
      response,
      'whatsapp.conversations.link-lead',
    )
    return response.data
  },

  async getConversationLinkPreview(
    conversationId: string,
    expectedPreviousLeadId: string,
    leadId?: string | null,
    organizationId?: string | null, transport?: WhatsAppRequestIntent,
  ) {
    const response = await requestWhatsAppAPI<Envelope<WhatsAppConversationLinkPreview>>(
      `/v1/whatsapp/conversations/${conversationId}/link-preview`,
      {
        organizationId,
        query: { expectedPreviousLeadId, leadId: leadId || undefined },
      }, transport,
    )
    validateDomainResponse(
      whatsAppConversationLinkPreviewResponseSchema,
      response,
      'whatsapp.conversations.link-preview',
    )
    return response.data
  },

  async retryMediaDownload(messageId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    return requestWhatsAppAPI<WhatsAppMediaDownloadRequestResult>(`/v1/whatsapp/messages/${messageId}/retry-media`, {
      method: 'POST',
      organizationId,
    }, transport)
  },

  async getLabels(sessionId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<Envelope<WhatsAppLabel[]>>(`/v1/whatsapp/sessions/${sessionId}/labels`, {
      organizationId,
    }, transport)
    return response.data
  },

  async getChatLabels(conversationId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<Envelope<WhatsAppLabel[]>>(
      `/v1/whatsapp/conversations/${conversationId}/labels`,
      { organizationId }, transport,
    )
    return response.data
  },

  async syncLabels(sessionId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    return requestWhatsAppAPI<{ raw?: unknown; synced: number }>(`/v1/whatsapp/sessions/${sessionId}/labels/sync`, {
      method: 'POST',
      organizationId,
    }, transport)
  },

  async assignLabel(sessionId: string, input: {
    remoteJid: string
    labelId: string
    conversationId: string
    add: boolean
  }, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    return requestWhatsAppAPI<{ ok: boolean; data?: unknown }>(`/v1/whatsapp/sessions/${sessionId}/labels/assign`, {
      method: 'POST',
      organizationId,
      body: input,
    }, transport)
  },

  async getGroups(sessionId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<Envelope<WhatsAppGroup[]>>(`/v1/whatsapp/sessions/${sessionId}/groups`, {
      organizationId,
    }, transport)
    return response.data
  },

  async syncGroups(sessionId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    return requestWhatsAppAPI<{ ok: boolean; data?: unknown }>(`/v1/whatsapp/sessions/${sessionId}/groups/sync`, {
      method: 'POST',
      organizationId,
    }, transport)
  },

  async groupInfo(sessionId: string, jid: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    return requestWhatsAppAPI<{ ok: boolean; data?: unknown }>(`/v1/whatsapp/sessions/${sessionId}/groups/info`, {
      method: 'POST',
      organizationId,
      body: { jid },
    }, transport)
  },

  async groupInviteLink(sessionId: string, jid: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<{ ok: boolean; data?: unknown }>(
      `/v1/whatsapp/sessions/${sessionId}/groups/invite-link`,
      {
        method: 'POST',
        organizationId,
        body: { jid },
      }, transport,
    )
    return response.data
  },

  async updateGroup(sessionId: string, input: {
    jid: string
    field: 'name' | 'description' | 'photo'
    value: string
  }, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    return requestWhatsAppAPI<{ ok: boolean; data?: unknown }>(`/v1/whatsapp/sessions/${sessionId}/groups/update`, {
      method: 'POST',
      organizationId,
      body: input,
    }, transport)
  },

  async checkNumbers(sessionId: string, numbers: string[], organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<{ ok: boolean; data?: unknown }>(
      `/v1/whatsapp/sessions/${sessionId}/contacts/check`,
      {
        method: 'POST',
        organizationId,
        body: { numbers },
      }, transport,
    )
    return response.data
  },

  async fetchAvatar(sessionId: string, jid: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<{ ok: boolean; data?: unknown }>(
      `/v1/whatsapp/sessions/${sessionId}/contacts/avatar`,
      {
        method: 'POST',
        organizationId,
        body: { jid },
      }, transport,
    )
    return response.data
  },

  async syncContactsAvatars(sessionId: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    return requestWhatsAppAPI<{ ok: boolean; data?: unknown }>(`/v1/whatsapp/sessions/${sessionId}/contacts/sync`, {
      method: 'POST',
      organizationId,
    }, transport)
  },

  async historySync(sessionId: string, jid?: string, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    const response = await requestWhatsAppAPI<{ ok: boolean; data?: unknown }>(
      `/v1/whatsapp/sessions/${sessionId}/history-sync`,
      {
        method: 'POST',
        organizationId,
        body: { jid },
      }, transport,
    )
    return response.data
  },

  async providerAction<T = unknown>(input: {
    action: string
    session_id: string
    instance_id?: string
    body?: Record<string, unknown>
  }, organizationId?: string | null, transport?: WhatsAppRequestIntent) {
    return requestWhatsAppAPI<{ ok: boolean; data?: T; error?: string }>('/v1/whatsapp/provider-action', {
      method: 'POST',
      organizationId,
      body: input,
    }, transport)
  },
}
