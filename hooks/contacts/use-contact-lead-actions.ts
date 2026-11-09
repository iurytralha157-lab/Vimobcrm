'use client';

import { useLayoutEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CONTACT_PAGE_SIZE_OPTIONS } from '@/config/contacts';
import { notifyLeadRealtimeChange } from '@/contexts/LeadRealtimeBus';
import { useLeadRequestScope, type LeadRequestOperation } from '@/hooks/leads/use-lead-request-scope';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { getLeadMoveStageContract, isLeadMoveStageContractCurrent } from '@/lib/api/lead-move-contract';
import { leadsAPI } from '@/lib/api/leads';
import { getNonBlankErrorMessageOrFallback, VimobAPIError } from '@/lib/api/vimob-error';
import { getLeadStatusFinancialReviewMessage } from '@/lib/lead-financial-review';
import { uuidSchema } from '@/lib/validation/common';
import { lostReasonSchema } from '@/lib/validation/schemas';

export const MAX_CONTACT_LEAD_ACTION_TARGETS = Math.max(...CONTACT_PAGE_SIZE_OPTIONS);
const REQUEST_CONCURRENCY = 3;
// The server allows 15 moves in two seconds per actor and organization.
const MOVE_SPACING_MS = 150;
const scopeChanged = 'Seu acesso ou a seleção mudou. Abra a ação novamente.';
const commercialQueryFamilies = [
  'properties', 'properties-infinite', 'property', 'property-workspace', 'property-history', 'property-publications',
  'public-properties', 'public-property', 'public-featured-properties', 'public-exclusive-properties', 'public-home-data',
  'grupo-olx-publications', 'commissions',
];

type DealStatus = 'open' | 'won' | 'lost';
type IsCurrent = () => boolean;

export type ContactLeadAction =
  | { kind: 'move-stage'; pipelineId: string; stageId: string; lostReason?: string }
  | { kind: 'assign'; assignedUserId: string }
  | { kind: 'deal-status'; status: DealStatus; lostReason?: string };

export type ContactLeadActionTarget = Readonly<{
  id: string;
  name: string;
  expectedUpdatedAt: string;
  expectedStageId: string | null;
  pipelineId: string | null;
  assignedUserId: string | null;
  status: DealStatus;
}>;

export type ContactLeadActionFailure = { id: string; message: string; code?: string };
export type ContactLeadActionReview = Readonly<{
  targets: readonly ContactLeadActionTarget[];
  failures: readonly ContactLeadActionFailure[];
  unstartedIds: readonly string[];
}>;

export type ContactLeadActionResult = {
  succeededIds: string[];
  unchangedIds: string[];
  failures: ContactLeadActionFailure[];
  unconfirmedIds: string[];
  unstartedIds: string[];
  financialReviewIds: string[];
};

function isDealStatus(value: unknown): value is DealStatus {
  return value === 'open' || value === 'won' || value === 'lost';
}

function failure(id: string, error: unknown): ContactLeadActionFailure {
  return {
    id,
    message: getNonBlankErrorMessageOrFallback(error, 'Não foi possível concluir a ação neste contato.'),
    ...(error instanceof VimobAPIError && error.code ? { code: error.code } : {}),
  };
}

async function runBounded<T>(
  items: readonly T[], concurrency: number, isCurrent: IsCurrent, execute: (item: T, index: number) => Promise<void>,
) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && isCurrent()) {
      const index = next++;
      await execute(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

function isUnchanged(target: ContactLeadActionTarget, action: ContactLeadAction) {
  switch (action.kind) {
    case 'move-stage': return target.expectedStageId === action.stageId && target.pipelineId === action.pipelineId;
    case 'assign': return target.assignedUserId === action.assignedUserId;
    case 'deal-status': return target.status === action.status;
  }
}

function validateAction(action: ContactLeadAction) {
  if (action.kind === 'assign') uuidSchema.parse(action.assignedUserId);
  if (action.kind === 'move-stage') {
    uuidSchema.parse(action.pipelineId);
    uuidSchema.parse(action.stageId);
  }
  if (action.kind === 'deal-status' && !isDealStatus(action.status)) {
    throw new Error('Selecione um status válido.');
  }
  const needsReason = action.kind === 'deal-status' && action.status === 'lost';
  const reason = action.kind === 'assign' ? undefined : action.lostReason;
  return needsReason || reason?.trim() ? lostReasonSchema.parse(reason ?? '') : undefined;
}

function definiteRejection(error: unknown) {
  return error instanceof VimobAPIError && error.status >= 400 && error.status < 500 && error.status !== 408;
}

export function useContactLeadActions() {
  const queryClient = useQueryClient();
  const requestScope = useLeadRequestScope();
  const { hasPermission } = useUserPermissions();
  const canOperate = hasPermission('lead_operate');
  const currentPermission = useRef<object | null>(null);
  // The existing scope hook also fences token, organization and actor changes.
  const reviews = useRef(new WeakMap<ContactLeadActionReview, { operation: LeadRequestOperation; permission: object }>());
  const running = useRef<LeadRequestOperation | null>(null);
  useLayoutEffect(() => {
    currentPermission.current = canOperate ? {} : null;
  }, [canOperate]);

  const prepare = async (ids: readonly string[], selectionIsCurrent: IsCurrent = () => true): Promise<ContactLeadActionReview> => {
    const operation = requestScope.capture();
    const permission = currentPermission.current;
    const current = () => currentPermission.current === permission && operation.isCurrent() && selectionIsCurrent();
    if (!permission || !current()) throw new Error(scopeChanged);
    const selected = [...new Set(ids.map(id => uuidSchema.parse(id)))];
    if (selected.length === 0 || selected.length > MAX_CONTACT_LEAD_ACTION_TARGETS) {
      throw new Error(`Selecione de 1 a ${MAX_CONTACT_LEAD_ACTION_TARGETS} contatos.`);
    }
    const targets: ContactLeadActionTarget[] = [];
    const failures: ContactLeadActionFailure[] = [];
    let sessionRejected = false;
    const canRead = () => current() && !sessionRejected;
    const intent = {
      ...operation.intent, retry: false,
      onRequestStart: () => { if (!canRead()) throw new Error(scopeChanged); },
    };
    await runBounded(selected, REQUEST_CONCURRENCY, canRead, async (id, index) => {
      try {
        const { data } = await leadsAPI.getLead(id, operation.organizationId, intent.signal, intent);
        if (!canRead()) return;
        if (data.id !== id || data.organization_id !== operation.organizationId ||
          data.can_operate !== true || data.queue_pool || !isDealStatus(data.deal_status) ||
          !data.updated_at || !Number.isFinite(Date.parse(data.updated_at))) {
          throw new Error('Não foi possível confirmar a permissão ou a versão deste contato.');
        }
        targets[index] = Object.freeze({
          id, name: data.name, expectedUpdatedAt: data.updated_at, expectedStageId: data.stage_id ?? null,
          pipelineId: data.pipeline_id ?? null, assignedUserId: data.assigned_user_id ?? null, status: data.deal_status,
        });
      } catch (error) {
        if (error instanceof VimobAPIError && error.status === 401) sessionRejected = true;
        if (canRead()) failures[index] = failure(id, error);
      }
    });
    if (!canRead()) throw new Error(scopeChanged);
    const review = Object.freeze({
      targets: Object.freeze(targets.filter(Boolean)),
      failures: Object.freeze(failures.filter(Boolean)),
      unstartedIds: Object.freeze(selected.filter((_id, index) => !targets[index] && !failures[index])),
    });
    reviews.current.set(review, { operation, permission });
    return review;
  };

  const run = async ({ review, action, isCurrent = () => true, onProgress }: {
    review: ContactLeadActionReview; action: ContactLeadAction; isCurrent?: IsCurrent;
    onProgress?: (completed: number, total: number) => void;
  }): Promise<ContactLeadActionResult> => {
    const prepared = reviews.current.get(review);
    if (!prepared || !prepared.operation.isCurrent() || currentPermission.current !== prepared.permission || !isCurrent()) {
      throw new Error(scopeChanged);
    }
    const { operation, permission } = prepared;
    if (running.current?.isCurrent()) throw new Error('Já existe uma ação de contatos em andamento.');
    const lostReason = validateAction(action);
    reviews.current.delete(review);
    running.current = operation;
    let stop = false;
    const current = () => !stop && currentPermission.current === permission && operation.isCurrent() && isCurrent();
    const result: ContactLeadActionResult = {
      succeededIds: [], unchangedIds: [], failures: [], unconfirmedIds: [], unstartedIds: [], financialReviewIds: [],
    };
    const intent = { ...operation.intent, signal: undefined };
    const completed = new Set<string>();
    let reconcileCommercial = false;
    const markCompleted = (id: string) => {
      completed.add(id);
      if (current()) onProgress?.(completed.size, review.targets.length);
    };
    let lastMoveStartedAt = Number.NEGATIVE_INFINITY;
    let moveContract: Awaited<ReturnType<typeof getLeadMoveStageContract>> | undefined;
    const concurrency = action.kind === 'move-stage' ? 1 : REQUEST_CONCURRENCY;
    try {
      await runBounded(review.targets, concurrency, current, async target => {
        if (isUnchanged(target, action)) {
          result.unchangedIds.push(target.id);
          markCompleted(target.id);
          return;
        }

        let writeStarted = false;
        const writeIntent = {
          ...intent,
          onRequestStart: () => {
            if (!current()) throw new Error(scopeChanged);
            writeStarted = true;
            if (action.kind === 'move-stage') lastMoveStartedAt = performance.now();
          },
        };
        const { id, expectedUpdatedAt, expectedStageId } = target;
        try {
          if (action.kind === 'move-stage') {
            const delay = MOVE_SPACING_MS - (performance.now() - lastMoveStartedAt);
            if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
            if (!current()) return;
            if (!isLeadMoveStageContractCurrent(moveContract, operation.organizationId, intent)) {
              moveContract = await getLeadMoveStageContract(operation.organizationId, {
                ...operation.intent,
                onRequestStart: () => { if (!current()) throw new Error(scopeChanged); },
              });
            }
            if (!current()) return;
          }
          const { data } = action.kind === 'move-stage'
            ? await leadsAPI.moveLeadStage(id, { stageId: action.stageId, expectedStageId, expectedUpdatedAt, lostReason },
              operation.organizationId, writeIntent, moveContract)
            : action.kind === 'assign'
              ? await leadsAPI.assignLead(id, action.assignedUserId, operation.organizationId, writeIntent, expectedUpdatedAt)
              : await leadsAPI.updateLead(id, { deal_status: action.status, expectedUpdatedAt,
                lost_reason: action.status === 'lost' ? lostReason : null }, operation.organizationId, writeIntent);
          if (data.id !== id || data.organization_id !== operation.organizationId) {
            throw new Error('A resposta não confirma o contato alterado.');
          }
          result.succeededIds.push(id);
          if (action.kind !== 'assign' && data.deal_status !== target.status) reconcileCommercial = true;
          if (getLeadStatusFinancialReviewMessage({ deal_status: target.status }, data)) result.financialReviewIds.push(id);
        } catch (error) {
          if (!writeStarted && !current()) return;
          if (writeStarted && !definiteRejection(error)) {
            result.unconfirmedIds.push(id);
            if (action.kind !== 'assign') reconcileCommercial = true;
          } else result.failures.push(failure(id, error));
          if (error instanceof VimobAPIError && (error.status === 401 || error.status === 429 ||
            error.code === 'lead_move_contract_unavailable')) {
            markCompleted(id);
            stop = true;
            return;
          }
        }
        markCompleted(id);
      });
    } finally {
      if (running.current === operation) running.current = null;
    }
    result.unstartedIds = review.targets.filter(({ id }) => !completed.has(id)).map(({ id }) => id);
    const affected = [...result.succeededIds, ...result.unconfirmedIds, ...result.failures.map(({ id }) => id)];
    if (currentPermission.current === permission && operation.canReconcileCapturedAccess() && affected.length > 0) {
      const { organizationId } = operation;
      for (const key of ['contacts-list', 'leads', 'stages-with-leads', 'financial-dashboard']) {
        void queryClient.invalidateQueries({ queryKey: [key, organizationId] });
      }
      for (const id of affected) {
        void queryClient.invalidateQueries({ queryKey: ['lead', organizationId, id] });
        void queryClient.invalidateQueries({ queryKey: ['lead-history-v2', id] });
        void queryClient.invalidateQueries({ queryKey: ['activities', id] });
        void queryClient.invalidateQueries({ queryKey: ['lead-cadence-state', organizationId, id] });
      }
      if (reconcileCommercial) {
        for (const key of commercialQueryFamilies) {
          void queryClient.invalidateQueries({ queryKey: [key, organizationId] });
        }
        for (const key of ['notifications', 'unread-notifications-count']) {
          void queryClient.invalidateQueries({ queryKey: [key, operation.userId, organizationId] });
        }
      }
      if (result.succeededIds.length && operation.isCurrent()) {
        const reason = action.kind === 'move-stage' ? 'lead.stage_moved' : action.kind === 'assign' ? 'lead.assigned' : 'lead.updated';
        notifyLeadRealtimeChange({ organizationId, leadId: result.succeededIds.length === 1 ? result.succeededIds[0] : null, reason });
      }
    }
    return result;
  };

  return { prepare, run };
}
