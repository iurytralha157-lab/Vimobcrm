export const SETTINGS_PAGE_TABS = [
  "account",
  "notifications",
  "team",
  "subscription",
  "integrations",
  "properties",
] as const;

export const SETTINGS_LEGACY_INTEGRATION_TABS = [
  "webhooks",
  "meta",
  "grupo-olx",
  "api",
  "whatsapp",
  "ai",
] as const;

export type SettingsPageTab = (typeof SETTINGS_PAGE_TABS)[number];
export type SettingsLegacyIntegrationTab =
  (typeof SETTINGS_LEGACY_INTEGRATION_TABS)[number];

export function normalizeSettingsTabAlias(value: string | null) {
  return value === "webhook" ? "webhooks" : value;
}

export function isSettingsPageTab(
  value: string | null,
): value is SettingsPageTab {
  return SETTINGS_PAGE_TABS.some((tab) => tab === value);
}

export function isSettingsLegacyIntegrationTab(
  value: string | null,
): value is SettingsLegacyIntegrationTab {
  return SETTINGS_LEGACY_INTEGRATION_TABS.some((tab) => tab === value);
}
