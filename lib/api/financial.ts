import { vimobAPIRequest } from './vimob-client'

type Envelope<T> = { data: T }
type Query = Record<string, string | number | boolean | null | undefined>

export const financialAPI = {
  async listCategories<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/financial/categories', { organizationId })
    return response.data
  },

  async createCategory<T>(body: unknown, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/financial/categories', {
      method: 'POST',
      organizationId,
      body,
    })
    return response.data
  },

  async listEntries<T>(query: Query = {}, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/financial/entries', { organizationId, query })
    return response.data
  },

  async createEntry<T>(body: unknown, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/financial/entries', {
      method: 'POST',
      organizationId,
      body,
    })
    return response.data
  },

  async updateEntry<T>(id: string, body: unknown, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/financial/entries/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    return response.data
  },

  async deleteEntry(id: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/financial/entries/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async markEntryPaid<T>(id: string, body: unknown, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/financial/entries/${id}/pay`, {
      method: 'POST',
      organizationId,
      body,
    })
    return response.data
  },

  async dashboard<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/financial/dashboard', { organizationId })
    return response.data
  },

  async listContracts<T>(query: Query = {}, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/contracts', { organizationId, query })
    return response.data
  },

  async getContract<T>(id: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/contracts/${id}`, { organizationId })
    return response.data
  },

  async createContract<T>(body: unknown, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/contracts', {
      method: 'POST',
      organizationId,
      body,
    })
    return response.data
  },

  async updateContract<T>(id: string, body: unknown, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/contracts/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    return response.data
  },

  async deleteContract(id: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/contracts/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async activateContract<T>(id: string, body: unknown, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/contracts/${id}/activate`, {
      method: 'POST',
      organizationId,
      body,
    })
    return response.data
  },

  async regenerateCommissions<T>(id: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/contracts/${id}/regenerate-commissions`, {
      method: 'POST',
      organizationId,
      body: {},
    })
    return response.data
  },

  async listContractDocuments<T>(id: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/contracts/${id}/documents`, { organizationId })
    return response.data
  },

  async uploadContractDocument<T>(id: string, file: File, organizationId?: string | null) {
    const formData = new FormData()
    formData.append('file', file)
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/contracts/${id}/documents`, {
      method: 'POST',
      organizationId,
      body: formData,
    })
    return response.data
  },

  async deleteContractDocument(id: string, path: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/contracts/${id}/documents`, {
      method: 'DELETE',
      organizationId,
      body: { path },
    })
  },

  async contractDocumentSignedURL(id: string, path: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<{ signedUrl: string }>>(`/v1/contracts/${id}/documents/signed-url`, {
      method: 'POST',
      organizationId,
      body: { path },
    })
    return response.data.signedUrl
  },

  async listCommissionRules<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/commission-rules', { organizationId })
    return response.data
  },

  async createCommissionRule<T>(body: unknown, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/commission-rules', {
      method: 'POST',
      organizationId,
      body,
    })
    return response.data
  },

  async updateCommissionRule<T>(id: string, body: unknown, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/commission-rules/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    return response.data
  },

  async deleteCommissionRule(id: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/commission-rules/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async listCommissions<T>(query: Query = {}, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/commissions', { organizationId, query })
    return response.data
  },

  async commissionAction<T>(id: string, action: 'approve' | 'pay' | 'cancel', body: unknown, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/commissions/${id}/${action}`, {
      method: 'POST',
      organizationId,
      body,
    })
    return response.data
  },

  async commissionsByBroker<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/commissions/by-broker', { organizationId })
    return response.data
  },

  async dreInput<T>(query: Query, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/dre/input', { organizationId, query })
    return response.data
  },

  async dreGroups<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/dre/groups', { organizationId })
    return response.data
  },

  async dreMappings<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/dre/mappings', { organizationId })
    return response.data
  },

  async createDREMapping<T>(body: unknown, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/dre/mappings', {
      method: 'POST',
      organizationId,
      body,
    })
    return response.data
  },

  async deleteDREMapping(id: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/dre/mappings/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async initializeDREGroups(organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>('/v1/dre/groups/initialize', {
      method: 'POST',
      organizationId,
      body: {},
    })
  },
}
