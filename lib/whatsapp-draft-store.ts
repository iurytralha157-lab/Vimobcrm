type Draft = { text: string; at: number };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const KEY = 'vimob:whatsapp-drafts:v1';
const TTL = 24 * 60 * 60_000;
const MAX_DRAFTS = 50;
const MAX_TEXT = 10_000;

export function createWhatsAppDraftStore(storage?: StorageLike, now: () => number = Date.now) {
  let drafts: Record<string, Draft> = {};
  let revision = 0;
  const listeners = new Set<() => void>();
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (!value || typeof value !== 'object') continue;
        let fields: unknown;
        try { fields = JSON.parse(key); } catch { continue; }
        if (!Array.isArray(fields) || fields.length !== 3 || fields.some(field => typeof field !== 'string')) continue;
        const draft = value as Partial<Draft>;
        if (typeof draft.text === 'string' && draft.text.length <= MAX_TEXT && typeof draft.at === 'number'
          && Number.isFinite(draft.at) && draft.at <= now() && now() - draft.at < TTL
          && Object.keys(drafts).length < MAX_DRAFTS) drafts[key] = { text: draft.text, at: draft.at };
      }
    }
  } catch { drafts = {}; }
  const persist = () => {
    try { if (Object.keys(drafts).length) storage?.setItem(KEY, JSON.stringify(drafts)); else storage?.removeItem(KEY); } catch { /* Memory remains available when browser storage is disabled/full. */ }
    revision += 1;
    listeners.forEach(listener => listener());
  };
  const prune = () => {
    const fresh = Object.entries(drafts).filter(([, draft]) => now() - draft.at < TTL && draft.at <= now())
      .sort((a, b) => b[1].at - a[1].at).slice(0, MAX_DRAFTS);
    drafts = Object.fromEntries(fresh);
  };
  const hasOwner = (key: string, owner: string) => {
    try { const fields: unknown = JSON.parse(key); return Array.isArray(fields) && fields[0] === owner; } catch { return false; }
  };
  return {
    getRevision() { return revision; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get(key: string | null) { const draft = key ? drafts[key] : undefined; return draft && now() - draft.at < TTL && draft.at <= now() ? draft.text : ''; },
    set(key: string | null, value: string | ((text: string) => string)) {
      if (!key) return;
      const old = this.get(key), next = typeof value === 'function' ? value(old) : value;
      if (old === next) return;
      if (next) drafts = { ...drafts, [key]: { text: next.slice(0, MAX_TEXT), at: now() } };
      else { const { [key]: removed, ...remaining } = drafts; void removed; drafts = remaining; }
      prune(); persist();
    },
    clearOwner(owner: string) { drafts = Object.fromEntries(Object.entries(drafts).filter(([key]) => !hasOwner(key, owner))); persist(); },
    retainOwner(owner: string | null) { drafts = Object.fromEntries(Object.entries(drafts).filter(([key]) => Boolean(owner) && hasOwner(key, owner!))); persist(); },
    clearConversation(owner: string, conversationId: string) {
      drafts = Object.fromEntries(Object.entries(drafts).filter(([key]) => {
        try { const fields: unknown = JSON.parse(key); return !hasOwner(key, owner) || !Array.isArray(fields) || fields[1] !== conversationId; } catch { return false; }
      })); persist();
    },
  };
}

let browserStore: ReturnType<typeof createWhatsAppDraftStore> | undefined;
export function getWhatsAppDraftStore() {
  if (typeof window === 'undefined') return createWhatsAppDraftStore();
  if (!browserStore) {
    let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* Session storage is optional. */ }
    browserStore = createWhatsAppDraftStore(storage);
  }
  return browserStore;
}

export function getWhatsAppDraftOwner(scope: { userId?: string | null; organizationId?: string | null; accessScope?: string | null }) {
  return scope.userId && scope.organizationId ? JSON.stringify([scope.userId, scope.organizationId, scope.accessScope || '']) : null;
}
