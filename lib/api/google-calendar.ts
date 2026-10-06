import { FEATURES } from "@/config/constants";
import { VimobAPIError, vimobAPIRequest } from "@/lib/api/vimob-client";

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

export interface GoogleCalendarStatus {
  connection: GoogleCalendarConnectionStatus | null;
  can_connect: boolean;
}

type GoogleCalendarFunctionResponse<T = unknown> = {
  success: boolean;
  error?: string;
} & T;

const GOOGLE_CALENDAR_OAUTH_PROXY_PATH =
  "/v1/integrations/google-calendar/functions/google-calendar-oauth";
const GOOGLE_CALENDAR_DISABLED_MESSAGE =
  "Integração com Google Agenda desativada temporariamente.";

function assertGoogleCalendarEnabled() {
  if (!FEATURES.ENABLE_GOOGLE_CALENDAR_INTEGRATION) {
    throw new Error(GOOGLE_CALENDAR_DISABLED_MESSAGE);
  }
}

function requireOrganizationId(organizationId?: string | null) {
  const normalized = organizationId?.trim();
  if (!normalized) throw new Error("Organização ativa não encontrada.");
  return normalized;
}

export function isGoogleCalendarServiceUnavailable(error: unknown) {
  return error instanceof VimobAPIError && (
    error.code === "google_calendar_function_unavailable" ||
    (error.status === 404 && error.code === "api_error")
  );
}

async function invokeGoogleCalendar<T>(
  path: string,
  organizationId: string,
  body: Record<string, unknown>,
  timeoutMs = 30_000,
) {
  assertGoogleCalendarEnabled();

  const data = await vimobAPIRequest<GoogleCalendarFunctionResponse<T>>(path, {
    method: "POST",
    organizationId: requireOrganizationId(organizationId),
    body,
    timeoutMs,
  });
  if (!data?.success) {
    throw new Error(data?.error || "Falha na integração com o Google Agenda.");
  }
  return data;
}

export function buildGoogleCalendarReturnUrl(currentHref: string) {
  const returnUrl = new URL(currentHref);
  returnUrl.searchParams.delete("google_calendar_connected");
  returnUrl.searchParams.delete("google_calendar_error");
  returnUrl.searchParams.delete("google_calendar_warning");

  if (returnUrl.pathname === "/settings" || returnUrl.pathname.startsWith("/settings/")) {
    returnUrl.searchParams.set("tab", "integrations");
    returnUrl.searchParams.set("integration", "google-calendar");
  }

  return returnUrl.toString();
}

export const googleCalendarAPI = {
  async getStatus(organizationId: string) {
    const data = await invokeGoogleCalendar<GoogleCalendarStatus>(
      GOOGLE_CALENDAR_OAUTH_PROXY_PATH,
      organizationId,
      { action: "status" },
    );
    return {
      connection: data.connection,
      can_connect: data.can_connect === true,
    };
  },

  getAuthUrl(organizationId: string, returnUrl: string) {
    return invokeGoogleCalendar<{ auth_url: string }>(
      GOOGLE_CALENDAR_OAUTH_PROXY_PATH,
      organizationId,
      { action: "get_auth_url", return_url: returnUrl },
    );
  },

  disconnect(organizationId: string, connectionId?: string) {
    return invokeGoogleCalendar(
      GOOGLE_CALENDAR_OAUTH_PROXY_PATH,
      organizationId,
      { action: "disconnect", connection_id: connectionId },
    );
  },

};
