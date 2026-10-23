import { useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';

type Tag = { id?: string; name?: string | null; color?: string | null };
type TaggedLead = { id: string; organization_id?: string | null; updated_at?: string | null; tags?: Tag[] };
type Operation = { isCurrent: () => boolean };
type Owner = { generation: number; active: Set<symbol>; uncertain: boolean };
type Journal = { epoch: number; owners: Map<string, Owner> };
type Receipt = {
  journal: Journal; epoch: number; owner: Owner; generation: number; token: symbol;
  leadId: string; organizationId: string; revision: string | null | undefined;
  tagId: string; before?: Tag; beforeIndex: number; added: Tag; action: 'add' | 'remove'; operation: Operation; finished: boolean;
};

function definiteRejection(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as { status?: unknown; code?: unknown; message?: unknown };
  // A duplicate response establishes that the relation already exists; never
  // erase it just because this particular request could not insert it again.
  if (value.code === 'tag_already_exists' || value.message === 'TAG_ALREADY_EXISTS') return false;
  return typeof value.status === 'number' && [400, 401, 403, 404, 405, 409, 410, 412, 415, 422].includes(value.status);
}

function project<Lead extends TaggedLead>(lead: Lead, receipt: Receipt): Lead {
  const tags = lead.tags || [];
  const present = tags.some(tag => tag.id === receipt.tagId);
  if (receipt.action === 'add') return present ? lead : { ...lead, tags: [...tags, receipt.added] };
  return present ? { ...lead, tags: tags.filter(tag => tag.id !== receipt.tagId) } : lead;
}

/** Local relation ownership, independent from status/assignee and other tags. */
export function useLeadTagOptimism<Lead extends TaggedLead>({ leadId, organizationId, actorId, sessionId, canOperate, setLead }: {
  leadId: string | null; organizationId: string | null | undefined; actorId: string | null;
  sessionId: string | null; canOperate: boolean; setLead: Dispatch<SetStateAction<Lead | null>>;
}) {
  const client = useQueryClient();
  const journal = useMemo<Journal>(() => ({ epoch: 0, owners: new Map(), leadId, organizationId, actorId, sessionId, client }),
    [leadId, organizationId, actorId, sessionId, client]);
  const current = useRef<Journal | null>(null);
  const gate = useRef(canOperate);
  useLayoutEffect(() => { gate.current = canOperate; }, [canOperate]);
  useLayoutEffect(() => {
    current.current = journal;
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (event.type !== 'removed' && !(event.type === 'updated' && event.action.type === 'success' && !event.action.manual)) return;
      const key = event.query.queryKey;
      const selected = (key[0] === 'lead' && key[1] === organizationId && key[2] === leadId) ||
        (key[0] === 'pipeline-selected-lead-access' && key[1] === organizationId && key[2] === leadId);
      const board = key[0] === 'stages-with-leads' && key[1] === organizationId;
      if (!selected && !board) return;
      // Structural sharing may keep every tag reference identical after a GET.
      journal.epoch++;
      journal.owners.clear();
    });
    return () => { if (current.current === journal) current.current = null; unsubscribe(); };
  }, [client, journal, leadId, organizationId]);
  const active = (receipt: Receipt) => current.current === receipt.journal && !receipt.finished && receipt.operation.isCurrent();
  const begin = (lead: Lead, tag: Tag & { id: string }, action: Receipt['action'], operation: Operation) => {
    if (current.current !== journal || !gate.current || !operation.isCurrent() || !organizationId ||
      lead.id !== leadId || (lead.organization_id && lead.organization_id !== organizationId)) return null;
    let owner = journal.owners.get(tag.id);
    if (!owner) { owner = { generation: 0, active: new Set(), uncertain: false }; journal.owners.set(tag.id, owner); }
    if (owner.active.size > 0) owner.uncertain = true;
    const token = Symbol('lead-tag'); owner.active.add(token);
    const receipt: Receipt = { journal, epoch: journal.epoch, owner, generation: ++owner.generation, token,
      leadId: lead.id, organizationId, revision: lead.updated_at, tagId: tag.id,
      before: lead.tags?.find(value => value.id === tag.id), beforeIndex: lead.tags?.findIndex(value => value.id === tag.id) ?? -1,
      added: { id: tag.id, name: tag.name, color: tag.color }, action, operation, finished: false };
    return receipt;
  };
  const matches = (lead: Lead, receipt: Receipt) => lead.id === receipt.leadId &&
    (!lead.organization_id || lead.organization_id === receipt.organizationId);
  const apply = (receipt: Receipt) => {
    setLead(lead => lead && active(receipt) && matches(lead, receipt) ? project(lead, receipt) : lead);
  };
  const finish = (receipt: Receipt, uncertain: boolean) => {
    receipt.owner.active.delete(receipt.token);
    if (uncertain) receipt.owner.uncertain = true;
    receipt.finished = true;
  };
  const reject = (receipt: Receipt, error: unknown) => {
    if (receipt.finished) return;
    const definitive = definiteRejection(error);
    const ownsRelation = active(receipt) && definitive && receipt.epoch === receipt.journal.epoch &&
      !receipt.owner.uncertain && receipt.owner.generation === receipt.generation && receipt.owner.active.has(receipt.token);
    if (ownsRelation) setLead(lead => {
      if (current.current !== receipt.journal || !receipt.operation.isCurrent() || receipt.epoch !== receipt.journal.epoch ||
        receipt.owner.uncertain || receipt.owner.generation !== receipt.generation ||
        !lead || !matches(lead, receipt) || lead.updated_at !== receipt.revision) return lead;
      const tags = lead.tags || [], relation = tags.find(tag => tag.id === receipt.tagId);
      if (receipt.action === 'add') {
        return !receipt.before && relation === receipt.added ? { ...lead, tags: tags.filter(tag => tag.id !== receipt.tagId) } : lead;
      }
      if (!receipt.before || relation) return lead;
      const index = Math.max(0, Math.min(receipt.beforeIndex, tags.length));
      return { ...lead, tags: [...tags.slice(0, index), receipt.before, ...tags.slice(index)] };
    });
    const refetchType = active(receipt) ? 'active' : 'none';
    finish(receipt, !definitive || !ownsRelation);
    // The board is read again; never restore an old whole tags array there.
    void Promise.all([
      client.invalidateQueries({ queryKey: ['lead', receipt.organizationId, receipt.leadId], exact: true, refetchType }),
      client.invalidateQueries({ queryKey: ['stages-with-leads', receipt.organizationId], refetchType }),
    ]).catch(() => { /* Remain stale until the next authorized read. */ });
  };
  return { begin, apply, project, reject, complete: (receipt: Receipt) => finish(receipt, true) };
}
