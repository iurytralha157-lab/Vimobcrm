type GalleryReadScope = { organizationId: string | null; userId: string | null; scopeKey: string };
type MediaURLReader = (id: string, organizationId: string, options: { signal: AbortSignal; expectedUserId: string }) => Promise<{ url: string }>;
type GalleryURLCallback = (options?: { signal?: AbortSignal }) => Promise<string | null>;
type GalleryReadLifetime = {
  activate(): void;
  dispose(): void;
  setVisible(ids: readonly string[]): void;
  read(id: string, options?: { signal?: AbortSignal }): Promise<string | null>;
  reader(id: string, kind: "image" | "video", validate: (url: string | null) => string | null): GalleryURLCallback;
};

/** A local read lifetime. No URL/data cache; each selected stored item is authorized again. */
export function createWhatsAppGalleryReadScope(scope: GalleryReadScope, getMediaURL: MediaURLReader) {
  const { organizationId, userId, scopeKey } = scope;
  let active = false;
  let generation = 0;
  let visible = new Set<string>();
  const pending = new Map<AbortController, string>();
  const readers = new Map<string, GalleryURLCallback>();
  const lifetime: GalleryReadLifetime = {
    activate() { active = true; generation += 1; },
    dispose() {
      active = false; generation += 1;
      for (const controller of pending.keys()) controller.abort();
      pending.clear(); visible.clear();
      readers.clear();
    },
    setVisible(ids: readonly string[]) {
      visible = new Set(ids);
      for (const [controller, id] of pending) if (!visible.has(id)) controller.abort();
    },
    async read(id: string, options?: { signal?: AbortSignal }): Promise<string | null> {
      if (!active || !visible.has(id) || !organizationId || !userId || !scopeKey || options?.signal?.aborted) return null;
      const capturedGeneration = generation;
      const controller = new AbortController();
      const abort = () => controller.abort();
      options?.signal?.addEventListener("abort", abort, { once: true });
      pending.set(controller, id);
      const isCurrent = () => active && generation === capturedGeneration && visible.has(id) && !controller.signal.aborted;
      try {
        if (!isCurrent()) return null;
        const result = await getMediaURL(id, organizationId, { signal: controller.signal, expectedUserId: userId });
        return isCurrent() && typeof result.url === "string" ? result.url : null;
      } catch (error) {
        if (!isCurrent()) return null;
        throw error;
      } finally {
        pending.delete(controller);
        options?.signal?.removeEventListener("abort", abort);
      }
    },
    reader(id: string, kind: "image" | "video", validate: (url: string | null) => string | null) {
      const key = `${id}:${kind}`;
      const existing = readers.get(key);
      if (existing) return existing;
      const callback = (options?: { signal?: AbortSignal }) => lifetime.read(id, options).then(validate);
      readers.set(key, callback);
      return callback;
    },
  };
  return lifetime;
}
