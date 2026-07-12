import {
  apiSignedUrlResponseSchema,
  apiUnknownEnvelopeSchema,
  commissionRuleCreateInputSchema,
  commissionRuleUpdateInputSchema,
  contractActivationInputSchema,
  contractDocumentInputSchema,
  dreMappingInputSchema,
  financialActionInputSchema,
  financialCategoryInputSchema,
  financialContractCreateInputSchema,
  financialContractUpdateInputSchema,
  financialEntryCreateInputSchema,
  financialEntryUpdateInputSchema,
  parseDomainInput,
  validateDomainResponse,
} from '@/lib/validation'
import { vimobAPIRequest } from './vimob-client'

type Envelope<T> = { data: T }
type Query = Record<string, string | number | boolean | null | undefined>

export const financialAPI = {
  async listCategories<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/financial/categories', { organizationId })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.categories.list')
    return response.data
  },

  async createCategory<T>(body: unknown, organizationId?: string | null) {
    const validatedBody = parseDomainInput(financialCategoryInputSchema, body, 'financial.categories.create')
    const response = await vimobAPIRequest<Envelope<T>>('/v1/financial/categories', {
      method: 'POST',
      organizationId,
      body: validatedBody,
    })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.categories.create')
    return response.data
  },

  async listEntries<T>(query: Query = {}, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/financial/entries', { organizationId, query })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.entries.list')
    return response.data
  },

  async createEntry<T>(body: unknown, organizationId?: string | null) {
    const validatedBody = parseDomainInput(financialEntryCreateInputSchema, body, 'financial.entries.create')
    const response = await vimobAPIRequest<Envelope<T>>('/v1/financial/entries', {
      method: 'POST',
      organizationId,
      body: validatedBody,
    })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.entries.create')
    return response.data
  },

  async updateEntry<T>(id: string, body: unknown, organizationId?: string | null) {
    const validatedBody = parseDomainInput(financialEntryUpdateInputSchema, body, 'financial.entries.update')
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/financial/entries/${id}`, {
      method: 'PATCH',
      organizationId,
      body: validatedBody,
    })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.entries.update')
    return response.data
  },

  async deleteEntry(id: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/financial/entries/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async markEntryPaid<T>(id: string, body: unknown, organizationId?: string | null) {
    const validatedBody = parseDomainInput(financialActionInputSchema, body, 'financial.entries.pay')
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/financial/entries/${id}/pay`, {
      method: 'POST',
      organizationId,
      body: validatedBody,
    })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.entries.pay')
    return response.data
  },

  async dashboard<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/financial/dashboard', { organizationId })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.dashboard')
    return response.data
  },

  async listContracts<T>(query: Query = {}, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/contracts', { organizationId, query })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.contracts.list')
    return response.data
  },

  async getContract<T>(id: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/contracts/${id}`, { organizationId })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.contracts.get')
    return response.data
  },

  async createContract<T>(body: unknown, organizationId?: string | null) {
    const validatedBody = parseDomainInput(financialContractCreateInputSchema, body, 'financial.contracts.create')
    const response = await vimobAPIRequest<Envelope<T>>('/v1/contracts', {
      method: 'POST',
      organizationId,
      body: validatedBody,
    })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.contracts.create')
    return response.data
  },

  async updateContract<T>(id: string, body: unknown, organizationId?: string | null) {
    const validatedBody = parseDomainInput(financialContractUpdateInputSchema, body, 'financial.contracts.update')
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/contracts/${id}`, {
      method: 'PATCH',
      organizationId,
      body: validatedBody,
    })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.contracts.update')
    return response.data
  },

  async deleteContract(id: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/contracts/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async activateContract<T>(id: string, body: unknown, organizationId?: string | null) {
    const validatedBody = parseDomainInput(contractActivationInputSchema, body, 'financial.contracts.activate')
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/contracts/${id}/activate`, {
      method: 'POST',
      organizationId,
      body: validatedBody,
    })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.contracts.activate')
    return response.data
  },

  async regenerateCommissions<T>(id: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/contracts/${id}/regenerate-commissions`, {
      method: 'POST',
      organizationId,
      body: {},
    })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.contracts.regenerate-commissions')
    return response.data
  },

  async listContractDocuments<T>(id: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/contracts/${id}/documents`, { organizationId })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.contracts.documents.list')
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
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.contracts.documents.upload')
    return response.data
  },

  async deleteContractDocument(id: string, path: string, organizationId?: string | null) {
    const body = parseDomainInput(contractDocumentInputSchema, { path }, 'financial.contracts.documents.delete')
    await vimobAPIRequest<{ ok: boolean }>(`/v1/contracts/${id}/documents`, {
      method: 'DELETE',
      organizationId,
      body,
    })
  },

  async contractDocumentSignedURL(id: string, path: string, organizationId?: string | null) {
    const body = parseDomainInput(contractDocumentInputSchema, { path }, 'financial.contracts.documents.signed-url')
    const response = await vimobAPIRequest<Envelope<{ signedUrl: string }>>(`/v1/contracts/${id}/documents/signed-url`, {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiSignedUrlResponseSchema, response, 'financial.contracts.documents.signed-url')
    return response.data.signedUrl
  },

  async listCommissionRules<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/commission-rules', { organizationId })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.commission-rules.list')
    return response.data
  },

  async createCommissionRule<T>(body: unknown, organizationId?: string | null) {
    const validatedBody = parseDomainInput(commissionRuleCreateInputSchema, body, 'financial.commission-rules.create')
    const response = await vimobAPIRequest<Envelope<T>>('/v1/commission-rules', {
      method: 'POST',
      organizationId,
      body: validatedBody,
    })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.commission-rules.create')
    return response.data
  },

  async updateCommissionRule<T>(id: string, body: unknown, organizationId?: string | null) {
    const validatedBody = parseDomainInput(commissionRuleUpdateInputSchema, body, 'financial.commission-rules.update')
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/commission-rules/${id}`, {
      method: 'PATCH',
      organizationId,
      body: validatedBody,
    })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.commission-rules.update')
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
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.commissions.list')
    return response.data
  },

  async commissionAction<T>(id: string, action: 'approve' | 'pay' | 'cancel', body: unknown, organizationId?: string | null) {
    const validatedBody = parseDomainInput(financialActionInputSchema, body, `financial.commissions.${action}`)
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/commissions/${id}/${action}`, {
      method: 'POST',
      organizationId,
      body: validatedBody,
    })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, `financial.commissions.${action}`)
    return response.data
  },

  async commissionsByBroker<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/commissions/by-broker', { organizationId })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.commissions.by-broker')
    return response.data
  },

  async dreInput<T>(query: Query, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/dre/input', { organizationId, query })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.dre.input')
    return response.data
  },

  async dreGroups<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/dre/groups', { organizationId })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.dre.groups')
    return response.data
  },

  async dreMappings<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/dre/mappings', { organizationId })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.dre.mappings')
    return response.data
  },

  async createDREMapping<T>(body: unknown, organizationId?: string | null) {
    const validatedBody = parseDomainInput(dreMappingInputSchema, body, 'financial.dre.mappings.create')
    const response = await vimobAPIRequest<Envelope<T>>('/v1/dre/mappings', {
      method: 'POST',
      organizationId,
      body: validatedBody,
    })
    validateDomainResponse(apiUnknownEnvelopeSchema, response, 'financial.dre.mappings.create')
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
