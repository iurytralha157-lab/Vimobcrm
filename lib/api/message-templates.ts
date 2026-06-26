import { vimobAPIRequest } from './vimob-client'

export interface MessageTemplate {
  id: string
  organization_id: string
  name: string
  content: string
  category: string
  variables: string[]
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CreateTemplateInput {
  name: string
  content: string
  category?: string
  variables?: string[]
}

export type UpdateTemplateInput = Partial<Omit<CreateTemplateInput, 'variables'>>

type MessageTemplateListResponse = {
  data: MessageTemplate[]
}

type MessageTemplateResponse = {
  data: MessageTemplate
}

export const messageTemplatesAPI = {
  async list(organizationId?: string | null) {
    const response = await vimobAPIRequest<MessageTemplateListResponse>('/v1/whatsapp/message-templates', {
      organizationId,
    })

    return response.data
  },

  async create(input: CreateTemplateInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<MessageTemplateResponse>('/v1/whatsapp/message-templates', {
      method: 'POST',
      organizationId,
      body: input,
    })

    return response.data
  },

  async update(id: string, input: UpdateTemplateInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<MessageTemplateResponse>(`/v1/whatsapp/message-templates/${id}`, {
      method: 'PATCH',
      organizationId,
      body: input,
    })

    return response.data
  },

  async remove(id: string, organizationId?: string | null) {
    await vimobAPIRequest<null>(`/v1/whatsapp/message-templates/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },
}
