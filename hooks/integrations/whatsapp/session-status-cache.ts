import type { QueryClient } from "@tanstack/react-query";
import { whatsappAPI, type WhatsAppSession, type WhatsAppSessionQuota } from "@/lib/api/whatsapp";
import type { CapturedWhatsAppMutationIntent } from "@/hooks/integrations/whatsapp/use-whatsapp-mutation-intent";
import { whatsappQueryKeys, type WhatsAppQueryScope, type WhatsAppResolvedSessionStatus } from "@/lib/whatsapp-query-cache";

type WhatsAppSessionList = WhatsAppSession[] & { meta?: WhatsAppSessionQuota };

export function normalizeSession(session: WhatsAppSession): WhatsAppSession {
  return {
    ...session,
    display_name: session.display_name || null,
    last_connected_at: session.last_connected_at || null,
    is_notification_session: session.is_notification_session || false,
  };
}

function replaceSessionStatus(
  sessions: WhatsAppSession[] | undefined,
  sessionId: string,
  status: WhatsAppResolvedSessionStatus,
) {
  if (!Array.isArray(sessions)) return sessions;
  const current = sessions.find((session) => session.id === sessionId);
  if (!current) return sessions;
  // A status probe cannot grant send access. Disconnection can revoke it;
  // reconnecting needs the authenticated list's current can_send decision.
  const canSend = status === "connected" ? current.can_send : false;
  if (current.status === status && current.can_send === canSend) return sessions;
  return sessions.map((session) => session.id === sessionId ? { ...session, status, can_send: canSend } : session);
}

export async function refreshAuthorizedSessionCaches(queryClient: QueryClient, intent: CapturedWhatsAppMutationIntent) {
  const sessionsKey = whatsappQueryKeys.sessions(intent.scope);
  const accessibleKey = whatsappQueryKeys.accessibleSessions(intent.scope);
  try {
    await Promise.all([
      queryClient.cancelQueries({ queryKey: sessionsKey, exact: true }),
      queryClient.cancelQueries({ queryKey: accessibleKey, exact: true }),
    ]);
    intent.assertCurrent();
    const fresh = await queryClient.fetchQuery({
      queryKey: sessionsKey,
      staleTime: 0,
      queryFn: async ({ signal }) => {
        intent.assertCurrent();
        const response = await intent.run(async transport => {
          // Keep both QueryClient replacement and the captured actor's abort.
          // Explicit listeners support mobile browsers without AbortSignal.any.
          const controller = new AbortController();
          const signals = transport.signal ? [signal, transport.signal] : [signal];
          const abort = () => controller.abort();
          for (const source of signals) source.addEventListener('abort', abort, { once: true });
          if (signals.some(source => source.aborted)) abort();
          try {
            return await whatsappAPI.getSessions(intent.scope.organizationId, undefined, { ...transport, signal: controller.signal });
          } finally {
            for (const source of signals) source.removeEventListener('abort', abort);
          }
        });
        intent.assertCurrent();
        const sessions = (response.data || []).map(session => normalizeSession(session as WhatsAppSession)) as WhatsAppSessionList;
        sessions.meta = response.meta;
        return sessions;
      },
    });
    // Query cancellation/replacement and actor/permission ABA must win over
    // this refetch. Only its still-current canonical result may mirror access.
    if (intent.isCurrent() && queryClient.getQueryData(sessionsKey) === fresh) {
      queryClient.setQueryData(accessibleKey, fresh);
    }
  } catch (error) {
    if (intent.isCurrent()) console.warn("WhatsApp authorized session refresh failed:", error);
  }
}

export function cacheSessionStatus(
  queryClient: QueryClient,
  scope: WhatsAppQueryScope,
  sessionId: string,
  status: WhatsAppResolvedSessionStatus,
) {
  queryClient.setQueryData<WhatsAppSessionList>(whatsappQueryKeys.sessions(scope), (current) => {
    const next = replaceSessionStatus(current, sessionId, status) as WhatsAppSessionList | undefined;
    if (!next || next === current) return current;
    next.meta = current?.meta;
    return next;
  });
  queryClient.setQueryData<WhatsAppSession[]>(whatsappQueryKeys.accessibleSessions(scope), (current) =>
    replaceSessionStatus(current, sessionId, status),
  );
}

