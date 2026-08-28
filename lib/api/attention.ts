import {
  acknowledgeAttentionItemInputSchema,
  apiAttentionItemPageResponseSchema,
  apiAttentionItemResponseSchema,
  apiAttentionPolicyListResponseSchema,
  apiAttentionPolicyResponseSchema,
  apiAttentionSummaryResponseSchema,
  apiAttentionSettingsResponseSchema,
  attentionItemStatusSchema,
  attentionScopeSchema,
  createAttentionPolicyInputSchema,
  parseDomainInput,
  resolveAttentionItemInputSchema,
  snoozeAttentionItemInputSchema,
  updateAttentionPolicyInputSchema,
  updateAttentionSettingsInputSchema,
  uuidSchema,
  validateDomainResponse,
  type AttentionItem,
  type AttentionItemPage,
  type AttentionItemStatus,
  type AttentionEngineMode,
  type AttentionPolicy,
  type AttentionPolicyStatus,
  type AttentionPolicyType,
  type AttentionScope,
  type AttentionSummary,
  type AttentionSettings,
  type CreateAttentionPolicyInput,
  type UpdateAttentionPolicyInput,
  type UpdateAttentionSettingsInput,
} from '@/lib/validation'

import { vimobAPIRequest } from './vimob-client'

type Envelope<T> = { data: T }

export type AttentionItemListParams = {
  scope: AttentionScope
  status?: AttentionItemStatus
  limit?: number
  cursor?: string
  organizationId?: string | null
}

export const attentionAPI = {
  async listItems(params: AttentionItemListParams): Promise<AttentionItemPage> {
    const scope = parseDomainInput(attentionScopeSchema, params.scope, 'attention.items.scope')
    const status = params.status
      ? parseDomainInput(attentionItemStatusSchema, params.status, 'attention.items.status')
      : undefined
    const response = await vimobAPIRequest<Envelope<AttentionItemPage>>('/v1/attention/items', {
      organizationId: params.organizationId,
      query: {
        scope,
        status,
        limit: params.limit,
        cursor: params.cursor,
      },
    })
    validateDomainResponse(apiAttentionItemPageResponseSchema, response, 'attention.items.list')
    return response.data
  },

  async getSummary(scope: AttentionScope, organizationId?: string | null): Promise<AttentionSummary> {
    const parsedScope = parseDomainInput(attentionScopeSchema, scope, 'attention.summary.scope')
    const response = await vimobAPIRequest<Envelope<AttentionSummary>>('/v1/attention/summary', {
      organizationId,
      query: { scope: parsedScope },
    })
    validateDomainResponse(apiAttentionSummaryResponseSchema, response, 'attention.summary')
    return response.data
  },

  async getSettings(organizationId?: string | null): Promise<AttentionSettings> {
    const response = await vimobAPIRequest<Envelope<AttentionSettings>>('/v1/attention/settings', {
      organizationId,
    })
    validateDomainResponse(apiAttentionSettingsResponseSchema, response, 'attention.settings.get')
    return response.data
  },

  async updateSettings(input: UpdateAttentionSettingsInput, organizationId?: string | null): Promise<AttentionSettings> {
    const body = parseDomainInput(updateAttentionSettingsInputSchema, input, 'attention.settings.update')
    const response = await vimobAPIRequest<Envelope<AttentionSettings>>('/v1/attention/settings', {
      method: 'PATCH',
      organizationId,
      body,
    })
    validateDomainResponse(apiAttentionSettingsResponseSchema, response, 'attention.settings.update')
    return response.data
  },

  async acknowledgeItem(id: string, note?: string, organizationId?: string | null): Promise<AttentionItem> {
    const itemId = parseDomainInput(uuidSchema, id, 'attention.items.acknowledge.id')
    const body = parseDomainInput(acknowledgeAttentionItemInputSchema, { note }, 'attention.items.acknowledge')
    const response = await vimobAPIRequest<Envelope<AttentionItem>>(`/v1/attention/items/${itemId}/acknowledge`, {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiAttentionItemResponseSchema, response, 'attention.items.acknowledge')
    return response.data
  },

  async snoozeItem(id: string, minutes: number, note?: string, organizationId?: string | null): Promise<AttentionItem> {
    const itemId = parseDomainInput(uuidSchema, id, 'attention.items.snooze.id')
    const body = parseDomainInput(snoozeAttentionItemInputSchema, { minutes, note }, 'attention.items.snooze')
    const response = await vimobAPIRequest<Envelope<AttentionItem>>(`/v1/attention/items/${itemId}/snooze`, {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiAttentionItemResponseSchema, response, 'attention.items.snooze')
    return response.data
  },

  async resolveItem(
    id: string,
    reason: string,
    note?: string,
    organizationId?: string | null,
    administrativeOverride = false,
  ): Promise<AttentionItem> {
    const itemId = parseDomainInput(uuidSchema, id, 'attention.items.resolve.id')
    const body = parseDomainInput(
      resolveAttentionItemInputSchema,
      { reason, note, administrativeOverride },
      'attention.items.resolve',
    )
    const response = await vimobAPIRequest<Envelope<AttentionItem>>(`/v1/attention/items/${itemId}/resolve`, {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiAttentionItemResponseSchema, response, 'attention.items.resolve')
    return response.data
  },

  async listPolicies(organizationId?: string | null): Promise<AttentionPolicy[]> {
    const response = await vimobAPIRequest<Envelope<AttentionPolicy[]>>('/v1/attention/policies', {
      organizationId,
    })
    validateDomainResponse(apiAttentionPolicyListResponseSchema, response, 'attention.policies.list')
    return response.data
  },

  async createPolicy(input: CreateAttentionPolicyInput, organizationId?: string | null): Promise<AttentionPolicy> {
    const body = parseDomainInput(createAttentionPolicyInputSchema, input, 'attention.policies.create')
    const response = await vimobAPIRequest<Envelope<AttentionPolicy>>('/v1/attention/policies', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiAttentionPolicyResponseSchema, response, 'attention.policies.create')
    return response.data
  },

  async updatePolicy(id: string, input: UpdateAttentionPolicyInput, organizationId?: string | null): Promise<AttentionPolicy> {
    const policyId = parseDomainInput(uuidSchema, id, 'attention.policies.update.id')
    const body = parseDomainInput(updateAttentionPolicyInputSchema, input, 'attention.policies.update')
    const response = await vimobAPIRequest<Envelope<AttentionPolicy>>(`/v1/attention/policies/${policyId}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    validateDomainResponse(apiAttentionPolicyResponseSchema, response, 'attention.policies.update')
    return response.data
  },
}

export type {
  AttentionEngineMode,
  AttentionItem,
  AttentionItemStatus,
  AttentionPolicy,
  AttentionPolicyStatus,
  AttentionPolicyType,
  AttentionScope,
  AttentionSummary,
  AttentionSettings,
  CreateAttentionPolicyInput,
  UpdateAttentionPolicyInput,
  UpdateAttentionSettingsInput,
}
