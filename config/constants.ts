// Feature flags
export const FEATURES = {
  ENABLE_ANALYTICS: true,
  ENABLE_PWA: true,
  ENABLE_NOTIFICATIONS: true,
  ENABLE_INTEGRATIONS: true,
} as const

// Routes
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  SIGNUP: '/cadastro',
  DASHBOARD: '/dashboard',
  DASHBOARD_CAMPAIGNS: '/dashboard/campaigns',
  RESET_PASSWORD: '/reset-password',
} as const

// Auth
export const AUTH_CONFIG = {
  SESSION_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes
  TOKEN_REFRESH_MS: 5 * 60 * 1000, // 5 minutes
  AUTO_REFRESH_ENABLED: true,
} as const

// API
export const API_CONFIG = {
  TIMEOUT_MS: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 1000,
} as const

// Cache
export const CACHE_CONFIG = {
  QUERY_CACHE_TIME: 5 * 60 * 1000, // 5 minutes
  STALE_TIME: 10 * 60 * 1000, // 10 minutes
} as const

// Organization segments
export const ORG_SEGMENTS = {
  IMOBILIARIO: 'imobiliario',
  TELECOM: 'telecom',
  SERVICOS: 'servicos',
} as const

// System module keys used to enable product areas per organization.
export const SYSTEM_MODULES = [
  { key: 'crm', label: 'Gestão' },
  { key: 'financial', label: 'Financeiro' },
  { key: 'properties', label: 'Imóveis' },
  { key: 'site', label: 'Sites' },
  { key: 'automations', label: 'Automações' },
  { key: 'agenda', label: 'Agenda' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'campaigns', label: 'Meta' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'portals', label: 'Portais' },
  { key: 'api', label: 'APIs' },
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'cadences', label: 'Cadências' },
  { key: 'tags', label: 'Etiquetas' },
  { key: 'round_robin', label: 'Distribuição' },
  { key: 'reports', label: 'Relatórios' },
  { key: 'performance', label: 'Performance' },
  { key: 'gamification', label: 'Gamificação' },
] as const

export type SystemModuleKey = (typeof SYSTEM_MODULES)[number]['key']

export const DEFAULT_ENABLED_MODULE_KEYS: SystemModuleKey[] = [
  'crm',
  'properties',
  'whatsapp',
  'agenda',
  'cadences',
  'tags',
  'round_robin',
  'reports',
]

export function getSystemModuleLabel(key: string) {
  return SYSTEM_MODULES.find((module) => module.key === key)?.label || key
}

// User roles
export const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  USER: 'user',
} as const
