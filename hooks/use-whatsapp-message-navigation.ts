'use client';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { WhatsAppMessage } from '@/hooks/use-whatsapp-conversations';
import { findWhatsAppMessageIdentity, matchesWhatsAppMessageSearch } from '@/lib/whatsapp-message-navigation';

type Page = { messages: WhatsAppMessage[]; nextCursor: string | null };
type Options = {
  scopeKey: string;
  messages: readonly WhatsAppMessage[];
  readPage?: (cursor: string | null, signal?: AbortSignal) => Promise<Page>;
  loadOlder?: () => Promise<{ messages: WhatsAppMessage[]; hasMore: boolean }>;
  logRef?: RefObject<HTMLElement | null>;
};
type SearchState = { owner: string; query: string; results: WhatsAppMessage[]; cursor: string | null; hasMore: boolean; busy: boolean; error: string };
const empty = (owner: string): SearchState => ({ owner, query: '', results: [], cursor: null, hasMore: false, busy: false, error: '' });

/** Explicit user actions read authorized pages; search never inserts records into the chat cache. */
export function useWhatsAppMessageNavigation(options: Options) {
  const hasReader = Boolean(options.readPage), hasLoader = Boolean(options.loadOlder);
  const renderIntent = useMemo(() => ({ hasLoader, hasReader, scopeKey: options.scopeKey }), [hasLoader, hasReader, options.scopeKey]);
  const [stateIntent, setStateIntent] = useState(renderIntent);
  const [openOwner, setOpenOwner] = useState<string | null>(null);
  const [state, setState] = useState(() => empty(options.scopeKey));
  const [navigationState, setNavigationState] = useState({ owner: options.scopeKey, busy: false, error: '' });
  if (stateIntent !== renderIntent) {
    setStateIntent(renderIntent);
    setState(empty(options.scopeKey));
    setOpenOwner(null);
    setNavigationState({ owner: options.scopeKey, busy: false, error: "" });
  }
  const current = useRef({ options, generation: 0 });
  const controller = useRef<AbortController | null>(null);
  const searchedCursors = useRef<{ owner: string; query: string; values: Set<string> } | null>(null);
  useLayoutEffect(() => { current.current.options = options; });
  useLayoutEffect(() => {
    const requestOwner = current.current;
    requestOwner.generation += 1;
    searchedCursors.current = null;
    return () => { requestOwner.generation += 1; controller.current?.abort(); };
  }, [hasLoader, hasReader, options.scopeKey]);
  const value = state.owner === options.scopeKey ? state : empty(options.scopeKey);
  const cancel = useCallback(() => {
    controller.current?.abort(); controller.current = null;
    setState(previous => previous.busy ? { ...previous, busy: false } : previous);
    setNavigationState(previous => previous.busy || previous.error ? { ...previous, busy: false, error: '' } : previous);
  }, []);
  const setOpen = useCallback((next: boolean) => {
    if (current.current.options.scopeKey !== options.scopeKey) return;
    setOpenOwner(next ? options.scopeKey : null);
    if (!next) { cancel(); searchedCursors.current = null; setState(empty(options.scopeKey)); }
  }, [cancel, options.scopeKey]);
  const setQuery = useCallback((query: string) => {
    if (current.current.options.scopeKey !== options.scopeKey) return;
    cancel(); searchedCursors.current = null; setState({ ...empty(options.scopeKey), query: query.slice(0, 180) });
  }, [cancel, options.scopeKey]);
  const scan = useCallback(async (more: boolean) => {
    if (current.current.options.scopeKey !== options.scopeKey || !value.query.trim() || value.busy || (more && !value.hasMore)) return;
    cancel();
    const request = new AbortController(); controller.current = request;
    const { generation } = current.current;
    const isCurrent = () => !request.signal.aborted && current.current.generation === generation
      && current.current.options.scopeKey === options.scopeKey && controller.current === request;
    const results = new Map((more ? value.results : []).map(message => [message.id, message]));
    const visited = new Set(more && searchedCursors.current?.owner === options.scopeKey
      && searchedCursors.current.query === value.query ? searchedCursors.current.values : []);
    let cursorInvalid = false;
    let cursor = more ? value.cursor : null, hasMore = false;
    setState({ ...value, busy: true, error: '' });
    try {
      if (!options.readPage) {
        for (const message of options.messages) if (matchesWhatsAppMessageSearch(message, value.query)) results.set(message.id, message);
      } else {
        for (let pageNumber = 0; pageNumber < 4; pageNumber += 1) {
          if (cursor) visited.add(cursor);
          const readPage = current.current.options.readPage;
          if (!readPage) return;
          const page = await readPage(cursor, request.signal);
          if (!isCurrent()) return;
          if (page.nextCursor && (page.nextCursor === cursor || visited.has(page.nextCursor))) {
            cursorInvalid = true; throw Error('Repeated authorized history cursor');
          }
          for (const message of page.messages) if (matchesWhatsAppMessageSearch(message, value.query)) results.set(message.id, message);
          hasMore = Boolean(page.nextCursor) && page.nextCursor !== cursor;
          cursor = page.nextCursor;
          if (!hasMore) break;
        }
      }
      if (isCurrent()) {
        searchedCursors.current = { owner: options.scopeKey, query: value.query, values: visited };
        setState({ owner: options.scopeKey, query: value.query, results: [...results.values()], cursor, hasMore, busy: false, error: '' });
      }
    } catch {
      if (isCurrent()) setState({ ...value, hasMore: cursorInvalid ? false : value.hasMore,
        busy: false, error: 'Não foi possível pesquisar agora. Tente novamente.' });
    }
  }, [cancel, options, value]);
  const navigateTo = useCallback(async (id: string, context?: { conversationId?: string | null; sessionId?: string | null }) => {
    if (current.current.options.scopeKey !== options.scopeKey) return;
    cancel(); const request = new AbortController(); controller.current = request;
    const { generation } = current.current;
    const isCurrent = () => !request.signal.aborted && current.current.generation === generation
      && current.current.options.scopeKey === options.scopeKey && controller.current === request;
    setNavigationState({ owner: options.scopeKey, busy: true, error: '' });
    try {
      let messages = [...options.messages], target = findWhatsAppMessageIdentity(messages, id, context);
      for (let page = 0; !target && current.current.options.loadOlder && page < 12; page += 1) {
        const loadOlder = current.current.options.loadOlder;
        if (!loadOlder) break;
        const previousCount = messages.length;
        const older = await loadOlder();
        if (!isCurrent()) return;
        messages = older.messages;
        target = findWhatsAppMessageIdentity(messages, id, context);
        // A frame alone is not proof that React committed the locally revealed
        // rows. Wait for those authorized rows before reusing the next adapter
        // or focusing a target returned by a server page. Reactions have no row.
        const expectedIds = messages.filter(message => message.message_type !== 'reaction').map(message => message.id);
        await new Promise<void>((resolve, reject) => {
          let frame: number | undefined, settled = false;
          const finish = (failed: boolean) => {
            if (settled) return;
            settled = true;
            if (frame !== undefined) window.cancelAnimationFrame(frame);
            window.clearTimeout(timer);
            request.signal.removeEventListener('abort', abort);
            if (failed) reject(Error('Authorized history did not commit')); else resolve();
          };
          const abort = () => finish(true);
          const observe = () => {
            if (settled) return;
            if (!isCurrent()) { finish(true); return; }
            const committedIds = new Set(current.current.options.messages.map(message => message.id));
            if (expectedIds.every(messageId => committedIds.has(messageId))) finish(false);
            else frame = window.requestAnimationFrame(observe);
          };
          const timer = window.setTimeout(() => finish(true), 1000);
          request.signal.addEventListener('abort', abort, { once: true });
          observe();
        });
        if (!isCurrent()) return;
        if (!older.hasMore || messages.length <= previousCount) break;
      }
      if (!isCurrent()) return;
      if (!target) throw Error('Message outside the loaded authorized range');
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      if (!isCurrent()) return;
      const log = current.current.options.logRef?.current;
      const root = log?.closest('[role="log"]') || log;
      const element = root?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(target.id)}"]`);
      if (!element) throw Error('Message not rendered');
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      element.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'instant' : 'smooth' }); element.focus({ preventScroll: true });
      if (!reducedMotion) element.animate?.([{ backgroundColor: 'var(--app-surface-hover)' }, { backgroundColor: 'transparent' }], { duration: 1500 });
      setNavigationState({ owner: options.scopeKey, busy: false, error: '' });
    } catch {
      if (isCurrent()) setNavigationState({ owner: options.scopeKey, busy: false, error: 'Não foi possível localizar a mensagem. Consulte as mensagens anteriores e tente novamente.' });
    }
  }, [cancel, options]);
  return {
    open: openOwner === options.scopeKey, setOpen, query: value.query, setQuery,
    results: value.results, hasMore: value.hasMore, isSearching: value.busy,
    error: value.error || (navigationState.owner === options.scopeKey ? navigationState.error : ''),
    navigating: navigationState.owner === options.scopeKey && navigationState.busy,
    search: () => scan(false), searchMore: () => scan(true), navigateTo,
  };
}

export type WhatsAppMessageNavigation = ReturnType<typeof useWhatsAppMessageNavigation>;
