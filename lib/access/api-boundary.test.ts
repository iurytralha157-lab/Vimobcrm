import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { getSafeAbsoluteHttpUrl } from '../safe-http-url'

const protectedClientFiles = [
  "lib/api/pipeline-board.ts",
  "lib/api/pipelines.ts",
  "contexts/AuthContext.tsx",
];

test("dados de autorizacao e pipeline passam pela API central", () => {
  for (const relativePath of protectedClientFiles) {
    const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");

    assert.doesNotMatch(
      source,
      /\.from\s*\(\s*['"`]/,
      `${relativePath} must not query Supabase tables directly`,
    );
  }
});

test("modulos de imoveis e site sao exigidos tambem no backend", () => {
  const source = readFileSync(
    resolve(process.cwd(), "apps/api/internal/app/app.go"),
    "utf8",
  );

  for (const contract of [
    'GET /v1/properties", withModulePermission("properties"',
    'GET /v1/property-summaries", withModulePermission("properties"',
    'GET /v1/site", withModulePermission("site"',
    'GET /v1/analytics/lead", withModulePermission("site"',
    'GET /v1/analytics/site-summary", withModulePermission("site"',
    'GET /v1/analytics/site-detailed", withModulePermission("site"',
  ]) {
    assert.match(
      source,
      new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
});

test("consultas e picker de imoveis falham fechados sem o modulo", () => {
  const propertiesHook = readFileSync(
    resolve(process.cwd(), "hooks/use-properties.ts"),
    "utf8",
  );
  const propertyPicker = readFileSync(
    resolve(
      process.cwd(),
      "components/features/properties/PropertyPickerDialog.tsx",
    ),
    "utf8",
  );

  assert.match(
    propertiesHook,
    /const hasPropertiesModule = hasModule\(["']properties["']\)/,
  );
  assert.match(
    propertiesHook,
    /enabled:\s*!!user\?\.id\s*&&\s*!!organizationId\s*&&\s*hasPropertiesModule\s*&&\s*options\.enabled !== false/,
  );
  assert.match(
    propertyPicker,
    /const hasPropertiesModule = hasModule\(["']properties["']\)/,
  );
  assert.match(propertyPicker, /if \(!hasPropertiesModule\) return null/);
});

test("configuracao Meta so consulta e edita filas com permissao de distribuicao", () => {
  const metaFormDialog = readFileSync(
    resolve(
      process.cwd(),
      "components/features/integrations/MetaFormConfigDialog.tsx",
    ),
    "utf8",
  );

  assert.match(metaFormDialog, /hasPermission\("distribution_manage"\)/);
  assert.match(
    metaFormDialog,
    /useRoundRobins\(\{\s*enabled: open && canManageDistribution,/,
  );
  assert.match(metaFormDialog, /\{canManageDistribution \? \(/);
  assert.match(
    metaFormDialog,
    /\{canManageDistribution && \(\s*<DistributionQueueEditor/,
  );
});

test("Meta usa somente o backend e separa visualizacao de administracao", () => {
  const metaHook = readFileSync(
    resolve(process.cwd(), "hooks/use-meta-integration.ts"),
    "utf8",
  );
  const marketingHook = readFileSync(
    resolve(process.cwd(), "hooks/marketing/use-marketing-dashboard.ts"),
    "utf8",
  );
  const marketingScreen = readFileSync(
    resolve(process.cwd(), "components/features/marketing/MarketingScreen.tsx"),
    "utf8",
  );

  assert.doesNotMatch(
    metaHook,
    /graph\.facebook\.com|supabase\.functions|invokeFunction/,
  );
  assert.match(metaHook, /integrationsAPI\.metaOAuthAction/);
  assert.match(marketingHook, /hasPermission\("settings_integrations"\)/);
  assert.match(
    marketingHook,
    /useMetaIntegrations\(\{ enabled: canManageIntegration \}\)/,
  );
  assert.match(
    marketingScreen,
    /model\.canManageIntegration && model\.integrationState\.isConnected/,
  );
});

test("disponibilidade e logo de equipe usam a organizacao ativa", () => {
  const availabilityHook = readFileSync(
    resolve(process.cwd(), "hooks/use-member-availability.ts"),
    "utf8",
  );
  const teamDialog = readFileSync(
    resolve(process.cwd(), "components/features/teams/TeamDialog.tsx"),
    "utf8",
  );

  assert.match(
    availabilityHook,
    /queryKey:\s*\[["']member-availability["'], organizationId, teamMemberId\]/,
  );
  assert.match(
    availabilityHook,
    /queryKey:\s*\[["']team-members-availability["'], organizationId, stableMemberIds\]/,
  );
  assert.match(
    availabilityHook,
    /listMemberAvailability\(\{ teamMemberId, organizationId \}\)/,
  );
  assert.match(
    availabilityHook,
    /teamMemberIds:\s*stableMemberIds,\s*organizationId,/,
  );
  assert.match(
    availabilityHook,
    /updateMemberAvailability\(input, organizationId\)/,
  );
  assert.match(
    availabilityHook,
    /replaceMemberAvailability\([\s\S]*?organizationId,\s*\)/,
  );
  assert.match(teamDialog, /uploadLogo\(logoFile, organizationId\)/);
});

test("editor preserva keep_assignee ao editar uma fila", () => {
  const editor = readFileSync(
    resolve(
      process.cwd(),
      "components/features/round-robin/DistributionQueueEditor.tsx",
    ),
    "utf8",
  );
  const queueMutation = readFileSync(
    resolve(process.cwd(), "hooks/use-create-queue-advanced.ts"),
    "utf8",
  );

  assert.match(
    editor,
    /reentry_behavior\?:\s*["']redistribute["']\s*\|\s*["']keep_assignee["']\s*\|\s*null;/,
  );
  assert.match(
    editor,
    /reentry_behavior:\s*queue\.reentry_behavior\s*\?\?\s*queue\.settings\?\.reentry_behavior\s*\?\?\s*["']redistribute["']/,
  );
  assert.match(
    queueMutation,
    /reentry_behavior:\s*input\.settings\.reentry_behavior\s*\|\|\s*["']redistribute["']/,
  );
});

test("chaves de API e webhooks isolam cache e chamadas pela organizacao ativa", () => {
  const apiTab = readFileSync(
    resolve(process.cwd(), "components/features/settings/APITab.tsx"),
    "utf8",
  );
  const webhooksHook = readFileSync(
    resolve(process.cwd(), "hooks/use-webhooks.ts"),
    "utf8",
  );

  for (const source of [apiTab, webhooksHook]) {
    assert.match(
      source,
      /organization\?\.id\s*\|\|\s*profile\?\.organization_id/,
    );
  }

  assert.match(apiTab, /queryKey:\s*\[['"]api-keys['"], organizationId\]/);
  assert.match(apiTab, /listApiKeys\(organizationId\)/);
  assert.match(apiTab, /createApiKey\([\s\S]*?organizationId,\s*\)/);
  assert.match(apiTab, /deleteApiKey\(id, organizationId\)/);
  assert.match(
    apiTab,
    /invalidateQueries\(\{ queryKey: \[['"]api-keys['"], organizationId\] \}\)/,
  );

  assert.match(
    webhooksHook,
    /queryKey:\s*\[['"]webhooks['"], organizationId\]/,
  );
  for (const method of [
    "list",
    "create",
    "update",
    "delete",
    "regenerateToken",
  ]) {
    assert.match(
      webhooksHook,
      new RegExp(`webhooksAPI\\.${method}\\([\\s\\S]*?organizationId\\)`),
    );
  }
});

test("DRE isola consultas e mutacoes pela organizacao ativa", () => {
  const dreHook = readFileSync(
    resolve(process.cwd(), "hooks/use-dre.ts"),
    "utf8",
  );
  const dreConfig = readFileSync(
    resolve(
      process.cwd(),
      "components/features/financial/DREAccountConfig.tsx",
    ),
    "utf8",
  );

  assert.equal(
    [
      ...dreHook.matchAll(
        /organization\?\.id\s*\|\|\s*profile\?\.organization_id/g,
      ),
    ].length,
    4,
  );
  assert.match(dreHook, /throw new Error\(['"]Organização não encontrada\./);
  assert.match(
    dreConfig,
    /const organizationId = organization\?\.id \|\| profile\?\.organization_id/,
  );
  assert.match(dreConfig, /createDREMapping\([\s\S]*?organizationId\)/);
  assert.match(dreConfig, /deleteDREMapping\(mappingId, organizationId\)/);
});

test("mutacoes financeiras falham fechadas sem organizacao ativa", () => {
  const entriesHook = readFileSync(
    resolve(process.cwd(), "hooks/use-financial.ts"),
    "utf8",
  );
  const commissionsHook = readFileSync(
    resolve(process.cwd(), "hooks/use-commissions.ts"),
    "utf8",
  );

  assert.equal(
    [
      ...entriesHook.matchAll(
        /if \(!orgId\) throw new Error\(["']Organização não encontrada["']\)/g,
      ),
    ].length,
    5,
  );
  assert.equal(
    [
      ...commissionsHook.matchAll(
        /if \(!organizationId\) throw new Error\(["']Organização não encontrada["']\)/g,
      ),
    ].length,
    6,
  );
});
test("distribuicao reconhece formularios Meta por uma leitura propria e limitada", () => {
  const appSource = readFileSync(
    resolve(process.cwd(), "apps/api/internal/app/app.go"),
    "utf8",
  );
  const editorSource = readFileSync(
    resolve(
      process.cwd(),
      "components/features/round-robin/DistributionQueueEditor.tsx",
    ),
    "utf8",
  );
  const tabSource = readFileSync(
    resolve(
      process.cwd(),
      "components/features/crm-management/DistributionTab.tsx",
    ),
    "utf8",
  );

  assert.match(
    appSource,
    /GET \/v1\/round-robin-meta-forms[^\n]+permissions\.DistributionManage/,
  );
  for (const source of [editorSource, tabSource]) {
    assert.match(source, /useRoundRobinMetaForms/);
    assert.doesNotMatch(source, /useMetaFormConfigs|useMetaIntegrations/);
  }
});

test('editor preserva a politica canonica de reentrada ao atualizar uma fila', () => {
  const editorSource = readFileSync(
    resolve(process.cwd(), 'components/features/round-robin/DistributionQueueEditor.tsx'),
    'utf8',
  )

  assert.match(
    editorSource,
    /reentry_behavior\?: ["']redistribute["'] \| ["']keep_assignee["'] \| null;/,
  )
  assert.match(
    editorSource,
    /\.\.\.\(queue\.settings \|\| \{\}\),[\s\S]*?reentry_behavior:\s*queue\.reentry_behavior\s*\?\?\s*queue\.settings\?\.reentry_behavior\s*\?\?\s*["']redistribute["'],/,
  )
})

test('ajustes visuais do fluxo WhatsApp preservam os dados e escondem codigos internos', () => {
  const trackingSource = readFileSync(
    resolve(process.cwd(), 'components/features/leads/LeadDetailDialog.tsx'),
    'utf8',
  )
  const trackingSectionSource = readFileSync(
    resolve(process.cwd(), 'components/features/leads/LeadTrackingSection.tsx'),
    'utf8',
  )
  const historySource = readFileSync(resolve(process.cwd(), 'hooks/use-lead-history.ts'), 'utf8')
  const editorSource = readFileSync(
    resolve(process.cwd(), 'components/features/round-robin/DistributionQueueEditor.tsx'),
    'utf8',
  )
  const tagSelectorSource = readFileSync(resolve(process.cwd(), 'components/ui/tag-selector.tsx'), 'utf8')
  const cardSource = readFileSync(resolve(process.cwd(), 'components/features/leads/LeadCard.tsx'), 'utf8')

  assert.match(trackingSource, /rawPayload\?\.source_url/)
  assert.match(trackingSource, /rawSourceReferral\?\.source_url/)
  assert.match(trackingSource, /const safeCreativeLink = getSafeAbsoluteHttpUrl\(leadMeta\?\.creative_link_url\)/)
  assert.match(trackingSource, /\['Link do criativo', safeCreativeLink\]/)
  assert.match(trackingSource, /\['Imagem', getSafeAbsoluteHttpUrl\(leadMeta\?\.creative_url\)\]/)
  assert.match(trackingSource, /\['Video', getSafeAbsoluteHttpUrl\(leadMeta\?\.creative_video_url\)\]/)
  assert.match(trackingSectionSource, /const safeCreativeImageUrl = getSafeAbsoluteHttpUrl\(leadMeta\.creative_url\)/)
  assert.match(trackingSectionSource, /const safeCreativeVideoUrl = getSafeAbsoluteHttpUrl\(leadMeta\.creative_video_url\)/)
  assert.match(trackingSectionSource, /window\.open\(url, '_blank', 'noopener,noreferrer'\)/)
  assert.doesNotMatch(trackingSectionSource, /window\.open\(leadMeta\./)
  assert.match(historySource, /'round_robin_auto',[\s\S]*?'canonical_round_robin'/)
  assert.match(editorSource, /import \{ useCreateTag, useTags \} from ["']@\/hooks\/use-tags["']/)
  assert.match(editorSource, /const handleCreateAutoTag = async \(\) => \{/)
  assert.match(editorSource, /!hasPermission\(["']tag_manage["']\)/)
  assert.match(editorSource, /searchTextIncludes\(tag\.name, autoTagSearch\)/)
  assert.match(editorSource, /void handleCreateAutoTag\(\)/)
  assert.match(editorSource, /<Command filter=\{commandSearchFilter\}>/)
  assert.match(editorSource, /Buscar corretor por nome ou e-mail/)
  assert.doesNotMatch(tagSelectorSource, /allowCreate\?: boolean/)
  assert.match(cardSource, /\{campaignName && \([\s\S]*?\{campaignName\}[\s\S]*?\)\}/)
  assert.doesNotMatch(cardSource, /const label = campaignName \|\| 'WhatsApp';/)
  assert.doesNotMatch(cardSource, /`WhatsApp · \$\{campaignName\}`/)
})

test('resposta automática da fila WhatsApp permanece opt-in e limitada', () => {
  const editorSource = readFileSync(
    resolve(process.cwd(), 'components/features/round-robin/DistributionQueueEditor.tsx'),
    'utf8',
  )
  const createHookSource = readFileSync(resolve(process.cwd(), 'hooks/use-create-queue-advanced.ts'), 'utf8')
  const listHookSource = readFileSync(resolve(process.cwd(), 'hooks/use-round-robins.ts'), 'utf8')

  for (const source of [editorSource, createHookSource, listHookSource]) {
    assert.match(source, /whatsapp_distribution_auto_reply_enabled\?: boolean/)
    assert.match(source, /whatsapp_distribution_auto_reply_message\?: string/)
    assert.match(source, /whatsapp_distribution_auto_reply_delay_seconds\?: number/)
  }
  assert.match(editorSource, /whatsapp_distribution_auto_reply_enabled: false/)
  assert.match(editorSource, /DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS = 30/)
  assert.match(editorSource, /MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS = 3600/)
  assert.match(editorSource, /\{hasWhatsAppMessageCondition && \([\s\S]*?distribution-queue-whatsapp-auto-reply/)
  assert.match(editorSource, /removedLastWhatsAppCondition[\s\S]*?whatsapp_distribution_auto_reply_enabled: false/)
  assert.match(editorSource, /sanitizedHasWhatsAppMessageCondition && whatsappAutoReplyEnabled/)
})

test('link do criativo aceita somente URL absoluta HTTP ou HTTPS', () => {
  assert.equal(getSafeAbsoluteHttpUrl('https://www.instagram.com/p/creative/'), 'https://www.instagram.com/p/creative/')
  assert.equal(getSafeAbsoluteHttpUrl('http://example.com/creative'), 'http://example.com/creative')
  assert.equal(getSafeAbsoluteHttpUrl('javascript:alert(1)'), null)
  assert.equal(getSafeAbsoluteHttpUrl('data:text/html,<script>alert(1)</script>'), null)
  assert.equal(getSafeAbsoluteHttpUrl('/creative/relative'), null)
})
