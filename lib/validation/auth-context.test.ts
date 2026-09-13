import assert from 'node:assert/strict'
import test from 'node:test'

import {
  apiMeProfileResponseSchema,
  apiMeResponseSchema,
  organizationSchema,
  tenantContextSchema,
  userProfileSchema,
} from './auth-context'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const TEAM_ID = '33333333-3333-4333-8333-333333333333'

const tenantContext = {
  userId: USER_ID,
  userRole: 'user',
  organizationId: ORGANIZATION_ID,
  organizationName: 'Vimob',
  organizationLogo: 'https://cdn.vimob.test/logo.png',
  subscriptionStatus: 'active',
  subscriptionType: 'paid',
  trialEndsAt: '2026-09-30T18:00:00.000Z',
  billingGraceUntil: '2026-10-02T18:00:00.000Z',
  memberRole: 'admin',
  permissions: ['leads_view'],
  enabledModules: ['crm'],
  isTeamLeader: true,
  ledTeamIds: [TEAM_ID],
  ledUserIds: [USER_ID],
  ledPipelineIds: [],
  isSuperAdmin: false,
}

const profile = {
  id: USER_ID,
  organization_id: ORGANIZATION_ID,
  name: 'André',
  email: 'andre@vimob.test',
  role: 'admin',
  avatar_url: null,
  is_active: true,
  language: 'pt-BR',
  theme_mode: 'system',
  whatsapp: null,
  cpf: null,
}

const organization = {
  id: ORGANIZATION_ID,
  name: 'Vimob',
  logo_url: null,
  theme_mode: 'system',
  accent_color: '#FF4529',
  is_active: true,
  subscription_status: 'active',
  segment: 'imobiliario',
  cnpj: null,
  creci: null,
  inscricao_estadual: null,
  razao_social: null,
  nome_fantasia: null,
  cep: null,
  endereco: null,
  numero: null,
  complemento: null,
  bairro: null,
  cidade: null,
  uf: null,
  telefone: null,
  whatsapp: null,
  email: null,
  website: null,
  default_commission_percentage: 5,
  property_edit_policy: 'responsible_or_admin',
  property_owner_contact_visibility: 'visible',
  updated_at: '2026-09-08T12:00:00Z',
}

test('valida o contrato completo de /v1/me/profile', () => {
  const result = apiMeProfileResponseSchema.safeParse({
    user: { id: USER_ID, email: profile.email },
    context: tenantContext,
    profile,
    organization,
  })

  assert.equal(result.success, true)
})

test('mantem /v1/me valido para super admin sem organizacao', () => {
  const result = apiMeResponseSchema.safeParse({
    user: { id: USER_ID, email: profile.email, role: 'authenticated' },
    context: {
      userId: USER_ID,
      userRole: 'super_admin',
      permissions: [],
      enabledModules: [],
      isTeamLeader: false,
      isSuperAdmin: true,
    },
  })

  assert.equal(result.success, true)
})

test('rejeita escopo de tenant ou cobranca malformados', () => {
  assert.equal(
    tenantContextSchema.safeParse({
      ...tenantContext,
      ledTeamIds: ['not-a-uuid'],
    }).success,
    false,
  )
  assert.equal(
    tenantContextSchema.safeParse({
      ...tenantContext,
      billingGraceUntil: 'data-invalida',
    }).success,
    false,
  )
})

test('normaliza papel global nulo e aliases legados do segmento imobiliario', () => {
  const parsedProfile = userProfileSchema.parse({
    ...profile,
    role: null,
  })

  assert.equal(parsedProfile.role, 'user')
  for (const legacySegment of ['imobiliario', 'imobiliário', 'imobiliaria', 'imobiliária']) {
    const parsedResponse = apiMeProfileResponseSchema.parse({
      user: { id: USER_ID, email: profile.email },
      context: tenantContext,
      profile,
      organization: {
        ...organization,
        segment: legacySegment,
      },
    })

    assert.equal(parsedResponse.organization?.segment, 'imobiliario')
  }
  assert.equal(
    organizationSchema.parse({ ...organization, segment: ' SERVIÇOS ' }).segment,
    'servicos',
  )
  assert.equal(
    userProfileSchema.safeParse({ ...profile, role: 'owner' }).success,
    false,
  )
})

test('rejeita campos centrais ausentes na resposta de perfil', () => {
  const incompleteOrganization: Partial<typeof organization> = { ...organization }
  delete incompleteOrganization.property_edit_policy

  assert.equal(
    apiMeProfileResponseSchema.safeParse({
      user: { id: USER_ID, email: profile.email },
      context: tenantContext,
      profile,
      organization: incompleteOrganization,
    }).success,
    false,
  )
})

test('rejeita organização sem revisão CAS válida', () => {
  assert.equal(
    organizationSchema.safeParse({ ...organization, updated_at: 'ontem' }).success,
    false,
  )

  const missingRevision: Partial<typeof organization> = { ...organization }
  delete missingRevision.updated_at
  assert.equal(organizationSchema.safeParse(missingRevision).success, false)
})
