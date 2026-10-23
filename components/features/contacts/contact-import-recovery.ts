import type { ImportLeadsProgress, ImportLeadsResult } from '@/hooks/use-leads';
import type { ParsedContact } from '@/components/features/contacts/contact-import-columns';
import { CONTACT_IMPORT_RECOVERY_TTL_MS, MAX_COMPLETED_CONTACT_IMPORT_RECOVERIES, MAX_CONTACT_IMPORT_RECOVERY_FILE_BYTES } from '@/config/contact-import';

export type ContactImportRecovery = {
  rows: ParsedContact[];
  file: File | null;
  ignoredColumns?: string[];
  preparationIssue?: string;
  destination: { pipeline: string; assignee: string; source: string; customSource: string; autoDistribute: boolean; roundRobin: string };
  pending: boolean;
  phase: 'preparing' | 'importing' | null;
  progress: ImportLeadsProgress | null;
  result: ImportLeadsResult | null;
  unknownPreparationRows: number[];
  preparedRows: number;
  createdTags: number;
};

type RecoveryRecord = {
  run: symbol;
  snapshot: ContactImportRecovery;
  updatedAt: number;
  expiresAt: number | null;
  cancelExpiry?: () => void;
};

function scheduleRecoveryExpiry(expire: () => void, delay: number) {
  const timer = globalThis.setTimeout(expire, delay);
  // Node regression tests should not stay open for a browser retention timer.
  if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') timer.unref();
  return () => globalThis.clearTimeout(timer);
}

/** Tab memory only, isolated by org/actor/session. Reloading is not resumable. */
export function createContactImportRecoveryStore({
  now = Date.now,
  scheduleExpiry = scheduleRecoveryExpiry,
}: { now?: () => number; scheduleExpiry?: (expire: () => void, delay: number) => () => void } = {}) {
  const records = new Map<string, RecoveryRecord>();
  const listeners = new Map<string, Set<() => void>>();
  const notify = (key: string) => listeners.get(key)?.forEach(listener => listener());
  const remove = (key: string) => {
    const record = records.get(key);
    if (!record) return;
    record.cancelExpiry?.();
    records.delete(key);
    notify(key);
  };
  const prune = () => {
    for (const [key, record] of records) {
      if (record.expiresAt !== null && record.expiresAt <= now()) remove(key);
    }
    while (true) {
      const completed = [...records.entries()].filter(([, record]) => !record.snapshot.pending)
        .sort(([, left], [, right]) => left.updatedAt - right.updatedAt);
      const fileBytes = completed.reduce((total, [, record]) => total + (record.snapshot.file?.size ?? 0), 0);
      if (completed.length <= MAX_COMPLETED_CONTACT_IMPORT_RECOVERIES && fileBytes <= MAX_CONTACT_IMPORT_RECOVERY_FILE_BYTES) break;
      remove(completed[0][0]);
    }
  };
  const setExpiry = (key: string, record: RecoveryRecord) => {
    record.cancelExpiry?.();
    record.cancelExpiry = undefined;
    record.expiresAt = record.snapshot.pending ? null : now() + CONTACT_IMPORT_RECOVERY_TTL_MS;
    if (record.expiresAt === null) return;
    const expiresAt = record.expiresAt;
    record.cancelExpiry = scheduleExpiry(() => {
      if (records.get(key) === record && record.expiresAt === expiresAt) remove(key);
    }, CONTACT_IMPORT_RECOVERY_TTL_MS);
  };
  return {
    get(key: string) { prune(); return records.get(key)?.snapshot; },
    start(key: string, snapshot: ContactImportRecovery) {
      prune();
      if (records.get(key)?.snapshot.pending) return null;
      const run = Symbol('contact-import');
      records.get(key)?.cancelExpiry?.();
      const record: RecoveryRecord = { run, snapshot, updatedAt: now(), expiresAt: null };
      records.set(key, record);
      setExpiry(key, record);
      prune();
      notify(key);
      return run;
    },
    update(key: string, run: symbol, patch: Partial<ContactImportRecovery>) {
      prune();
      const record = records.get(key);
      if (!record || record.run !== run) return;
      record.snapshot = { ...record.snapshot, ...patch };
      record.updatedAt = now();
      setExpiry(key, record);
      prune();
      notify(key);
    },
    clear(key: string) {
      if (records.get(key)?.snapshot.pending) return;
      remove(key);
    },
    /** Keep A-B-A recovery within a session; discard terminated identities even if pending. */
    retainSession(userId?: string | null, sessionId?: string | null) {
      for (const key of records.keys()) {
        let identity: unknown;
        try { identity = JSON.parse(key); } catch { identity = null; }
        if (!userId || !sessionId || !Array.isArray(identity) || identity[1] !== userId || identity[2] !== sessionId) remove(key);
      }
      prune();
    },
    subscribe(key: string, listener: () => void) {
      const group = listeners.get(key) || new Set<() => void>();
      group.add(listener);
      listeners.set(key, group);
      return () => { group.delete(listener); if (group.size === 0) listeners.delete(key); };
    },
  };
}

export const contactImportRecovery = createContactImportRecoveryStore();
