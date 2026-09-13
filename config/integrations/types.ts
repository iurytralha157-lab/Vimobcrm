export const INTEGRATION_PROVIDER_IDS = [
  "whatsapp",
  "ai",
  "meta",
  "grupo-olx",
  "zap",
  "viva-real",
  "olx",
  "chaves-na-mao",
  "google-calendar",
  "webhooks",
  "api",
  "chatgpt",
  "manychat",
  "google-tag-manager",
  "google-analytics",
  "google-search-console",
  "vista",
  "instagram",
  "claude",
] as const;

export type IntegrationProviderId = (typeof INTEGRATION_PROVIDER_IDS)[number];

export const INTEGRATION_CATEGORY_IDS = [
  "customer-engagement",
  "real-estate-portals",
  "automation-data",
  "site-measurement",
  "roadmap",
] as const;

export type IntegrationCategoryId = (typeof INTEGRATION_CATEGORY_IDS)[number];

export const INTEGRATION_CAPABILITIES = [
  "connection-management",
  "session-management",
  "lead-ingestion",
  "messaging",
  "ai-assistance",
  "automation",
  "form-management",
  "marketing-sync",
  "property-publication",
  "calendar-sync",
  "webhook-ingestion",
  "webhook-delivery",
  "api-access",
  "site-measurement",
  "social-sync",
] as const;

export type IntegrationCapability = (typeof INTEGRATION_CAPABILITIES)[number];

export const INTEGRATION_FEATURE_FLAGS = [
  "ENABLE_GOOGLE_CALENDAR_INTEGRATION",
] as const;

export type IntegrationFeatureFlag = (typeof INTEGRATION_FEATURE_FLAGS)[number];

export type IntegrationAvailability =
  | "available"
  | "feature-flagged"
  | "requires-homologation"
  | "disabled"
  | "coming-soon";

export type IntegrationStatus =
  | "not-connected"
  | "connected"
  | "reconnect-required"
  | "loading"
  | "error"
  | "unavailable";

export type IntegrationDefaultStatus = Extract<
  IntegrationStatus,
  "not-connected" | "unavailable"
>;

export type IntegrationModuleKey =
  | "whatsapp"
  | "ai_agent"
  | "portals"
  | "webhooks"
  | "api"
  | "site";

export type IntegrationPermissionKey =
  | "whatsapp_view"
  | "whatsapp_manage"
  | "settings_ai"
  | "settings_integrations"
  | "settings_site";

export type IntegrationSystemIconName =
  | "building"
  | "sparkles"
  | "webhook"
  | "key";

export type IntegrationIconDefinition =
  | Readonly<{
      kind: "brand";
      src: string;
      alt: string;
      fallback: string;
      fallbackClassName: string;
    }>
  | Readonly<{
      kind: "system";
      name: IntegrationSystemIconName;
      label: string;
    }>;

export type IntegrationManagementSurface =
  | Readonly<{
      kind: "route";
      href:
        | "/settings/integrations/meta"
        | "/settings/integrations/whatsapp";
    }>
  | Readonly<{ kind: "dialog" }>
  | Readonly<{ kind: "external"; href: `https://${string}` }>
  | Readonly<{ kind: "none" }>;

export interface IntegrationProviderDefinition {
  readonly title: string;
  readonly description: string;
  readonly defaultDetail: string;
  readonly category: IntegrationCategoryId;
  readonly availability: IntegrationAvailability;
  readonly defaultStatus: IntegrationDefaultStatus;
  readonly capabilities: readonly IntegrationCapability[];
  readonly featureFlag: IntegrationFeatureFlag | null;
  readonly requiredModule: IntegrationModuleKey | null;
  readonly requiredPermission: IntegrationPermissionKey | null;
  readonly requiresAdmin: boolean;
  readonly management: IntegrationManagementSurface;
  readonly icon: IntegrationIconDefinition;
}

export type IntegrationProviderCatalog = Readonly<{
  [ProviderId in IntegrationProviderId]: IntegrationProviderDefinition;
}>;

export interface IntegrationProviderManifest<
  ProviderId extends IntegrationProviderId = IntegrationProviderId,
> {
  readonly id: ProviderId;
  readonly manageKey: IntegrationProviderId;
  readonly aliasOf: IntegrationProviderId | null;
  readonly effectiveRequiresAdmin: boolean;
  readonly definition: IntegrationProviderDefinition;
}
