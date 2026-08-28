import { vimobAPIRequest } from './vimob-client'
import { apiMeProfileResponseSchema, apiMeResponseSchema, entityIdSchema, okResponseSchema, parseDomainInput, validateDomainResponse } from '@/lib/validation'

export type TenantContext = {
  userId: string
  userRole: string
  organizationId?: string
  organizationName?: string
  organizationLogo?: string
  subscriptionStatus?: string
  subscriptionType?: string
  trialEndsAt?: string
  billingGraceUntil?: string
  memberRole?: string
  permissions: string[]
  enabledModules: string[]
  isTeamLeader: boolean
  ledTeamIds?: string[]
  ledUserIds?: string[]
  ledPipelineIds?: string[]
  isSuperAdmin: boolean
}

export type MeResponse = {
  user: {
    id: string
    email?: string
  }
  context: TenantContext
}

export type MeProfile = {
  id: string
  organization_id: string | null
  name: string
  email: string
  role: 'super_admin' | 'admin' | 'user' | string
  avatar_url: string | null
  is_active: boolean
  language?: string | null
  theme_mode?: 'light' | 'dark' | 'system' | null
  whatsapp?: string | null
  cpf?: string | null
}

export type MeOrganization = {
  id: string
  name: string
  logo_url: string | null
  theme_mode: string
  accent_color: string
  is_active?: boolean
  subscription_status?: string
  subscription_type?: string | null
  trial_ends_at?: string | null
  billing_grace_until?: string | null
  segment?: 'imobiliario' | 'telecom' | 'servicos' | null
  cnpj?: string | null
  creci?: string | null
  inscricao_estadual?: string | null
  razao_social?: string | null
  nome_fantasia?: string | null
  cep?: string | null
  endereco?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  uf?: string | null
  telefone?: string | null
  whatsapp?: string | null
  email?: string | null
  website?: string | null
  default_commission_percentage?: number | null
  property_edit_policy?: 'everyone' | 'responsible_or_admin' | null
  property_owner_contact_visibility?: 'visible' | 'hidden' | null
}

export type MeProfileResponse = MeResponse & {
  profile: MeProfile
  organization: MeOrganization | null
}

export const meAPI = {
  async getMe(organizationId?: string | null) {
    const response = await vimobAPIRequest<MeResponse>('/v1/me', {
      organizationId,
    })
    validateDomainResponse(apiMeResponseSchema, response, 'me.get')
    return response
  },

  async getProfile(organizationId?: string | null) {
    const response = await vimobAPIRequest<MeProfileResponse>('/v1/me/profile', {
      organizationId,
    })
    validateDomainResponse(apiMeProfileResponseSchema, response, 'me.profile')
    return response
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
