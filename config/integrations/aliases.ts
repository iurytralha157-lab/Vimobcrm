import type { IntegrationProviderId } from "./types";

export const INTEGRATION_MANAGE_KEY_ALIASES = {
  zap: "grupo-olx",
  "viva-real": "grupo-olx",
  olx: "grupo-olx",
} as const satisfies Partial<Record<IntegrationProviderId, IntegrationProviderId>>;

export type IntegrationAliasId = keyof typeof INTEGRATION_MANAGE_KEY_ALIASES;

export function isIntegrationAlias(
  providerId: IntegrationProviderId,
): providerId is IntegrationAliasId {
  return Object.prototype.hasOwnProperty.call(
    INTEGRATION_MANAGE_KEY_ALIASES,
    providerId,
  );
}

export function getIntegrationManageKey(
  providerId: IntegrationProviderId,
): IntegrationProviderId {
  if (!isIntegrationAlias(providerId)) return providerId;
  return INTEGRATION_MANAGE_KEY_ALIASES[providerId];
}
