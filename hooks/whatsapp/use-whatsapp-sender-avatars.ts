"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getUserSummaries, type UserSummary } from "@/lib/api/user-summaries";
import { buildWhatsAppSenderAvatars, type WhatsAppSenderAvatar } from "@/lib/whatsapp-avatar";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import { WHATSAPP_MESSAGES_RECONCILE_EVENT, type WhatsAppMessagesReconcileEventDetail } from "@/lib/whatsapp-query-cache";

const isUUID = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const SUMMARY_BATCH_SIZE = 100;
const SUMMARY_BATCH_CONCURRENCY = 2;
let summaryReadGeneration = 0;

function isTransientSummaryFailure(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  return typeof status === "number" ? status >= 500 || status === 408 || status === 429
    : error instanceof Error && !code;
}

/** Match the existing summaries API limit; a query publishes only complete data. */
async function readSenderSummaries(ids: readonly string[], organizationId: string | null, userId: string | null, signal: AbortSignal) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const requireCurrent = () => {
    if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  const batches = Array.from({ length: Math.ceil(ids.length / SUMMARY_BATCH_SIZE) }, (_, index) =>
    ids.slice(index * SUMMARY_BATCH_SIZE, (index + 1) * SUMMARY_BATCH_SIZE));
  const results: UserSummary[][] = new Array(batches.length);
  let next = 0;
  const read = async () => {
    while (next < batches.length) {
      requireCurrent();
      const index = next++;
      const users = await getUserSummaries([...batches[index]], organizationId,
        { signal: controller.signal, expectedUserId: userId });
      requireCurrent();
      results[index] = users;
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(SUMMARY_BATCH_CONCURRENCY, batches.length) }, read));
    requireCurrent();
    return results.flat();
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

/** One scoped query per visible thread, with bounded API batches rather than per-message reads. */
export function useWhatsAppSenderAvatars({ messages, conversationId, leadId, sessionId, enabled = true }: {
  messages: readonly { from_me?: boolean; sender_user_id?: string | null }[];
  conversationId?: string | null; leadId?: string | null; sessionId?: string | null; enabled?: boolean;
}): ReadonlyMap<string, WhatsAppSenderAvatar> {
  const scope = useWhatsAppQueryScope();
  const queryClient = useQueryClient();
  const idsKey = [...new Set(messages.filter(message => message.from_me).map(message =>
    message.sender_user_id?.trim().toLowerCase() || "").filter(isUUID))].sort().slice(0, 1000).join(",");
  const ids = useMemo(() => idsKey ? idsKey.split(",") : [], [idsKey]);
  const identity = JSON.stringify([scope.organizationId, scope.userId, scope.accessScope, conversationId, leadId, sessionId, idsKey]);
  const queryKey = useMemo(() => ['whatsapp-sender-avatars', scope.organizationId, scope.userId, scope.accessScope,
    conversationId, leadId, sessionId, idsKey] as const,
  [scope.organizationId, scope.userId, scope.accessScope, conversationId, leadId, sessionId, idsKey]);
  const contextKey = useMemo(() => queryKey.slice(0, -1), [queryKey]);
  const ready = enabled && Boolean(scope.organizationId && scope.userId && scope.accessScope && conversationId);
  const owner = JSON.stringify([ready, ...contextKey]);
  const visit = useMemo(() => ({ owner }), [owner]);
  const query = useQuery({ queryKey,
    // A completed reauthorization must be distinguishable even when React
    // Query structurally shares an identical list of image URLs.
    queryFn: async ({ signal }) => ({ identity, users: await readSenderSummaries(ids, scope.organizationId, scope.userId, signal), readGeneration: ++summaryReadGeneration }),
    enabled: ready && ids.length > 0,
    staleTime: 60_000, gcTime: 5 * 60_000, retry: false, refetchOnWindowFocus: true,
  });
  type Retained = { visit: object; users: UserSummary[]; seen: unknown; blocked: Set<unknown> };
  const [retained, setRetained] = useState<Retained>(() => ({ visit, users: [], seen: undefined, blocked: new Set() }));
  const blockedSources = useCallback(() => queryClient.getQueriesData({ queryKey: contextKey }).map(([, data]) => data).filter(Boolean), [queryClient, contextKey]);
  let current = retained.visit === visit ? retained
    : { visit, users: [], seen: undefined, blocked: new Set(blockedSources()) };
  if (current !== retained) setRetained(current);
  const denied = query.isError && !isTransientSummaryFailure(query.error);
  if (denied && (current.users.length > 0 || !current.blocked.has(query.data))) {
    current = { ...current, users: [], seen: query.data, blocked: new Set([...current.blocked, ...blockedSources(), query.data]) };
    setRetained(current);
  } else if (ready && !denied && query.data?.identity === identity && current.seen !== query.data && !current.blocked.has(query.data)) {
    current = { ...current, users: query.data.users, seen: query.data };
    setRetained(current);
  }
  const previousVisit = useRef(visit);
  useEffect(() => {
    if (previousVisit.current === visit) return;
    previousVisit.current = visit;
    // An actor/context ABA or re-open starts a new authorized visit. Do not
    // resurrect an old fresh cache entry; share any already active peer read.
    if (ready && ids.length) void query.refetch({ cancelRefetch: false });
  }, [ids.length, query, ready, visit]);
  useEffect(() => {
    // A hidden surface must not schedule remaining batches; another active
    // surface with this exact query may still need the shared request.
    if (!enabled) void queryClient.cancelQueries({ queryKey, exact: true, type: "inactive" });
  }, [enabled, queryClient, queryKey]);
  useEffect(() => {
    if (!enabled || !ids.length) return;
    const reconcile = (event: Event) => {
      const detail = (event as CustomEvent<WhatsAppMessagesReconcileEventDetail>).detail;
      if (detail?.scope && (detail.scope.organizationId !== scope.organizationId || detail.scope.userId !== scope.userId
        || detail.scope.accessScope !== scope.accessScope)) return;
      if (detail?.leadIds?.length && leadId && !detail.leadIds.includes(leadId)) return;
      if (detail?.conversationIds?.length && conversationId && !detail.conversationIds.includes(conversationId)) return;
      if (!detail?.authorizationChanged) return;
      const blocked = blockedSources();
      setRetained(previous => previous.visit === visit
        ? { ...previous, users: [], blocked: new Set([...previous.blocked, ...blocked]) } : previous);
      // Retire every author-set cache of this exact conversation/ACL, including
      // pages that are currently inactive, so pagination cannot revive them.
      void queryClient.cancelQueries({ queryKey: contextKey }).then(() => queryClient.resetQueries({ queryKey: contextKey }));
    };
    window.addEventListener(WHATSAPP_MESSAGES_RECONCILE_EVENT, reconcile);
    return () => window.removeEventListener(WHATSAPP_MESSAGES_RECONCILE_EVENT, reconcile);
  }, [enabled, ids.length, leadId, conversationId, queryClient, contextKey, scope.organizationId, scope.userId, scope.accessScope, visit, blockedSources]);
  return useMemo(() => ready && !denied ? buildWhatsAppSenderAvatars(ids, current.users) : new Map(), [ready, denied, ids, current.users]);
}
