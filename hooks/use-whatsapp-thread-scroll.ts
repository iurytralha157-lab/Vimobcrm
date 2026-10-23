import { useCallback, useLayoutEffect, useRef, useState, type RefObject, type UIEvent } from "react";

type ReadingState = {
    scopeKey: string;
    lastItemId: string | null;
    firstItemId: string | null;
    away: boolean;
    viewport: HTMLElement | null;
    width: number;
    height: number;
    scrollHeight: number;
    anchor: { id: string | null; offset: number; top: number } | null;
};
const rows = (node: HTMLElement) => {
    const items = Array.from(node.querySelectorAll<HTMLElement>("[data-thread-item-id]"));
    return items.length ? items : Array.from(node.querySelectorAll<HTMLElement>("[data-message-id]"));
};
const remember = (node: HTMLElement, state: ReadingState) => {
    const bounds = node.getBoundingClientRect();
    const anchor = rows(node).find((item) => {
      const rect = item.getBoundingClientRect();
      return rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
    state.width = node.clientWidth;
    state.height = node.clientHeight;
    state.scrollHeight = node.scrollHeight;
    state.anchor = { id: anchor?.dataset.threadItemId ?? anchor?.dataset.messageId ?? null,
      offset: anchor ? anchor.getBoundingClientRect().top - bounds.top : 0, top: node.scrollTop };
};
const restore = (node: HTMLElement, state: ReadingState) => {
    const anchor = state.anchor;
    if (!anchor) return;
    const row = anchor.id ? rows(node).find((item) => (
      item.dataset.threadItemId ?? item.dataset.messageId
    ) === anchor.id) : null;
    if (row) node.scrollTop += row.getBoundingClientRect().top - node.getBoundingClientRect().top - anchor.offset;
    else node.scrollTop = anchor.top;
};

export function useWhatsAppThreadScroll(scopeKey: string, lastItemId: string | null,
  scrollRef: RefObject<HTMLDivElement | null>, bottomRef: RefObject<HTMLDivElement | null>,
  options: { firstItemId?: string | null; layoutKey?: string; radixViewport?: boolean; enabled?: boolean; suspended?: boolean } = {}) {
  const stateRef = useRef<ReadingState>({ scopeKey, lastItemId: null, firstItemId: null,
    away: false, viewport: null, width: 0, height: 0, scrollHeight: 0, anchor: null });
  const lifecycleRef = useRef({ active: false });
  const restoreFramesRef = useRef(new Set<number>());
  useLayoutEffect(() => {
    const lifecycle = { active: true };
    const restoreFrames = restoreFramesRef.current;
    lifecycleRef.current = lifecycle;
    return () => {
      lifecycle.active = false;
      for (const frame of restoreFrames) window.cancelAnimationFrame(frame);
      restoreFrames.clear();
    };
  }, [scopeKey, options.enabled, options.suspended]);
  const renderScopeKey = JSON.stringify([scopeKey, options.enabled !== false]);
  const [away, setAway] = useState({ scopeKey: renderScopeKey, value: false });
  // Reset derived UI state on every scope/visibility transition, including ABA.
  if (away.scopeKey !== renderScopeKey) setAway({ scopeKey: renderScopeKey, value: false });
  const viewport = useCallback(() => options.radixViewport
    ? scrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? null
    : scrollRef.current, [options.radixViewport, scrollRef]);
  // Run against the committed DOM. Equal-array refreshes cannot cancel an
  // initial timer, and both the Radix chat and the lead's native viewport use
  // the same reading anchor when earlier rows or media change their height.
  useLayoutEffect(() => {
    if (stateRef.current.scopeKey !== scopeKey || options.enabled === false) {
      stateRef.current = { scopeKey, lastItemId: null, firstItemId: null, away: false,
        viewport: null, width: 0, height: 0, scrollHeight: 0, anchor: null };
    }
    // Temporary presentation hiding keeps the reading anchor and derived UI.
    if (options.enabled === false || options.suspended) return;
    const node = viewport();
    if (!node) return;
    const state = stateRef.current;
    const initial = state.lastItemId === null;
    const viewportChanged = state.viewport !== node;
    const rowsChanged = state.lastItemId !== lastItemId || state.firstItemId !== (options.firstItemId ?? null);
    const sizeChanged = state.width !== node.clientWidth || state.height !== node.clientHeight
      || state.scrollHeight !== node.scrollHeight;
    if (lastItemId && (initial || !state.away) && (initial || viewportChanged || rowsChanged || sizeChanged)) {
      bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
    } else if (state.away && (viewportChanged || rowsChanged || sizeChanged)) restore(node, state);
    state.lastItemId = lastItemId;
    state.firstItemId = options.firstItemId ?? null;
    state.viewport = node;
    remember(node, state);
    if (typeof ResizeObserver === "undefined") return;
    const lifecycle = lifecycleRef.current;
    const observer = new ResizeObserver(() => {
      if (!lifecycle.active || stateRef.current !== state || viewport() !== node) return;
      if (state.away) restore(node, state);
      else if (state.lastItemId) bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
      remember(node, state);
    });
    observer.observe(node);
    const content = node.querySelector<HTMLElement>("[data-whatsapp-message-log]");
    if (content) observer.observe(content);
    else for (const item of rows(node)) observer.observe(item);
    return () => observer.disconnect();
  });
  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const state = stateRef.current;
    const node = viewport();
    if (!node || state.scopeKey !== scopeKey || state.viewport !== node || options.enabled === false || options.suspended) return;
    // Resize may dispatch scroll before ResizeObserver; it is not a reading gesture.
    if (state.width !== node.clientWidth || state.height !== node.clientHeight) return;
    const next = node.scrollHeight - node.scrollTop - node.clientHeight >= 50;
    state.away = next;
    remember(node, state);
    setAway((current) => current.scopeKey === renderScopeKey && current.value === next ? current : { scopeKey: renderScopeKey, value: next });
    void event;
  }, [options.enabled, options.suspended, renderScopeKey, scopeKey, viewport]);
  const scrollToLatest = useCallback(() => {
    if (stateRef.current.scopeKey !== scopeKey || options.enabled === false || options.suspended) return;
    stateRef.current.away = false;
    setAway({ scopeKey: renderScopeKey, value: false });
    // Smooth scrolling emits intermediate events that otherwise stop burst following.
    bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
    const node = viewport();
    if (node) remember(node, stateRef.current);
  }, [bottomRef, options.enabled, options.suspended, renderScopeKey, scopeKey, viewport]);
  const loadOlderPreservingPosition = useCallback(async (load: () => Promise<unknown>) => {
    const state = stateRef.current;
    const lifecycle = lifecycleRef.current;
    const node = viewport();
    if (!lifecycle.active || !node || state.scopeKey !== scopeKey || options.enabled === false || options.suspended) return;
    state.away = true;
    remember(node, state);
    setAway({ scopeKey: renderScopeKey, value: true });
    await load();
    if (!lifecycle.active || lifecycleRef.current !== lifecycle || stateRef.current !== state || viewport() !== node) return;
    const frame = window.requestAnimationFrame(() => {
      restoreFramesRef.current.delete(frame);
      if (!lifecycle.active || lifecycleRef.current !== lifecycle || stateRef.current !== state || viewport() !== node) return;
      restore(node, state);
      remember(node, state);
    });
    restoreFramesRef.current.add(frame);
  }, [options.enabled, options.suspended, renderScopeKey, scopeKey, viewport]);
  return { onScroll, scrollToLatest, showScrollToLatest: options.enabled !== false && away.scopeKey === renderScopeKey && away.value, loadOlderPreservingPosition };
}
