import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { organizationSiteMutationSchema } from "./auxiliary";

import {
  INTEGRATION_BRAND_ASSETS,
  getChavesNaMaoIntegrationStatus,
  getGoogleCalendarIntegrationStatus,
  getGrupoOLXIntegrationStatus,
  getMetaIntegrationStatus,
  isGoogleCalendarIntegrationConnected,
  isGrupoOLXIntegrationConnected,
  isMetaIntegrationConnected,
} from "../integration-catalog";
import {
  INTEGRATION_MANAGE_KEY_ALIASES,
  INTEGRATION_PROVIDER_CATALOG,
  INTEGRATION_PROVIDER_IDS,
  createIntegrationProviderManifest,
  isIntegrationAvailableByDefault,
} from "../../config/integrations";

import {
  chavesNaMaoIntegrationInputSchema,
  chavesNaMaoIntegrationSchema,
  chavesNaMaoPublicationsInputSchema,
  grupoOLXImportReportSchema,
  grupoOLXIntegrationSchema,
  grupoOLXIntegrationInputSchema,
  grupoOLXPublicationSchema,
  grupoOLXPublicationsInputSchema,
  googleAnalyticsMeasurementIdSchema,
  googleSearchConsoleVerificationTokenSchema,
  googleTagManagerContainerIdSchema,
  metaAdAccountsActionResponseSchema,
  metaConnectPageActionResponseSchema,
  metaConversionFeedbackInputSchema,
  metaFormConfigInputSchema,
  metaOAuthFlowResultSchema,
  metaPageFormsActionResponseSchema,
  metaPublicIntegrationSchema,
} from "./integrations";

test("identificadores Google sao normalizados e validados por provedor", () => {
  assert.equal(
    googleAnalyticsMeasurementIdSchema.parse(" g-abc1234567 "),
    "G-ABC1234567",
  );
  assert.equal(
    googleAnalyticsMeasurementIdSchema.safeParse("UA-123-1").success,
    false,
  );
  assert.equal(
    googleAnalyticsMeasurementIdSchema.safeParse("GTM-ABC123").success,
    false,
  );

  assert.equal(
    googleTagManagerContainerIdSchema.parse(" gtm-abcd1234 "),
    "GTM-ABCD1234",
  );
  assert.equal(
    googleTagManagerContainerIdSchema.safeParse("G-ABC1234567").success,
    false,
  );
});

test("Search Console aceita token ou meta tag oficial sem aceitar HTML arbitrario", () => {
  const token = "abcDEF_1234567890-token";
  assert.equal(googleSearchConsoleVerificationTokenSchema.parse(token), token);
  assert.equal(
    googleSearchConsoleVerificationTokenSchema.parse(
      `<meta name="google-site-verification" content="${token}" />`,
    ),
    token,
  );
  assert.equal(
    googleSearchConsoleVerificationTokenSchema.parse(
      `<meta content="${token}" name="google-site-verification">`,
    ),
    token,
  );
  assert.equal(
    googleSearchConsoleVerificationTokenSchema.safeParse(
      "<script>alert(1)</script>",
    ).success,
    false,
  );
});

test("Search Console publica verificacao apenas nos metadados da pagina inicial", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "components/features/public-site/route-renderer.tsx",
    ),
    "utf8",
  );
  assert.match(source, /verification:\s*\n\s*route\.kind === "home"/);
  assert.match(source, /\{ google: googleSearchConsoleVerification \}/);
});

test("contrato generico do site valida os tres identificadores Google", () => {
  const parsed = organizationSiteMutationSchema.parse({
    google_analytics_id: " g-abc1234567 ",
    google_search_console_verification: "abcDEF_1234567890-token",
    gtm_id: " gtm-abcd1234 ",
  });

  assert.equal(parsed.google_analytics_id, "G-ABC1234567");
  assert.equal(parsed.gtm_id, "GTM-ABCD1234");
  assert.equal(
    organizationSiteMutationSchema.safeParse({
      gtm_id: "<script>alert(1)</script>",
    }).success,
    false,
  );
});

test("configuracao por tenant do Grupo OLX nao aceita a credencial global do CRM", () => {
  const validInput = {
    settings: {
      contact_name: "Equipe Vimob",
      contact_email: "portais@vimob.com.br",
    },
  };

  assert.equal(
    grupoOLXIntegrationInputSchema.safeParse(validInput).success,
    true,
  );
  assert.equal(
    grupoOLXIntegrationInputSchema.safeParse({
      ...validInput,
      leadWebhookSecret: "nao-deve-ser-armazenado-no-tenant",
    }).success,
    false,
  );
  assert.equal(
    grupoOLXIntegrationInputSchema.safeParse({
      ...validInput,
      settings: {
        ...validInput.settings,
        secret_key: "nao-deve-ser-armazenado-no-tenant",
      },
    }).success,
    false,
  );
  assert.equal(
    grupoOLXIntegrationInputSchema.safeParse({
      ...validInput,
      isActive: true,
    }).success,
    false,
  );
});

test("PUT legado do Grupo OLX aceita somente campos editáveis e rejeita estado canônico", () => {
  const validInput = {
    publications: [
      {
        propertyId: "30000000-0000-4000-8000-000000000001",
        clientListingId: "VIMOB-123",
        publicationType: "PREMIUM",
      },
    ],
  };

  assert.equal(
    grupoOLXPublicationsInputSchema.safeParse(validInput).success,
    true,
  );
  assert.equal(
    grupoOLXPublicationsInputSchema.safeParse({
      publications: [
        {
          ...validInput.publications[0],
          isEnabled: true,
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    grupoOLXPublicationsInputSchema.safeParse({
      publications: [
        {
          ...validInput.publications[0],
          canonical_managed: true,
          canonical_desired_state: "published",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    grupoOLXPublicationsInputSchema.safeParse({
      publications: [
        {
          ...validInput.publications[0],
          publicationType: "ULTRA_SECRET_PRODUCT",
        },
      ],
    }).success,
    false,
  );
});

test("historico do Grupo OLX expoe dead letter sem carregar o payload bruto", () => {
  const report = {
    id: "30000000-0000-4000-8000-000000000002",
    report_id: "grupo-olx-report-123",
    status: "received",
    annotation_status: "dead",
    annotation_attempts: 12,
    annotation_next_attempt_at: null,
    annotation_processed_at: "2026-08-01T19:00:00Z",
    annotation_last_error: "invalid_report_schema",
    provider_occurred_at: null,
    created_at: "2026-08-01T18:59:59Z",
  };

  assert.equal(
    grupoOLXImportReportSchema.parse(report).annotation_status,
    "dead",
  );
  assert.equal(
    grupoOLXImportReportSchema.safeParse({
      ...report,
      raw_payload: { secret: "must-not-enter-the-browser" },
    }).success,
    false,
  );
});

test("respostas do Grupo OLX falham fechadas para credenciais e payload interno", () => {
  const integration = {
    id: "30000000-0000-4000-8000-000000000003",
    organization_id: "30000000-0000-4000-8000-000000000004",
    portal: "grupo_olx",
    status: "connected",
    is_active: true,
    feed_token: "a".repeat(64),
    webhook_token: "b".repeat(64),
    default_pipeline_id: null,
    default_stage_id: null,
    default_assigned_user_id: null,
    default_round_robin_id: null,
    settings: {
      contact_name: "Equipe Vimob",
      contact_email: "portais@vimob.com.br",
    },
    last_feed_accessed_at: null,
    last_lead_received_at: null,
    last_import_report_at: null,
    last_sync_status: null,
    last_error: null,
    created_at: "2026-08-01T18:00:00Z",
    updated_at: "2026-08-01T18:00:00Z",
  };
  assert.equal(
    grupoOLXIntegrationSchema.parse(integration).portal,
    "grupo_olx",
  );
  assert.equal(
    grupoOLXIntegrationSchema.safeParse({
      ...integration,
      secret_key: "must-never-enter-the-browser",
    }).success,
    false,
  );

  const publication = {
    id: "30000000-0000-4000-8000-000000000005",
    integration_id: integration.id,
    property_id: "30000000-0000-4000-8000-000000000006",
    canonical_managed: true,
    desired_state: "published",
    observed_state: "published",
    canonical_desired_state: "published",
    canonical_observed_state: "published",
    canonical_published_version: 1,
    client_listing_id: "VIMOB-123",
    publication_type: "STANDARD",
    is_enabled: true,
    status: "published",
    validation_errors: [],
    last_exported_at: null,
    last_seen_in_feed_at: null,
    last_error: null,
    created_at: "2026-08-01T18:00:00Z",
    updated_at: "2026-08-01T18:00:00Z",
    canonical_updated_at: "2026-08-01T18:00:00Z",
    property: {
      id: "30000000-0000-4000-8000-000000000006",
      code: "VIMOB-123",
      title: "Apartamento central",
      status: "active",
      tipo_de_negocio: "venda",
      tipo_de_imovel: "apartamento",
      cidade: "São Paulo",
      bairro: "Centro",
      preco: 450000,
      valor_locacao: null,
      imagem_principal: null,
    },
  };
  assert.equal(
    grupoOLXPublicationSchema.parse(publication).canonical_published_version,
    1,
  );
  assert.equal(
    grupoOLXPublicationSchema.safeParse({
      ...publication,
      raw_payload: { must: "stay-server-side" },
    }).success,
    false,
  );
});

test("retorno OAuth Meta aceita somente o portfolio seguro do backend", () => {
  const safeFlow = {
    id: "10000000-0000-4000-8000-000000000001",
    organization_id: "10000000-0000-4000-8000-000000000002",
    user_id: "10000000-0000-4000-8000-000000000003",
    status: "success",
    payload: {
      flow_id: "10000000-0000-4000-8000-000000000001",
      success: true,
      pages: [
        {
          id: "123456789",
          name: "Pagina Vimob",
          instagram_business_account: {
            id: "987654321",
            username: "vimob",
          },
        },
      ],
      ad_accounts: [
        { id: "act_123", account_id: "123", name: "Conta principal" },
      ],
    },
  };

  assert.equal(
    metaOAuthFlowResultSchema.parse(safeFlow).payload?.pages[0]?.name,
    "Pagina Vimob",
  );
  assert.throws(() =>
    metaOAuthFlowResultSchema.parse({
      ...safeFlow,
      payload: {
        ...safeFlow.payload,
        user_token: "must-never-reach-the-browser",
      },
    }),
  );
});

test("retorno de conexao Meta informa quando a dashboard nao recebeu ads_read", () => {
  const parsed = metaConnectPageActionResponseSchema.parse({
    success: true,
    marketing_active: false,
    messenger_active: true,
    integration: { id: "20000000-0000-4000-8000-000000000001" },
    missing_permissions: ["ads_read"],
  });

  assert.deepEqual(parsed.missing_permissions, ["ads_read"]);
  assert.throws(() =>
    metaConnectPageActionResponseSchema.parse({
      success: true,
      marketing_active: true,
      messenger_active: true,
      integration: {},
      missing_permissions: "ads_read",
    }),
  );
});

test("retorno de formularios Meta valida o contrato antes de chegar a interface", () => {
  const parsed = metaPageFormsActionResponseSchema.parse({
    forms: [
      {
        id: "123456789",
        name: "Formulario de interesse",
        status: "ACTIVE",
        leads_count: 7,
        questions: [
          { key: "full_name", label: "Nome completo", type: "FULL_NAME" },
        ],
      },
    ],
  });

  assert.equal(parsed.forms[0]?.questions?.[0]?.key, "full_name");
  assert.throws(() =>
    metaPageFormsActionResponseSchema.parse({
      forms: [{ id: "123456789", name: "", status: "ACTIVE" }],
    }),
  );
  assert.throws(() =>
    metaPageFormsActionResponseSchema.parse({
      forms: [
        {
          id: "123456789",
          name: "Formulario",
          status: "ACTIVE",
          access_token: "secret",
        },
      ],
    }),
  );
});

test("configuracao de formulario Meta aceita imovel e fila ausentes", () => {
  const parsed = metaFormConfigInputSchema.parse({
    integrationId: "20000000-0000-4000-8000-000000000001",
    formId: "1110786561386001",
    formName: "HOLOS MOOD TATUAPE - CC",
    propertyId: null,
    roundRobinId: null,
    purpose: "Venda",
    defaultValues: {
      purpose: "Venda",
      auto_tags: [],
    },
    autoTags: [],
    fieldMapping: {
      full_name: "name",
      phone_number: "phone",
    },
    customFieldsConfig: [],
    isActive: true,
  });

  assert.equal(parsed.propertyId, null);
  assert.equal(parsed.roundRobinId, null);
  assert.equal("property_id" in (parsed.defaultValues ?? {}), false);
});

test("projecoes Meta rejeitam credenciais ou campos inesperados", () => {
  const integration = {
    id: "20000000-0000-4000-8000-000000000001",
    organization_id: "20000000-0000-4000-8000-000000000002",
    page_id: "123456789",
    page_name: "Pagina Vimob",
    page_picture_url: null,
    facebook_user_id: null,
    facebook_user_name: null,
    is_connected: true,
    integration_type: "facebook",
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
    health_status: "healthy",
    token_status: "active",
    token_expires_at: null,
    last_validated_at: null,
    webhook_subscribed_at: null,
    created_at: "2026-07-31T12:00:00Z",
    updated_at: "2026-07-31T12:00:00Z",
    marketing_token_available: true,
    instagram_insights_available: true,
    crm_dataset_id: "987654321098765",
    crm_dataset_name: "Dataset Vimob",
    conversion_feedback_enabled: true,
    conversion_feedback_status: "active",
    conversion_feedback_last_sent_at: null,
    conversion_feedback_last_validated_at: null,
    conversion_feedback_last_error: null,
  };

  assert.equal(
    metaPublicIntegrationSchema.parse(integration).page_id,
    "123456789",
  );
  const legacyIntegration = { ...integration };
  delete (legacyIntegration as Partial<typeof integration>)
    .marketing_token_available;
  delete (legacyIntegration as Partial<typeof integration>)
    .instagram_insights_available;
  Object.assign(legacyIntegration, {
    assigned_user_id: null,
    form_ids: ["form_123"],
    field_mapping: { email: "email" },
    campaign_property_mapping: { campaign_123: "property_123" },
  });
  assert.equal(
    metaPublicIntegrationSchema.parse(legacyIntegration)
      .marketing_token_available,
    false,
    "backends anteriores devem permanecer visiveis sem liberar Marketing avancado",
  );
  assert.equal(
    metaPublicIntegrationSchema.parse(legacyIntegration)
      .instagram_insights_available,
    false,
    "backends anteriores devem permanecer visiveis sem liberar insights organicos",
  );
  assert.throws(() =>
    metaPublicIntegrationSchema.parse({
      ...integration,
      access_token: "must-never-reach-the-browser",
    }),
  );
  for (const forbiddenField of [
    "user_token",
    "granted_scopes",
    "access_token_secret_ref",
    "crm_dataset_access_token",
    "crm_dataset_access_token_secret_ref",
    "test_event_code",
    "testEventCode",
  ]) {
    assert.throws(() =>
      metaPublicIntegrationSchema.parse({
        ...integration,
        [forbiddenField]: "must-never-reach-the-browser",
      }),
    );
  }
  assert.throws(() =>
    metaAdAccountsActionResponseSchema.parse({
      success: true,
      ad_accounts: [],
      user_token: "must-never-reach-the-browser",
    }),
  );
});

test("configuracao de devolucao Meta valida dataset e token write-only", () => {
  const parsed = metaConversionFeedbackInputSchema.parse({
    integrationId: "20000000-0000-4000-8000-000000000001",
    datasetId: "987654321098765",
    datasetName: "Dataset Vimob",
    datasetAccessToken: "token-enviado-somente-ao-backend",
    enabled: true,
    replayRecentFacts: true,
    testEventCode: "TEST12345",
  });

  assert.equal(parsed.datasetId, "987654321098765");
  assert.equal(parsed.replayRecentFacts, true);
  assert.equal(parsed.testEventCode, "TEST12345");
  assert.equal(
    metaConversionFeedbackInputSchema.safeParse({
      integrationId: "20000000-0000-4000-8000-000000000001",
      enabled: true,
      replayRecentFacts: true,
    }).success,
    false,
  );
  assert.equal(
    metaConversionFeedbackInputSchema.safeParse({
      ...parsed,
      enabled: false,
      replayRecentFacts: true,
    }).success,
    false,
  );
  assert.equal(
    metaConversionFeedbackInputSchema.safeParse({
      ...parsed,
      replayRecentFacts: false,
      testEventCode: "TEST12345",
    }).success,
    false,
  );
  assert.equal(
    metaConversionFeedbackInputSchema.safeParse({
      ...parsed,
      testEventCode: "   ",
    }).success,
    false,
  );
  assert.equal(
    metaConversionFeedbackInputSchema.safeParse({
      ...parsed,
      testEventCode: "TEST\n12345",
    }).success,
    false,
  );
  assert.throws(() =>
    metaConversionFeedbackInputSchema.parse({
      ...parsed,
      datasetId: "act_123",
    }),
  );
  assert.throws(() =>
    metaConversionFeedbackInputSchema.parse({
      ...parsed,
      unexpectedCredential: "must-not-pass",
    }),
  );
});

test("Chaves na Mão aceita somente configuração e publicação XML", () => {
  const settings = {
    settings: {
      contact_name: "Equipe Vimob",
      contact_email: "portais@vimob.com.br",
      contact_phone: "+55 41 99999-9999",
      detail_base_url: "https://imobiliaria.example/imoveis",
    },
  };
  assert.equal(chavesNaMaoIntegrationInputSchema.safeParse(settings).success, true);
  assert.equal(
    chavesNaMaoIntegrationInputSchema.safeParse({
      ...settings,
      defaultRoundRobinId: "30000000-0000-4000-8000-000000000001",
    }).success,
    false,
  );
  assert.equal(
    chavesNaMaoIntegrationInputSchema.safeParse({
      ...settings,
      webhookToken: "nao-suportado",
    }).success,
    false,
  );

  const publication = {
    publications: [
      {
        propertyId: "30000000-0000-4000-8000-000000000002",
        clientListingId: "VIMOB-123",
        publicationType: "FEATURED",
        isEnabled: true,
      },
    ],
  };
  assert.equal(chavesNaMaoPublicationsInputSchema.safeParse(publication).success, true);
  assert.equal(
    chavesNaMaoPublicationsInputSchema.safeParse({
      publications: [
        { ...publication.publications[0], publicationType: "PREMIUM" },
      ],
    }).success,
    false,
  );
});

test("resposta Chaves na Mão fixa webhook de leads como indisponível", () => {
  const integration = {
    id: "30000000-0000-4000-8000-000000000003",
    organization_id: "30000000-0000-4000-8000-000000000004",
    portal: "chaves_na_mao",
    status: "pending_setup",
    is_active: true,
    feed_token: "a".repeat(64),
    settings: {
      contact_name: "Equipe Vimob",
      contact_email: "portais@vimob.com.br",
      detail_base_url: "https://imobiliaria.example/imoveis",
    },
    last_feed_accessed_at: null,
    last_sync_status: null,
    last_error: null,
    lead_webhook_available: false,
    lead_webhook_blocker: "Contrato público de leads indisponível.",
    created_at: "2026-09-08T12:00:00Z",
    updated_at: "2026-09-08T12:00:00Z",
  };

  assert.equal(chavesNaMaoIntegrationSchema.safeParse(integration).success, true);
  assert.equal(
    chavesNaMaoIntegrationSchema.safeParse({
      ...integration,
      lead_webhook_available: true,
    }).success,
    false,
  );
  assert.equal(
    chavesNaMaoIntegrationSchema.safeParse({
      ...integration,
      webhook_token: "b".repeat(64),
    }).success,
    false,
  );
});

test("catalogo de integracoes separa portais e mantem conectores futuros visiveis", () => {
  const source = readFileSync(
    resolve(process.cwd(), "components/features/settings/IntegrationsTab.tsx"),
    "utf8",
  );

  const expectedIntegrationNames = [
    "WhatsApp",
    "IA de atendimento",
    "Meta",
    "Canal Pro",
    "ZAP Imóveis",
    "Viva Real",
    "OLX",
    "Chaves na Mão",
    "Google Agenda",
    "Webhook",
    "API",
    "ChatGPT",
    "ManyChat",
    "Google Tag Manager",
    "Google Analytics",
    "Google Search Console",
    "Vista",
    "Instagram",
    "Claude",
  ];

  assert.deepEqual(
    INTEGRATION_PROVIDER_IDS.map(
      (providerId) => INTEGRATION_PROVIDER_CATALOG[providerId].title,
    ),
    expectedIntegrationNames,
  );

  assert.doesNotMatch(source, /\.filter\(\(item\) => item\.enabled\)/);
  assert.match(source, /INTEGRATION_PROVIDER_IDS\.map\(\(key\)/);
  assert.match(source, /isIntegrationProviderId\(value\)/);
  assert.deepEqual(INTEGRATION_MANAGE_KEY_ALIASES, {
    zap: "grupo-olx",
    "viva-real": "grupo-olx",
    olx: "grupo-olx",
  });
  assert.match(source, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(source, /<BrandGlyph label=\{fallback\}/);
  assert.match(
    source,
    /label: "Homologação pendente"/,
  );

  for (const disabledKey of [
    "chatgpt",
    "manychat",
    "vista",
    "instagram",
    "claude",
    "chaves-na-mao",
  ] as const) {
    assert.equal(isIntegrationAvailableByDefault(disabledKey), false);
  }

  for (const availableBackendKey of ["webhooks", "api"] as const) {
    assert.equal(isIntegrationAvailableByDefault(availableBackendKey), true);
    assert.deepEqual(
      INTEGRATION_PROVIDER_CATALOG[availableBackendKey].management,
      {
        kind: "dialog",
      },
    );
  }

  for (const availableGoogleSiteKey of [
    "google-tag-manager",
    "google-analytics",
    "google-search-console",
  ] as const) {
    assert.equal(isIntegrationAvailableByDefault(availableGoogleSiteKey), true);
    assert.deepEqual(
      INTEGRATION_PROVIDER_CATALOG[availableGoogleSiteKey].management,
      {
        kind: "dialog",
      },
    );
    assert.equal(
      INTEGRATION_PROVIDER_CATALOG[availableGoogleSiteKey].requiredModule,
      "site",
    );
    assert.equal(
      INTEGRATION_PROVIDER_CATALOG[availableGoogleSiteKey].requiredPermission,
      "settings_site",
    );
  }

  assert.deepEqual(INTEGRATION_PROVIDER_CATALOG.meta.management, {
    kind: "route",
    href: "/settings/integrations/meta",
  });
  assert.deepEqual(INTEGRATION_PROVIDER_CATALOG.whatsapp.management, {
    kind: "route",
    href: "/settings/integrations/whatsapp",
  });
  assert.equal(
    INTEGRATION_PROVIDER_CATALOG.whatsapp.requiredPermission,
    "whatsapp_view",
  );
  assert.equal(
    INTEGRATION_PROVIDER_CATALOG["chaves-na-mao"].availability,
    "requires-homologation",
  );
  assert.equal(
    INTEGRATION_PROVIDER_CATALOG["chaves-na-mao"].management.kind,
    "dialog",
  );
  assert.deepEqual(
    INTEGRATION_PROVIDER_CATALOG["chaves-na-mao"].capabilities,
    ["property-publication"],
  );
  assert.equal(
    INTEGRATION_PROVIDER_CATALOG["chaves-na-mao"].requiredModule,
    "portals",
  );
  assert.equal(
    createIntegrationProviderManifest("chaves-na-mao").aliasOf,
    null,
  );
  assert.match(source, /router\.push\(item\.management\.href\)/);
  assert.match(source, /window\.open\(item\.management\.href/);
  assert.match(source, /INTEGRATION_CATEGORY_IDS\.map\(\(categoryId\)/);
  assert.match(source, /INTEGRATION_CAPABILITY_LABELS\[capability\]/);
  assert.match(source, /Não foi possível consultar o status/);
  assert.doesNotMatch(
    source,
    /WhatsAppIntegrationSettings/,
    "WhatsApp deve abrir a página dedicada, nunca voltar ao popup de integrações",
  );
  assert.match(source, /<GrupoOLXIntegrationSettings \/>/);
  assert.match(source, /<ChavesNaMaoIntegrationSettings \/>/);
  assert.match(source, /<GoogleAnalyticsIntegrationSettings \/>/);
  assert.match(source, /<GoogleTagManagerIntegrationSettings \/>/);
  assert.match(source, /<GoogleSearchConsoleIntegrationSettings \/>/);
  assert.match(source, /hasPortalsModule/);

  const chavesSettingsSource = readFileSync(
    resolve(
      process.cwd(),
      "components/features/integrations/chaves-na-mao/ChavesNaMaoIntegrationSettings.tsx",
    ),
    "utf8",
  );
  const chavesHookSource = readFileSync(
    resolve(
      process.cwd(),
      "hooks/integrations/chaves-na-mao/use-chaves-na-mao-integration.ts",
    ),
    "utf8",
  );
  const chavesAPISource = readFileSync(
    resolve(
      process.cwd(),
      "lib/api/integrations/chaves-na-mao.ts",
    ),
    "utf8",
  );
  assert.match(chavesSettingsSource, /disabled=\{\s*!canActivate/);
  assert.match(
    chavesSettingsSource,
    /integrationQuery\.isSuccess && !integrationQuery\.isError/,
  );
  assert.match(chavesSettingsSource, /Entrada de leads não disponível/);
  assert.match(chavesSettingsSource, /Manual oficial/);
  assert.match(chavesHookSource, /requireHomologationOpen\(homologationOpen\)/);
  assert.match(
    chavesAPISource,
    /chaves_na_mao_homologation_required/,
  );
  assert.doesNotMatch(chavesAPISource, /chaves-na-mao\/leads/);
  assert.equal(
    createIntegrationProviderManifest("meta").effectiveRequiresAdmin,
    true,
  );
  assert.equal(
    createIntegrationProviderManifest("zap").effectiveRequiresAdmin,
    true,
  );
  assert.match(
    source,
    /rounded-\[8px\] border-0 bg-\[var\(--app-surface-solid\)\] shadow-none/,
  );
  assert.doesNotMatch(source, /cdn\.simpleicons\.org\//);

  for (const providerId of INTEGRATION_PROVIDER_IDS) {
    const providerRoot = resolve(
      process.cwd(),
      "components/features/integrations/providers",
      providerId,
    );
    assert.equal(existsSync(resolve(providerRoot, "manifest.ts")), true);
    assert.equal(existsSync(resolve(providerRoot, "index.ts")), true);
  }

  for (const assetPath of Object.values(INTEGRATION_BRAND_ASSETS)) {
    assert.match(assetPath, /^\/images\/integrations\/[a-z0-9-]+\.svg$/);
    assert.equal(
      existsSync(resolve(process.cwd(), "public", assetPath.slice(1))),
      true,
      `${assetPath} precisa existir no bundle local`,
    );
  }
});

test("status do catalogo reflete a conexao real dos provedores", () => {
  assert.equal(getGoogleCalendarIntegrationStatus(null), "not-connected");
  assert.equal(
    getGoogleCalendarIntegrationStatus({ sync_status: "error" }),
    "reconnect-required",
  );
  assert.equal(
    getGoogleCalendarIntegrationStatus({ sync_status: "connected" }),
    "connected",
  );
  assert.equal(isGoogleCalendarIntegrationConnected(null), false);
  assert.equal(
    isGoogleCalendarIntegrationConnected({ sync_status: "connected" }),
    true,
  );
  assert.equal(
    isGoogleCalendarIntegrationConnected({ sync_status: "syncing" }),
    true,
  );
  assert.equal(
    isGoogleCalendarIntegrationConnected({ sync_status: "idle" }),
    true,
  );
  assert.equal(
    isGoogleCalendarIntegrationConnected({ sync_status: "disconnected" }),
    false,
  );
  assert.equal(
    isGoogleCalendarIntegrationConnected({ sync_status: "error" }),
    false,
  );
  assert.equal(
    isGoogleCalendarIntegrationConnected({ sync_status: "unknown" }),
    false,
  );

  assert.equal(isGrupoOLXIntegrationConnected(null), false);
  assert.equal(getGrupoOLXIntegrationStatus(null), "not-connected");
  assert.equal(
    getGrupoOLXIntegrationStatus({ status: "pending_setup", is_active: true }),
    "not-connected",
  );
  assert.equal(
    getGrupoOLXIntegrationStatus({ status: "paused", is_active: true }),
    "reconnect-required",
  );
  assert.equal(
    getGrupoOLXIntegrationStatus({ status: "connected", is_active: true }),
    "connected",
  );
  assert.equal(
    isGrupoOLXIntegrationConnected({ status: "connected", is_active: true }),
    true,
  );
  assert.equal(
    isGrupoOLXIntegrationConnected({ status: "connected", is_active: false }),
    false,
  );
  assert.equal(
    isGrupoOLXIntegrationConnected({
      status: "paused",
      is_active: true,
      last_feed_accessed_at: "2026-08-31T12:00:00Z",
    }),
    false,
  );
  assert.equal(
    isGrupoOLXIntegrationConnected({
      status: "error",
      is_active: true,
      last_feed_accessed_at: "2026-08-31T12:00:00Z",
    }),
    false,
  );
  assert.equal(
    isGrupoOLXIntegrationConnected({
      status: "pending_setup",
      is_active: true,
    }),
    false,
  );

  assert.equal(getChavesNaMaoIntegrationStatus(null), "not-connected");
  assert.equal(
    getChavesNaMaoIntegrationStatus({
      status: "connected",
      is_active: true,
    }),
    "connected",
  );
  assert.equal(
    getChavesNaMaoIntegrationStatus({
      status: "paused",
      is_active: false,
    }),
    "reconnect-required",
  );

  assert.equal(
    isMetaIntegrationConnected({ is_connected: true, token_status: "active" }),
    true,
  );
  assert.equal(getMetaIntegrationStatus(null), "not-connected");
  assert.equal(
    getMetaIntegrationStatus({ is_connected: true, token_status: "expired" }),
    "reconnect-required",
  );
  assert.equal(
    getMetaIntegrationStatus({ is_connected: true, token_status: "active" }),
    "connected",
  );
  assert.equal(
    isMetaIntegrationConnected({ is_connected: true, token_status: null }),
    true,
  );
  assert.equal(
    isMetaIntegrationConnected({ is_connected: false, token_status: "active" }),
    false,
  );
  assert.equal(
    isMetaIntegrationConnected({ is_connected: true, token_status: "expired" }),
    false,
  );
  assert.equal(
    isMetaIntegrationConnected({ is_connected: true, token_status: "invalid" }),
    false,
  );
  assert.equal(
    isMetaIntegrationConnected({ is_connected: true, token_status: "error" }),
    false,
  );

  const marketingSource = readFileSync(
    resolve(process.cwd(), "hooks/marketing/use-marketing-dashboard.ts"),
    "utf8",
  );
  assert.match(marketingSource, /filter\(isMetaIntegrationConnected\)/);
});

test("tela Meta preserva autoria compacta e concentra a rolagem na lista", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "components/features/integrations/MetaIntegrationSettings.tsx",
    ),
    "utf8",
  );
  const screenSource = readFileSync(
    resolve(
      process.cwd(),
      "components/features/integrations/MetaSettingsScreen.tsx",
    ),
    "utf8",
  );

  assert.doesNotMatch(source, /MetaConversionFeedbackPanel/);
  assert.match(source, /<MetaWebhookHealthBanner \/>/);
  assert.match(
    source,
    /aria-label={`Criado por \$\{config\.created_by_name\}`}/,
  );
  assert.match(source, /max-w-\[1500px\]/);
  assert.match(
    source,
    /lg:grid-cols-\[minmax\(220px,260px\)_minmax\(0,1fr\)\]/,
  );
  assert.match(
    source,
    /lg:grid-cols-\[minmax\(280px,0\.8fr\)_minmax\(360px,1\.4fr\)\]/,
  );
  assert.match(source, /sm:max-w-sm lg:w-\[360px\] lg:flex-none/);
  assert.match(source, /min-h-0 flex-1 overflow-hidden/);
  assert.match(source, /\[&>div\]:h-full \[&>div\]:overflow-auto/);
  assert.match(screenSource, /borderless disableMainScroll/);
  assert.doesNotMatch(source, /line-clamp-/);
  assert.match(
    source,
    /title=\{integration\?\.page_name \|\| "Página conectada"\}/,
  );
  assert.match(source, /title=\{config\.form_name \|\| config\.form_id\}/);
  assert.match(
    source,
    /format\(new Date\(config\.created_at\), "dd\/MM\/yyyy"/,
  );
  assert.match(source, /format\(new Date\(config\.created_at\), "HH:mm"/);
  assert.match(source, /adAccountId: selectedAccount\.adAccountId/);
  assert.match(
    source,
    /if \(selectedAccount\?\.isNew\) \{\s*setSelectedIntegration\(null\);\s*setPendingPage\(page\);\s*return;\s*\}/,
  );
  assert.match(
    source,
    /setNewOAuth\(null\);\s*setSelectedAccountKey\(getIntegrationAccountKey\(integration\)\);/,
  );
  assert.match(source, /getAccountPageSummary\(account\)/);
  assert.doesNotMatch(source, />Nova conexão</);
  assert.match(source, /Atualizar conexão da página/);
});
