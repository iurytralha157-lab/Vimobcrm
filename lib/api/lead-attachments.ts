import { vimobAPIRequest } from './vimob-client'

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
    const response = await vimobAPIRequest<Envelope<LeadAttachment[]>>('/v1/lead-attachments', {
      query: { leadId },
    })
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
    const response = await vimobAPIRequest<Envelope<LeadAttachment>>('/v1/lead-attachments', {
      method: 'POST',
      body: attachment,
    })
    return response.data
  },

  async upload(leadId: string, file: File) {
    const body = new FormData()
    body.append('file', file)

    const response = await vimobAPIRequest<Envelope<LeadAttachment>>(`/v1/leads/${leadId}/attachments`, {
      method: 'POST',
      body,
    })
    return response.data
  },
}
