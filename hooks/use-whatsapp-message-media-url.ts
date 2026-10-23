import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { whatsappAPI } from "@/lib/api/whatsapp";
import { clearUnavailableWhatsAppLeadCache, isWhatsAppAccessUnavailable } from "@/lib/whatsapp-access-revocation";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";

let activeRequests = 0;
const waiters: Array<() => void> = [];
async function mediaRequestSlot(signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  try {
    while (activeRequests >= 4) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      await new Promise<void>((resolve, reject) => {
        const wake = () => { signal.removeEventListener("abort", cancel); resolve(); };
        const cancel = () => {
          const index = waiters.indexOf(wake);
          if (index >= 0) waiters.splice(index, 1);
          reject(new DOMException("Cancelled", "AbortError"));
        };
        waiters.push(wake);
        signal.addEventListener("abort", cancel, { once: true });
      });
    }
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  } catch (error) {
    // A cancelled, already-woken request must pass its free slot onward.
    if (activeRequests < 4) waiters.shift()?.();
    throw error;
  }
  activeRequests += 1;
  return () => { activeRequests -= 1; waiters.shift()?.(); };
}

type MediaEntry = { fingerprint: string; generation: number; url: string | null; expiresAt: number | null; failed: boolean };
function initialStoredURL(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? /\/storage\/v1\/object\/(sign|authenticated)\/whatsapp-media\//.test(url.pathname) && !url.username && !url.password ? value : null
      : null;
  } catch { return null; }
}
export function useWhatsAppMessageMediaURL(input: {
  messageId: string; leadId?: string | null; sessionId?: string | null;
  storedMedia?: boolean; mediaUrl: string | null;
  enabled?: boolean;
}) {
  const sourceScope = useWhatsAppQueryScope();
  const scope = useMemo(() => ({ organizationId: sourceScope.organizationId, userId: sourceScope.userId,
    accessScope: sourceScope.accessScope }), [sourceScope.organizationId, sourceScope.userId, sourceScope.accessScope]);
  const queryClient = useQueryClient();
  const fingerprint = useMemo(() => JSON.stringify([scope.organizationId, scope.userId, scope.accessScope,
    input.messageId, input.leadId, input.sessionId, Boolean(input.storedMedia)]),
  [scope, input.messageId, input.leadId, input.sessionId, input.storedMedia]);
  const [currentScope, setCurrentScope] = useState({ fingerprint, generation: 0 });
  if (currentScope.fingerprint !== fingerprint) setCurrentScope({ fingerprint, generation: currentScope.generation + 1 });
  const initialURL = input.storedMedia ? initialStoredURL(input.mediaUrl) : input.mediaUrl;
  const [entry, setEntry] = useState<MediaEntry>(() => ({ fingerprint, generation: 0, url: initialURL,
    expiresAt: initialURL ? Date.now() + 14 * 60_000 : null, failed: false }));
  const [loadingFingerprint, setLoadingFingerprint] = useState<string | null>(null);
  const enabled = input.enabled !== false;
  const automaticEnabledRef = useRef(enabled);
  const identityRef = useRef(fingerprint);
  const generationRef = useRef(0);
  const pendingRef = useRef<{ fingerprint: string; controller: AbortController; promise: Promise<string | null>; mode: { automatic: boolean } } | null>(null);
  const initialAttemptRef = useRef<string | null>(null);
  const sourceUrlRef = useRef(input.mediaUrl);
  useLayoutEffect(() => {
    identityRef.current = fingerprint;
    generationRef.current += 1;
    pendingRef.current?.controller.abort();
    pendingRef.current = null;
    initialAttemptRef.current = null;
    return () => {
      identityRef.current = "";
      generationRef.current += 1;
      pendingRef.current?.controller.abort();
      pendingRef.current = null;
    };
  }, [fingerprint]);
  useLayoutEffect(() => {
    automaticEnabledRef.current = enabled;
    if (enabled || !pendingRef.current?.mode.automatic) return;
    pendingRef.current.controller.abort();
    pendingRef.current = null;
    initialAttemptRef.current = null;
    const generation = generationRef.current;
    queueMicrotask(() => {
      if (!automaticEnabledRef.current && identityRef.current === fingerprint && generationRef.current === generation
        && !pendingRef.current) setLoadingFingerprint(null);
    });
  }, [enabled, fingerprint]);
  useEffect(() => {
    if (entry.fingerprint !== fingerprint || entry.generation !== currentScope.generation) return;
    const nextURL = input.storedMedia ? initialStoredURL(input.mediaUrl) : input.mediaUrl;
    if (!nextURL || sourceUrlRef.current === input.mediaUrl) return;
    sourceUrlRef.current = input.mediaUrl;
    const generation = generationRef.current;
    queueMicrotask(() => {
      if (identityRef.current === fingerprint && generationRef.current === generation) setEntry({ fingerprint, generation: currentScope.generation, url: nextURL,
        expiresAt: Date.now() + 14 * 60_000, failed: false });
    });
  }, [currentScope.generation, entry.fingerprint, entry.generation, fingerprint, input.mediaUrl, input.storedMedia]);

  const readMediaURL = useCallback((automatic: boolean): Promise<string | null> => {
    if (!input.storedMedia || !scope.organizationId || !scope.userId || identityRef.current !== fingerprint) return Promise.resolve(null);
    if (automatic && !automaticEnabledRef.current) return Promise.resolve(null);
    if (pendingRef.current?.fingerprint === fingerprint) {
      // A deliberate open/download may keep an existing visible prefetch alive
      // after opening a viewer moves the bubble outside the observed viewport.
      if (!automatic) pendingRef.current.mode.automatic = false;
      return pendingRef.current.promise;
    }
    const controller = new AbortController();
    const mode = { automatic };
    const generation = generationRef.current;
    const isCurrent = () => !controller.signal.aborted && identityRef.current === fingerprint && generationRef.current === generation
      && (!mode.automatic || automaticEnabledRef.current);
    setLoadingFingerprint(fingerprint);
    const promise = (async () => {
      let release: (() => void) | undefined;
      try {
        release = await mediaRequestSlot(controller.signal);
        if (!isCurrent()) return null;
        const media = await whatsappAPI.getMessageMediaURL(input.messageId, scope.organizationId, { signal: controller.signal, expectedUserId: scope.userId });
        if (!isCurrent()) return null;
        setEntry({ fingerprint, generation: currentScope.generation, url: media.url, expiresAt: Date.now() + Math.max(1, media.expiresIn) * 1000, failed: false });
        return media.url;
      } catch (error) {
        if (!isCurrent()) return null;
        setEntry({ fingerprint, generation: currentScope.generation, url: null, expiresAt: null, failed: true });
        if (isWhatsAppAccessUnavailable(error)) {
          if (input.leadId) clearUnavailableWhatsAppLeadCache(queryClient, scope, input.leadId);
          window.dispatchEvent(new CustomEvent("vimob:whatsapp-media-unavailable", { detail: {
            organizationId: scope.organizationId, userId: scope.userId, accessScope: scope.accessScope,
            messageId: input.messageId, leadId: input.leadId ?? null,
          } }));
        }
        throw error;
      } finally {
        release?.();
        if (pendingRef.current?.controller === controller) pendingRef.current = null;
        if (isCurrent()) setLoadingFingerprint(null);
      }
    })();
    pendingRef.current = { fingerprint, controller, promise, mode };
    return promise;
  }, [currentScope.generation, fingerprint, input.leadId, input.messageId, input.storedMedia, queryClient, scope]);
  const refresh = useCallback(() => readMediaURL(false), [readMediaURL]);
  const currentEntry = entry.fingerprint === fingerprint && entry.generation === currentScope.generation ? entry : null;
  useEffect(() => {
    if (!enabled || !input.storedMedia || currentEntry?.url || currentEntry?.failed || initialAttemptRef.current === fingerprint) return;
    initialAttemptRef.current = fingerprint;
    void readMediaURL(true).catch(() => {});
  }, [currentEntry, enabled, fingerprint, input.storedMedia, readMediaURL]);
  useEffect(() => {
    if (!enabled || !input.storedMedia || !currentEntry?.url || !currentEntry.expiresAt) return;
    const timer = window.setTimeout(() => { void readMediaURL(true).catch(() => {}); }, Math.max(1, currentEntry.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [currentEntry, enabled, input.storedMedia, readMediaURL]);
  return { mediaUrl: input.storedMedia ? currentEntry?.url ?? null : input.mediaUrl,
    playbackIdentity: JSON.stringify([fingerprint, currentScope.generation]),
    isLoading: loadingFingerprint === fingerprint || Boolean(enabled && input.storedMedia && scope.organizationId && scope.userId && !currentEntry?.failed && !currentEntry?.url), failed: currentEntry?.failed ?? false,
    refresh: input.storedMedia ? refresh : undefined };
}
