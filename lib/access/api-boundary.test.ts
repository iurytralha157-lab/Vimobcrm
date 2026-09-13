import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { getSafeAbsoluteHttpUrl } from "../safe-http-url";

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
    resolve(process.cwd(), "apps/api/internal/app/routes.go"),
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
  const teamEditor = readFileSync(
    resolve(process.cwd(), "components/features/teams/TeamEditorScreen.tsx"),
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
  assert.match(teamEditor, /uploadLogo\(logoFile, organizationId\)/);
  assert.match(
    teamEditor,
    /accept=["']image\/jpeg,image\/png,image\/webp,image\/gif["']/,
  );
  assert.doesNotMatch(teamEditor, /image\/svg\+xml|GIF ou SVG/);
});

test("editor preserva keep_assignee ao editar uma fila", () => {
  const editor = readFileSync(
    resolve(
      process.cwd(),
      "components/features/round-robin/DistributionQueueEditor.tsx",
    ),
    "utf8",
  );
  const formContract = readFileSync(
    resolve(process.cwd(), "lib/round-robin/distribution-queue-form.ts"),
    "utf8",
  );
  const queueMutation = readFileSync(
    resolve(process.cwd(), "hooks/use-create-queue-advanced.ts"),
    "utf8",
  );

  assert.match(
    formContract,
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

test("gestao abre a criacao e a edicao de equipes e filas em paginas dedicadas", () => {
  const distributionTab = readFileSync(
    resolve(
      process.cwd(),
      "components/features/crm-management/DistributionTab.tsx",
    ),
    "utf8",
  );
  const teamsTab = readFileSync(
    resolve(process.cwd(), "components/features/crm-management/TeamsTab.tsx"),
    "utf8",
  );
  const newTeamPage = readFileSync(
    resolve(process.cwd(), "app/(protected)/crm/management/teams/new/page.tsx"),
    "utf8",
  );
  const teamEditor = readFileSync(
    resolve(process.cwd(), "components/features/teams/TeamEditorScreen.tsx"),
    "utf8",
  );
  const queuePage = readFileSync(
    resolve(
      process.cwd(),
      "app/(protected)/crm/management/distribution/[id]/edit/page.tsx",
    ),
    "utf8",
  );
  const newQueuePage = readFileSync(
    resolve(
      process.cwd(),
      "app/(protected)/crm/management/distribution/new/page.tsx",
    ),
    "utf8",
  );
  const queueScreen = readFileSync(
    resolve(
      process.cwd(),
      "components/features/round-robin/DistributionQueueEditorScreen.tsx",
    ),
    "utf8",
  );
  const queueLoading = readFileSync(
    resolve(
      process.cwd(),
      "app/(protected)/crm/management/distribution/[id]/edit/loading.tsx",
    ),
    "utf8",
  );

  assert.match(
    distributionTab,
    /NEW_DISTRIBUTION_QUEUE_URL\s*=\s*["']\/crm\/management\/distribution\/new["']/,
  );
  assert.match(distributionTab, /router\.push\(NEW_DISTRIBUTION_QUEUE_URL\)/);
  assert.match(
    distributionTab,
    /router\.push\(`\/crm\/management\/distribution\/\$\{queue\.id\}\/edit`\)/,
  );
  assert.doesNotMatch(
    distributionTab,
    /DistributionQueueEditor|editorOpen|queue=\{null\}/,
  );
  assert.match(
    teamsTab,
    /NEW_TEAM_URL\s*=\s*["']\/crm\/management\/teams\/new["']/,
  );
  assert.match(teamsTab, /router\.push\(NEW_TEAM_URL\)/);
  assert.doesNotMatch(teamsTab, /TeamDialog|setTeamDialogOpen/);
  assert.match(newTeamPage, /<TeamEditorScreen mode=["']create["'] \/>/);
  assert.match(
    teamEditor,
    /router\.replace\(`\/crm\/management\/teams\/\$\{createdTeam\.id\}\/edit`\)/,
  );
  assert.doesNotMatch(teamEditor, /router\.push\(MANAGEMENT_TEAMS_URL\)/);
  assert.match(
    teamEditor,
    /\{isEditing && team && \(\s*<TeamOperationalOverview/,
  );
  assert.match(
    teamEditor,
    /\{isEditing && team && \([\s\S]*?<TeamChangeHistory teamId=\{team\.id\} \/>/,
  );
  assert.match(queuePage, /params:\s*Promise<\{ id: string \}>/);
  assert.match(
    queuePage,
    /<DistributionQueueEditorScreen mode=["']edit["'] queueId=\{id\} \/>/,
  );
  assert.match(
    newQueuePage,
    /<DistributionQueueEditorScreen mode=["']create["'] \/>/,
  );
  assert.match(queueScreen, /presentation="page"/);
  assert.match(queueScreen, /useRoundRobin\(queueId,/);
  assert.doesNotMatch(queueScreen, /useRoundRobins|\.data\?\.find/);
  assert.match(
    queueScreen,
    /router\.replace\(\s*`\/crm\/management\/distribution\/\$\{createdQueue\.id\}\/edit`/,
  );
  assert.match(
    distributionTab,
    /\{canManageAllDistribution && \(\s*<Button[\s\S]*?aria-label=\{`Excluir fila/,
  );
  assert.match(
    queueScreen,
    /<DistributionQueueChangeHistory queueId=\{queue\.id\} \/>/,
  );
  assert.match(queueScreen, /<AppLayout title=\{title\}>/);
  assert.match(queueScreen, /Criada por \{creator\} em \{createdAt\}/);
  assert.doesNotMatch(queueScreen, /queue\.name/);
  assert.doesNotMatch(queueScreen, /Fila ativa|Fila inativa/);
  assert.doesNotMatch(queueScreen, /disableMainScroll|xl:overflow-y-hidden/);
  assert.doesNotMatch(queueLoading, /disableMainScroll/);
});

test("editor de fila bloqueia salvamento inseguro e atualiza historico auditado", () => {
  const editor = readFileSync(
    resolve(
      process.cwd(),
      "components/features/round-robin/DistributionQueueEditor.tsx",
    ),
    "utf8",
  );
  const history = readFileSync(
    resolve(
      process.cwd(),
      "components/features/round-robin/DistributionQueueChangeHistory.tsx",
    ),
    "utf8",
  );
  const hook = readFileSync(
    resolve(process.cwd(), "hooks/use-round-robins.ts"),
    "utf8",
  );
  const api = readFileSync(
    resolve(process.cwd(), "lib/api/round-robins.ts"),
    "utf8",
  );

  assert.match(editor, /const persistedMemberById = useMemo/);
  assert.match(editor, /persistedMember\?\.user_id === member\.entityId/);
  assert.match(editor, /const blockingReferenceDataError =/);
  assert.match(editor, /!blockingReferenceDataError/);
  assert.match(editor, /\(!!formData\.target_pipeline_id && stagesLoading\)/);
  assert.match(editor, /const hasUnsavedChanges =/);
  assert.match(
    editor,
    /const DEFAULT_PAGE_SECTION_IDS = \["basic", "members"\]/,
  );
  assert.match(
    editor,
    /2xl:grid-cols-\[minmax\(0,1\.08fr\)_minmax\(0,0\.92fr\)\]/,
  );
  assert.match(editor, /presentation === "page"[\s\S]*?"overflow-visible"/);
  assert.match(editor, /presentation === "page" \? "sticky bottom-0 z-10"/);
  assert.match(editor, /max-w-\[680px\]/);
  assert.match(editor, /shadow-\[0_-10px_30px/);
  assert.match(history, /useRoundRobinHistory\(queueId\)/);
  assert.match(history, /data-distribution-history-scroll/);
  assert.doesNotMatch(history, /overflow-y-auto/);
  assert.match(history, /dd\/MM · HH:mm/);
  assert.match(
    hook,
    /queryKey: \['round-robin-history', organizationId, roundRobinId\]/,
  );
  assert.match(hook, /refetchInterval: 30_000/);
  assert.match(api, /async getRoundRobin\(roundRobinId:/);
  assert.match(api, /'round-robin\.get'/);
  assert.match(api, /`\/v1\/round-robins\/\$\{roundRobinId\}\/history`/);
});

test("editor de fila oferece busca e deixa regras e tags mais legiveis", () => {
  const membersSection = readFileSync(
    resolve(
      process.cwd(),
      "components/features/round-robin/distribution-queue-editor/DistributionQueueMembersSection.tsx",
    ),
    "utf8",
  );
  const tagsSection = readFileSync(
    resolve(
      process.cwd(),
      "components/features/round-robin/distribution-queue-editor/DistributionQueueAutoTagsSection.tsx",
    ),
    "utf8",
  );
  const rulesSection = readFileSync(
    resolve(
      process.cwd(),
      "components/features/round-robin/distribution-queue-editor/DistributionQueueRulesSection.tsx",
    ),
    "utf8",
  );
  const conditionValueEditor = readFileSync(
    resolve(
      process.cwd(),
      "components/features/round-robin/distribution-queue-editor/DistributionQueueConditionValueEditor.tsx",
    ),
    "utf8",
  );

  assert.match(membersSection, /function SearchableTeamPicker/);
  assert.match(membersSection, /placeholder="Buscar equipe por nome\.\.\."/);
  assert.match(
    membersSection,
    /placeholder="Buscar usuário por nome ou e-mail\.\.\."/,
  );
  assert.match(membersSection, />Participantes<\/span>/);
  assert.match(membersSection, /max-h-\[clamp\(220px,36dvh,360px\)\]/);
  assert.match(tagsSection, /max-h-\[180px\][\s\S]*overflow-y-auto/);
  assert.match(tagsSection, /h-8 max-w-\[220px\][\s\S]*text-\[12px\]/);
  assert.match(
    rulesSection,
    /sm:grid-cols-\[minmax\(170px,210px\)_minmax\(0,1fr\)_32px\]/,
  );
  assert.match(conditionValueEditor, /min-h-\[52px\]/);
  assert.match(conditionValueEditor, /max-h-\[232px\]/);
  assert.match(conditionValueEditor, /min\(100%,240px\)/);
  assert.match(conditionValueEditor, /bg-\[var\(--app-surface-soft\)\]/);
});

test("editor de equipe prioriza KPIs, selecao de escala e historico auditado", () => {
  const editor = readFileSync(
    resolve(process.cwd(), "components/features/teams/TeamEditorScreen.tsx"),
    "utf8",
  );
  const overview = readFileSync(
    resolve(
      process.cwd(),
      "components/features/teams/TeamOperationalOverview.tsx",
    ),
    "utf8",
  );
  const history = readFileSync(
    resolve(process.cwd(), "components/features/teams/TeamChangeHistory.tsx"),
    "utf8",
  );
  const teamsHook = readFileSync(
    resolve(process.cwd(), "hooks/use-teams.ts"),
    "utf8",
  );
  const teamsAPI = readFileSync(
    resolve(process.cwd(), "lib/api/teams.ts"),
    "utf8",
  );

  assert.doesNotMatch(overview, /Operação da equipe/);
  assert.doesNotMatch(overview, /Membros e disponibilidade/);
  assert.match(overview, /aria-label="Indicadores da equipe"/);
  assert.match(overview, /label="Distribuições"/);
  assert.match(overview, /useTeamDistributionStats\(team\.id\)/);
  assert.match(overview, /coverage === "partial"/);
  assert.match(overview, /Valor mínimo comprovado/);
  assert.doesNotMatch(overview, /useRoundRobins|leads_count/);
  assert.doesNotMatch(overview, /label="Eventos de fila"/);
  assert.doesNotMatch(overview, /label="Filas ativas"/);
  assert.match(editor, /aria-label=\{`Ver escala de/);
  assert.match(
    editor,
    /onClick=\{\(\) => setActiveScheduleUserId\(user\.id\)\}/,
  );
  assert.match(editor, /<TeamChangeHistory teamId=\{team\.id\} \/>/);
  assert.match(
    editor,
    /TEAM_EDITOR_PANEL_HEIGHT_CLASS = "h-\[600px\] xl:h-full xl:min-h-0"/,
  );
  assert.match(editor, /<AppLayout title=\{title\} disableMainScroll>/);
  assert.match(editor, /flex h-full min-h-0 w-full flex-col/);
  assert.match(editor, /overflow-y-auto pb-8/);
  assert.match(editor, /xl:min-h-\[360px\] xl:max-h-\[600px\] xl:flex-1/);
  assert.match(editor, /data-team-panel="members"/);
  assert.match(editor, /data-team-panel="schedule"/);
  assert.match(editor, /max-w-\[680px\]/);
  assert.match(editor, /sticky bottom-0/);
  assert.match(editor, /shadow-\[0_-10px_30px/);
  assert.doesNotMatch(editor, /Sem escala configurada: recebe leads 24h/);
  assert.doesNotMatch(editor, /overscroll-contain/);
  assert.match(editor, /xl:grid-cols-/);
  assert.doesNotMatch(editor, /Clique em outro membro para trocar/);
  assert.match(history, /useTeamHistory\(teamId\)/);
  assert.match(history, /groupHistoryEvents\(historyQuery\.data \|\| \[\]\)/);
  assert.match(history, /data-team-history-scroll/);
  assert.doesNotMatch(history, /overscroll-contain/);
  assert.match(history, /displayHistory\.map/);
  assert.doesNotMatch(history, /displayHistory\.slice/);
  assert.doesNotMatch(history, /Equipe, membros e escalas/);
  assert.match(history, /dd\/MM · HH:mm/);
  assert.match(teamsHook, /refetchInterval: 1000 \* 30/);
  assert.match(teamsHook, /refetchIntervalInBackground: false/);
  assert.match(teamsHook, /refetchOnWindowFocus: "always"/);
  assert.match(
    teamsHook,
    /queryKey:\s*\[["']team-members-availability["'], organizationId\]/,
  );
  assert.match(
    teamsHook,
    /queryKey:\s*\[["']member-availability["'], organizationId\]/,
  );
  assert.match(
    teamsHook,
    /queryKey:\s*\[["']team-distribution-stats["'], organizationId, teamId\]/,
  );
  assert.match(teamsAPI, /\/v1\/teams\/\$\{id\}\/distribution-stats/);
});

test("lista de equipes diferencia falha de carregamento de estado vazio", () => {
  const teamsTab = readFileSync(
    resolve(process.cwd(), "components/features/crm-management/TeamsTab.tsx"),
    "utf8",
  );

  assert.match(teamsTab, /useTeams\(\{ includeInactive: true \}\)/);
  assert.match(teamsTab, /\.isError|isError:/);
  assert.match(teamsTab, /Não foi possível carregar as equipes/);
  assert.match(teamsTab, /\.refetch\(|refetch:/);
  assert.match(teamsTab, /Tentar novamente/);
});

test("escopo de lideranca usa o contexto do tenant e expoe falhas de descoberta", () => {
  const accessScope = readFileSync(
    resolve(process.cwd(), "hooks/use-user-access-scope.ts"),
    "utf8",
  );

  assert.match(accessScope, /tenantContext\?\.ledTeamIds \|\| \[\]/);
  assert.match(accessScope, /tenantContext\?\.ledUserIds \|\| \[\]/);
  assert.match(accessScope, /tenantContext\?\.ledPipelineIds \|\| \[\]/);
  assert.match(accessScope, /tenantContext\?\.isTeamLeader/);
  assert.match(accessScope, /ledTeamIds\.length > 0/);
  assert.match(accessScope, /hasTenantTeamScope:/);
  assert.match(
    accessScope,
    /isError: Boolean\(teamScopeError \|\| pipelineScopeError\)/,
  );
  assert.match(accessScope, /refetch: async \(\) =>/);
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

  assert.match(apiTab, /activeOrganization\.organizationId/);
  assert.match(webhooksHook, /useActiveOrganizationId\(\)/);

  for (const source of [apiTab, webhooksHook]) {
    assert.doesNotMatch(
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
    [...dreHook.matchAll(/activeOrganization\.organizationId/g)].length,
    4,
  );
  assert.doesNotMatch(
    dreHook,
    /organization\?\.id\s*\|\|\s*profile\?\.organization_id/,
  );
  assert.match(dreHook, /throw new Error\(['"]Organização não encontrada\./);
  assert.match(
    dreConfig,
    /const organizationId = activeOrganization\.organizationId/,
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
    resolve(process.cwd(), "apps/api/internal/app/routes.go"),
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

test("editor preserva a politica canonica de reentrada ao atualizar uma fila", () => {
  const formSource = readFileSync(
    resolve(process.cwd(), "lib/round-robin/distribution-queue-form.ts"),
    "utf8",
  );

  assert.match(
    formSource,
    /reentry_behavior\?: ["']redistribute["'] \| ["']keep_assignee["'];/,
  );
  assert.match(
    formSource,
    /\.\.\.\(queue\.settings \|\| \{\}\),[\s\S]*?reentry_behavior:\s*queue\.reentry_behavior\s*\?\?\s*queue\.settings\?\.reentry_behavior\s*\?\?\s*["']redistribute["'],/,
  );
});

test("ajustes visuais do fluxo WhatsApp preservam os dados e escondem codigos internos", () => {
  const trackingSource = readFileSync(
    resolve(process.cwd(), "components/features/leads/lead-detail/tracking.ts"),
    "utf8",
  );
  const trackingHoverSource = readFileSync(
    resolve(
      process.cwd(),
      "components/features/leads/lead-detail/CampaignTrackingHover.tsx",
    ),
    "utf8",
  );
  const historySource = readFileSync(
    resolve(process.cwd(), "hooks/lead-history/build-history.ts"),
    "utf8",
  );
  const autoTagsSource = readFileSync(
    resolve(
      process.cwd(),
      "components/features/round-robin/distribution-queue-editor/DistributionQueueAutoTagsSection.tsx",
    ),
    "utf8",
  );
  const membersSource = readFileSync(
    resolve(
      process.cwd(),
      "components/features/round-robin/distribution-queue-editor/DistributionQueueMembersSection.tsx",
    ),
    "utf8",
  );
  const tagSelectorSource = readFileSync(
    resolve(process.cwd(), "components/ui/tag-selector.tsx"),
    "utf8",
  );
  const cardSource = readFileSync(
    resolve(process.cwd(), "components/features/leads/LeadCard.tsx"),
    "utf8",
  );

  assert.match(trackingSource, /rawPayload\?\.source_url/);
  assert.match(trackingSource, /rawSourceReferral\?\.source_url/);
  assert.match(trackingSource, /creative_link_url: firstTrackingText\(/);
  assert.match(
    trackingHoverSource,
    /const safeCreativeLink = getSafeAbsoluteHttpUrl\(leadMeta\?\.creative_link_url\)/,
  );
  assert.match(trackingHoverSource, /\['Link do criativo', safeCreativeLink\]/);
  assert.match(
    trackingHoverSource,
    /\['Imagem', getSafeAbsoluteHttpUrl\(leadMeta\?\.creative_url\)\]/,
  );
  assert.match(
    trackingHoverSource,
    /\['Video', getSafeAbsoluteHttpUrl\(leadMeta\?\.creative_video_url\)\]/,
  );
  assert.match(trackingHoverSource, /const seenLinks = new Set<string>\(\)/);
  assert.match(trackingHoverSource, /seenLinks\.has\(href\)/);
  assert.match(trackingHoverSource, /target="_blank"/);
  assert.match(trackingHoverSource, /rel="noopener noreferrer"/);
  assert.doesNotMatch(trackingHoverSource, /window\.open\(leadMeta\./);
  assert.match(
    historySource,
    /'round_robin_auto',[\s\S]*?'canonical_round_robin'/,
  );
  assert.match(
    autoTagsSource,
    /import \{ useCreateTag, type Tag \} from ["']@\/hooks\/use-tags["']/,
  );
  assert.match(autoTagsSource, /const handleCreate = async \(\) => \{/);
  assert.match(autoTagsSource, /hasPermission\(["']tag_manage["']\)/);
  assert.match(autoTagsSource, /searchTextIncludes\(tag\.name, search\)/);
  assert.match(autoTagsSource, /void handleCreate\(\)/);
  assert.match(membersSource, /<Command filter=\{commandSearchFilter\}>/);
  assert.match(membersSource, /Buscar usuário por nome ou e-mail/);
  assert.doesNotMatch(tagSelectorSource, /allowCreate\?: boolean/);
  assert.match(
    cardSource,
    /\{campaignName && \([\s\S]*?\{campaignName\}[\s\S]*?\)\}/,
  );
  assert.doesNotMatch(
    cardSource,
    /const label = campaignName \|\| 'WhatsApp';/,
  );
  assert.doesNotMatch(cardSource, /`WhatsApp · \$\{campaignName\}`/);
});

test("resposta automática da fila WhatsApp permanece opt-in e limitada", () => {
  const editorSource = readFileSync(
    resolve(
      process.cwd(),
      "components/features/round-robin/DistributionQueueEditor.tsx",
    ),
    "utf8",
  );
  const formContractSource = readFileSync(
    resolve(process.cwd(), "lib/round-robin/distribution-queue-form.ts"),
    "utf8",
  );
  const autoReplySectionSource = readFileSync(
    resolve(
      process.cwd(),
      "components/features/round-robin/distribution-queue-editor/DistributionQueueWhatsAppAutoReplySection.tsx",
    ),
    "utf8",
  );
  const createHookSource = readFileSync(
    resolve(process.cwd(), "hooks/use-create-queue-advanced.ts"),
    "utf8",
  );
  const listHookSource = readFileSync(
    resolve(process.cwd(), "hooks/use-round-robins.ts"),
    "utf8",
  );

  for (const source of [formContractSource, createHookSource, listHookSource]) {
    assert.match(source, /whatsapp_distribution_auto_reply_enabled\?: boolean/);
    assert.match(source, /whatsapp_distribution_auto_reply_message\?: string/);
    assert.match(
      source,
      /whatsapp_distribution_auto_reply_delay_seconds\?: number/,
    );
  }
  assert.match(
    formContractSource,
    /whatsapp_distribution_auto_reply_enabled: false/,
  );
  assert.match(
    formContractSource,
    /DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS = 30/,
  );
  assert.match(
    formContractSource,
    /MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS = 3600/,
  );
  assert.match(
    editorSource,
    /\{hasWhatsAppMessageCondition && \([\s\S]*?<DistributionQueueWhatsAppAutoReplySection/,
  );
  assert.match(
    autoReplySectionSource,
    /data-tour="distribution-queue-whatsapp-auto-reply"/,
  );
  assert.match(
    editorSource,
    /removedLastWhatsAppCondition[\s\S]*?whatsapp_distribution_auto_reply_enabled: false/,
  );
  assert.match(
    editorSource,
    /sanitizedHasWhatsAppMessageCondition && whatsappAutoReplyEnabled/,
  );
});

test("link do criativo aceita somente URL absoluta HTTP ou HTTPS", () => {
  assert.equal(
    getSafeAbsoluteHttpUrl("https://www.instagram.com/p/creative/"),
    "https://www.instagram.com/p/creative/",
  );
  assert.equal(
    getSafeAbsoluteHttpUrl("http://example.com/creative"),
    "http://example.com/creative",
  );
  assert.equal(getSafeAbsoluteHttpUrl("javascript:alert(1)"), null);
  assert.equal(
    getSafeAbsoluteHttpUrl("data:text/html,<script>alert(1)</script>"),
    null,
  );
  assert.equal(getSafeAbsoluteHttpUrl("/creative/relative"), null);
});
