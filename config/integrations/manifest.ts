import { getIntegrationManageKey } from "./aliases";
import { INTEGRATION_PROVIDER_CATALOG } from "./catalog";
import {
  INTEGRATION_PROVIDER_IDS,
  type IntegrationFeatureFlag,
  type IntegrationProviderDefinition,
  type IntegrationProviderId,
  type IntegrationProviderManifest,
} from "./types";

const INTEGRATION_PROVIDER_ID_SET = new Set<string>(INTEGRATION_PROVIDER_IDS);

export function isIntegrationProviderId(
  value: unknown,
): value is IntegrationProviderId {
  return typeof value === "string" && INTEGRATION_PROVIDER_ID_SET.has(value);
}

export function getIntegrationProviderDefinition<
  ProviderId extends IntegrationProviderId,
>(providerId: ProviderId): IntegrationProviderDefinition {
  return INTEGRATION_PROVIDER_CATALOG[providerId];
}

export function createIntegrationProviderManifest<
  ProviderId extends IntegrationProviderId,
>(providerId: ProviderId): IntegrationProviderManifest<ProviderId> {
  const manageKey = getIntegrationManageKey(providerId);

  return Object.freeze({
    id: providerId,
    manageKey,
    aliasOf: manageKey === providerId ? null : manageKey,
    effectiveRequiresAdmin:
      INTEGRATION_PROVIDER_CATALOG[manageKey].requiresAdmin,
    definition: INTEGRATION_PROVIDER_CATALOG[providerId],
  });
}

export function isIntegrationFeatureEnabled(
  providerId: IntegrationProviderId,
  flags: Readonly<Partial<Record<IntegrationFeatureFlag, boolean>>>,
) {
  const featureFlag = INTEGRATION_PROVIDER_CATALOG[providerId].featureFlag;
  return featureFlag === null || flags[featureFlag] === true;
}

export function isIntegrationAvailableByDefault(
  providerId: IntegrationProviderId,
) {
  const availability = INTEGRATION_PROVIDER_CATALOG[providerId].availability;
  return availability === "available" || availability === "feature-flagged";
}
