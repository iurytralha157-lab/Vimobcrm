import { useMutation, useQuery, useQueryClient, type Query, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useLeadRequestScope, type LeadRequestOperation } from '@/hooks/leads/use-lead-request-scope';

import {
  leadTasksAPI,
  type CompleteCadenceTaskInput,
} from '@/lib/api/lead-tasks';
import type { LeadCadenceState } from '@/lib/validation';
import { appendOptimisticLeadHistoryEvent, removeOptimisticLeadHistoryEvent, invalidateLeadHistorySoon } from '@/hooks/use-optimistic-lead-history';
let optimisticCadenceSequence = 0;

export type LeadTask = {
  id: string;
  lead_id: string;
  day_offset: number;
  type: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  is_done: boolean | null;
  done_at: string | null;
  done_by: string | null;
  outcome: string | null;
  outcome_notes: string | null;
  created_at: string;
};

function invalidateLeadTaskCaches(queryClient: ReturnType<typeof useQueryClient>, leadId?: string | null) {
  queryClient.invalidateQueries({ queryKey: ['lead-tasks'] });
  queryClient.invalidateQueries({ queryKey: ['lead-cadence-state'] });
  queryClient.invalidateQueries({ queryKey: ['activities'] });
  queryClient.invalidateQueries({ queryKey: ['recent-activities'] });
  queryClient.invalidateQueries({ queryKey: ['home'] });
  queryClient.invalidateQueries({ queryKey: ['upcoming-tasks'] });
  if (leadId) {
    invalidateLeadHistorySoon(queryClient, leadId);
    queryClient.invalidateQueries({ queryKey: ['lead-timeline', leadId] });
  }
}

export function useLeadTasks(leadId?: string) {
  return useQuery({
    queryKey: ['lead-tasks', leadId],
    queryFn: () => (leadId ? leadTasksAPI.list(leadId) : Promise.resolve([])),
    enabled: !!leadId,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
}

export function useToggleLeadTask() {
  const queryClient = useQueryClient();
  const requestScope = useLeadRequestScope();

  return useMutation({
    onMutate: variables => requestScope.bind(variables),
    mutationFn: (variables: { id: string; is_done: boolean; leadId?: string }) => {
      const operation = requestScope.require(variables);
      const { id, is_done, leadId } = variables;
      return leadTasksAPI.patch(id, { is_done, leadId }, operation.organizationId, operation.intent);
    },
    onSuccess: (data) => {
      invalidateLeadTaskCaches(queryClient, data?.lead_id);
    },
    onError: (error, variables, operation) => {
      if (!requestScope.isCurrent(operation || requestScope.contextFor(variables))) return;
      toast.error('Erro ao atualizar tarefa: ' + error.message);
    },
    onSettled: (_data, _error, variables) => requestScope.release(variables),
  });
}

export function useCreateLeadTask() {
  const queryClient = useQueryClient();
  const requestScope = useLeadRequestScope();

  return useMutation({
    onMutate: variables => requestScope.bind(variables),
    mutationFn: (task: {
      lead_id: string;
      day_offset: number;
      type: 'call' | 'message' | 'email' | 'note';
      title: string;
      description?: string;
      due_date?: string;
    }) => {
      const operation = requestScope.require(task);
      return leadTasksAPI.create(task, operation.organizationId, operation.intent);
    },
    onSuccess: (data, _variables, operation) => {
      invalidateLeadTaskCaches(queryClient, data?.lead_id);
      if (requestScope.isCurrent(operation)) toast.success('Tarefa criada!');
    },
    onError: (error, variables, operation) => {
      if (!requestScope.isCurrent(operation || requestScope.contextFor(variables))) return;
      toast.error('Erro ao criar tarefa: ' + error.message);
    },
    onSettled: (_data, _error, variables) => requestScope.release(variables),
  });
}

type CadenceCacheTask = Pick<LeadTask, 'id' | 'is_done'> & {
  status?: string;
  done_at?: string | null;
  outcome?: string | null;
  outcome_notes?: string | null;
};
type CadenceItemOwner = { generation: number; active: Set<symbol>; unsafe: boolean };
type CadenceCacheChange = {
  query: Query;
  kind: 'tasks' | 'cadence';
  taskId: string;
  before: CadenceCacheTask;
  installed?: CadenceCacheTask;
  owner: CadenceItemOwner;
  generation: number;
  resourceKey: string;
  serverVersion: number;
};
type CadenceCacheReceipt = { token: symbol; changes: CadenceCacheChange[]; finished: boolean };
const cadenceCacheOwners = new WeakMap<QueryClient, {
  versions: Map<string, number>;
  scopesByLead: Map<string, Set<string>>;
  items: WeakMap<Query, Map<string, CadenceItemOwner>>;
}>();
const cadenceCompletionInputs = new WeakMap<LeadRequestOperation, CompleteCadenceTaskInput>();

function cadenceOwners(client: QueryClient) {
  let tracking = cadenceCacheOwners.get(client);
  if (tracking) return tracking;
  tracking = { versions: new Map(), scopesByLead: new Map(), items: new WeakMap() };
  cadenceCacheOwners.set(client, tracking);
  const current = tracking;
  client.getQueryCache().subscribe(event => {
    if (event.type === 'updated' && event.action.type === 'success' && !event.action.manual) {
      // A canonical read of either projection supersedes both, even when
      // structural sharing preserves the optimistic task object byte-for-byte.
      const key = event.query.queryKey;
      const resources = key[0] === 'lead-tasks' && typeof key[1] === 'string' ? current.scopesByLead.get(key[1])
        : key[0] === 'lead-cadence-state' && typeof key[1] === 'string' && typeof key[2] === 'string'
          ? [JSON.stringify([key[1], key[2]])] : [];
      for (const resource of resources ?? []) current.versions.set(resource, (current.versions.get(resource) ?? 0) + 1);
      current.items.delete(event.query);
    }
  });
  return tracking;
}

function cadenceSummary(state: LeadCadenceState, tasks: LeadCadenceState['tasks']) {
  const pending = tasks.filter(task => task.status === 'pending' && !task.is_done);
  return {
    ...state.summary,
    completed: tasks.filter(task => task.status === 'completed' || task.is_done).length,
    pending: pending.length,
    overdue: pending.filter(task => task.due_at && Date.parse(task.due_at) < Date.now()).length,
    next_task_id: pending[0]?.id || null,
  };
}

function applyCadenceTaskOptimism(client: QueryClient, organizationId: string, input: CompleteCadenceTaskInput, now: string): CadenceCacheReceipt {
  const receipt: CadenceCacheReceipt = { token: Symbol('cadence-completion'), changes: [], finished: false };
  if (!input.taskId) return receipt;
  const tracking = cadenceOwners(client);
  const resourceKey = JSON.stringify([organizationId, input.leadId]);
  let scopes = tracking.scopesByLead.get(input.leadId);
  if (!scopes) { scopes = new Set(); tracking.scopesByLead.set(input.leadId, scopes); }
  scopes.add(resourceKey);
  for (const query of client.getQueryCache().getAll()) {
    const key = query.queryKey;
    const kind = key[0] === 'lead-tasks' && key[1] === input.leadId ? 'tasks'
      : key[0] === 'lead-cadence-state' && key[1] === organizationId && key[2] === input.leadId ? 'cadence' : null;
    if (!kind) continue;
    const data = query.state.data as LeadTask[] | LeadCadenceState | undefined;
    const tasks = kind === 'tasks' ? Array.isArray(data) ? data : undefined
      : !Array.isArray(data) && data?.lead_id === input.leadId ? data.tasks : undefined;
    const before = tasks?.find(task => task.id === input.taskId);
    if (!before || (kind === 'tasks' && (before as LeadTask).lead_id !== input.leadId)) continue;
    let items = tracking.items.get(query);
    if (!items) { items = new Map(); tracking.items.set(query, items); }
    let owner = items.get(before.id);
    if (!owner) { owner = { generation: 0, active: new Set(), unsafe: query.state.isInvalidated }; items.set(before.id, owner); }
    // A snapshot of another pending completion is never a rollback baseline.
    if (owner.active.size > 0 || query.state.isInvalidated) owner.unsafe = true;
    owner.active.add(receipt.token);
    const change: CadenceCacheChange = { query, kind, taskId: before.id, before, owner, resourceKey,
      generation: ++owner.generation, serverVersion: tracking.versions.get(resourceKey) ?? 0 };
    const optimistic = { ...before, is_done: true, done_at: now,
      outcome: input.outcome || null, outcome_notes: input.outcomeNotes || null,
      ...(kind === 'cadence' ? { status: 'completed' } : {}) };
    const nextTasks = tasks!.map(task => task.id === before.id ? optimistic : task);
    const next = kind === 'tasks' ? nextTasks : {
      ...(data as LeadCadenceState), tasks: nextTasks,
      summary: cadenceSummary(data as LeadCadenceState, nextTasks as LeadCadenceState['tasks']),
    };
    const installed = client.setQueryData(query.queryKey, next) as LeadTask[] | LeadCadenceState;
    change.installed = (Array.isArray(installed) ? installed : installed.tasks).find(task => task.id === before.id);
    receipt.changes.push(change);
  }
  return receipt;
}

function releaseCadenceTaskOptimism(receipt?: CadenceCacheReceipt) {
  if (!receipt || receipt.finished) return;
  receipt.finished = true;
  for (const change of receipt.changes) change.owner.active.delete(receipt.token);
}

function rollbackCadenceTaskOptimism(client: QueryClient, receipt: CadenceCacheReceipt, canReconcile: boolean) {
  const tracking = cadenceOwners(client);
  if (canReconcile) for (const change of receipt.changes) {
    if (change.owner.unsafe || change.owner.generation !== change.generation ||
      !change.owner.active.has(receipt.token) ||
      (tracking.versions.get(change.resourceKey) ?? 0) !== change.serverVersion ||
      client.getQueryCache().find({ queryKey: change.query.queryKey, exact: true }) !== change.query) continue;
    client.setQueryData(change.query.queryKey, (data: LeadTask[] | LeadCadenceState | undefined) => {
      const tasks = Array.isArray(data) ? data : data?.tasks;
      if (!tasks || tasks.find(task => task.id === change.taskId) !== change.installed) return data;
      if (!Array.isArray(data) && data) {
        const expected = cadenceSummary(data, data.tasks);
        if ((['completed', 'pending', 'overdue', 'next_task_id'] as const).some(key => expected[key] !== data.summary[key])) return data;
      }
      const restored = tasks.map(task => task.id === change.taskId ? change.before : task);
      return Array.isArray(data) ? restored as LeadTask[] : data ? {
        ...data, tasks: restored as LeadCadenceState['tasks'], summary: cadenceSummary(data, restored as LeadCadenceState['tasks']),
      } : data;
    });
  }
  releaseCadenceTaskOptimism(receipt);
}

function invalidateCadenceCompletionCaches(client: QueryClient, organizationId: string, leadId: string, isCurrent: boolean) {
  const refetchType = isCurrent ? 'active' : 'none';
  // Refetch is reconciliation, never part of the outcome of an accepted POST.
  void Promise.all([
    client.invalidateQueries({ queryKey: ['lead-tasks', leadId], refetchType }),
    client.invalidateQueries({ predicate: query => query.queryKey[0] === 'lead-cadence-state' &&
      query.queryKey[1] === organizationId && query.queryKey[2] === leadId, refetchType }),
    ...['lead-history-v2', 'lead-timeline', 'activities'].map(family =>
      client.invalidateQueries({ queryKey: [family, leadId], refetchType })),
    ...['recent-activities', 'home', 'upcoming-tasks'].map(family =>
      client.invalidateQueries({ queryKey: [family], refetchType })),
  ]).catch(() => { /* Keep the caches stale; a failed read cannot fail the completed write. */ });
}

function isDefinitiveCadenceRejection(error: unknown) {
  const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
  return typeof status === 'number' && [400, 401, 403, 404, 405, 409, 410, 412, 415, 422].includes(status);
}

export function useCompleteCadenceTask() {
  const queryClient = useQueryClient();
  const requestScope = useLeadRequestScope();

  return useMutation({
    mutationFn: (input: CompleteCadenceTaskInput) => {
      const operation = requestScope.require(input);
      const captured = cadenceCompletionInputs.get(operation);
      if (!captured || (captured.organizationId && captured.organizationId !== operation.organizationId)) throw new Error('Seu acesso mudou. Abra o contato novamente.');
      return leadTasksAPI.completeCadence({ ...captured, organizationId: operation.organizationId }, operation.intent);
    },
    onMutate: async (input) => {
      const operation = requestScope.bind(input);
      const captured = { ...input };
      cadenceCompletionInputs.set(operation, captured);
      if (captured.organizationId && captured.organizationId !== operation.organizationId) throw new Error('Seu acesso mudou. Abra o contato novamente.');
      const queryKey = ['lead-tasks', captured.leadId] as const;
      const historyQueryKey = ['lead-history-v2', captured.leadId] as const;
      await Promise.all([
        queryClient.cancelQueries({ queryKey }),
        queryClient.cancelQueries({ queryKey: historyQueryKey }),
        queryClient.cancelQueries({ predicate: query => query.queryKey[0] === 'lead-cadence-state' &&
          query.queryKey[1] === operation.organizationId && query.queryKey[2] === captured.leadId }),
      ]);
      requestScope.require(input);
      const now = new Date().toISOString();
      const optimisticCache = applyCadenceTaskOptimism(queryClient, operation.organizationId, captured, now);

      const taskReference = captured.taskId || captured.templateTaskId || 'unknown';
      const optimisticHistoryId = appendOptimisticLeadHistoryEvent(queryClient, captured.leadId, {
          id: `optimistic-cadence-${captured.leadId}-${taskReference}-${now}-${++optimisticCadenceSequence}`,
          type: 'task_completed',
          label: 'Tarefa concluida',
          content: captured.title ? `Cadencia concluida: ${captured.title}` : 'Tarefa da cadencia concluida',
          timestamp: now,
          actor: null,
          source: 'activity',
          metadata: {
            task_id: captured.taskId || null,
            template_task_id: captured.templateTaskId || null,
            task_type: captured.type || null,
            day_offset: captured.dayOffset ?? 0,
            outcome: captured.outcome || null,
            outcome_notes: captured.outcomeNotes || null,
          },
        });
      return {
        operation,
        optimisticCache,
        historyLeadId: captured.leadId,
        optimisticHistoryId,
      };
    },
    onError: (error, _input, context) => {
      if (context) {
        rollbackCadenceTaskOptimism(queryClient, context.optimisticCache,
          isDefinitiveCadenceRejection(error) && context.operation.canReconcileCapturedAccess());
        removeOptimisticLeadHistoryEvent(queryClient, context.historyLeadId, context.optimisticHistoryId);
      }
      if (requestScope.isCurrent(context?.operation || requestScope.contextFor(_input))) toast.error('Erro ao completar tarefa: ' + error.message);
    },
    onSettled: (_data, _error, variables, context) => {
      releaseCadenceTaskOptimism(context?.optimisticCache);
      const operation = context?.operation || requestScope.contextFor(variables);
      const captured = operation ? cadenceCompletionInputs.get(operation) : undefined;
      requestScope.release(variables);
      if (operation) {
        cadenceCompletionInputs.delete(operation);
        if (captured) invalidateCadenceCompletionCaches(queryClient, operation.organizationId, captured.leadId, requestScope.isCurrent(operation));
      }
    },
  });
}
