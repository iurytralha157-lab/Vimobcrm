import { create } from 'zustand'
import { User, Session } from '@supabase/supabase-js'

export interface UserProfile {
  id: string
  organization_id: string | null
  name: string
  email: string
  role: 'admin' | 'user' | 'super_admin'
  avatar_url: string | null
  is_active: boolean
  language?: string
  phone?: string
  whatsapp?: string
  cpf?: string
  cep?: string
  endereco?: string
  numero?: string
  complemento?: string
  bairro?: string
  cidade?: string
  uf?: string
}

export interface Organization {
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

export interface UserOrganization {
  organization_id: string
  organization_name: string
  organization_logo: string | null
  member_role: string
  is_active: boolean
  joined_at: string
  last_accessed_at: string | null
}

interface ImpersonateSession {
  orgId: string
  orgName: string
}

interface AuthStore {
  // State
  user: User | null
  session: Session | null
  profile: UserProfile | null
  organization: Organization | null
  isSuperAdmin: boolean
  loading: boolean
  authInitialized: boolean
  organizationsLoaded: boolean
  isInitializingOrg: boolean
  userOrganizations: UserOrganization[]
  impersonating: ImpersonateSession | null

  // Actions
  setUser: (user: User | null) => void
  setSession: (session: Session | null) => void
  setProfile: (profile: UserProfile | null) => void
  setOrganization: (organization: Organization | null) => void
  setSuperAdmin: (isSuperAdmin: boolean) => void
  setLoading: (loading: boolean) => void
  setAuthInitialized: (initialized: boolean) => void
  setOrganizationsLoaded: (loaded: boolean) => void
  setIsInitializingOrg: (initializing: boolean) => void
  setUserOrganizations: (orgs: UserOrganization[]) => void
  setImpersonating: (session: ImpersonateSession | null) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  // Initial state
  user: null,
  session: null,
  profile: null,
  organization: null,
  isSuperAdmin: false,
  loading: true,
  authInitialized: false,
  organizationsLoaded: false,
  isInitializingOrg: false,
  userOrganizations: [],
  impersonating: null,

  // Actions
  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setProfile: (profile) => set({ profile }),
  setOrganization: (organization) => set({ organization }),
  setSuperAdmin: (isSuperAdmin) => set({ isSuperAdmin }),
  setLoading: (loading) => set({ loading }),
  setAuthInitialized: (authInitialized) => set({ authInitialized }),
  setOrganizationsLoaded: (organizationsLoaded) => set({ organizationsLoaded }),
  setIsInitializingOrg: (isInitializingOrg) => set({ isInitializingOrg }),
  setUserOrganizations: (userOrganizations) => set({ userOrganizations }),
  setImpersonating: (impersonating) => set({ impersonating }),
  clearAuth: () =>
    set({
      user: null,
      session: null,
      profile: null,
      organization: null,
      isSuperAdmin: false,
      authInitialized: false,
      organizationsLoaded: false,
      userOrganizations: [],
      impersonating: null,
    }),
}))
