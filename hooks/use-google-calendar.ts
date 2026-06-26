import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { integrationsAPI } from "@/lib/api";
import { toast } from "sonner";

export interface GoogleCalendarConnectionStatus {
  id: string;
  organization_id: string;
  user_id: string;
  account_email: string | null;
  account_picture_url: string | null;
  calendar_id: string;
  calendar_summary: string | null;
  sync_enabled: boolean;
  sync_status: "idle" | "syncing" | "connected" | "error" | "disconnected";
  connected_at: string;
  disconnected_at: string | null;
  last_synced_at: string | null;
  watch_expires_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

type GoogleCalendarFunctionResponse<T = unknown> = {
  success: boolean;
  error?: string;
} & T;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Erro desconhecido";
}

async function invokeGoogleCalendar<T>(body: Record<string, unknown>) {
  const data = await integrationsAPI.invokeFunction<GoogleCalendarFunctionResponse<T>>("google-calendar-oauth", body);
  if (!data?.success) throw new Error(data?.error || "Falha na integracao Google Calendar");
  return data;
}

export function useGoogleCalendarStatus() {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["google-calendar-status", profile?.id],
    queryFn: async () => {
      if (!profile?.id) return null;
      const data = await invokeGoogleCalendar<{ connection: GoogleCalendarConnectionStatus | null }>({ action: "status" });
      return data.connection;
    },
    enabled: !!profile?.id,
    staleTime: 1000 * 60,
  });
}

export function useConnectGoogleCalendar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const returnUrl = window.location.href;
      return invokeGoogleCalendar<{ auth_url: string }>({
        action: "get_auth_url",
        return_url: returnUrl,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      window.location.href = data.auth_url;
    },
    onError: (error) => {
      console.error("Error connecting Google Calendar:", error);
      toast.error(`Erro ao conectar Google Calendar: ${getErrorMessage(error)}`);
    },
  });
}

export function useDisconnectGoogleCalendar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (connectionId?: string) => {
      await invokeGoogleCalendar({
        action: "disconnect",
        connection_id: connectionId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      toast.success("Google Calendar desconectado");
    },
    onError: (error) => {
      console.error("Error disconnecting Google Calendar:", error);
      toast.error(`Erro ao desconectar: ${getErrorMessage(error)}`);
    },
  });
}

export function useToggleGoogleCalendarSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (syncEnabled: boolean) => {
      await invokeGoogleCalendar({
        action: "set_sync_enabled",
        sync_enabled: syncEnabled,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      toast.success("Sincronizacao atualizada");
    },
    onError: (error) => {
      console.error("Error toggling Google Calendar sync:", error);
      toast.error(`Erro ao atualizar sincronizacao: ${getErrorMessage(error)}`);
    },
  });
}

export function useSyncGoogleCalendarNow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return invokeGoogleCalendar({
        action: "sync_now",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      queryClient.invalidateQueries({ queryKey: ["schedule-events"] });
      toast.success("Google Calendar sincronizado");
    },
    onError: (error) => {
      console.error("Error syncing Google Calendar:", error);
      toast.error(`Erro ao sincronizar: ${getErrorMessage(error)}`);
    },
  });
}
