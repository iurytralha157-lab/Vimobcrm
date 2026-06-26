import { z } from 'zod'

// User Schemas
export const userProfileSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid().nullable(),
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  role: z.enum(['admin', 'user', 'super_admin']),
  avatar_url: z.string().url().nullable(),
  is_active: z.boolean(),
  language: z.string().optional(),
  theme_mode: z.enum(['light', 'dark', 'system']).optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  cpf: z.string().optional(),
  cep: z.string().optional(),
  endereco: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().optional(),
})

export type UserProfile = z.infer<typeof userProfileSchema>

// Auth Schemas
export const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
})

export type LoginInput = z.infer<typeof loginSchema>

export const signUpSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres'),
  name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres'),
})

export type SignUpInput = z.infer<typeof signUpSchema>

export const resetPasswordSchema = z.object({
  email: z.string().email('Email inválido'),
})

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

// Organization Schemas
export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Organization name is required'),
  logo_url: z.string().url().nullable(),
  theme_mode: z.string(),
  accent_color: z.string(),
  is_active: z.boolean().optional(),
  subscription_status: z.string().optional(),
  segment: z.enum(['imobiliario', 'telecom', 'servicos']).nullable(),
  cnpj: z.string().optional().nullable(),
  creci: z.string().optional().nullable(),
  inscricao_estadual: z.string().optional().nullable(),
  razao_social: z.string().optional().nullable(),
  nome_fantasia: z.string().optional().nullable(),
  cep: z.string().optional().nullable(),
  endereco: z.string().optional().nullable(),
  numero: z.string().optional().nullable(),
  complemento: z.string().optional().nullable(),
  bairro: z.string().optional().nullable(),
  cidade: z.string().optional().nullable(),
  uf: z.string().optional().nullable(),
  telefone: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  website: z.string().url().optional().nullable(),
  default_commission_percentage: z.number().optional().nullable(),
})

export type Organization = z.infer<typeof organizationSchema>

const nullableNumberInput = z.number().finite().nullable()

export const adminSubscriptionPlanSchema = z.object({
  slug: z.string().min(1, 'Slug é obrigatório'),
  name: z.string().min(1, 'Nome é obrigatório'),
  description: z.string().nullable(),
  price: z.number().finite().min(0, 'Preço não pode ser negativo'),
  billing_cycle: z.string().nullable(),
  trial_enabled: z.boolean(),
  trial_days: nullableNumberInput,
  max_users: nullableNumberInput,
  max_leads: nullableNumberInput,
  max_whatsapp_sessions: nullableNumberInput,
  modules: z.array(z.string().min(1)).default([]),
  is_active: z.boolean(),
  is_public: z.boolean(),
})

export type AdminSubscriptionPlanInput = z.infer<typeof adminSubscriptionPlanSchema>

// Meta Schemas
export const metaLeadgenValueSchema = z.object({
  page_id: z.string().min(1),
  form_id: z.string().min(1),
  leadgen_id: z.string().min(1),
  ad_id: z.string().min(1),
  adgroup_id: z.string().min(1),
  campaign_id: z.string().min(1),
  created_time: z.number().int().positive(),
})

export const metaLeadgenWebhookSchema = z.object({
  object: z.string().min(1),
  entry: z.array(
    z.object({
      id: z.string().min(1),
      time: z.number().int().positive(),
      changes: z.array(
        z.object({
          field: z.literal('leadgen'),
          value: metaLeadgenValueSchema,
        }),
      ).min(1),
    }),
  ).min(1),
})

export type MetaLeadgenWebhookInput = z.infer<typeof metaLeadgenWebhookSchema>

export const metaCreativeAssetSchema = z.object({
  creative_id: z.string().min(1),
  ad_id: z.string().optional().nullable(),
  ad_name: z.string().optional().nullable(),
  creative_name: z.string().optional().nullable(),
  thumbnail_url: z.string().url().optional().nullable(),
  creative_url: z.string().url().optional().nullable(),
  creative_video_url: z.string().url().optional().nullable(),
  creative_permalink_url: z.string().url().optional().nullable(),
  instagram_permalink_url: z.string().url().optional().nullable(),
  raw_payload: z.record(z.unknown()).default({}),
})

export type MetaCreativeAssetInput = z.infer<typeof metaCreativeAssetSchema>

export const metaCampaignInsightSchema = z.object({
  campaign_id: z.string().min(1),
  campaign_name: z.string().optional().nullable(),
  adset_id: z.string().optional().nullable(),
  adset_name: z.string().optional().nullable(),
  ad_id: z.string().optional().nullable(),
  ad_name: z.string().optional().nullable(),
  level: z.enum(['campaign', 'adset', 'ad']).default('campaign'),
  spend: z.number().finite().min(0).optional().nullable(),
  impressions: z.number().int().min(0).optional().nullable(),
  reach: z.number().int().min(0).optional().nullable(),
  clicks: z.number().int().min(0).optional().nullable(),
  link_clicks: z.number().int().min(0).optional().nullable(),
  leads_count: z.number().int().min(0).optional().nullable(),
  conversations_count: z.number().int().min(0).optional().nullable(),
  ctr: z.number().finite().min(0).optional().nullable(),
  cpc: z.number().finite().min(0).optional().nullable(),
  cpm: z.number().finite().min(0).optional().nullable(),
  cpl: z.number().finite().min(0).optional().nullable(),
  hook_rate: z.number().finite().min(0).optional().nullable(),
  status: z.string().optional().nullable(),
  budget: z.number().finite().min(0).optional().nullable(),
  budget_type: z.string().optional().nullable(),
  objective: z.string().optional().nullable(),
  date_start: z.string().min(1),
  date_stop: z.string().min(1),
})

export type MetaCampaignInsightInput = z.infer<typeof metaCampaignInsightSchema>
