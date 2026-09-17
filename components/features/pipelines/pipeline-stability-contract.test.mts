import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function readRepoFile(relativePath: string) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

const pipelineApiSource = readRepoFile('lib/api/pipeline-board.ts');
const pipelineReferencesApiSource = readRepoFile('lib/api/pipelines.ts');
const stagesHookSource = readRepoFile('hooks/use-stages.ts');
const sharedFiltersSource = readRepoFile('hooks/use-shared-filters.ts');
const permissionHookSource = readRepoFile('hooks/use-organization-roles.ts');
const settingsApiSource = readRepoFile('lib/api/settings.ts');
const leadVisibilityApiSource = readRepoFile('lib/api/lead-visibility.ts');
const leadVisibilityHookSource = readRepoFile('hooks/use-lead-visibility.ts');
const teamsApiSource = readRepoFile('lib/api/teams.ts');
const teamsHookSource = readRepoFile('hooks/use-teams.ts');
const tagsApiSource = readRepoFile('lib/api/tags.ts');
const tagsHookSource = readRepoFile('hooks/use-tags.ts');
const leadsHookSource = readRepoFile('hooks/use-leads.ts');
const assignLeadHookSource = readRepoFile('hooks/use-assign-lead-roundrobin.ts');
const dealStatusHookSource = readRepoFile('hooks/use-deal-status-change.ts');
const leadRealtimeSource = readRepoFile('contexts/LeadRealtimeBus.tsx');
const backendRealtimeSource = readRepoFile('contexts/BackendRealtimeBus.tsx');
const filterContextSource = readRepoFile('contexts/FilterContext.tsx');
const screenSource = readRepoFile('components/features/pipelines/PipelinesScreen.tsx');
const sharedFiltersComponentSource = readRepoFile('components/shared/SharedFilters.tsx');
const boardSource = readRepoFile(
  'components/features/pipelines/pipeline-screen/PipelineBoard.tsx',
);
const leadCardSource = readRepoFile('components/features/leads/LeadCard.tsx');
const createLeadDialogSource = readRepoFile('components/features/leads/CreateLeadDialog.tsx');
const leadDetailSource = readRepoFile('components/features/leads/LeadDetailDialog.tsx');
const leadThreadSource = readRepoFile('components/features/leads/LeadUnifiedThread.tsx');
const floatingChatSource = readRepoFile('components/features/chat/FloatingChat.tsx');
const conversationLeadPanelSource = readRepoFile(
  'components/features/whatsapp/ConversationLeadPanel.tsx',
);
const leadDetailPipelineCacheSource = readRepoFile(
  'components/features/leads/lead-detail/use-lead-detail-pipeline-cache.ts',
);
const campaignHoverSource = readRepoFile(
  'components/features/leads/lead-detail/CampaignTrackingHover.tsx',
);
const setupGuideTourSource = readRepoFile(
  'components/features/setup-guide/tour/model.ts',
);

test('leituras do board usam um prazo único e apenas o retry transitório do React Query', () => {
  assert.equal(
    pipelineApiSource.match(/timeoutMs: PIPELINE_READ_TIMEOUT_MS/g)?.length,
    4,
  );
  assert.equal(pipelineApiSource.match(/retry: false/g)?.length, 4);
  assert.equal(pipelineApiSource.match(/signal: params\.signal/g)?.length, 4);
  assert.doesNotMatch(pipelineApiSource, /timeoutMs:\s*4_000/);
  assert.match(stagesHookSource, /retry: shouldRetryPipelineQuery/);
  assert.equal(
    pipelineReferencesApiSource.match(/timeoutMs: PIPELINE_READ_TIMEOUT_MS/g)?.length,
    2,
  );
  assert.equal(pipelineReferencesApiSource.match(/retry: false/g)?.length, 2);
  assert.equal(pipelineReferencesApiSource.match(/\n\s+signal,/g)?.length, 2);
  assert.doesNotMatch(pipelineReferencesApiSource, /timeoutMs:\s*4_000/);
  assert.match(leadVisibilityApiSource, /retry: false/);
  assert.match(leadVisibilityHookSource, /retry: shouldRetryPipelineQuery/);
  assert.match(teamsApiSource, /async listTeams[\s\S]{0,500}retry: false/);
  assert.match(teamsHookSource, /queryFn: \(\{ signal \}\)[\s\S]{0,300}retry: shouldRetryPipelineQuery/);
  assert.match(tagsApiSource, /async list[\s\S]{0,300}retry: false/);
  assert.match(tagsHookSource, /queryFn: \(\{ signal \}\)[\s\S]{0,200}retry: shouldRetryPipelineQuery/);
});

test('realtime limita rajadas sem cancelar uma leitura válida do board', () => {
  assert.match(leadRealtimeSource, /LEAD_REALTIME_MAX_WAIT_MS/);
  assert.match(leadRealtimeSource, /pipelineReconcileStartedAtRef/);
  assert.match(leadRealtimeSource, /getPipelineRealtimeRefreshDelay\(/);
  assert.match(leadRealtimeSource, /queryKey: \["stages-with-leads", orgId\]/);
  assert.match(leadRealtimeSource, /const markWhatsAppBoardStale = \(\) =>[\s\S]{0,300}refetchType: "none"/);
  assert.match(leadRealtimeSource, /if \(isWhatsAppOnlyBatch\)[\s\S]{0,500}markWhatsAppBoardStale\(\)/);
  assert.match(leadRealtimeSource, /pendingWhatsAppBoardStaleRef/);
  assert.match(leadRealtimeSource, /getQueryCache\(\)\.subscribe/);
  assert.match(leadRealtimeSource, /cancelRefetch: false/);
  assert.match(leadRealtimeSource, /shared-filter-lead-meta-filters/);
  assert.match(backendRealtimeSource, /getBackendRealtimeResetDelay\(/);
  assert.match(backendRealtimeSource, /query\.queryKey\[0\] !== "stages-with-leads"/);
  assert.match(backendRealtimeSource, /reason: "realtime\.reset"/);
  assert.match(backendRealtimeSource, /cancelRefetch: false/);
});

test('mutações de lead passam pelo coordenador e não disparam segundo refetch do board', () => {
  assert.match(leadsHookSource, /notifyLeadRealtimeChange\(/);
  assert.match(assignLeadHookSource, /reason: 'lead\.redistributed'/);
  assert.match(leadDetailPipelineCacheSource, /notifyLeadRealtimeChange\(/);
  assert.doesNotMatch(
    leadsHookSource,
    /invalidateQueries\(\s*\{\s*queryKey: \['stages-with-leads'\]/,
  );
  assert.doesNotMatch(
    assignLeadHookSource,
    /invalidateQueries\(\s*\{\s*queryKey: \['stages-with-leads'\]/,
  );
  assert.doesNotMatch(
    leadDetailPipelineCacheSource,
    /invalidateQueries\(\s*\{\s*queryKey: \['stages-with-leads'\]/,
  );
  assert.match(
    dealStatusHookSource,
    /queryKey: \['stages-with-leads'\], refetchType: 'none'/,
  );
  assert.doesNotMatch(dealStatusHookSource, /refetchType: 'inactive'/);
  assert.match(dealStatusHookSource, /notifyLeadRealtimeChange\(/);
  assert.doesNotMatch(
    conversationLeadPanelSource,
    /invalidateQueries\([\s\S]{0,100}queryKey: \["stages-with-leads"\]/,
  );
  assert.match(conversationLeadPanelSource, /reason: "lead\.assigned"/);
});

test('escopo de equipe e filtros persistidos preservam disponibilidade e hierarquia', () => {
  assert.match(sharedFiltersSource, /const teamFilterScope = resolvePipelineFilterScopeState/);
  assert.match(sharedFiltersSource, /if \(!isFiltersHydrated \|\| permissionsLoading \|\| !teamId\) return/);
  assert.match(sharedFiltersSource, /!teamsQuery\.isFetching/);
  assert.match(sharedFiltersSource, /teamsQuery\.isSuccess/);
  assert.match(
    permissionHookSource,
    /queryKey: \['has-permission', organizationId, profile\?\.id, isSuperAdmin, permissionKey\]/,
  );
  assert.match(permissionHookSource, /settingsAPI\.hasPermission\(permissionKey, organizationId\)/);
  assert.match(settingsApiSource, /async hasPermission\(permissionKey: string, organizationId\?: string \| null\)/);
  assert.match(sharedFiltersSource, /wasMetaFilterCascadeHydratedRef/);
  assert.match(sharedFiltersSource, /!campaignId \|\| item\.campaignId === campaignId/);
  assert.match(sharedFiltersSource, /if \(!isFiltersHydrated \|\| campaignId \|\| \(!adSetId && !adId\)\) return/);
  assert.doesNotMatch(sharedFiltersSource, /adSets\.length !== 1/);
  assert.doesNotMatch(sharedFiltersSource, /ads\.length !== 1/);
  assert.match(screenSource, /const hasHydratedDynamicFilterSelection/);
  assert.match(screenSource, /if \(!hasHydratedDynamicFilterSelection\) return/);
  assert.doesNotMatch(screenSource, /isDynamicFilterScopeReady/);
  assert.match(screenSource, /const handleEnableFilterOptions = useCallback/);
  assert.match(sharedFiltersComponentSource, /Algumas opções não foram atualizadas\./);
  assert.match(sharedFiltersComponentSource, /onClick=\{onRetryDynamicOptions\}/);
  assert.match(sharedFiltersComponentSource, /loading=\{isLoadingTags\}/);
  assert.match(sharedFiltersComponentSource, /selectedTagIds=\{tagIds\}/);
  assert.match(sharedFiltersComponentSource, /placeholder="Buscar campanha\.\.\."/);
});

test('erro inicial bloqueia dados incompletos e falha de atualização preserva o cache', () => {
  assert.match(screenSource, /isLoadingError: leadsLoadingError/);
  assert.match(screenSource, /isRefetchError: leadsRefetchError/);
  assert.match(screenSource, /leadsLoadingError && stagesWithLeads\.length === 0/);
  assert.match(screenSource, /const handlePipelineBoardRefresh/);
  assert.match(boardSource, /Os dados podem estar desatualizados\./);
  assert.match(boardSource, /onClick=\{onBoardRefresh\}/);
});

test('busca filtrada usa apenas a consulta canônica do board', () => {
  assert.doesNotMatch(screenSource, /getPipelineBoard\(/);
  assert.match(screenSource, /serverSearchResults: \[\]/);
});

test('pipeline inicia sem período implícito e usa origem somente após aplicação', () => {
  assert.match(
    screenSource,
    /useState<DatePreset \| null>\(null\)/,
  );
  assert.match(screenSource, /dateRangeOverride: pipelineDateRange/);
  assert.match(screenSource, /dateMode: pipelineDateRange \? 'origin' : undefined/);
  assert.doesNotMatch(screenSource, /pipelineDateMode/);
  assert.doesNotMatch(screenSource, /Operacional/);
});

test('cabecalho da coluna mantem apenas o menu e cria lead pelo botao geral', () => {
  assert.match(boardSource, /aria-label=\{`Configurar coluna \$\{stage\.name\}`\}/);
  assert.doesNotMatch(boardSource, /pipeline-column-new-lead/);
  assert.doesNotMatch(boardSource, /Adicionar lead na coluna/);
  assert.doesNotMatch(boardSource, /onCreateLead:\s*\(stageId/);
  assert.match(setupGuideTourSource, /selector: '\[data-tour="pipeline-new-lead"\]'/);
  assert.doesNotMatch(setupGuideTourSource, /selector: '\[data-tour="pipeline-column-new-lead"\]'/);
});

test('rascunho de novo lead não atravessa pipeline ou coluna de entrada', () => {
  assert.match(
    createLeadDialogSource,
    /lead-draft-\$\{activeOrganization\.organizationId\}-\$\{defaultPipelineId \|\| 'default'\}-\$\{defaultStageId \|\| 'any-stage'\}/,
  );
});

test('filtro de data persistido falha de forma segura quando está corrompido', () => {
  assert.match(filterContextSource, /Number\.isNaN\(from\.getTime\(\)\)/);
  assert.match(filterContextSource, /Number\.isNaN\(to\.getTime\(\)\)/);
  assert.match(filterContextSource, /from\.getTime\(\) > to\.getTime\(\)/);
  assert.match(filterContextSource, /Restricted browser contexts can make sessionStorage unavailable/);
});

test('tags do card e do detalhe permanecem com título branco', () => {
  assert.match(leadCardSource, /getTagColorStyleWithWhiteText\(lead\.tags\[0\]\.color\)/);
  assert.match(leadCardSource, /lead\.tags\.slice\(1\)\.map/);
  assert.match(leadCardSource, /aria-label=\{`Ver mais \$\{lead\.tags\.length - 1\} tags`\}/);
  assert.equal(
    leadDetailSource.match(/getTagColorStyleWithWhiteText\(tagColor\)/g)?.length,
    2,
  );
});

test('histórico é somente leitura e ações de chat abrem o balão flutuante', () => {
  assert.equal(leadDetailSource.match(/\n\s+readOnly\n/g)?.length, 2);
  assert.match(leadThreadSource, /!readOnly && canViewWhatsApp/);
  assert.match(leadThreadSource, /onReact=\{!readOnly && canOperateWhatsApp/);
  assert.match(leadThreadSource, /onRetryMedia=\{!readOnly/);
  assert.match(leadThreadSource, /const shouldLoadComposerData = canViewWhatsApp && !readOnly/);
  assert.match(leadThreadSource, /reconcileOnSubscribe: !readOnly/);
  assert.match(leadCardSource, /openNewChat\(lead\.phone, leadName, lead\.id\)/);
  assert.match(leadCardSource, /hasPhone && hasWhatsAppModule && canViewWhatsApp/);
  assert.match(leadDetailSource, /openNewChat\(phone, leadName, currentLead\.id\)/);
  assert.match(leadDetailSource, /openNewChatWithMessage\(phone, preparedMessage, currentLead\.id, leadName\)/);
  assert.match(leadDetailSource, /disabled=\{!canOpenLeadWhatsApp \|\| !localLead\.phone\}/);
  assert.match(floatingChatSource, /useUserPermissions\(\)/);
  assert.match(floatingChatSource, /loadingSessions \|\| !accessReady \|\| !canViewWhatsApp/);
  assert.match(
    floatingChatSource,
    /const shouldLoadFloatingChatData = accessReady[\s\S]{0,120}&& canViewWhatsApp/,
  );
});

test('rastreamento da campanha permanece aberto enquanto trigger ou conteúdo têm interação', () => {
  assert.match(campaignHoverSource, /onPointerEnter=\{keepOpen\}/);
  assert.match(campaignHoverSource, /onPointerLeave=\{scheduleClose\}/);
  assert.match(campaignHoverSource, /onFocusCapture=\{keepOpen\}/);
  assert.match(campaignHoverSource, /onBlurCapture=\{scheduleClose\}/);
});
