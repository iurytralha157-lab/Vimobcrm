import { vimobAPIRequest } from './vimob-client'
import { apiMessageTemplateListResponseSchema, apiMessageTemplateResponseSchema, entityIdSchema, messageTemplateCreateInputSchema, messageTemplateUpdateInputSchema, parseDomainInput, validateDomainResponse } from '@/lib/validation'

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
    validateDomainResponse(apiMessageTemplateListResponseSchema, response, 'message-templates.list')

    return response.data
  },

  async create(input: CreateTemplateInput, organizationId?: string | null) {
    const body = parseDomainInput(messageTemplateCreateInputSchema, input, 'message-templates.create')
    const response = await vimobAPIRequest<MessageTemplateResponse>('/v1/whatsapp/message-templates', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiMessageTemplateResponseSchema, response, 'message-templates.create')

    return response.data
  },

  async update(id: string, input: UpdateTemplateInput, organizationId?: string | null) {
    const templateId = parseDomainInput(entityIdSchema, id, 'message-templates.update.id')
    const body = parseDomainInput(messageTemplateUpdateInputSchema, input, 'message-templates.update')
    const response = await vimobAPIRequest<MessageTemplateResponse>(`/v1/whatsapp/message-templates/${templateId}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    validateDomainResponse(apiMessageTemplateResponseSchema, response, 'message-templates.update')

    return response.data
  },

  async remove(id: string, organizationId?: string | null) {
    const templateId = parseDomainInput(entityIdSchema, id, 'message-templates.remove.id')
    await vimobAPIRequest<null>(`/v1/whatsapp/message-templates/${templateId}`, {
      method: 'DELETE',
      organizationId,
    })
  },
}
