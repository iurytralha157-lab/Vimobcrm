import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useAccessibleSessions } from "./use-accessible-sessions";
import { whatsappAPI } from "@/lib/api/whatsapp";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import { useWhatsAppMutationIntent, type CapturedWhatsAppMutationIntent } from "@/hooks/integrations/whatsapp/use-whatsapp-mutation-intent";

const POLL_INTERVAL = 120000;
const INITIAL_SESSION_LOAD_DELAY_MS = 15000;
const ERROR_THRESHOLD = 2;

interface SessionHealthState {
  sessionId: string;
  instanceName: string;
  displayName: string;
  lastKnownStatus: string;
  consecutiveFailures: number;
  lastCheck: Date;
  notificationSent: boolean;
}

export function useWhatsAppHealthMonitor() {
  const { profile } = useAuth();
  const currentUserId = profile?.id ?? null;
  const originalOrganizationId = profile?.organization_id ?? null;
  const scope = useWhatsAppQueryScope();
  const { capture } = useWhatsAppMutationIntent();
  const scopeKey = JSON.stringify([scope.organizationId, scope.userId, scope.accessScope]);
  const queryClient = useQueryClient();
  const [monitorEnabledUserId, setMonitorEnabledUserId] = useState<string | null>(null);
  const monitorEnabled = !!currentUserId && monitorEnabledUserId === currentUserId && originalOrganizationId === scope.organizationId;
  const { data: sessions } = useAccessibleSessions({ enabled: monitorEnabled });

  const healthStatesRef = useRef<Map<string, SessionHealthState>>(new Map());
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingIntentRef = useRef<CapturedWhatsAppMutationIntent | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  useEffect(() => {
    if (!currentUserId) return undefined;

    const timeout = setTimeout(() => setMonitorEnabledUserId(currentUserId), INITIAL_SESSION_LOAD_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [currentUserId]);

  const checkSessionHealth = useCallback(async (
    intent: CapturedWhatsAppMutationIntent,
    sessionId: string,
    instanceName: string,
    displayName: string,
    provider: string = "evolution_go",
  ): Promise<boolean> => {
    void instanceName;

    try {
      if (provider !== "evolution_go") return false;
      intent.assertCurrent();
      const status = await intent.run((transport) => whatsappAPI.getConnectionStatus(sessionId, intent.scope.organizationId, transport));
      intent.assertCurrent();
      return status?.status === "connected" || status?.connected === true || status?.state === "open";
    } catch (err) {
      if (!intent.isCurrent()) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const normalized = msg.toLowerCase();
      const isTransient = msg.includes("non-2xx") || msg.includes("503") || msg.includes("temporarily unavailable");
      const isDisconnected =
        normalized.includes("client disconnected") ||
        normalized.includes("provider operation failed") ||
        normalized.includes("unable to complete whatsapp operation") ||
        normalized.includes("not connected");
      if (isTransient) {
        console.warn(`Health check transient error for ${displayName} (will retry)`);
        return true;
      }
      if (isDisconnected) {
        console.warn(`Health check detected disconnected WhatsApp for ${displayName}`);
        return false;
      }
      console.warn(`Health check error for ${displayName}:`, msg);
      return false;
    }
  }, []);

  const pollSessions = useCallback(async () => {
    if (!currentUserId || originalOrganizationId !== scope.organizationId || !sessions || sessions.length === 0 || pollingIntentRef.current?.isCurrent()) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

    const intent = capture();
    if (!intent.isCurrent()) { intent.release(); return; }
    pollingIntentRef.current = intent;
    setIsPolling(true);

    try {
      const connectedSessions = sessions.filter((s) => s.owner_user_id === currentUserId && (s.status === "connected" || s.status === "connecting"));

      for (const session of connectedSessions) {
        intent.assertCurrent();
        const healthKey = `${scopeKey}:${session.id}`;
        const state = healthStatesRef.current.get(healthKey) || {
          sessionId: session.id,
          instanceName: session.instance_name,
          displayName: session.display_name || session.instance_name,
          lastKnownStatus: session.status,
          consecutiveFailures: 0,
          lastCheck: new Date(),
          notificationSent: false,
        };

        const isConnected = await checkSessionHealth(
          intent,
          session.id,
          session.instance_name,
          state.displayName,
          session.provider,
        );

        intent.assertCurrent();
        if (isConnected) {
          const shouldRefreshSessions = state.lastKnownStatus !== "connected" && session.status !== "connected";
          state.consecutiveFailures = 0;
          state.notificationSent = false;
          state.lastKnownStatus = "connected";
          if (shouldRefreshSessions) {
            queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
            queryClient.invalidateQueries({ queryKey: ["accessible-sessions"] });
          }
        } else {
          state.consecutiveFailures++;

          if (state.consecutiveFailures >= ERROR_THRESHOLD && !state.notificationSent) {
            queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
            queryClient.invalidateQueries({ queryKey: ["accessible-sessions"] });
            state.notificationSent = true;
          }
        }

        state.lastCheck = new Date();
        healthStatesRef.current.set(healthKey, state);
      }
    } catch (error) {
      if (intent.isCurrent()) console.warn("WhatsApp health refresh failed:", error);
    } finally {
      intent.release();
      if (pollingIntentRef.current === intent) {
        pollingIntentRef.current = null;
        setIsPolling(false);
      }
    }
  }, [capture, currentUserId, originalOrganizationId, scope.organizationId, scopeKey, sessions, checkSessionHealth, queryClient]);

  const checkNow = useCallback(async () => {
    const intent = capture();
    if (!intent.isCurrent() || originalOrganizationId !== intent.scope.organizationId) { intent.release(); return; }
    if (!sessions || sessions.length === 0) {
      intent.release();
      toast.info("Nenhuma sessao WhatsApp configurada");
      return;
    }
    const toastId = toast.loading("Verificando conexoes...");
    try {
      const connectedSessions = sessions.filter((s) => s.owner_user_id === currentUserId && (s.status === "connected" || s.status === "connecting"));
      if (connectedSessions.length === 0) throw new Error("Nenhuma sessao conectada");
      let allHealthy = true;
      for (const session of connectedSessions) {
        intent.assertCurrent();
        const isConnected = await checkSessionHealth(intent, session.id, session.instance_name, session.display_name || session.instance_name, session.provider);
        if (!isConnected) allHealthy = false;
      }
      intent.assertCurrent();
      if (!allHealthy) throw new Error("Algumas sessoes estao desconectadas");
      toast.success("Todas as sessoes estao conectadas", { id: toastId });
    } catch (error) {
      if (intent.isCurrent()) toast.error(error instanceof Error ? error.message : "Não foi possível verificar as conexões.", { id: toastId });
      else toast.dismiss(toastId);
    } finally { intent.release(); }
  }, [capture, currentUserId, originalOrganizationId, sessions, checkSessionHealth]);

  useEffect(() => {
    if (!monitorEnabled || !currentUserId || !sessions) return;

    const initialTimeout = setTimeout(() => {
      pollSessions();
    }, 5000);

    pollIntervalRef.current = setInterval(pollSessions, POLL_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [monitorEnabled, currentUserId, sessions, pollSessions]);

  return { checkNow, isPolling };
}
