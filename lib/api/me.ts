import { vimobAPIRequest } from './vimob-client'

export type TenantContext = {
  userId: string
  userRole: string
  organizationId?: string
  organizationName?: string
  organizationLogo?: string
  memberRole?: string
  permissions: string[]
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
}

export type MeProfileResponse = MeResponse & {
  profile: MeProfile
  organization: MeOrganization | null
}

export const meAPI = {
  async getMe(organizationId?: string | null) {
    return vimobAPIRequest<MeResponse>('/v1/me', {
      organizationId,
    })
  },

  async getProfile(organizationId?: string | null) {
    return vimobAPIRequest<MeProfileResponse>('/v1/me/profile', {
      organizationId,
    })
  },

  async switchOrganization(organizationId: string) {
    return vimobAPIRequest<{ ok: boolean }>('/v1/me/switch-organization', {
      method: 'POST',
      body: { organizationId },
    })
  },
}
