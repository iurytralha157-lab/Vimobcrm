import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

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
