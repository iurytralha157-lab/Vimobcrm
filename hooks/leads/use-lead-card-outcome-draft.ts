'use client';

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskOutcomeDraft } from '@/components/features/leads/TaskOutcomeDialog';
import { createUUID } from '@/lib/client-id';
import { captureQueryClientAccess } from '@/lib/access/query-client-access';
import { leadContactOutcomeCommandSchema, type LeadContactOutcomeCommand } from '@/lib/validation/lead-contact-outcomes';

type SavedDraft = { revision: number; draft: TaskOutcomeDraft };
type PendingCommand = { command: LeadContactOutcomeCommand; submitted: SavedDraft; latest: SavedDraft };
type BusyCommand = { commandId: string; command: LeadContactOutcomeCommand; canReconcile: () => boolean };
const emptyDraft: TaskOutcomeDraft = { outcome: '', notes: '' };

/** Keep a quick-action result when realtime, filtering or a move remounts its card. */
export function useLeadCardOutcomeDraft(
  organizationId: string | null | undefined,
  actorId: string | null | undefined,
  sessionId: string | null | undefined,
  leadId: string,
  kind: 'call' | 'email',
) {
  const client = useQueryClient();
  const key = useMemo(() => ['lead-card-outcome-draft', organizationId, actorId, sessionId, leadId, kind] as const,
    [organizationId, actorId, sessionId, leadId, kind]);
  const owner = useMemo(() => ({ key, client }), [key, client]);
  const commandKey = useMemo(() => ['lead-card-outcome-command', ...key.slice(1)] as const, [key]);
  const busyKey = useMemo(() => ['lead-card-outcome-busy', ...key.slice(1)] as const, [key]);
  const commands = useRef(new WeakMap<object, () => boolean>());
  const snapshots = useRef(new WeakMap<object, () => boolean>());
  const ownerAccess = useRef(new WeakMap<object, () => boolean>());
  const active = useRef<object | null>(owner);
  // Capture at the first gesture, after the provider's layout effect has
  // registered its lease. An old callback must never acquire a newer lease.
  const ownerHasAccess = useCallback(() => {
    let guard = ownerAccess.current.get(owner);
    if (!guard) { guard = captureQueryClientAccess(client); ownerAccess.current.set(owner, guard); }
    return guard();
  }, [owner, client]);
  useLayoutEffect(() => {
    // A SID replacement may reuse the provider's QueryClient. Pending private
    // data must not remain pinned forever after that access has retired.
    client.removeQueries({ predicate: query => ['lead-card-outcome-command', 'lead-card-outcome-busy'].includes(String(query.queryKey[0]))
      && (query.queryKey[1] !== organizationId || query.queryKey[2] !== actorId || query.queryKey[3] !== sessionId) });
    active.current = owner;
    return () => { if (active.current === owner) active.current = null; };
  }, [owner, client, organizationId, actorId, sessionId]);
  const { data: pending } = useQuery<PendingCommand | null>({ queryKey: commandKey,
    queryFn: () => null, enabled: false, gcTime: 30 * 60_000 });
  const { data: busy } = useQuery<BusyCommand | null>({ queryKey: busyKey,
    queryFn: () => null, enabled: false, gcTime: 30 * 60_000 });
  const { data } = useQuery<SavedDraft>({
    queryKey: key,
    queryFn: () => ({ revision: 0, draft: emptyDraft }),
    enabled: false,
    gcTime: 30 * 60_000,
  });
  const updateDraft = useCallback((draft: TaskOutcomeDraft) => {
    if (active.current !== owner || !organizationId || !actorId || !sessionId || !ownerHasAccess()) return;
    const command = client.getQueryData<PendingCommand | null>(commandKey);
    // Cancel hides the dialog, but an uncertain command still needs a selected
    // result on reopen so its original receipt can be reconciled safely.
    if (command && !draft.outcome && !draft.notes) return;
    const previous = client.getQueryData<SavedDraft>(key) ?? command?.latest;
    const next = client.setQueryData<SavedDraft>(key, { revision: (previous?.revision ?? 0) + 1, draft })!;
    // This mirror pins the latest draft while an unconfirmed command exists,
    // even if the ordinary 30-minute draft query is garbage collected.
    if (command) client.setQueryData(commandKey, { ...command, latest: next });
  }, [client, key, commandKey, owner, organizationId, actorId, sessionId, ownerHasAccess]);
  const captureSubmission = useCallback(() => {
    const current = client.getQueryData<SavedDraft>(key) ?? client.getQueryData<PendingCommand | null>(commandKey)?.latest;
    if (current && active.current === owner && ownerHasAccess()) snapshots.current.set(current, ownerAccess.current.get(owner)!);
    return current;
  }, [client, key, commandKey, snapshots, owner, ownerHasAccess]);
  const acknowledgeSavedDraft = useCallback((submitted: SavedDraft | undefined) => {
    // A confirmed write may outlive its card. Clear only that exact cached version;
    // a newly mounted card's edits (even identical text after ABA) own another one.
    if (!submitted || snapshots.current.get(submitted)?.() !== true || client.getQueryData<SavedDraft>(key) !== submitted) return;
    client.setQueryData<SavedDraft>(key, { revision: submitted.revision + 1, draft: emptyDraft });
  }, [client, key, snapshots]);
  const getSubmission = (outcome: TaskOutcomeDraft['outcome'], notes: string): LeadContactOutcomeCommand => {
    if (active.current !== owner || !organizationId || !actorId || !sessionId || !ownerHasAccess()) {
      throw new Error('Confirme seu acesso antes de registrar o resultado.');
    }
    const busy = client.getQueryData<BusyCommand | null>(busyKey);
    if (busy?.canReconcile()) {
      commands.current.set(busy.command, ownerAccess.current.get(owner)!);
      return busy.command;
    }
    let pending = client.getQueryData<PendingCommand | null>(commandKey);
    if (!pending) {
      const command = Object.freeze(leadContactOutcomeCommandSchema.parse({ commandId: createUUID(), channel: kind, outcome, notes }));
      const current = client.getQueryData<SavedDraft>(key);
      const submitted = current && current.draft.outcome === outcome && current.draft.notes === notes
        ? current : { revision: current?.revision ?? 0, draft: { outcome, notes } };
      pending = { command, submitted, latest: current ?? submitted };
      client.setQueryData(commandKey, pending);
      const query = client.getQueryCache().find({ queryKey: commandKey, exact: true });
      // Only an unacknowledged command is pinned beyond the draft lifetime.
      if (query) query.setOptions({ ...query.options, gcTime: Infinity });
    }
    commands.current.set(pending.command, ownerAccess.current.get(owner)!);
    return pending.command;
  };
  const beginSubmission = (command: LeadContactOutcomeCommand) => {
    if (active.current !== owner || commands.current.get(command)?.() !== true || client.getQueryData<BusyCommand | null>(busyKey)?.canReconcile()) return false;
    if (client.getQueryData<PendingCommand | null>(commandKey)?.command.commandId !== command.commandId) return false;
    client.setQueryData<BusyCommand>(busyKey, { commandId: command.commandId, command, canReconcile: commands.current.get(command)! });
    const query = client.getQueryCache().find({ queryKey: busyKey, exact: true });
    if (query) query.setOptions({ ...query.options, gcTime: Infinity });
    return true;
  };
  const endSubmission = (command: LeadContactOutcomeCommand) => {
    if (commands.current.get(command)?.() !== true || client.getQueryData<BusyCommand | null>(busyKey)?.commandId !== command.commandId) return;
    client.setQueryData(busyKey, null);
    client.removeQueries({ queryKey: busyKey, exact: true });
  };
  const acknowledgeSavedCommand = (command: LeadContactOutcomeCommand) => {
    if (commands.current.get(command)?.() !== true) return false;
    const pending = client.getQueryData<PendingCommand | null>(commandKey);
    if (pending?.command.commandId !== command.commandId) return false;
    const latest = client.getQueryData<SavedDraft>(key) ?? pending.latest;
    const unchanged = latest.revision === pending.submitted.revision
      && latest.draft.outcome === pending.submitted.draft.outcome && latest.draft.notes === pending.submitted.draft.notes;
    if (unchanged) client.setQueryData<SavedDraft>(key, { revision: latest.revision + 1, draft: emptyDraft });
    else if (!client.getQueryData(key)) client.setQueryData(key, latest);
    client.setQueryData(commandKey, null);
    client.removeQueries({ queryKey: commandKey, exact: true });
    return unchanged;
  };
  return { draft: data?.draft ?? pending?.latest.draft ?? emptyDraft, updateDraft, captureSubmission, acknowledgeSavedDraft,
    getSubmission, beginSubmission, endSubmission, acknowledgeSavedCommand, isSubmitting: busy?.canReconcile() === true };
}
