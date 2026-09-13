import { vimobAPIRequest } from './vimob-client'
import {
  apiMeProfileResponseSchema,
  apiMeResponseSchema,
} from '@/lib/validation/auth-context'
import {
  entityIdSchema,
  okResponseSchema,
  parseDomainInput,
  validateDomainResponse,
} from '@/lib/validation'

export type {
  MeProfileResponse,
  MeResponse,
  Organization as MeOrganization,
  TenantContext,
  UserProfile as MeProfile,
} from '@/lib/validation/auth-context'

export const meAPI = {
  async getMe(organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>('/v1/me', {
      organizationId,
    })
    return validateDomainResponse(apiMeResponseSchema, response, 'me.get')
  },

  async getProfile(organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>('/v1/me/profile', {
      organizationId,
    })
    return validateDomainResponse(apiMeProfileResponseSchema, response, 'me.profile')
  },

  async switchOrganization(organizationId: string) {
    const id = parseDomainInput(entityIdSchema, organizationId, 'me.switch-organization.id')
    const response = await vimobAPIRequest<{ ok: boolean }>('/v1/me/switch-organization', {
      method: 'POST',
      body: { organizationId: id },
    })
    validateDomainResponse(okResponseSchema, response, 'me.switch-organization')
    return response
  },
}
