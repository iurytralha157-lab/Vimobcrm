import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useAccessibleSessions } from "./use-accessible-sessions";
import { notificationService } from "@/services/NotificationService";
import { whatsappAPI } from "@/lib/api/whatsapp";

const POLL_INTERVAL = 30000;
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
  const { data: sessions } = useAccessibleSessions();

  const healthStatesRef = useRef<Map<string, SessionHealthState>>(new Map());
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPollingRef = useRef(false);
  const [isPolling, setIsPolling] = useState(false);

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
      const isTransient = msg.includes("non-2xx") || msg.includes("503") || msg.includes("temporarily unavailable");
      if (isTransient) {
        console.warn(`Health check transient error for ${displayName} (will retry)`);
        return true;
      }
      console.error(`Health check error for ${displayName}:`, err);
      return false;
    }
  }, [organizationId]);

  const createDisconnectionNotification = useCallback(async (
    sessionName: string,
    ownerId: string,
    organizationId: string,
  ) => {
    try {
      await notificationService.send({
        eventKey: "whatsapp_disconnected",
        organizationId,
        userId: ownerId,
        variables: { session_name: sessionName },
      });
    } catch (err) {
      console.error("Failed to create disconnection notification:", err);
    }
  }, []);

  const pollSessions = useCallback(async () => {
    if (!profile?.id || !sessions || sessions.length === 0 || isPollingRef.current) return;

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
          state.consecutiveFailures = 0;
          state.notificationSent = false;
          state.lastKnownStatus = "connected";
          queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
          queryClient.invalidateQueries({ queryKey: ["accessible-sessions"] });
        } else {
          state.consecutiveFailures++;

          if (state.consecutiveFailures >= ERROR_THRESHOLD && !state.notificationSent) {
            toast.warning("Possivel desconexao do WhatsApp", {
              description: `A sessao "${state.displayName}" pode estar com problemas. Aguarde a verificacao automatica.`,
              duration: 10000,
            });

            await createDisconnectionNotification(
              state.displayName,
              session.owner_user_id,
              session.organization_id,
            );

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
  }, [profile?.id, sessions, checkSessionHealth, createDisconnectionNotification, queryClient]);

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
    if (!profile?.id || !sessions) return;

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
  }, [profile?.id, sessions, pollSessions]);

  return { checkNow, isPolling };
}
