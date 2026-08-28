import {
  apiDispatchNotificationResponseSchema,
  apiNotificationListResponseSchema,
  apiNotificationResponseSchema,
  apiUnreadCountResponseSchema,
  createNotificationInputSchema,
  dispatchNotificationInputSchema,
  okResponseSchema,
  parseDomainInput,
  validateDomainResponse,
} from '@/lib/validation'
import { vimobAPIRequest } from './vimob-client'

type Envelope<T> = {
  data: T
}

export interface Notification {
  id: string
  user_id: string
  organization_id: string
  title: string
  content: string | null
  type: string
  is_read: boolean
  lead_id: string | null
  target_url?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
}

export interface NotificationPage {
  notifications: Notification[]
  nextCursor: string | null
}

export interface DispatchNotificationInput {
  eventKey?: string
  templateSlug?: string
  organizationId: string
  userId?: string
  recipient?: string
  title?: string
  content?: string
  variables?: Record<string, unknown>
  leadId?: string
  dedupeKey?: string
  isTest?: boolean
  channels?: Array<'system' | 'whatsapp' | 'email' | 'push'>
}

export interface DispatchNotificationResult {
  success: boolean
  notification?: Notification
  whatsapp?: DispatchChannelResult
  push?: DispatchChannelResult
  email?: DispatchChannelResult
  error?: string
}

export interface DispatchChannelResult {
    enabled: boolean
    attempted: boolean
    ok: boolean
    status?: number
    error?: string
    provider?: string
    session_id?: string
    instance_id?: string
    sent?: number
    skipped?: number
}

export const notificationsAPI = {
  async list(params: { userId?: string; limit?: number; cursor?: string | null } = {}): Promise<NotificationPage> {
    const response = await vimobAPIRequest<Envelope<Notification[]> & { next_cursor?: string | null }>('/v1/notifications', {
      query: {
        userId: params.userId,
        limit: params.limit,
        cursor: params.cursor || undefined,
      },
    })
    validateDomainResponse(apiNotificationListResponseSchema, response, 'notifications.list')
    return {
      notifications: response.data,
      nextCursor: response.next_cursor || null,
    }
  },

  async unreadCount(userId?: string) {
    const response = await vimobAPIRequest<{ count: number }>('/v1/notifications/unread-count', {
      query: { userId },
    })
    validateDomainResponse(apiUnreadCountResponseSchema, response, 'notifications.unread-count')
    return response
  },

  async markRead(id: string) {
    const response = await vimobAPIRequest<{ ok: boolean }>(`/v1/notifications/${id}/read`, {
      method: 'POST',
    })
    validateDomainResponse(okResponseSchema, response, 'notifications.mark-read')
  },

  async markAllRead() {
    const response = await vimobAPIRequest<{ ok: boolean }>('/v1/notifications/read-all', {
      method: 'POST',
    })
    validateDomainResponse(okResponseSchema, response, 'notifications.mark-all-read')
  },

  async create(notification: {
    user_id: string
    organization_id: string
    title: string
    content?: string
    type?: string
    lead_id?: string
    metadata?: Record<string, unknown>
  }) {
    const body = parseDomainInput(createNotificationInputSchema, notification, 'notifications.create')
    const response = await vimobAPIRequest<Envelope<Notification>>('/v1/notifications', {
      method: 'POST',
      body,
    })
    validateDomainResponse(apiNotificationResponseSchema, response, 'notifications.create')
    return response.data
  },

  async dispatch(input: DispatchNotificationInput) {
    const body = parseDomainInput(dispatchNotificationInputSchema, {
      event_key: input.eventKey,
      template_slug: input.templateSlug,
      organization_id: input.organizationId,
      user_id: input.userId,
      recipient: input.recipient,
      title: input.title,
      content: input.content,
      variables: input.variables || {},
      lead_id: input.leadId,
      dedupe_key: input.dedupeKey,
      is_test: input.isTest,
      channels: input.channels,
    }, 'notifications.dispatch')
    const response = await vimobAPIRequest<DispatchNotificationResult>('/v1/notifications/dispatch', {
      method: 'POST',
      organizationId: input.organizationId,
      body,
    })
    validateDomainResponse(apiDispatchNotificationResponseSchema, response, 'notifications.dispatch')
    return response
  },
}
