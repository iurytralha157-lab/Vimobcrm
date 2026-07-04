import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useAccessibleSessions } from "./use-accessible-sessions";
import { whatsappAPI } from "@/lib/api/whatsapp";

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
  const organizationId = profile?.organization_id;
  const queryClient = useQueryClient();
  const [monitorEnabledUserId, setMonitorEnabledUserId] = useState<string | null>(null);
  const monitorEnabled = !!profile?.id && monitorEnabledUserId === profile.id;
  const { data: sessions } = useAccessibleSessions({ enabled: monitorEnabled });

  const healthStatesRef = useRef<Map<string, SessionHealthState>>(new Map());
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPollingRef = useRef(false);
  const [isPolling, setIsPolling] = useState(false);

  useEffect(() => {
    if (!profile?.id) return undefined;

    const timeout = setTimeout(() => setMonitorEnabledUserId(profile.id), INITIAL_SESSION_LOAD_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [profile?.id]);

  const checkSessionHealth = useCallback(async (
    sessionId: string,
    instanceName: string,
    displayName: string,
    provider: string = "evolution_go",
  ): Promise<boolean> => {
    void instanceName;

    try {
      if (provider !== "evolution_go") return false;
      const status = await whatsappAPI.getConnectionStatus(sessionId, organizationId);
      return status?.status === "connected" || status?.connected === true || status?.state === "open";
    } catch (err) {
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
  }, [organizationId]);

  const pollSessions = useCallback(async () => {
    if (!profile?.id || !sessions || sessions.length === 0 || isPollingRef.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

    isPollingRef.current = true;
    setIsPolling(true);

    try {
      const connectedSessions = sessions.filter((s) => s.status === "connected" || s.status === "connecting");

      for (const session of connectedSessions) {
        const state = healthStatesRef.current.get(session.id) || {
          sessionId: session.id,
          instanceName: session.instance_name,
          displayName: session.display_name || session.instance_name,
          lastKnownStatus: session.status,
          consecutiveFailures: 0,
          lastCheck: new Date(),
          notificationSent: false,
        };

        const isConnected = await checkSessionHealth(
          session.id,
          session.instance_name,
          state.displayName,
          session.provider,
        );

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
        healthStatesRef.current.set(session.id, state);
      }
    } finally {
      isPollingRef.current = false;
      setIsPolling(false);
    }
  }, [profile?.id, sessions, checkSessionHealth, queryClient]);

  const checkNow = useCallback(async () => {
    if (!sessions || sessions.length === 0) {
      toast.info("Nenhuma sessao WhatsApp configurada");
      return;
    }

    toast.promise(
      (async () => {
        const connectedSessions = sessions.filter((s) => s.status === "connected" || s.status === "connecting");
        if (connectedSessions.length === 0) throw new Error("Nenhuma sessao conectada");

        let allHealthy = true;
        for (const session of connectedSessions) {
          const displayName = session.display_name || session.instance_name;
          const isConnected = await checkSessionHealth(
            session.id,
            session.instance_name,
            displayName,
            session.provider,
          );
          if (!isConnected) allHealthy = false;
        }

        if (!allHealthy) throw new Error("Algumas sessoes estao desconectadas");
        return "Todas as sessoes estao conectadas";
      })(),
      {
        loading: "Verificando conexoes...",
        success: (msg) => msg,
        error: (err) => err.message,
      },
    );
  }, [sessions, checkSessionHealth]);

  useEffect(() => {
    if (!monitorEnabled || !profile?.id || !sessions) return;

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
  }, [monitorEnabled, profile?.id, sessions, pollSessions]);

  return { checkNow, isPolling };
}
