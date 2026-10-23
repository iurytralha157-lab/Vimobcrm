import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { QueryClient } from '@tanstack/react-query';
import { getLeadDraftKey } from '@/lib/lead-edit-session';
import { invalidateScopedLeadStatus } from '@/lib/pipeline-status-cache';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function readRepoFile(relativePath: string) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

function namedFunctionSource(source: string, name: string) {
  const parsed = ts.createSourceFile('contract.ts', source, ts.ScriptTarget.Latest, true);
  const matches: string[] = [];
  function visit(node: ts.Node) {
    if ((ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node))
      && node.name?.getText(parsed) === name) matches.push(node.getText(parsed));
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(matches.length, 1, `one canonical declaration of ${name}`);
  return matches[0];
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
const toolbarSource = readRepoFile(
  'components/features/pipelines/pipeline-screen/PipelineToolbar.tsx',
);
const sharedFiltersComponentSource = readRepoFile('components/shared/SharedFilters.tsx');
const searchableFilterSelectSource = readRepoFile('components/shared/SearchableFilterSelect.tsx');
const boardSource = readRepoFile(
  'components/features/pipelines/pipeline-screen/PipelineBoard.tsx',
);
const stageColumnMenuSource = readRepoFile(
  'components/features/pipelines/pipeline-screen/StageColumnMenu.tsx',
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
  // Mutation retries do not belong to the two catalog GET contracts.
  for (const method of ['getPipelines', 'getStages']) {
    const read = namedFunctionSource(pipelineReferencesApiSource, method);
    assert.equal(read.match(/timeoutMs: PIPELINE_READ_TIMEOUT_MS/g)?.length, 1);
    assert.equal(read.match(/retry: false/g)?.length, 1);
    assert.equal(read.match(/\n\s+signal,/g)?.length, 1);
    assert.doesNotMatch(read, /timeoutMs:\s*4_000/);
  }
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
  assert.match(dealStatusHookSource, /invalidateScopedLeadStatus\(queryClient, variables\.organizationId, variables\.leadId, !mounted\.current\)/);
  const invalidations: Array<{ queryKey: readonly unknown[]; refetchType: string; exact?: boolean }> = [];
  const client = { invalidateQueries: (options: typeof invalidations[number]) => {
    invalidations.push(options);
    return Promise.resolve();
  } } as unknown as QueryClient;
  invalidateScopedLeadStatus(client, 'org-a', 'lead-a');
  assert.deepEqual(invalidations, [
    { queryKey: ['stages-with-leads', 'org-a'], refetchType: 'none' },
    { queryKey: ['leads', 'org-a'], refetchType: 'none' },
    { queryKey: ['lead', 'org-a', 'lead-a'], exact: true, refetchType: 'none' },
  ]);
  invalidations.length = 0;
  invalidateScopedLeadStatus(client, 'org-b', 'lead-b', true);
  assert.deepEqual(invalidations, [
    { queryKey: ['stages-with-leads', 'org-b'], refetchType: 'active' },
    { queryKey: ['leads', 'org-b'], refetchType: 'active' },
    { queryKey: ['lead', 'org-b', 'lead-b'], exact: true, refetchType: 'active' },
  ]);
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
  assert.doesNotMatch(sharedFiltersSource, /wasMetaFilterCascadeHydratedRef/);
  assert.match(sharedFiltersSource, /new Set\(selectedCampaignIds\)/);
  assert.equal(sharedFiltersSource.match(/selectedCampaignIdSet\.size === 0 \|\| selectedCampaignIdSet\.has\(item\.campaignId \|\| ''\)/g)?.length, 2);
  assert.match(filterContextSource, /setCampaignIdsInternal\(normalized\)/);
  assert.doesNotMatch(sharedFiltersSource, /selectedCampaignIds\.join\(["']\,["']\)/);
  assert.match(filterContextSource, /const setPageId = useCallback\([\s\S]{0,300}setCampaignIdsInternal\(\[\]\)[\s\S]{0,150}setAdSetIdInternal\(null\)[\s\S]{0,150}setAdIdInternal\(null\)/);
  assert.match(filterContextSource, /const setCampaignIds = useCallback\([\s\S]{0,600}setAdSetIdInternal\(null\)[\s\S]{0,150}setAdIdInternal\(null\)/);
  assert.match(filterContextSource, /const setAdSetId = useCallback\([\s\S]{0,200}setAdIdInternal\(null\)/);
  assert.match(filterContextSource, /const restoreFilterSnapshot = useCallback\([\s\S]{0,500}applyState\(nextState\)/);
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
  assert.match(sharedFiltersComponentSource, /ariaLabel="Filtrar por campanha"/);
  assert.match(searchableFilterSelectSource, /placeholder="Buscar opções\.\.\."/);
  assert.match(searchableFilterSelectSource, /searchTextIncludes\(\[option\.label, option\.value/);
});

test('erro inicial bloqueia dados incompletos e falha de atualização preserva o cache', () => {
  assert.match(screenSource, /isLoadingError: leadsLoadingError/);
  assert.match(screenSource, /isRefetchError: leadsRefetchError/);
  assert.match(screenSource, /leadsLoadingError && stagesWithLeads\.length === 0/);
  assert.doesNotMatch(screenSource, /const handlePipelineBoardRefresh/);
  assert.match(screenSource, /onBoardRefresh=\{\(\) => void handleCriticalLoadRetry\(\)\}/);
  assert.match(screenSource, /onCriticalLoadRetry=\{\(\) => void handleCriticalLoadRetry\(\)\}/);
  assert.match(screenSource, /leadsLoadingError \|\| leadsRefetchError \|\| boardAccessRevoked/);
  assert.match(boardSource, /Os dados podem estar desatualizados\./);
  assert.match(boardSource, /onClick=\{onBoardRefresh\}/);
});

test('busca filtrada usa apenas a consulta canônica do board', () => {
  assert.doesNotMatch(screenSource, /getPipelineBoard\(/);
  assert.match(screenSource, /serverSearchResults: \[\]/);
});

test('pipeline usa o período compartilhado com semântica de origem', () => {
  assert.doesNotMatch(screenSource, /pipelineDatePreset/);
  assert.match(screenSource, /const pipelineDateRange = sharedFilters\.dateRange/);
  assert.match(screenSource, /dateMode: 'origin'/);
  assert.doesNotMatch(screenSource, /pipelineDateMode/);
  assert.doesNotMatch(screenSource, /Operacional/);
});

test('pipeline traduz sem responsavel para filtro nulo sem enviar sentinel como UUID', () => {
  assert.match(toolbarSource, /includeUnassignedUserOption/);
  assert.match(screenSource, /const isUnassignedFilter = filterUser === 'unassigned'/);
  assert.match(
    screenSource,
    /const selectedFilterUserId = filterUser === 'all' \|\| isUnassignedFilter/,
  );
  assert.match(screenSource, /const effectivePipelineFilterUser = selectedFilterUserId/);
  assert.match(screenSource, /unassigned: isUnassignedFilter/);
  assert.match(screenSource, /teamId: sharedFilters\.teamId \|\| undefined/);
});

test('lider recebe a coorte do backend incluindo sem responsavel da equipe selecionada', () => {
  assert.doesNotMatch(screenSource, /filterUserIds: effectivePipelineFilterUserIds/);
  assert.doesNotMatch(screenSource, /filterUserIds:/);
  assert.match(screenSource, /teamId: sharedFilters\.teamId \|\| undefined/);
  assert.match(screenSource, /if \(hasUserScope && !scopedVisibleUserIds\.includes\(selectedFilterUserId\)\) return false/);
  assert.match(screenSource, /if \(Array\.isArray\(selectedTeamUserIds\) && !selectedTeamUserIds\.includes\(selectedFilterUserId\)\) return false/);
  assert.match(screenSource, /selectedFilterUserAllowed \? selectedFilterUserId : NO_VISIBLE_USER_ID/);
  assert.match(screenSource, /visibleUserIds: \[\.\.\.\(scopedVisibleUserIds \?\? \[\]\)\]\.sort\(\)/);
  assert.match(screenSource, /ledTeamIds: \[\.\.\.\(tenantContext\?\.ledTeamIds \?\? \[\]\)\]\.sort\(\)/);
  assert.match(screenSource, /visibilityScopeKey,/);
  assert.match(stagesHookSource, /\[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19\]/);
  assert.match(screenSource, /loadMoreLeads\.mutate\([\s\S]*?filters: pipelineBoardFilters/);
});

test('cabecalho da coluna mantem apenas o menu e cria lead pelo botao geral', () => {
  assert.match(boardSource, /<StageColumnMenu\s+stageName=\{stage\.name\}/);
  assert.match(boardSource, /onSelect=\{\(tab, returnFocusElement\) => onOpenStageSettings\(stage, tab, returnFocusElement\)\}/);
  assert.match(stageColumnMenuSource, /aria-label=\{`Configurar coluna \$\{stageName\}`\}/);
  assert.doesNotMatch(boardSource, /pipeline-column-new-lead/);
  assert.doesNotMatch(boardSource, /Adicionar lead na coluna/);
  assert.doesNotMatch(boardSource, /onCreateLead:\s*\(stageId/);
  assert.match(setupGuideTourSource, /selector: '\[data-tour="pipeline-new-lead"\]'/);
  assert.doesNotMatch(setupGuideTourSource, /selector: '\[data-tour="pipeline-column-new-lead"\]'/);
});

test('rascunho de novo lead não atravessa pipeline ou coluna de entrada', () => {
  assert.match(
    createLeadDialogSource,
    /const draftKey = !isEditMode \? getLeadDraftKey\(user\?\.id, activeOrganization\.organizationId, defaultPipelineId, defaultStageId\) : null/,
  );
  const key = getLeadDraftKey('user-a', 'org-a', 'pipeline-a', 'stage-a');
  assert.equal(key, 'lead-draft-v2-user-a-org-a-pipeline-a-stage-a');
  for (const other of [
    getLeadDraftKey('user-b', 'org-a', 'pipeline-a', 'stage-a'),
    getLeadDraftKey('user-a', 'org-b', 'pipeline-a', 'stage-a'),
    getLeadDraftKey('user-a', 'org-a', 'pipeline-b', 'stage-a'),
    getLeadDraftKey('user-a', 'org-a', 'pipeline-a', 'stage-b'),
  ]) assert.notEqual(other, key);
  assert.equal(getLeadDraftKey('user-a', 'org-a'), 'lead-draft-v2-user-a-org-a-default-any-stage');
  assert.equal(getLeadDraftKey(undefined, 'org-a', 'pipeline-a', 'stage-a'), null);
  assert.equal(getLeadDraftKey('user-a', null, 'pipeline-a', 'stage-a'), null);
});

test('filtro de data em memória valida o intervalo sem persistência', () => {
  assert.match(filterContextSource, /Number\.isNaN\(from\.getTime\(\)\)/);
  assert.match(filterContextSource, /Number\.isNaN\(to\.getTime\(\)\)/);
  assert.match(filterContextSource, /from\.getTime\(\) > to\.getTime\(\)/);
  assert.doesNotMatch(filterContextSource, /sessionStorage|localStorage/);
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
  assert.equal(leadDetailSource.match(/<LeadUnifiedThread\b/g)?.length, 2);
  assert.doesNotMatch(leadThreadSource, /MessageBox|useSendWhatsAppMessage|useStartConversation|useWhatsAppAttendanceGate/);
  assert.match(leadThreadSource, /plainHistory/);
  assert.match(leadThreadSource, /reconcileOnSubscribe: false/);
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
