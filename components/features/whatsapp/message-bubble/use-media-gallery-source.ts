import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MessageMediaGalleryItem } from "./media-gallery-model";

/** Scope transitions create a new intent, including A -> B -> A. No URL cache. */
export function useMediaGallerySource(item: MessageMediaGalleryItem, scopeKey: string, isOpen: boolean) {
  const intent = useMemo(() => ({ id: item.id, url: item.url, scopeKey, refresh: item.refresh, isOpen }), [item.id, item.url, scopeKey, item.refresh, isOpen]);
  const activeIntent = useRef<typeof intent | null>(null);
  const requestGeneration = useRef(0);
  const pendingRequest = useRef<AbortController | null>(null);
  const [result, setResult] = useState<{ intent: typeof intent; url: string | null; failed: boolean } | null>(null);
  useLayoutEffect(() => {
    activeIntent.current = intent;
    return () => { if (activeIntent.current === intent) activeIntent.current = null; requestGeneration.current += 1; pendingRequest.current?.abort(); pendingRequest.current = null; };
  }, [intent]);
  const refresh = useCallback(async () => {
    if (!intent.isOpen || !intent.refresh || activeIntent.current !== intent) return null;
    const generation = ++requestGeneration.current;
    pendingRequest.current?.abort();
    const controller = new AbortController();
    pendingRequest.current = controller;
    try {
      const url = await intent.refresh({ signal: controller.signal });
      if (controller.signal.aborted || activeIntent.current !== intent || generation !== requestGeneration.current) return null;
      setResult({ intent, url: url || null, failed: !url });
      return url || null;
    } catch {
      if (!controller.signal.aborted && activeIntent.current === intent && generation === requestGeneration.current) setResult({ intent, url: null, failed: true });
      return null;
    } finally {
      if (pendingRequest.current === controller) pendingRequest.current = null;
    }
  }, [intent]);
  useEffect(() => {
    if (!item.url && intent.isOpen && intent.refresh) queueMicrotask(() => { if (activeIntent.current === intent) void refresh(); });
  }, [intent, item.url, refresh]);
  const currentResult = result?.intent === intent ? result : null;
  return {
    url: isOpen ? item.url || currentResult?.url || null : null,
    loading: isOpen && !item.url && Boolean(item.refresh) && !currentResult,
    failed: Boolean(currentResult?.failed),
    refresh: item.url ? item.refresh : refresh,
  };
}
