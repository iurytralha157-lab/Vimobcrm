import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/query-core';
import { getGlobalSignOutSessionId } from '../../lib/auth/global-sign-out.ts';
import { captureLeadRequestIntent } from '../../lib/lead-request-intent.ts';
import { captureQueryClientAccess } from '../../lib/access/query-client-access.ts';
import { createUUID } from '../../lib/client-id.ts';
import { leadContactOutcomeCommandSchema } from '../../lib/validation/lead-contact-outcomes.ts';
import * as history from '../use-optimistic-lead-history.ts';
import { deferred, evaluateProduction, productionDeclaration, turn } from './lead-request-runtime-fixture.mjs';

const token = (actor, sid) => `header.${Buffer.from(JSON.stringify({ sub: actor, session_id: sid })).toString('base64url')}.synthetic`;
const moduleSource = path => {
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  return ast.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)).map(node => node.getText(ast)).join('\n');
};
const declaration = (path, name) => 'const ' + productionDeclaration(path, node => ts.isVariableDeclaration(node) && node.name.getText() === name);
const optionalDeclaration = (path, name) => {
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let found;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText() === name) found = 'const ' + node.getText(ast); ts.forEachChild(node, visit); }
  visit(ast); return found;
};
export const fixtureTask = { id: 'task-a', template_task_id: 'template-a', type: 'call' };

// Real handlers, first-response wrapper, task/activity hooks and request/detail
// scopes. MutationObserver runs actual callback scheduling. React lifecycle,
// auth and transport are synthetic; no services, network or database involved.
export function firstResponseFeedbackRuntime(variant = 'popup') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const slots = [], observers = [], requests = [], notices = [], stateWrites = [], readSubscriptions = [], draftObservers = [];
  const auth = { activeOrganization: { organizationId: 'org-a' }, user: { id: 'actor-a' }, profile: { id: 'actor-a' },
    session: { access_token: token('actor-a', 'sid-a') } };
  const cadenceActionPendingRef = { current: false };
  const quickActionSubmittingRef = { current: false };
  let cursor = 0, mounted = true, allowed = true, captureOperation, recordFirstResponse, completeCadenceTask, createActivity, recordContactOutcome, outcomeStore;
  let fetching = false, blocked = false, poolReadOnly = false, capability = true;
  let lead = { id: 'lead-a', organization_id: 'org-a', can_operate: true, first_response_at: null, first_response_is_automation: false };
  let outcomeOpen = true, cadencePending = false, quickPending = false, quickType = 'call';
  const outcomeState = { taskForOutcome: fixtureTask, draft: { outcome: '', notes: '' }, scheduleOpen: false, scheduleDefaultType: 'call', editingScheduleEvent: null };
  const changed = (old, next) => !old || next.some((value, index) => !Object.is(value, old[index]));
  const react = {
    useRef: value => { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo: (build, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: build() }; return slots[index].value; },
    useLayoutEffect: (setup, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; } },
  };
  react.useEffect = react.useLayoutEffect;
  const toast = Object.fromEntries(['warning', 'error', 'success', 'info'].map(kind => [kind, (message, options) => notices.push({ kind, message, options })]));
  const transport = kind => async (...args) => {
    const wait = deferred(), intent = args.at(-1);
    intent?.onRequestStart?.();
    const request = { kind, args, intent, wait, settled: false, ignoreAbort: false };
    requests.push(request);
    intent?.signal?.addEventListener('abort', () => {
      if (kind === 'first-response' && !request.ignoreAbort && !request.settled) {
        request.settled = true; wait.reject(new DOMException('Aborted synthetic response', 'AbortError'));
      }
    }, { once: true });
    return await wait.promise;
  };
  const deps = { ...react, ...history, toast, getGlobalSignOutSessionId, captureLeadRequestIntent, captureQueryClientAccess,
    createUUID, leadContactOutcomeCommandSchema, useCallback: callback => callback, notifyLeadRealtimeChange() {},
    useAuth: () => auth, useQueryClient: () => client,
    getVimobAPIAccessTokenUserId: () => auth.user?.id ?? null,
    getVimobAPIAccessTokenSessionId: () => getGlobalSignOutSessionId(auth.session),
    leadsAPI: { recordFirstResponse: transport('first-response') },
    leadTasksAPI: { completeCadence: transport('complete') }, activitiesAPI: { create: transport('activity') },
    leadContactOutcomesAPI: { record: transport('activity') },
    useQuery: options => { const observer = new QueryObserver(client, options); draftObservers.push(observer); return observer.getCurrentResult(); },
    useMutation: options => { const observer = new MutationObserver(client, options); observers.push(observer);
      return { mutateAsync: variables => observer.mutate(variables), isPending: observer.getCurrentResult().isPending }; },
  };
  deps.useLeadRequestScope = evaluateProduction(moduleSource('hooks/leads/use-lead-request-scope.ts'), deps, 'useLeadRequestScope');
  const detailScope = evaluateProduction(moduleSource('hooks/leads/use-lead-detail-operation-scope.ts'), deps, 'useLeadDetailOperationScope');
  const firstHook = evaluateProduction(moduleSource('hooks/use-first-response.ts'), deps, 'useRecordFirstResponseOnAction');
  const completeHook = evaluateProduction(moduleSource('hooks/use-lead-tasks.ts'), deps, 'useCompleteCadenceTask');
  const activityHook = evaluateProduction(moduleSource('hooks/use-activities.ts'), deps, 'useCreateActivity');
  const contactHook = evaluateProduction(moduleSource('hooks/leads/use-record-lead-contact-outcome.ts'), deps, 'useRecordLeadContactOutcome');
  const draftHook = evaluateProduction(moduleSource('hooks/leads/use-lead-card-outcome-draft.ts'), deps, 'useLeadCardOutcomeDraft');
  const dialogPath = process.env.FIRST_RESPONSE_POPUP_SOURCE || 'components/features/leads/LeadDetailDialog.tsx';
  const cardPath = process.env.FIRST_RESPONSE_CARD_SOURCE || 'components/features/leads/LeadCard.tsx';
  const scopeName = variant === 'popup' ? 'captureCadenceFeedbackOperation'
    : variant === 'quick' ? 'captureDetailOperation' : 'captureCardOperation';
  const scopeDeclaration = optionalDeclaration(variant === 'card' ? cardPath : dialogPath, scopeName);
  const render = (patch = {}) => {
    assert(mounted, 'fixture already unmounted');
    if ('lead' in patch) lead = { ...lead, id: patch.lead };
    if ('org' in patch) { auth.activeOrganization.organizationId = patch.org; lead = { ...lead, organization_id: patch.org }; }
    if ('actor' in patch) { auth.user = { id: patch.actor }; auth.profile = { id: patch.actor }; }
    if ('sid' in patch || 'actor' in patch) auth.session = { access_token: token(auth.user.id, patch.sid ?? getGlobalSignOutSessionId(auth.session)) };
    if ('allowed' in patch) allowed = patch.allowed;
    if ('fetching' in patch) fetching = patch.fetching;
    if ('blocked' in patch) blocked = patch.blocked;
    if ('poolReadOnly' in patch) poolReadOnly = patch.poolReadOnly;
    if ('capability' in patch) capability = patch.capability;
    if ('quickType' in patch) quickType = patch.quickType;
    lead = { ...lead, can_operate: capability && (variant !== 'card' || allowed) };
    if ('firstResponseAt' in patch) lead = { ...lead, first_response_at: patch.firstResponseAt };
    cursor = 0;
    recordFirstResponse = firstHook().recordFirstResponse;
    completeCadenceTask = completeHook(); createActivity = activityHook(); recordContactOutcome = contactHook();
    outcomeStore = draftHook(auth.activeOrganization.organizationId, auth.user.id, getGlobalSignOutSessionId(auth.session), lead.id, quickType);
    const scopeDependencies = { ...deps, useLeadDetailOperationScope: detailScope, lead, leadId: lead.id,
      activeOrganization: auth.activeOrganization, user: auth.user, session: auth.session, queryClient: client,
      canRecordContact: allowed && capability && !poolReadOnly, canOperateLead: allowed && capability && !poolReadOnly && !blocked && !fetching,
      readAccessBlocked: blocked, detailReadState: { hideDetails: blocked }, poolReadOnly, hasLeadOperatePermission: allowed, fullLeadQuery: { data: lead, isFetching: fetching },
    };
    captureOperation = scopeDeclaration ? evaluateProduction(scopeDeclaration, scopeDependencies, scopeName)
      : detailScope(lead.id, auth.activeOrganization.organizationId, auth.user.id, client, allowed, getGlobalSignOutSessionId(auth.session));
    return handler();
  };
  const setState = (field, value) => { stateWrites.push({ field, value }); if (field === 'outcome') outcomeOpen = value;
    else if (field === 'quick') quickPending = value; else cadencePending = value; };
  const handler = () => {
    const dependencies = { ...deps, lead, localLead: lead, activeOrganization: auth.activeOrganization, profile: auth.profile,
      canOperateLead: allowed && capability && !poolReadOnly && !blocked && !fetching, canRecordContact: allowed && capability && !poolReadOnly,
      captureDetailOperation: captureOperation, captureCadenceFeedbackOperation: captureOperation, captureCardOperation: captureOperation,
      cadenceActionPendingRef, setCadenceActionPending: value => setState('cadence', value),
      quickActionSubmittingRef, setQuickActionSubmitting: value => setState('quick', value),
      createActivityMutation: createActivity, quickActionOutcomeType: quickType,
      recordContactOutcome,
      setQuickActionOutcomeOpen: value => setState('outcome', value),
      quickActionDraft: outcomeStore,
      // Cache acknowledgement is not a retired component's state write; its
      // version/tenant guards are exercised by lead-card-outcome-draft tests.
      cardOutcomeDraft: outcomeStore,
      cadenceOrganizationId: lead.organization_id, completeCadenceTask, createActivity,
      recordFirstResponse, outcomeType: quickType, setOutcomeDialogOpen: value => setState('outcome', value),
      getErrorObjectMessage: error => error.message, getErrorMessage: error => error.message,
    };
    return variant === 'popup'
      ? evaluateProduction(declaration(dialogPath, 'handleToggleCadenceTask'), dependencies, 'handleToggleCadenceTask')
      : variant === 'quick'
        ? evaluateProduction(declaration(dialogPath, 'handleQuickActionOutcomeConfirm'), dependencies, 'handleQuickActionOutcomeConfirm')
        : evaluateProduction(declaration(cardPath, 'handleOutcomeConfirm'), dependencies, 'handleOutcomeConfirm');
  };
  const setInputDraft = (outcome, notes) => {
    const current = client.getQueryData(['lead-card-outcome-draft', auth.activeOrganization.organizationId, auth.user.id,
      getGlobalSignOutSessionId(auth.session), lead.id, quickType])?.draft;
    if (current?.outcome !== outcome || current?.notes !== notes) outcomeStore.updateDraft({ outcome, notes });
  };
  const startOutcome = async (outcome, notes) => {
    setInputDraft(outcome, notes);
    const pending = handler()(outcome, notes).then(value => ({ value }), error => ({ error }));
    await turn(); return pending;
  };
  const start = async (task = fixtureTask) => {
    if (variant !== 'popup') setInputDraft(quickType === 'email' ? 'replied' : 'answered', 'Synthetic outcome');
    const current = handler();
    const pending = (variant === 'popup' ? current(task, 'answered', 'Synthetic outcome') : current(quickType === 'email' ? 'replied' : 'answered', 'Synthetic outcome'))
      .then(value => ({ value }), error => ({ error }));
    await turn(); return pending;
  };
  const confirmOutcome = (outcome, notes, task = fixtureTask) => {
    assert.equal(variant, 'popup', 'cadence confirmation belongs to the popup fixture');
    outcomeState.taskForOutcome = task;
    outcomeState.draft = { outcome, notes };
    const write = (field, value) => { stateWrites.push({ field, value }); outcomeState[field] = value; };
    const current = evaluateProduction(declaration(dialogPath, 'handleOutcomeConfirm'), {
      canOperateLead: allowed && capability && !poolReadOnly && !blocked && !fetching,
      taskForOutcome: outcomeState.taskForOutcome, handleToggleCadenceTask: handler(),
      setOutcomeDialogOpen: value => setState('outcome', value),
      canManageLeadSchedule: true, hasAgendaModule: true, toast,
      getCadenceTaskType: evaluateProduction(productionDeclaration('components/features/leads/lead-detail/utils.ts',
        node => ts.isFunctionDeclaration(node) && node.name?.text === 'getCadenceTaskType'), {}, 'getCadenceTaskType'),
      setEditingScheduleEvent: value => write('editingScheduleEvent', value),
      setScheduleDefaultType: value => write('scheduleDefaultType', value),
      setScheduleFormOpen: value => write('scheduleOpen', value),
      setTaskForOutcome: value => write('taskForOutcome', value),
      outcomeDraft: { updateDraft: value => write('draft', value) },
    }, 'handleOutcomeConfirm');
    return current(outcome, notes).then(value => ({ value }), error => ({ error }));
  };
  const resolve = (request, data) => { request.settled = true; request.wait.resolve(data ?? (request.kind === 'first-response'
    ? { recorded: true } : request.kind === 'complete'
      ? { id: request.args[0].taskId, lead_id: request.args[0].leadId, is_done: true,
        outcome: request.args[0].outcome, outcome_notes: request.args[0].outcomeNotes }
      : request.args[1]?.commandId ? { commandId: request.args[1].commandId, leadId: request.args[0], channel: request.args[1].channel,
        activityId: 'activity-a', recordedAt: '2026-10-19T12:00:00Z' } : { id: 'activity-a', lead_id: 'lead-a' })); };
  const reject = (request, status = 500) => { request.settled = true; request.wait.reject(Object.assign(new Error('Synthetic response failure'), { status })); };
  const until = async predicate => { for (let count = 0; count < 20 && !predicate(); count++) await turn(); assert(predicate(), 'expected semantic condition was not reached'); };
  const unmount = () => { mounted = false; slots.forEach(slot => slot?.cleanup?.()); readSubscriptions.splice(0).forEach(off => off()); };
  const watchLeadRefetch = () => {
    const wait = deferred(); let reads = 0;
    client.setQueryData(['lead', 'org-a', 'lead-a'], lead);
    const observer = new QueryObserver(client, { queryKey: ['lead', 'org-a', 'lead-a'], staleTime: Infinity,
      queryFn: async () => { reads++; return await wait.promise; } });
    readSubscriptions.push(observer.subscribe(result => { if (mounted) render({ fetching: result.isFetching }); }));
    return { reads: () => reads, resolve: () => wait.resolve(lead) };
  };
  render();
  return { variant, client, requests, notices, stateWrites, render, handler, start, startOutcome, confirmOutcome, resolve, reject, until, watchLeadRefetch,
    byKind: kind => requests.filter(request => request.kind === kind),
    state: () => ({ ...outcomeState, outcomeOpen, cadencePending, pendingRef: cadenceActionPendingRef.current,
      quickPending, quickPendingRef: quickActionSubmittingRef.current,
      quickDraft: client.getQueryData(['lead-card-outcome-draft', auth.activeOrganization.organizationId, auth.user.id, getGlobalSignOutSessionId(auth.session), lead.id, quickType])?.draft ?? { outcome: '', notes: '' } }),
    unmount, close() { if (mounted) unmount(); observers.forEach(observer => observer.reset()); draftObservers.forEach(observer => observer.destroy()); client.clear(); },
  };
}
