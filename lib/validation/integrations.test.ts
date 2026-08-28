import assert from 'node:assert/strict'
import test from 'node:test'

import {
  grupoOLXImportReportSchema,
  grupoOLXIntegrationSchema,
  grupoOLXIntegrationInputSchema,
  grupoOLXPublicationSchema,
  grupoOLXPublicationsInputSchema,
  metaAdAccountsActionResponseSchema,
  metaConversionFeedbackInputSchema,
  metaOAuthFlowResultSchema,
  metaPublicIntegrationSchema,
} from './integrations'

test('configuracao por tenant do Grupo OLX nao aceita a credencial global do CRM', () => {
  const validInput = {
    settings: {
      contact_name: 'Equipe Vimob',
      contact_email: 'portais@vimob.com.br',
    },
  }

  assert.equal(grupoOLXIntegrationInputSchema.safeParse(validInput).success, true)
  assert.equal(grupoOLXIntegrationInputSchema.safeParse({
    ...validInput,
    leadWebhookSecret: 'nao-deve-ser-armazenado-no-tenant',
  }).success, false)
  assert.equal(grupoOLXIntegrationInputSchema.safeParse({
    ...validInput,
    settings: {
      ...validInput.settings,
      secret_key: 'nao-deve-ser-armazenado-no-tenant',
    },
  }).success, false)
  assert.equal(grupoOLXIntegrationInputSchema.safeParse({
    ...validInput,
    isActive: true,
  }).success, false)
})

test('PUT legado do Grupo OLX aceita somente campos editáveis e rejeita estado canônico', () => {
  const validInput = {
    publications: [{
      propertyId: '30000000-0000-4000-8000-000000000001',
      clientListingId: 'VIMOB-123',
      publicationType: 'PREMIUM',
    }],
  }

  assert.equal(grupoOLXPublicationsInputSchema.safeParse(validInput).success, true)
  assert.equal(grupoOLXPublicationsInputSchema.safeParse({
    publications: [{
      ...validInput.publications[0],
      isEnabled: true,
    }],
  }).success, false)
  assert.equal(grupoOLXPublicationsInputSchema.safeParse({
    publications: [{
      ...validInput.publications[0],
      canonical_managed: true,
      canonical_desired_state: 'published',
    }],
  }).success, false)
  assert.equal(grupoOLXPublicationsInputSchema.safeParse({
    publications: [{
      ...validInput.publications[0],
      publicationType: 'ULTRA_SECRET_PRODUCT',
    }],
  }).success, false)
})

test('historico do Grupo OLX expoe dead letter sem carregar o payload bruto', () => {
  const report = {
    id: '30000000-0000-4000-8000-000000000002',
    report_id: 'grupo-olx-report-123',
    status: 'received',
    annotation_status: 'dead',
    annotation_attempts: 12,
    annotation_next_attempt_at: null,
    annotation_processed_at: '2026-08-01T19:00:00Z',
    annotation_last_error: 'invalid_report_schema',
    provider_occurred_at: null,
    created_at: '2026-08-01T18:59:59Z',
  }

  assert.equal(grupoOLXImportReportSchema.parse(report).annotation_status, 'dead')
  assert.equal(grupoOLXImportReportSchema.safeParse({
    ...report,
    raw_payload: { secret: 'must-not-enter-the-browser' },
  }).success, false)
})

test('respostas do Grupo OLX falham fechadas para credenciais e payload interno', () => {
  const integration = {
    id: '30000000-0000-4000-8000-000000000003',
    organization_id: '30000000-0000-4000-8000-000000000004',
    portal: 'grupo_olx',
    status: 'connected',
    is_active: true,
    feed_token: 'a'.repeat(64),
    webhook_token: 'b'.repeat(64),
    default_pipeline_id: null,
    default_stage_id: null,
    default_assigned_user_id: null,
    default_round_robin_id: null,
    settings: {
      contact_name: 'Equipe Vimob',
      contact_email: 'portais@vimob.com.br',
    },
    last_feed_accessed_at: null,
    last_lead_received_at: null,
    last_import_report_at: null,
    last_sync_status: null,
    last_error: null,
    created_at: '2026-08-01T18:00:00Z',
    updated_at: '2026-08-01T18:00:00Z',
  }
  assert.equal(grupoOLXIntegrationSchema.parse(integration).portal, 'grupo_olx')
  assert.equal(grupoOLXIntegrationSchema.safeParse({
    ...integration,
    secret_key: 'must-never-enter-the-browser',
  }).success, false)

  const publication = {
    id: '30000000-0000-4000-8000-000000000005',
    integration_id: integration.id,
    property_id: '30000000-0000-4000-8000-000000000006',
    canonical_managed: true,
    desired_state: 'published',
    observed_state: 'published',
    canonical_desired_state: 'published',
    canonical_observed_state: 'published',
    canonical_published_version: 1,
    client_listing_id: 'VIMOB-123',
    publication_type: 'STANDARD',
    is_enabled: true,
    status: 'published',
    validation_errors: [],
    last_exported_at: null,
    last_seen_in_feed_at: null,
    last_error: null,
    created_at: '2026-08-01T18:00:00Z',
    updated_at: '2026-08-01T18:00:00Z',
    canonical_updated_at: '2026-08-01T18:00:00Z',
    property: {
      id: '30000000-0000-4000-8000-000000000006',
      code: 'VIMOB-123',
      title: 'Apartamento central',
      status: 'active',
      tipo_de_negocio: 'venda',
      tipo_de_imovel: 'apartamento',
      cidade: 'São Paulo',
      bairro: 'Centro',
      preco: 450000,
      valor_locacao: null,
      imagem_principal: null,
    },
  }
  assert.equal(grupoOLXPublicationSchema.parse(publication).canonical_published_version, 1)
  assert.equal(grupoOLXPublicationSchema.safeParse({
    ...publication,
    raw_payload: { must: 'stay-server-side' },
  }).success, false)
})

test('retorno OAuth Meta aceita somente o portfolio seguro do backend', () => {
  const safeFlow = {
    id: '10000000-0000-4000-8000-000000000001',
    organization_id: '10000000-0000-4000-8000-000000000002',
    user_id: '10000000-0000-4000-8000-000000000003',
    status: 'success',
    payload: {
      flow_id: '10000000-0000-4000-8000-000000000001',
      success: true,
      pages: [{
        id: '123456789',
        name: 'Pagina Vimob',
        instagram_business_account: {
          id: '987654321',
          username: 'vimob',
        },
      }],
      ad_accounts: [{ id: 'act_123', account_id: '123', name: 'Conta principal' }],
    },
  }

  assert.equal(metaOAuthFlowResultSchema.parse(safeFlow).payload?.pages[0]?.name, 'Pagina Vimob')
  assert.throws(() => metaOAuthFlowResultSchema.parse({
    ...safeFlow,
    payload: {
      ...safeFlow.payload,
      user_token: 'must-never-reach-the-browser',
    },
  }))
})

test('projecoes Meta rejeitam credenciais ou campos inesperados', () => {
  const integration = {
    id: '20000000-0000-4000-8000-000000000001',
    organization_id: '20000000-0000-4000-8000-000000000002',
    page_id: '123456789',
    page_name: 'Pagina Vimob',
    page_picture_url: null,
    facebook_user_id: null,
    facebook_user_name: null,
    is_connected: true,
    integration_type: 'facebook',
    instagram_business_account_id: null,
    instagram_username: null,
    ad_account_id: null,
    selected_ad_accounts: [],
    pipeline_id: null,
    stage_id: null,
    default_status: null,
    leads_received: 0,
    last_lead_at: null,
    last_sync_at: null,
    last_error: null,
    health_status: 'healthy',
    token_status: 'active',
    token_expires_at: null,
    last_validated_at: null,
    webhook_subscribed_at: null,
    created_at: '2026-07-31T12:00:00Z',
    updated_at: '2026-07-31T12:00:00Z',
    marketing_token_available: true,
    crm_dataset_id: '987654321098765',
    crm_dataset_name: 'Dataset Vimob',
    conversion_feedback_enabled: true,
    conversion_feedback_status: 'active',
    conversion_feedback_last_sent_at: null,
    conversion_feedback_last_validated_at: null,
    conversion_feedback_last_error: null,
  }

  assert.equal(metaPublicIntegrationSchema.parse(integration).page_id, '123456789')
  const legacyIntegration = { ...integration }
  delete (legacyIntegration as Partial<typeof integration>).marketing_token_available
  Object.assign(legacyIntegration, {
    assigned_user_id: null,
    form_ids: ['form_123'],
    field_mapping: { email: 'email' },
    campaign_property_mapping: { campaign_123: 'property_123' },
  })
  assert.equal(
    metaPublicIntegrationSchema.parse(legacyIntegration).marketing_token_available,
    false,
    'backends anteriores devem permanecer visiveis sem liberar Marketing avancado',
  )
  assert.throws(() => metaPublicIntegrationSchema.parse({
    ...integration,
    access_token: 'must-never-reach-the-browser',
  }))
  for (const forbiddenField of [
    'user_token',
    'granted_scopes',
    'access_token_secret_ref',
    'crm_dataset_access_token',
    'crm_dataset_access_token_secret_ref',
    'test_event_code',
    'testEventCode',
  ]) {
    assert.throws(() => metaPublicIntegrationSchema.parse({
      ...integration,
      [forbiddenField]: 'must-never-reach-the-browser',
    }))
  }
  assert.throws(() => metaAdAccountsActionResponseSchema.parse({
    success: true,
    ad_accounts: [],
    user_token: 'must-never-reach-the-browser',
  }))
})

test('configuracao de devolucao Meta valida dataset e token write-only', () => {
  const parsed = metaConversionFeedbackInputSchema.parse({
    integrationId: '20000000-0000-4000-8000-000000000001',
    datasetId: '987654321098765',
    datasetName: 'Dataset Vimob',
    datasetAccessToken: 'token-enviado-somente-ao-backend',
    enabled: true,
    replayRecentFacts: true,
    testEventCode: 'TEST12345',
  })

  assert.equal(parsed.datasetId, '987654321098765')
  assert.equal(parsed.replayRecentFacts, true)
  assert.equal(parsed.testEventCode, 'TEST12345')
  assert.equal(metaConversionFeedbackInputSchema.safeParse({
    integrationId: '20000000-0000-4000-8000-000000000001',
    enabled: true,
    replayRecentFacts: true,
  }).success, false)
  assert.equal(metaConversionFeedbackInputSchema.safeParse({
    ...parsed,
    enabled: false,
    replayRecentFacts: true,
  }).success, false)
  assert.equal(metaConversionFeedbackInputSchema.safeParse({
    ...parsed,
    replayRecentFacts: false,
    testEventCode: 'TEST12345',
  }).success, false)
  assert.equal(metaConversionFeedbackInputSchema.safeParse({
    ...parsed,
    testEventCode: '   ',
  }).success, false)
  assert.equal(metaConversionFeedbackInputSchema.safeParse({
    ...parsed,
    testEventCode: 'TEST\n12345',
  }).success, false)
  assert.throws(() => metaConversionFeedbackInputSchema.parse({
    ...parsed,
    datasetId: 'act_123',
  }))
  assert.throws(() => metaConversionFeedbackInputSchema.parse({
    ...parsed,
    unexpectedCredential: 'must-not-pass',
  }))
})
