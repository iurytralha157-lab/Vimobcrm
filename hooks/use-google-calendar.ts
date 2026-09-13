import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { invalidateScheduleDashboardCaches } from "@/hooks/schedule/invalidate-schedule-dashboard";
import { getErrorObjectMessage as getErrorMessage } from "@/lib/api/vimob-error";
import { FEATURES } from "@/config/constants";
import {
  buildGoogleCalendarReturnUrl,
  googleCalendarAPI,
  type GoogleCalendarConnectionStatus,
} from "@/lib/api/google-calendar";
import { toast } from "sonner";

export type { GoogleCalendarConnectionStatus };

export function useGoogleCalendarStatus(options: { enabled?: boolean } = {}) {
  const { activeOrganization, profile } = useAuth();

  return useQuery({
    queryKey: [
      "google-calendar-status",
      activeOrganization.organizationId,
      profile?.id,
    ],
    queryFn: async () => {
      if (!profile?.id || !activeOrganization.organizationId) return null;
      if (!FEATURES.ENABLE_GOOGLE_CALENDAR_INTEGRATION) return null;
      return googleCalendarAPI.getStatus(activeOrganization.organizationId);
    },
    enabled:
      options.enabled !== false &&
      !!profile?.id &&
      !!activeOrganization.organizationId &&
      FEATURES.ENABLE_GOOGLE_CALENDAR_INTEGRATION,
    staleTime: 1000 * 60,
  });
}

export function useConnectGoogleCalendar() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!activeOrganization.organizationId) {
        throw new Error("Organização ativa não encontrada.");
      }
      return googleCalendarAPI.getAuthUrl(
        activeOrganization.organizationId,
        buildGoogleCalendarReturnUrl(window.location.href),
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      window.location.href = data.auth_url;
    },
    onError: (error) => {
      console.error("Error connecting Google Agenda:", error);
      toast.error(`Erro ao conectar Google Agenda: ${getErrorMessage(error)}`);
    },
  });
}

export function useDisconnectGoogleCalendar() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();

  return useMutation({
    mutationFn: async (connectionId?: string) => {
      if (!activeOrganization.organizationId) {
        throw new Error("Organização ativa não encontrada.");
      }
      await googleCalendarAPI.disconnect(
        activeOrganization.organizationId,
        connectionId,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      toast.success("Google Agenda desconectada");
    },
    onError: (error) => {
      console.error("Error disconnecting Google Agenda:", error);
      toast.error(`Erro ao desconectar: ${getErrorMessage(error)}`);
    },
  });
}

export function useToggleGoogleCalendarSync() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();

  return useMutation({
    mutationFn: async (syncEnabled: boolean) => {
      if (!activeOrganization.organizationId) {
        throw new Error("Organização ativa não encontrada.");
      }
      await googleCalendarAPI.setSyncEnabled(
        activeOrganization.organizationId,
        syncEnabled,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      toast.success("Sincronização atualizada");
    },
    onError: (error) => {
      console.error("Error toggling Google Agenda sync:", error);
      toast.error(`Erro ao atualizar sincronizacao: ${getErrorMessage(error)}`);
    },
  });
}

export function useSyncGoogleCalendarNow() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!activeOrganization.organizationId) {
        throw new Error("Organização ativa não encontrada.");
      }
      return googleCalendarAPI.syncNow(activeOrganization.organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      queryClient.invalidateQueries({ queryKey: ["schedule-events"] });
      invalidateScheduleDashboardCaches(queryClient);
      toast.success("Google Agenda sincronizada");
    },
    onError: (error) => {
      console.error("Error syncing Google Agenda:", error);
      toast.error(`Erro ao sincronizar: ${getErrorMessage(error)}`);
    },
  });
}
