import { compareServerRevisions } from '@/lib/compare-server-revisions';
import { replaceEqualDeep } from '@tanstack/react-query';

type ReadSnapshot = {
  id: string;
  organization_id?: string | null;
  updated_at?: string | null;
};

// Fence GET commits without changing field-owned optimistic or rollback writes.
const serverReads = new WeakSet<object>();
const staleReadMessage = 'O lead foi atualizado durante a leitura. Tente novamente para confirmar os dados atuais.';

export class LeadReadSupersededError extends Error {
  constructor() {
    super(staleReadMessage);
    this.name = 'LeadReadSupersededError';
  }
}

function superseded(cached: ReadSnapshot | null | undefined, incoming: ReadSnapshot) {
  if (!cached || cached.id !== incoming.id || cached.organization_id !== incoming.organization_id) return false;
  const revision = compareServerRevisions(cached.updated_at, incoming.updated_at);
  return revision === 1 || (revision === null && compareServerRevisions(cached.updated_at, cached.updated_at) === 0);
}

/** Check again at Query's synchronous commit, after the queryFn promise resolves. */
export function reconcileLeadReadCache<T extends ReadSnapshot | null | undefined>(current: T, incoming: T): T {
  if (incoming && serverReads.has(incoming) && superseded(current, incoming)) throw new LeadReadSupersededError();
  return replaceEqualDeep(current, incoming);
}

/** A superseded GET cannot overwrite data or establish fresh access from cache. */
export async function readConsistentLeadSnapshot<T extends ReadSnapshot>(options: {
  organizationId: string;
  leadId: string;
  signal?: AbortSignal;
  read: () => Promise<T | null>;
  getCached: () => T | null | undefined;
}): Promise<T | null> {
  // Retry once with a new server read, never by promoting the cached snapshot.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (options.signal?.aborted) throw new Error('Leitura cancelada');
    const incoming = await options.read();
    if (options.signal?.aborted) throw new Error('Leitura cancelada');
    if (!incoming) return null;
    if (incoming.id !== options.leadId || incoming.organization_id !== options.organizationId) {
      throw new Error('A leitura do lead não corresponde à organização e seleção atuais.');
    }

    const cached = options.getCached();
    if (superseded(cached, incoming)) continue;
    serverReads.add(incoming);
    return incoming;
  }
  throw new LeadReadSupersededError();
}
