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
  metadata?: Record<string, unknown> | null
  created_at: string
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
  whatsapp?: {
    enabled: boolean
    attempted: boolean
    ok: boolean
    status?: number
    error?: string
  }
  error?: string
}

export const notificationsAPI = {
  async list(params: { userId?: string; limit?: number } = {}) {
    const response = await vimobAPIRequest<Envelope<Notification[]>>('/v1/notifications', {
      query: {
        userId: params.userId,
        limit: params.limit,
      },
    })
    return response.data
  },

  async unreadCount(userId?: string) {
    return vimobAPIRequest<{ count: number }>('/v1/notifications/unread-count', {
      query: { userId },
    })
  },

  async markRead(id: string) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/notifications/${id}/read`, {
      method: 'POST',
    })
  },

  async markAllRead() {
    await vimobAPIRequest<{ ok: boolean }>('/v1/notifications/read-all', {
      method: 'POST',
    })
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
    const response = await vimobAPIRequest<Envelope<Notification>>('/v1/notifications', {
      method: 'POST',
      body: notification,
    })
    return response.data
  },

  async dispatch(input: DispatchNotificationInput) {
    return vimobAPIRequest<DispatchNotificationResult>('/v1/notifications/dispatch', {
      method: 'POST',
      organizationId: input.organizationId,
      body: {
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
      },
    })
  },
}
