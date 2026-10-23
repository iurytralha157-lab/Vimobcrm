import { useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { compareServerRevisions } from '@/lib/compare-server-revisions';

type ScopedLead = { id: string; organization_id?: string | null; updated_at?: string | null };
type Operation = { isCurrent: () => boolean };
type Owner = { generation: number; pending: number; uncertain: boolean };
type Journal = { epoch: number; owners: Map<string, Owner> };
type Receipt<Lead> = {
  journal: Journal; epoch: number; owner: Owner; generation: number; operation: Operation;
  leadId: string; organizationId: string; revision: string | null | undefined;
  keys: (keyof Lead)[]; before: Partial<Lead>; present: Set<keyof Lead>; patch: Partial<Lead>; finished: boolean;
};

export function isDefiniteLeadFieldRejection(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && [400, 401, 403, 404, 405, 409, 410, 412, 415, 422].includes(status);
}

/** One coherent relation group owns its rollback, never the entire popup. */
export function useLeadFieldOptimism<Lead extends ScopedLead>({ leadId, organizationId, actorId, sessionId, setLead }: {
  leadId: string | null; organizationId: string | null | undefined; actorId: string | null;
  sessionId: string | null; setLead: Dispatch<SetStateAction<Lead | null>>;
}) {
  const client = useQueryClient();
  const journal = useMemo<Journal>(() => ({ epoch: 0, owners: new Map(), leadId, organizationId, actorId, sessionId, client }),
    [leadId, organizationId, actorId, sessionId, client]);
  const current = useRef<Journal | null>(null);
  useLayoutEffect(() => {
    current.current = journal;
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (event.type !== 'removed' && !(event.type === 'updated' && event.action.type === 'success' && !event.action.manual)) return;
      const key = event.query.queryKey;
      if (!((key[0] === 'lead' || key[0] === 'pipeline-selected-lead-access') && key[1] === organizationId && key[2] === leadId) &&
        !(key[0] === 'stages-with-leads' && key[1] === organizationId)) return;
      // Even a structurally identical GET retires all prior local ownership.
      journal.epoch++;
      journal.owners.clear();
    });
    return () => { if (current.current === journal) current.current = null; unsubscribe(); };
  }, [client, journal, leadId, organizationId]);
  const isCurrent = (receipt: Receipt<Lead>) => current.current === receipt.journal && !receipt.finished &&
    receipt.operation.isCurrent() && receipt.epoch === receipt.journal.epoch &&
    !receipt.owner.uncertain && receipt.owner.generation === receipt.generation;
  const begin = (lead: Lead, patch: Partial<Lead>, operation: Operation, revision = lead.updated_at) => {
    if (current.current !== journal || !operation.isCurrent() || !organizationId || lead.id !== leadId ||
      (lead.organization_id && lead.organization_id !== organizationId)) return null;
    const keys = Object.keys(patch) as (keyof Lead)[];
    const group = keys.map(String).sort().join('|');
    let owner = journal.owners.get(group);
    if (!owner) { owner = { generation: 0, pending: 0, uncertain: false }; journal.owners.set(group, owner); }
    if (owner.pending > 0) owner.uncertain = true;
    owner.pending++;
    const before: Partial<Lead> = {};
    const present = new Set<keyof Lead>();
    for (const key of keys) { before[key] = lead[key]; if (Object.hasOwn(lead, key)) present.add(key); }
    return { journal, epoch: journal.epoch, owner, generation: ++owner.generation, operation,
      leadId: lead.id, organizationId, revision, keys, before, present, patch, finished: false } satisfies Receipt<Lead>;
  };
  const matches = (lead: Lead, receipt: Receipt<Lead>) => lead.id === receipt.leadId &&
    (!lead.organization_id || lead.organization_id === receipt.organizationId) && lead.updated_at === receipt.revision &&
    compareServerRevisions(lead.updated_at, receipt.revision) === 0;
  const apply = (receipt: Receipt<Lead>) => {
    setLead(lead => lead && isCurrent(receipt) && matches(lead, receipt) &&
      receipt.keys.every(key => Object.is(lead[key], receipt.before[key])) ? { ...lead, ...receipt.patch } : lead);
  };
  const finish = (receipt: Receipt<Lead>, uncertain: boolean) => {
    if (receipt.finished) return;
    receipt.owner.pending--;
    if (uncertain) receipt.owner.uncertain = true;
    receipt.finished = true;
  };
  const reject = (receipt: Receipt<Lead>, error: unknown) => {
    if (receipt.finished) return;
    const definitive = isDefiniteLeadFieldRejection(error), owns = definitive && isCurrent(receipt);
    if (owns) setLead(lead => {
      // Recheck scope/epoch in the updater: React may run it after a context switch.
      if (current.current !== receipt.journal || !receipt.operation.isCurrent() || receipt.epoch !== receipt.journal.epoch ||
        receipt.owner.uncertain || receipt.owner.generation !== receipt.generation || !lead || !matches(lead, receipt) ||
        !receipt.keys.every(key => Object.hasOwn(lead, key) && Object.is(lead[key], receipt.patch[key]))) return lead;
      const restored = { ...lead };
      for (const key of receipt.keys) {
        if (receipt.present.has(key)) restored[key] = receipt.before[key] as Lead[keyof Lead];
        else delete restored[key];
      }
      return restored;
    });
    const refetchType = current.current === receipt.journal && receipt.operation.isCurrent() ? 'active' : 'none';
    finish(receipt, !owns);
    void Promise.all([
      client.invalidateQueries({ queryKey: ['lead', receipt.organizationId, receipt.leadId], exact: true, refetchType }),
      client.invalidateQueries({ queryKey: ['stages-with-leads', receipt.organizationId], refetchType }),
    ]).catch(() => { /* Remain stale until the next authorized read. */ });
  };
  return { begin, apply, reject, isCurrent, complete: (receipt: Receipt<Lead>) => finish(receipt, true),
    discard: (receipt: Receipt<Lead>) => finish(receipt, false) };
}
