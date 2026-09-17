import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Building2,
  Key,
  Lock,
  RefreshCw,
  Settings2,
  Sparkles,
  Webhook,
} from "lucide-react";
import NextImage from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { WebhooksIntegrationSettings } from "@/components/features/integrations/webhooks";
import { APIAccessIntegrationSettings } from "@/components/features/integrations/api-access";
import { AIAssistantTab } from "@/components/features/settings/AIAssistantTab";
import { GrupoOLXIntegrationSettings } from "@/components/features/integrations/grupo-olx";
import { GoogleCalendarIntegrationSettings } from "@/components/features/integrations/google-calendar";
import { GoogleAnalyticsIntegrationSettings } from "@/components/features/integrations/google-analytics";
import { GoogleSearchConsoleIntegrationSettings } from "@/components/features/integrations/google-search-console";
import { GoogleTagManagerIntegrationSettings } from "@/components/features/integrations/google-tag-manager";
import { ChavesNaMaoIntegrationSettings } from "@/components/features/integrations/chaves-na-mao";
import {
  useMetaIntegrations,
  type MetaAdAccount,
  type MetaPage,
} from "@/hooks/integrations/meta";
import { useWhatsAppSessions } from "@/hooks/integrations/whatsapp";
import { useGoogleCalendarStatus } from "@/hooks/integrations/google-calendar";
import { useGrupoOLXIntegration } from "@/hooks/integrations/grupo-olx";
import { useGoogleAnalyticsIntegration } from "@/hooks/integrations/google-analytics";
import { useGoogleSearchConsoleIntegration } from "@/hooks/integrations/google-search-console";
import { useGoogleTagManagerIntegration } from "@/hooks/integrations/google-tag-manager";
import { useAPIKeys } from "@/hooks/integrations/api-access";
import { useWebhooks } from "@/hooks/integrations/webhooks";
import { useChavesNaMaoIntegration } from "@/hooks/integrations/chaves-na-mao";
import { FEATURES } from "@/config/constants";
import {
  INTEGRATION_CAPABILITY_LABELS,
  INTEGRATION_CATEGORY_CATALOG,
  INTEGRATION_CATEGORY_IDS,
  INTEGRATION_PROVIDER_IDS,
  createIntegrationProviderManifest,
  getIntegrationManageKey,
  getIntegrationProviderDefinition,
  isIntegrationAvailableByDefault,
  isIntegrationFeatureEnabled,
  isIntegrationProviderId,
  type IntegrationAvailability,
  type IntegrationCapability,
  type IntegrationCategoryId,
  type IntegrationIconDefinition,
  type IntegrationManagementSurface,
  type IntegrationProviderId,
  type IntegrationStatus,
} from "@/config/integrations";
import { normalizeSearchText } from "@/lib/search-text";
import { isChavesNaMaoHomologationRequired } from "@/lib/api";
import {
  getChavesNaMaoIntegrationStatus,
  getGoogleCalendarIntegrationStatus,
  getGrupoOLXIntegrationStatus,
  getMetaIntegrationStatus,
} from "@/lib/integration-catalog";

type IntegrationKey = IntegrationProviderId;

const INTEGRATION_FEATURE_STATE = {
  ENABLE_GOOGLE_CALENDAR_INTEGRATION:
    FEATURES.ENABLE_GOOGLE_CALENDAR_INTEGRATION,
} as const;

const ADMIN_ONLY_INTEGRATIONS = new Set<IntegrationKey>(
  INTEGRATION_PROVIDER_IDS.filter(
    (providerId) =>
      createIntegrationProviderManifest(providerId).effectiveRequiresAdmin,
  ),
);

const TEMPORARILY_DISABLED_INTEGRATIONS = new Set<IntegrationKey>(
  INTEGRATION_PROVIDER_IDS.filter(
    (providerId) =>
      providerId !== "chaves-na-mao" &&
      (!isIntegrationAvailableByDefault(providerId) ||
        !isIntegrationFeatureEnabled(providerId, INTEGRATION_FEATURE_STATE)),
  ),
);

const GOOGLE_SITE_CONFIGURATION_IDS = new Set<IntegrationKey>([
  "google-analytics",
  "google-tag-manager",
  "google-search-console",
]);

interface MetaOAuthPayload {
  pages?: MetaPage[];
  ad_accounts?: MetaAdAccount[];
  flow_id?: string;
  adAccountId?: string;
  ad_account_id?: string;
  facebook_user_id?: string;
  facebook_user_name?: string;
}

interface MetaOAuthStatus {
  status?: string;
  flowId?: string | null;
  error?: string | null;
  nonce?: number;
}

interface MetaOAuthWindowMessage {
  type?: string;
  data?: MetaOAuthPayload | null;
  status?: string;
  flowId?: string | null;
  error?: string | null;
  nonce?: number;
}

const META_OAUTH_CHANNEL = "vimob-meta-oauth";
const META_OAUTH_STORAGE_KEY = "vimob:meta-oauth";

function sanitizeMetaOAuthPayload(
  payload?: MetaOAuthPayload | null,
): MetaOAuthPayload | null {
  const flowId = payload?.flow_id?.trim();
  if (!flowId) return null;
  return {
    flow_id: flowId,
    pages: (payload?.pages || []).map((page) => ({
      id: page.id,
      name: page.name,
      picture: page.picture,
      facebook_user_id: page.facebook_user_id,
      facebook_user_name: page.facebook_user_name,
    })),
    ad_accounts: (payload?.ad_accounts || [])
      .filter((account) => Boolean(account.id?.trim()))
      .map((account) => ({
        id: account.id.trim(),
        account_id: account.account_id,
        name: account.name,
        account_status: account.account_status,
        currency: account.currency,
        timezone_name: account.timezone_name,
      })),
    adAccountId: payload?.adAccountId || payload?.ad_account_id,
    facebook_user_id: payload?.facebook_user_id,
    facebook_user_name: payload?.facebook_user_name,
  };
}

function publishMetaOAuthReturn(message: MetaOAuthWindowMessage) {
  const payload = { ...message, nonce: message.nonce ?? Date.now() };

  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(payload, window.location.origin);
  }

  try {
    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel(META_OAUTH_CHANNEL);
      channel.postMessage(payload);
      channel.close();
    }
  } catch {
    // BroadcastChannel can be unavailable in restricted browser modes.
  }

  try {
    window.localStorage.setItem(
      META_OAUTH_STORAGE_KEY,
      JSON.stringify(payload),
    );
    window.localStorage.removeItem(META_OAUTH_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in restricted browser modes; postMessage/BroadcastChannel still cover normal flow.
  }
}

interface IntegrationItem {
  key: IntegrationKey;
  title: string;
  description: string;
  enabled: boolean;
  status: IntegrationStatus;
  detail: string;
  icon: import("react").ReactNode;
  category: IntegrationCategoryId;
  capabilities: readonly IntegrationCapability[];
  availability: IntegrationAvailability;
  management: IntegrationManagementSurface;
  requiresAdmin?: boolean;
  locked?: boolean;
  missingModule?: boolean;
  retry?: () => void;
}

interface IntegrationsTabProps {
  defaultIntegration?: string;
  onCloseIntegration?: () => void;
  hasWhatsAppModule: boolean;
  hasAIModule: boolean;
  hasWebhooksModule: boolean;
  hasAPIModule: boolean;
  hasPortalsModule: boolean;
  hasSiteModule: boolean;
  canManageIntegrations: boolean;
  canViewWhatsApp: boolean;
  canManageAI: boolean;
  canManageSite: boolean;
  search: string;
}

export function IntegrationsTab({
  defaultIntegration,
  onCloseIntegration,
  hasWhatsAppModule,
  hasAIModule,
  hasWebhooksModule,
  hasAPIModule,
  hasPortalsModule,
  hasSiteModule,
  canManageIntegrations,
  canViewWhatsApp,
  canManageAI,
  canManageSite,
  search,
}: IntegrationsTabProps) {
  const router = useRouter();
  const canManageAdminIntegrations = canManageIntegrations;
  const requestedDefaultIntegrationKey = isIntegrationKey(defaultIntegration)
    ? defaultIntegration
    : null;
  const defaultIntegrationKey = requestedDefaultIntegrationKey
    ? getIntegrationManageKey(requestedDefaultIntegrationKey)
    : null;
  const {
    data: metaIntegrations = [],
    isLoading: metaIntegrationsLoading,
    isError: metaIntegrationsLoadFailed,
    refetch: refetchMetaIntegrations,
  } = useMetaIntegrations({ enabled: canManageIntegrations });
  const {
    data: whatsappSessions = [],
    isLoading: whatsappSessionsLoading,
    isError: whatsappSessionsLoadFailed,
    refetch: refetchWhatsAppSessions,
  } = useWhatsAppSessions({ enabled: canViewWhatsApp });
  const {
    data: googleCalendarStatus,
    isLoading: googleCalendarLoading,
    isError: googleCalendarLoadFailed,
    refetch: refetchGoogleCalendar,
  } = useGoogleCalendarStatus();
  const {
    data: grupoOLXIntegration,
    isLoading: grupoOLXLoading,
    isError: grupoOLXLoadFailed,
    refetch: refetchGrupoOLX,
  } = useGrupoOLXIntegration({
    enabled: canManageIntegrations && hasPortalsModule,
  });
  const {
    data: chavesNaMaoIntegration,
    error: chavesNaMaoError,
    isLoading: chavesNaMaoLoading,
    isError: chavesNaMaoLoadFailed,
    isSuccess: chavesNaMaoLoadSucceeded,
    refetch: refetchChavesNaMao,
  } = useChavesNaMaoIntegration({
    enabled: canManageIntegrations && hasPortalsModule,
  });
  const chavesNaMaoHomologationRequired =
    isChavesNaMaoHomologationRequired(chavesNaMaoError);
  const googleSiteQueriesEnabled = canManageSite && hasSiteModule;
  const {
    data: googleAnalyticsIntegration,
    isLoading: googleAnalyticsLoading,
    isError: googleAnalyticsLoadFailed,
    refetch: refetchGoogleAnalytics,
  } = useGoogleAnalyticsIntegration({ enabled: googleSiteQueriesEnabled });
  const {
    data: googleTagManagerIntegration,
    isLoading: googleTagManagerLoading,
    isError: googleTagManagerLoadFailed,
    refetch: refetchGoogleTagManager,
  } = useGoogleTagManagerIntegration({ enabled: googleSiteQueriesEnabled });
  const {
    data: googleSearchConsoleIntegration,
    isLoading: googleSearchConsoleLoading,
    isError: googleSearchConsoleLoadFailed,
    refetch: refetchGoogleSearchConsole,
  } = useGoogleSearchConsoleIntegration({ enabled: googleSiteQueriesEnabled });
  const {
    data: webhookIntegrations = [],
    isLoading: webhookIntegrationsLoading,
    isError: webhookIntegrationsLoadFailed,
    refetch: refetchWebhooks,
  } = useWebhooks({ enabled: canManageIntegrations && hasWebhooksModule });
  const {
    data: apiKeys = [],
    isLoading: apiKeysLoading,
    isError: apiKeysLoadFailed,
    refetch: refetchAPIKeys,
  } = useAPIKeys({ enabled: canManageIntegrations && hasAPIModule });
  const whatsappQuota = whatsappSessions.meta;
  const hasWhatsAppAccess =
    hasWhatsAppModule || whatsappQuota?.maxSessions !== undefined;
  const hasIntegrationPermission = useCallback(
    (key: IntegrationKey) => {
      const permission = getIntegrationProviderDefinition(key).requiredPermission;
      if (permission === "whatsapp_view") return canViewWhatsApp;
      if (permission === "whatsapp_manage") return canViewWhatsApp;
      if (permission === "settings_ai") return canManageAI;
      if (permission === "settings_site") return canManageSite;
      if (permission === "settings_integrations") return canManageIntegrations;
      return true;
    },
    [canManageAI, canManageIntegrations, canManageSite, canViewWhatsApp],
  );
  const hasIntegrationModule = useCallback(
    (key: IntegrationKey) => {
      const moduleKey = getIntegrationProviderDefinition(key).requiredModule;
      if (moduleKey === "whatsapp") return hasWhatsAppAccess;
      if (moduleKey === "ai_agent") return hasAIModule;
      if (moduleKey === "webhooks") return hasWebhooksModule;
      if (moduleKey === "api") return hasAPIModule;
      if (moduleKey === "portals") return hasPortalsModule;
      if (moduleKey === "site") return hasSiteModule;
      return true;
    },
    [
      hasAIModule,
      hasAPIModule,
      hasPortalsModule,
      hasSiteModule,
      hasWebhooksModule,
      hasWhatsAppAccess,
    ],
  );
  const isIntegrationEnabled = useCallback(
    (key: IntegrationKey) => {
      if (
        !isIntegrationAvailableByDefault(key) ||
        !isIntegrationFeatureEnabled(key, INTEGRATION_FEATURE_STATE)
      ) {
        return false;
      }
      return hasIntegrationPermission(key) && hasIntegrationModule(key);
    },
    [hasIntegrationModule, hasIntegrationPermission],
  );
  const defaultIntegrationUnavailable =
    requestedDefaultIntegrationKey !== null &&
    requestedDefaultIntegrationKey !== "chaves-na-mao" &&
    (!isIntegrationEnabled(requestedDefaultIntegrationKey) ||
      TEMPORARILY_DISABLED_INTEGRATIONS.has(requestedDefaultIntegrationKey));
  const defaultIntegrationLocked =
    requestedDefaultIntegrationKey !== null &&
    ((ADMIN_ONLY_INTEGRATIONS.has(
      getIntegrationManageKey(requestedDefaultIntegrationKey),
    ) &&
      !canManageAdminIntegrations) ||
      (requestedDefaultIntegrationKey === "chaves-na-mao" &&
        (!hasIntegrationPermission(requestedDefaultIntegrationKey) ||
          !hasIntegrationModule(requestedDefaultIntegrationKey))));
  const [, setMetaOAuthPayload] = useState<MetaOAuthPayload | null>(null);
  const [, setMetaOAuthStatus] = useState<MetaOAuthStatus | null>(null);
  const [activeIntegration, setActiveIntegration] =
    useState<IntegrationKey | null>(
      defaultIntegrationKey &&
        !defaultIntegrationLocked &&
        !defaultIntegrationUnavailable
        ? defaultIntegrationKey
        : null,
    );
  const handledMetaOAuthEventRef = useRef<string | number | null>(null);
  const openedDefaultIntegrationRef = useRef<IntegrationKey | null>(null);
  const disabledIntegrations = TEMPORARILY_DISABLED_INTEGRATIONS;

  useEffect(() => {
    if (
      !defaultIntegrationKey ||
      defaultIntegrationLocked ||
      defaultIntegrationUnavailable
    ) {
      openedDefaultIntegrationRef.current = null;
      if (
        defaultIntegrationKey &&
        activeIntegration === defaultIntegrationKey
      ) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Mantem links diretos para modulos indisponiveis sem modal vazio.
        setActiveIntegration(null);
      }
      return;
    }

    if (openedDefaultIntegrationRef.current !== defaultIntegrationKey) {
      openedDefaultIntegrationRef.current = defaultIntegrationKey;
      setActiveIntegration(defaultIntegrationKey);
    }
  }, [
    activeIntegration,
    defaultIntegrationKey,
    defaultIntegrationLocked,
    defaultIntegrationUnavailable,
  ]);

  const closeIntegration = useCallback(() => {
    setActiveIntegration(null);
    onCloseIntegration?.();
  }, [onCloseIntegration]);

  const handleMetaOAuthMessage = useCallback(
    (message: MetaOAuthWindowMessage) => {
      if (!message?.type) return;
      const eventKey =
        message.nonce ??
        `${message.type}:${message.flowId ?? ""}:${message.status ?? ""}:${message.error ?? ""}:${message.data?.facebook_user_id ?? ""}`;
      if (handledMetaOAuthEventRef.current === eventKey) return;
      handledMetaOAuthEventRef.current = eventKey;

      if (message.type === "META_OAUTH_SUCCESS") {
        const payload = sanitizeMetaOAuthPayload(message.data);
        if (!payload) {
          setMetaOAuthStatus({
            status: "error",
            error:
              "O retorno antigo da Meta foi bloqueado por segurança. Inicie a conexão novamente.",
            nonce: Date.now(),
          });
        } else {
          setMetaOAuthPayload(payload);
        }
        setActiveIntegration("meta");
        return;
      }

      if (message.type === "META_OAUTH_STATUS") {
        setMetaOAuthStatus({
          status: message.status,
          flowId: message.flowId,
          error: message.error,
          nonce: message.nonce ?? Date.now(),
        });
        setActiveIntegration("meta");
        refetchMetaIntegrations();
      }
    },
    [refetchMetaIntegrations],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hasLegacyPayload = params.has("meta_oauth_data");
    const status = params.get("meta_oauth_status");
    const flowId = params.get("meta_oauth_flow_id");
    const error = params.get("meta_oauth_error");
    const isOAuthPopupReturn = params.get("meta_oauth_popup") === "1";
    if (!hasLegacyPayload && !status && !flowId && !error) return;

    try {
      const oauthStatus: MetaOAuthStatus = {
        status:
          hasLegacyPayload && !flowId
            ? "error"
            : status || (flowId ? "success" : undefined),
        flowId,
        error:
          hasLegacyPayload && !flowId
            ? "O retorno antigo da Meta foi bloqueado por segurança. Inicie a conexão novamente."
            : error,
        nonce: Date.now(),
      };

      if ((window.opener && !window.opener.closed) || isOAuthPopupReturn) {
        publishMetaOAuthReturn({ type: "META_OAUTH_STATUS", ...oauthStatus });
        window.close();
        return;
      }

      /* eslint-disable react-hooks/set-state-in-effect -- Consome o retorno OAuth da URL apenas uma vez ao abrir a tela. */
      setMetaOAuthStatus(oauthStatus);
      setActiveIntegration("meta");
      /* eslint-enable react-hooks/set-state-in-effect */
      refetchMetaIntegrations();
    } catch (error) {
      console.error("Invalid Meta OAuth payload", error);
    } finally {
      params.delete("meta_oauth_data");
      params.delete("meta_oauth_status");
      params.delete("meta_oauth_flow_id");
      params.delete("meta_oauth_error");
      params.delete("meta_oauth_popup");
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${params.toString() ? `?${params}` : ""}`,
      );
    }
  }, [refetchMetaIntegrations]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      handleMetaOAuthMessage(event.data as MetaOAuthWindowMessage);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== META_OAUTH_STORAGE_KEY || !event.newValue) return;
      try {
        handleMetaOAuthMessage(
          JSON.parse(event.newValue) as MetaOAuthWindowMessage,
        );
      } catch {
        // Ignore malformed cross-window events.
      }
    };

    window.addEventListener("message", handleMessage);
    window.addEventListener("storage", handleStorage);

    let channel: BroadcastChannel | null = null;
    try {
      if ("BroadcastChannel" in window) {
        channel = new BroadcastChannel(META_OAUTH_CHANNEL);
        channel.onmessage = (event) =>
          handleMetaOAuthMessage(event.data as MetaOAuthWindowMessage);
      }
    } catch {
      channel = null;
    }

    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
      channel?.close();
    };
  }, [handleMetaOAuthMessage]);

  const integrations = useMemo<IntegrationItem[]>(() => {
    const connectedMetaPages = metaIntegrations.filter(
      (integration) => getMetaIntegrationStatus(integration) === "connected",
    ).length;
    const metaStatus: IntegrationStatus =
      metaIntegrations.length === 0
        ? "not-connected"
        : connectedMetaPages === metaIntegrations.length
          ? "connected"
          : "reconnect-required";
    const connectedWhatsAppSessions = whatsappSessions.filter(
      (item) => item.status === "connected",
    ).length;
    const whatsappStatus: IntegrationStatus =
      connectedWhatsAppSessions > 0
        ? "connected"
        : whatsappSessions.length > 0
          ? "reconnect-required"
          : "not-connected";
    const googleCalendarRuntimeStatus =
      getGoogleCalendarIntegrationStatus(googleCalendarStatus);
    const grupoOLXRuntimeStatus =
      getGrupoOLXIntegrationStatus(grupoOLXIntegration);
    const chavesNaMaoRuntimeStatus =
      getChavesNaMaoIntegrationStatus(chavesNaMaoIntegration);

    return INTEGRATION_PROVIDER_IDS.map((key) => {
      const definition = getIntegrationProviderDefinition(key);
      const manifest = createIntegrationProviderManifest(key);
      const availableByRelease =
        (isIntegrationAvailableByDefault(key) ||
          (key === "chaves-na-mao" &&
            (chavesNaMaoLoading ||
              chavesNaMaoLoadSucceeded ||
              (chavesNaMaoLoadFailed &&
                !chavesNaMaoHomologationRequired)))) &&
        isIntegrationFeatureEnabled(key, INTEGRATION_FEATURE_STATE);
      const exposesFailClosedConfiguration = key === "chaves-na-mao";
      const shouldEnforceAccess =
        availableByRelease || exposesFailClosedConfiguration;
      const locked = shouldEnforceAccess && !hasIntegrationPermission(key);
      const missingModule =
        shouldEnforceAccess && !locked && !hasIntegrationModule(key);
      let status: IntegrationStatus = definition.defaultStatus;
      let detail = definition.defaultDetail;
      let loading = false;
      let loadError = false;
      let retry: (() => void) | undefined;

      switch (key) {
        case "whatsapp":
          status = whatsappStatus;
          loading = whatsappSessionsLoading;
          loadError = whatsappSessionsLoadFailed;
          retry = () => void refetchWhatsAppSessions();
          detail = `${connectedWhatsAppSessions} conectada${
            connectedWhatsAppSessions === 1 ? "" : "s"
          } de ${whatsappSessions.length}`;
          break;
        case "ai":
          status = whatsappSessions.some((item) => {
            const settings = item.advanced_settings;
            return (
              !!settings &&
              typeof settings === "object" &&
              !Array.isArray(settings) &&
              settings.ai_auto_reply_enabled === true
            );
          })
            ? "connected"
            : "not-connected";
          loading = whatsappSessionsLoading;
          loadError = whatsappSessionsLoadFailed;
          retry = () => void refetchWhatsAppSessions();
          break;
        case "meta":
          status = metaStatus;
          loading = metaIntegrationsLoading;
          loadError = metaIntegrationsLoadFailed;
          retry = () => void refetchMetaIntegrations();
          detail = `${connectedMetaPages} página${
            connectedMetaPages === 1 ? "" : "s"
          } ativa${connectedMetaPages === 1 ? "" : "s"} de ${metaIntegrations.length}`;
          break;
        case "grupo-olx":
          status = grupoOLXRuntimeStatus;
          loading = grupoOLXLoading;
          loadError = grupoOLXLoadFailed;
          retry = () => void refetchGrupoOLX();
          detail =
            grupoOLXIntegration?.status === "pending_setup"
              ? "Configuração inicial incompleta"
              : grupoOLXRuntimeStatus === "connected"
                ? "Feed e entrada de leads ativos"
                : definition.defaultDetail;
          break;
        case "zap":
        case "viva-real":
        case "olx":
          status = grupoOLXRuntimeStatus;
          loading = grupoOLXLoading;
          loadError = grupoOLXLoadFailed;
          retry = () => void refetchGrupoOLX();
          detail =
            grupoOLXRuntimeStatus === "connected"
              ? "Canal Pro conectado"
              : definition.defaultDetail;
          break;
        case "chaves-na-mao":
          status = chavesNaMaoRuntimeStatus;
          loading = chavesNaMaoLoading;
          loadError =
            chavesNaMaoLoadFailed && !chavesNaMaoHomologationRequired;
          retry = () => void refetchChavesNaMao();
          detail = chavesNaMaoHomologationRequired
            ? "Homologação necessária"
            : chavesNaMaoRuntimeStatus === "connected"
              ? "Feed XML ativo"
              : chavesNaMaoIntegration?.status === "pending_setup"
                ? "Aguardando aceite do portal"
                : definition.defaultDetail;
          break;
        case "google-calendar":
          status = googleCalendarRuntimeStatus;
          loading = googleCalendarLoading;
          loadError = googleCalendarLoadFailed;
          retry = () => void refetchGoogleCalendar();
          detail = googleCalendarStatus?.account_email || definition.defaultDetail;
          break;
        case "google-analytics":
          status = googleAnalyticsIntegration?.configured
            ? googleAnalyticsIntegration.legacyValue ||
              !googleAnalyticsIntegration.siteActive ||
              !googleAnalyticsIntegration.publicUrl
              ? "reconnect-required"
              : "connected"
            : "not-connected";
          loading = googleAnalyticsLoading;
          loadError = googleAnalyticsLoadFailed;
          retry = () => void refetchGoogleAnalytics();
          detail = googleAnalyticsIntegration?.legacyValue
            ? `${googleAnalyticsIntegration.value} · substitua por GA4`
            : googleAnalyticsIntegration?.value
              ? `${googleAnalyticsIntegration.value}${!googleAnalyticsIntegration.siteActive ? " · site pausado" : !googleAnalyticsIntegration.publicUrl ? " · sem URL pública" : ""}`
              : definition.defaultDetail;
          break;
        case "google-tag-manager":
          status = googleTagManagerIntegration?.configured
            ? !googleTagManagerIntegration.siteActive ||
              !googleTagManagerIntegration.publicUrl
              ? "reconnect-required"
              : "connected"
            : "not-connected";
          loading = googleTagManagerLoading;
          loadError = googleTagManagerLoadFailed;
          retry = () => void refetchGoogleTagManager();
          detail = googleTagManagerIntegration?.value
            ? `${googleTagManagerIntegration.value}${!googleTagManagerIntegration.siteActive ? " · site pausado" : !googleTagManagerIntegration.publicUrl ? " · sem URL pública" : ""}`
            : definition.defaultDetail;
          break;
        case "google-search-console":
          status = googleSearchConsoleIntegration?.configured
            ? !googleSearchConsoleIntegration.siteActive ||
              !googleSearchConsoleIntegration.publicUrl
              ? "reconnect-required"
              : "connected"
            : "not-connected";
          loading = googleSearchConsoleLoading;
          loadError = googleSearchConsoleLoadFailed;
          retry = () => void refetchGoogleSearchConsole();
          detail = googleSearchConsoleIntegration?.configured
            ? `Verificação configurada${!googleSearchConsoleIntegration.siteActive ? " · site pausado" : !googleSearchConsoleIntegration.publicUrl ? " · sem URL pública" : ""}`
            : definition.defaultDetail;
          break;
        case "webhooks": {
          const activeWebhooks = webhookIntegrations.filter(
            (webhook) => webhook.is_active,
          ).length;
          status = activeWebhooks > 0 ? "connected" : "not-connected";
          loading = webhookIntegrationsLoading;
          loadError = webhookIntegrationsLoadFailed;
          retry = () => void refetchWebhooks();
          detail =
            webhookIntegrations.length === 0
              ? definition.defaultDetail
              : `${activeWebhooks} ativo${activeWebhooks === 1 ? "" : "s"} de ${webhookIntegrations.length}`;
          break;
        }
        case "api": {
          const activeAPIKeys = apiKeys.filter((key) => key.is_active).length;
          status = activeAPIKeys > 0 ? "connected" : "not-connected";
          loading = apiKeysLoading;
          loadError = apiKeysLoadFailed;
          retry = () => void refetchAPIKeys();
          detail =
            apiKeys.length === 0
              ? definition.defaultDetail
              : `${activeAPIKeys} chave${activeAPIKeys === 1 ? "" : "s"} ativa${activeAPIKeys === 1 ? "" : "s"}`;
          break;
        }
      }

      if (!availableByRelease || locked || missingModule) {
        status = "unavailable";
      } else if (loading) {
        status = "loading";
        detail = "Verificando status...";
      } else if (loadError) {
        status = "error";
        detail = "Status não verificado";
      }

      return {
        key,
        title: definition.title,
        description: definition.description,
        enabled:
          key === "chaves-na-mao"
            ? !locked && !missingModule
            : isIntegrationEnabled(key),
        status,
        detail,
        icon: <IntegrationIcon definition={definition.icon} />,
        category: definition.category,
        capabilities: definition.capabilities,
        availability: definition.availability,
        management: definition.management,
        requiresAdmin: manifest.effectiveRequiresAdmin,
        locked,
        missingModule,
        retry,
      };
    });
  }, [
    apiKeys,
    apiKeysLoadFailed,
    apiKeysLoading,
    chavesNaMaoHomologationRequired,
    chavesNaMaoIntegration,
    chavesNaMaoLoadFailed,
    chavesNaMaoLoadSucceeded,
    chavesNaMaoLoading,
    googleAnalyticsIntegration,
    googleAnalyticsLoadFailed,
    googleAnalyticsLoading,
    googleCalendarLoadFailed,
    googleCalendarLoading,
    googleCalendarStatus,
    googleSearchConsoleIntegration,
    googleSearchConsoleLoadFailed,
    googleSearchConsoleLoading,
    googleTagManagerIntegration,
    googleTagManagerLoadFailed,
    googleTagManagerLoading,
    grupoOLXIntegration,
    grupoOLXLoadFailed,
    grupoOLXLoading,
    hasIntegrationModule,
    hasIntegrationPermission,
    isIntegrationEnabled,
    metaIntegrations,
    metaIntegrationsLoadFailed,
    metaIntegrationsLoading,
    refetchAPIKeys,
    refetchChavesNaMao,
    refetchGoogleAnalytics,
    refetchGoogleCalendar,
    refetchGoogleSearchConsole,
    refetchGoogleTagManager,
    refetchGrupoOLX,
    refetchMetaIntegrations,
    refetchWebhooks,
    refetchWhatsAppSessions,
    whatsappSessions,
    whatsappSessionsLoadFailed,
    whatsappSessionsLoading,
    webhookIntegrations,
    webhookIntegrationsLoadFailed,
    webhookIntegrationsLoading,
  ]);

  const filteredIntegrations = integrations.filter((item) => {
    const query = normalizeSearchText(search);
    if (!query) return true;
    const capabilities = item.capabilities
      .map((capability) => INTEGRATION_CAPABILITY_LABELS[capability])
      .join(" ");
    const category = INTEGRATION_CATEGORY_CATALOG[item.category];
    return normalizeSearchText(
      `${item.title} ${item.description} ${item.detail} ${capabilities} ${category.title}`,
    ).includes(query);
  });

  const groupedIntegrations = INTEGRATION_CATEGORY_IDS.map((categoryId) => ({
    categoryId,
    definition: INTEGRATION_CATEGORY_CATALOG[categoryId],
    items: filteredIntegrations.filter((item) => item.category === categoryId),
  })).filter((group) => group.items.length > 0);


  const openIntegration = useCallback(
    (item: IntegrationItem) => {
      if (item.management.kind === "route") {
        router.push(item.management.href);
        return;
      }
      if (item.management.kind === "external") {
        window.open(item.management.href, "_blank", "noopener,noreferrer");
        return;
      }
      if (item.management.kind === "dialog") {
        setActiveIntegration(getIntegrationManageKey(item.key));
      }
    },
    [router],
  );

  const effectiveActiveIntegration =
    activeIntegration &&
    (activeIntegration === "meta" ||
      (ADMIN_ONLY_INTEGRATIONS.has(activeIntegration) &&
        !canManageAdminIntegrations) ||
      disabledIntegrations.has(activeIntegration))
      ? null
      : activeIntegration;
  const activeTitle = integrations.find(
    (item) => item.key === effectiveActiveIntegration,
  )?.title;

  return (
    <div className="space-y-5">
      {groupedIntegrations.map((group) => (
        <section key={group.categoryId} className="space-y-3">
          <div className="flex items-end justify-between gap-3 px-0.5">
            <h2 className="text-[13px] font-medium text-[var(--app-text-primary)]">
              {group.definition.title}
            </h2>
            <span className="shrink-0 text-[11px] font-light text-muted-foreground">
              {group.items.length} {group.items.length === 1 ? "integração" : "integrações"}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {group.items.map((item) => (
              <IntegrationCard
                key={item.key}
                item={item}
                canManageAdminIntegrations={canManageAdminIntegrations}
                onManage={() => openIntegration(item)}
              />
            ))}
          </div>
        </section>
      ))}

      {filteredIntegrations.length === 0 && (
        <div className="app-card rounded-[8px] p-8 text-center">
          <p className="text-sm font-medium text-[var(--app-text-primary)]">
            Nenhuma integração encontrada
          </p>
          <p className="mt-1 text-xs font-light text-muted-foreground">
            Tente pesquisar pelo nome, canal ou capacidade da integração.
          </p>
        </div>
      )}

      <Dialog
        open={!!effectiveActiveIntegration}
        onOpenChange={(open) => !open && closeIntegration()}
      >
        <DialogContent
          data-tour={
            effectiveActiveIntegration
              ? `${effectiveActiveIntegration}-integration-dialog`
              : undefined
          }
          className="max-w-[96vw] lg:max-w-6xl max-h-[90vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>
              {activeTitle ? `Integração com ${activeTitle}` : "Integração"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Configure credenciais, destinos e opções da integração
              selecionada.
            </DialogDescription>
          </DialogHeader>
          {effectiveActiveIntegration === "ai" && <AIAssistantTab />}
          {effectiveActiveIntegration === "google-calendar" && (
            <GoogleCalendarIntegrationSettings />
          )}
          {effectiveActiveIntegration === "google-analytics" && (
            <GoogleAnalyticsIntegrationSettings />
          )}
          {effectiveActiveIntegration === "google-tag-manager" && (
            <GoogleTagManagerIntegrationSettings />
          )}
          {effectiveActiveIntegration === "google-search-console" && (
            <GoogleSearchConsoleIntegrationSettings />
          )}
          {effectiveActiveIntegration === "grupo-olx" && (
            <GrupoOLXIntegrationSettings />
          )}
          {effectiveActiveIntegration === "chaves-na-mao" && (
            <ChavesNaMaoIntegrationSettings />
          )}
          {effectiveActiveIntegration === "webhooks" && (
            <WebhooksIntegrationSettings />
          )}
          {effectiveActiveIntegration === "api" && (
            <APIAccessIntegrationSettings />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IntegrationCard({
  item,
  canManageAdminIntegrations,
  onManage,
}: {
  item: IntegrationItem;
  canManageAdminIntegrations: boolean;
  onManage: () => void;
}) {
  const isAccessLocked = Boolean(
    item.locked || (item.requiresAdmin && !canManageAdminIntegrations),
  );
  const isExternalGuidance = item.management.kind === "external";
  const isHomologationSurface =
    item.availability === "requires-homologation";
  const isReleaseUnavailable =
    item.status === "unavailable" &&
    !isAccessLocked &&
    !item.missingModule;
  const canManage =
    !isAccessLocked &&
    !item.missingModule &&
    item.status !== "loading" &&
    item.management.kind !== "none" &&
    (!isReleaseUnavailable || isExternalGuidance || isHomologationSurface);
  const status = getIntegrationStatusPresentation(item, isAccessLocked);
  const tourTarget =
    item.key === "whatsapp"
      ? "whatsapp-integration-card"
      : item.key === "meta"
        ? "meta-integration"
        : item.key === "google-calendar"
          ? "google-calendar-integration"
          : undefined;
  const buttonTourTarget =
    item.key === "whatsapp"
      ? "whatsapp-integration-button"
      : item.key === "meta"
        ? "meta-integration-button"
        : item.key === "google-calendar"
          ? "google-calendar-integration-button"
          : undefined;

  return (
    <Card
      data-tour={tourTarget}
      className={`flex h-full flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none ${item.management.kind === "none" ? "opacity-75" : ""}`}
    >
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-[var(--app-surface-soft)]">
              {item.icon}
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate text-[13px] font-normal">
                {item.title}
              </CardTitle>
              <CardDescription className="mt-0.5 truncate text-[11px] font-light">
                {item.detail}
              </CardDescription>
            </div>
          </div>
          <Badge
            variant="outline"
            className={`!rounded-[6px] whitespace-nowrap border-transparent text-[10px] font-medium ${status.className}`}
          >
            {status.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 p-4 pt-2">
        <div className="min-h-[44px]">
          <IntegrationCardNotice
            item={item}
            isAccessLocked={isAccessLocked}
          />
        </div>

        <div className="mt-auto flex gap-2">
          {item.status === "error" && item.retry ? (
            <Button
              type="button"
              variant="outline"
              className="h-9 flex-1 gap-2 rounded-[6px] shadow-none"
              onClick={item.retry}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Tentar novamente
            </Button>
          ) : null}
          <Button
            type="button"
            data-tour={buttonTourTarget}
            variant={item.status === "connected" ? "outline" : "default"}
            className="h-9 flex-1 gap-2 rounded-[6px] border-0 shadow-none"
            disabled={!canManage}
            onClick={onManage}
          >
            {isAccessLocked ? (
              <Lock className="h-4 w-4" />
            ) : item.status === "loading" ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Settings2 className="h-4 w-4" />
            )}
            {getIntegrationActionLabel(item, isAccessLocked)}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function IntegrationCardNotice({
  item,
  isAccessLocked,
}: {
  item: IntegrationItem;
  isAccessLocked: boolean;
}) {
  if (isAccessLocked) {
    return (
      <p className="flex items-start gap-2 rounded-[6px] bg-[var(--app-surface-soft)] p-2 text-[11px] leading-4 text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Sua função não permite gerenciar esta integração.
      </p>
    );
  }
  if (item.missingModule) {
    return (
      <p className="flex items-start gap-2 rounded-[6px] bg-[var(--app-surface-soft)] p-2 text-[11px] leading-4 text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        O módulo necessário não está liberado para esta organização.
      </p>
    );
  }
  if (
    item.availability === "requires-homologation" &&
    item.status === "unavailable"
  ) {
    return (
      <p className="flex items-start gap-2 rounded-[6px] bg-amber-500/10 p-2 text-[11px] leading-4 text-amber-800 dark:text-amber-200">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Exige contrato, XML aprovado e credenciais de homologação do portal.
      </p>
    );
  }
  if (item.status === "error") {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-[6px] bg-destructive/10 p-2 text-[11px] leading-4 text-destructive"
      >
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Não foi possível consultar o status. Tente novamente ou revise a
        configuração.
      </p>
    );
  }
  if (item.status === "reconnect-required") {
    return (
      <p className="flex items-start gap-2 rounded-[6px] bg-amber-500/10 p-2 text-[11px] leading-4 text-amber-800 dark:text-amber-200">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Há configuração salva, mas uma etapa precisa ser corrigida.
      </p>
    );
  }
  return null;
}

function getIntegrationStatusPresentation(
  item: IntegrationItem,
  isAccessLocked: boolean,
) {
  if (isAccessLocked) {
    return {
      label: "Sem acesso",
      className:
        "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
    };
  }
  if (item.missingModule) {
    return {
      label: "Módulo indisponível",
      className:
        "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
    };
  }
  if (
    item.availability === "requires-homologation" &&
    item.status === "unavailable"
  ) {
    return {
      label: "Homologação pendente",
      className: "bg-amber-500/10 text-amber-800 dark:text-amber-200",
    };
  }
  if (item.availability === "coming-soon") {
    return {
      label: "Em breve",
      className:
        "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
    };
  }
  if (item.status === "connected") {
    return {
      label: GOOGLE_SITE_CONFIGURATION_IDS.has(item.key)
        ? "Configurado"
        : "Conectado",
      className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }
  if (item.status === "reconnect-required") {
    return {
      label: "Ação necessária",
      className: "bg-amber-500/10 text-amber-800 dark:text-amber-200",
    };
  }
  if (item.status === "error") {
    return {
      label: "Falha na verificação",
      className: "bg-destructive/10 text-destructive",
    };
  }
  if (item.status === "loading") {
    return {
      label: "Verificando",
      className: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    };
  }
  if (item.status === "not-connected") {
    return {
      label: "Pendente",
      className:
        "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
    };
  }
  return {
    label: "Indisponível",
    className:
      "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
  };
}

function getIntegrationActionLabel(
  item: IntegrationItem,
  isAccessLocked: boolean,
) {
  if (isAccessLocked) return "Sem acesso";
  if (item.missingModule) return "Módulo indisponível";
  if (
    item.availability === "requires-homologation" &&
    item.status === "unavailable"
  ) {
    return "Ver requisitos";
  }
  if (item.management.kind === "external") return "Ver requisitos";
  if (item.management.kind === "none") return "Em breve";
  if (item.status === "loading") return "Verificando";
  if (item.status === "error") return "Revisar";
  if (item.status === "connected") return "Gerenciar";
  if (item.status === "reconnect-required") return "Corrigir configuração";
  return "Configurar";
}

function isIntegrationKey(value?: string): value is IntegrationKey {
  return isIntegrationProviderId(value);
}

function IntegrationIcon({
  definition,
}: {
  definition: IntegrationIconDefinition;
}) {
  if (definition.kind === "brand") {
    return (
      <LogoImage
        src={definition.src}
        alt={definition.alt}
        fallback={definition.fallback}
        fallbackClassName={definition.fallbackClassName}
      />
    );
  }

  const iconClassName = "h-7 w-7 text-primary";
  if (definition.name === "sparkles") {
    return <Sparkles aria-label={definition.label} className={iconClassName} />;
  }
  if (definition.name === "webhook") {
    return <Webhook aria-label={definition.label} className={iconClassName} />;
  }
  if (definition.name === "building") {
    return <Building2 aria-label={definition.label} className={iconClassName} />;
  }
  return <Key aria-label={definition.label} className={iconClassName} />;
}

function LogoImage({
  src,
  alt,
  fallback,
  fallbackClassName,
}: {
  src: string;
  alt: string;
  fallback: string;
  fallbackClassName: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span role="img" aria-label={alt}>
        <BrandGlyph label={fallback} className={fallbackClassName} />
      </span>
    );
  }

  return (
    <NextImage
      src={src}
      alt={alt}
      width={28}
      height={28}
      className="h-7 w-7 object-contain"
      unoptimized
      onError={() => setFailed(true)}
    />
  );
}

function BrandGlyph({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-7 min-w-7 items-center justify-center rounded-[6px] px-1.5 text-[10px] font-semibold tracking-tight ${className}`}
    >
      {label}
    </span>
  );
}
