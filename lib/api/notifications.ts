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
  created_at: string
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
  }) {
    const response = await vimobAPIRequest<Envelope<Notification>>('/v1/notifications', {
      method: 'POST',
      body: notification,
    })
    return response.data
  },
}
