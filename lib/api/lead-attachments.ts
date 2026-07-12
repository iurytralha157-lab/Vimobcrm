import { vimobAPIRequest } from './vimob-client'
import { apiLeadAttachmentListResponseSchema, apiLeadAttachmentResponseSchema, entityIdSchema, leadAttachmentCreateInputSchema, parseDomainInput, validateDomainResponse } from '@/lib/validation'

export interface LeadAttachment {
  id: string
  lead_id: string
  file_name: string
  file_url: string
  file_type: string | null
  file_size: number | null
  created_at: string
  created_by: string | null
  message_id: string | null
}

type Envelope<T> = {
  data: T
}

export const leadAttachmentsAPI = {
  async list(leadId: string) {
    const id = parseDomainInput(entityIdSchema, leadId, 'lead-attachments.list.id')
    const response = await vimobAPIRequest<Envelope<LeadAttachment[]>>('/v1/lead-attachments', {
      query: { leadId: id },
    })
    validateDomainResponse(apiLeadAttachmentListResponseSchema, response, 'lead-attachments.list')
    return response.data
  },

  async create(attachment: {
    lead_id: string
    file_name: string
    file_url: string
    file_type?: string
    file_size?: number
    message_id?: string
  }) {
    const body = parseDomainInput(leadAttachmentCreateInputSchema, attachment, 'lead-attachments.create')
    const response = await vimobAPIRequest<Envelope<LeadAttachment>>('/v1/lead-attachments', {
      method: 'POST',
      body,
    })
    validateDomainResponse(apiLeadAttachmentResponseSchema, response, 'lead-attachments.create')
    return response.data
  },

  async upload(leadId: string, file: File) {
    const id = parseDomainInput(entityIdSchema, leadId, 'lead-attachments.upload.id')
    const body = new FormData()
    body.append('file', file)

    const response = await vimobAPIRequest<Envelope<LeadAttachment>>(`/v1/leads/${id}/attachments`, {
      method: 'POST',
      body,
    })
    validateDomainResponse(apiLeadAttachmentResponseSchema, response, 'lead-attachments.upload')
    return response.data
  },
}
