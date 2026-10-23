import { getVimobAPIAccessTokenSessionId, getVimobAPIAccessTokenUserId, vimobAPIRequest } from './vimob-client'
import type { VimobAPIRequestIntent } from './vimob-client'
import { getLeadAttachmentUploadReceipt } from '@/lib/lead-attachment-upload'
import { apiLeadAttachmentListResponseSchema, apiLeadAttachmentResponseSchema, entityIdSchema, leadAttachmentCreateInputSchema, parseDomainInput, validateDomainResponse } from '@/lib/validation'

export interface LeadAttachment {
  id: string
  lead_id: string
  file_name: string
  file_url: string | null
  availability?: 'ready' | 'signing_unavailable' | 'not_requested'
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
  async list(leadId: string, organizationId?: string | null, intent?: VimobAPIRequestIntent, { metadataOnly = false }: { metadataOnly?: boolean } = {}) {
    const id = parseDomainInput(entityIdSchema, leadId, 'lead-attachments.list.id')
    const response = await vimobAPIRequest<Envelope<LeadAttachment[]>>('/v1/lead-attachments', {
      ...intent,
      organizationId,
      query: { leadId: id, ...(metadataOnly ? { metadataOnly: true } : {}) },
    })
    validateDomainResponse(apiLeadAttachmentListResponseSchema, response, 'lead-attachments.list')
    return response.data
  },

  async access(leadId: string, attachmentId: string, organizationId?: string | null, intent?: VimobAPIRequestIntent) {
    const id = parseDomainInput(entityIdSchema, leadId, 'lead-attachments.access.leadId')
    const documentId = parseDomainInput(entityIdSchema, attachmentId, 'lead-attachments.access.attachmentId')
    const response = await vimobAPIRequest<Envelope<LeadAttachment>>(`/v1/leads/${id}/attachments/${documentId}/access`, {
      ...intent, organizationId,
    })
    validateDomainResponse(apiLeadAttachmentResponseSchema, response, 'lead-attachments.access')
    if (response.data.id !== documentId || response.data.lead_id !== id || response.data.availability === 'not_requested') {
      throw new Error('Não foi possível confirmar o acesso a este documento.')
    }
    return response.data
  },

  async create(attachment: {
    lead_id: string
    file_name: string
    file_url: string
    file_type?: string
    file_size?: number
    message_id?: string
  }, organizationId?: string | null, intent?: VimobAPIRequestIntent) {
    const body = parseDomainInput(leadAttachmentCreateInputSchema, attachment, 'lead-attachments.create')
    const response = await vimobAPIRequest<Envelope<LeadAttachment>>('/v1/lead-attachments', {
      ...intent,
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiLeadAttachmentResponseSchema, response, 'lead-attachments.create')
    return response.data
  },

  async upload(leadId: string, file: File, organizationId?: string | null, intent?: VimobAPIRequestIntent) {
    const id = parseDomainInput(entityIdSchema, leadId, 'lead-attachments.upload.id')
    const userId = intent?.expectedUserId ?? getVimobAPIAccessTokenUserId()
    const sessionId = intent?.expectedSessionId ?? getVimobAPIAccessTokenSessionId()
    if (!organizationId || !userId || !sessionId) throw new Error('A organização e uma sessão ativa são necessárias para enviar documentos.')
    const receipt = getLeadAttachmentUploadReceipt(file, { organizationId, leadId: id, userId, sessionId })
    const body = new FormData()
    body.append('file', file)
    body.append('uploadRequestKey', receipt.uploadRequestKey)

    const response = await vimobAPIRequest<Envelope<LeadAttachment>>(`/v1/leads/${id}/attachment-uploads`, {
      ...intent,
      expectedUserId: receipt.userId,
      expectedSessionId: receipt.sessionId,
      timeoutMs: 60_000,
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiLeadAttachmentResponseSchema, response, 'lead-attachments.upload')
    return response.data
  },
}
