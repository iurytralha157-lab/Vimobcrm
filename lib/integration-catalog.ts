export { INTEGRATION_BRAND_ASSETS } from "../config/integrations/assets";

import type { IntegrationStatus } from "../config/integrations/types";

type GoogleCalendarConnectionLike = {
  sync_status?: string | null;
};

type GrupoOLXIntegrationLike = {
  status?: string | null;
  is_active?: boolean | null;
  last_feed_accessed_at?: string | null;
};

type ChavesNaMaoIntegrationLike = GrupoOLXIntegrationLike;

type MetaIntegrationLike = {
  is_connected?: boolean | null;
  token_status?: string | null;
};

function normalizedStatus(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function getGoogleCalendarIntegrationStatus(
  connection: GoogleCalendarConnectionLike | null | undefined,
): IntegrationStatus {
  if (!connection) return "not-connected";

  return ["idle", "syncing", "connected"].includes(
    normalizedStatus(connection.sync_status),
  )
    ? "connected"
    : "reconnect-required";
}

export function getGrupoOLXIntegrationStatus(
  integration: GrupoOLXIntegrationLike | null | undefined,
): IntegrationStatus {
  if (!integration) return "not-connected";

  const status = normalizedStatus(integration.status);
  if (status === "connected" && integration.is_active !== false) {
    return "connected";
  }
  if (["", "draft", "pending_setup"].includes(status)) {
    return "not-connected";
  }
  return "reconnect-required";
}

export function getChavesNaMaoIntegrationStatus(
  integration: ChavesNaMaoIntegrationLike | null | undefined,
): IntegrationStatus {
  return getGrupoOLXIntegrationStatus(integration);
}

export function getMetaIntegrationStatus(
  integration: MetaIntegrationLike | null | undefined,
): IntegrationStatus {
  if (!integration) return "not-connected";
  if (integration.is_connected !== true) return "reconnect-required";

  return normalizedStatus(integration.token_status ?? "active") === "active"
    ? "connected"
    : "reconnect-required";
}

export function isGoogleCalendarIntegrationConnected(
  connection: GoogleCalendarConnectionLike | null | undefined,
) {
  return getGoogleCalendarIntegrationStatus(connection) === "connected";
}

export function isGrupoOLXIntegrationConnected(
  integration: GrupoOLXIntegrationLike | null | undefined,
) {
  return getGrupoOLXIntegrationStatus(integration) === "connected";
}

export function isMetaIntegrationConnected(
  integration: MetaIntegrationLike | null | undefined,
) {
  // Older public responses did not expose token_status. Keep the same
  // compatibility rule used by Marketing while failing closed for expired,
  // invalid and error states.
  return getMetaIntegrationStatus(integration) === "connected";
}
