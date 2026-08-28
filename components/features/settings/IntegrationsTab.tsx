import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Building2, Key, Lock, MessageCircle, Search, Settings2, Webhook } from "lucide-react";
import NextImage from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { WhatsAppTab } from "@/components/features/settings/WhatsAppTab";
import { WebhooksTab } from "@/components/features/settings/WebhooksTab";
import { APITab } from "@/components/features/settings/APITab";
import { AIAssistantTab } from "@/components/features/settings/AIAssistantTab";
import { GrupoOLXIntegrationSettings } from "@/components/features/integrations/GrupoOLXIntegrationSettings";
import { GoogleCalendarConnect } from "@/components/features/schedule/GoogleCalendarConnect";
import {
  useMetaIntegrations,
  type MetaAdAccount,
  type MetaPage,
} from "@/hooks/use-meta-integration";
import { useWhatsAppSessions } from "@/hooks/use-whatsapp-sessions";
import { useGoogleCalendarStatus } from "@/hooks/use-google-calendar";
import { useGrupoOLXIntegration } from "@/hooks/use-grupo-olx-integration";
import { FEATURES } from "@/config/constants";
import { normalizeSearchText } from "@/lib/search-text";

type IntegrationKey = "whatsapp" | "ai" | "meta" | "grupo-olx" | "google-calendar" | "webhooks" | "api";
const ADMIN_ONLY_INTEGRATIONS = new Set<IntegrationKey>(["meta", "grupo-olx"]);
const TEMPORARILY_DISABLED_INTEGRATIONS = new Set<IntegrationKey>(
  FEATURES.ENABLE_GOOGLE_CALENDAR_INTEGRATION ? [] : ["google-calendar"],
);

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

function sanitizeMetaOAuthPayload(payload?: MetaOAuthPayload | null): MetaOAuthPayload | null {
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
    window.localStorage.setItem(META_OAUTH_STORAGE_KEY, JSON.stringify(payload));
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
  connected: boolean;
  detail: string;
  icon: import("react").ReactNode;
  requiresAdmin?: boolean;
  locked?: boolean;
  loadError?: boolean;
}

interface IntegrationsTabProps {
  defaultIntegration?: string;
  onCloseIntegration?: () => void;
  hasWhatsAppModule: boolean;
  hasAIModule: boolean;
  hasWebhooksModule: boolean;
  hasAPIModule: boolean;
  hasPortalsModule: boolean;
  canManageIntegrations: boolean;
  canManageWhatsApp: boolean;
  canManageAI: boolean;
}

export function IntegrationsTab({
  defaultIntegration,
  onCloseIntegration,
  hasWhatsAppModule,
  hasAIModule,
  hasWebhooksModule,
  hasAPIModule,
  hasPortalsModule,
  canManageIntegrations,
  canManageWhatsApp,
  canManageAI,
}: IntegrationsTabProps) {
  const router = useRouter();
  const canManageAdminIntegrations = canManageIntegrations;
  const defaultIntegrationKey = isIntegrationKey(defaultIntegration) ? defaultIntegration : null;
  const {
    data: metaIntegrations = [],
    isLoading: metaIntegrationsLoading,
    isError: metaIntegrationsLoadFailed,
    refetch: refetchMetaIntegrations,
  } = useMetaIntegrations({ enabled: canManageIntegrations });
  const { data: whatsappSessions = [], isError: whatsappSessionsLoadFailed } = useWhatsAppSessions({ enabled: canManageWhatsApp });
  const { data: googleCalendarStatus, isError: googleCalendarLoadFailed } = useGoogleCalendarStatus();
  const { data: grupoOLXIntegration, isError: grupoOLXLoadFailed } = useGrupoOLXIntegration({ enabled: canManageIntegrations && hasPortalsModule });
  const whatsappQuota = whatsappSessions.meta;
  const hasWhatsAppAccess = hasWhatsAppModule || whatsappQuota?.maxSessions !== undefined;
  const isIntegrationEnabled = useCallback((key: IntegrationKey) => {
    if (key === "whatsapp") return canManageWhatsApp && hasWhatsAppAccess;
    if (key === "ai") return canManageAI && hasAIModule;
    if (key === "google-calendar") return true;
    if (!canManageIntegrations) return false;
    if (key === "webhooks") return hasWebhooksModule;
    if (key === "api") return hasAPIModule;
    if (key === "grupo-olx") return hasPortalsModule;
    return true;
  }, [canManageAI, canManageIntegrations, canManageWhatsApp, hasAIModule, hasAPIModule, hasPortalsModule, hasWebhooksModule, hasWhatsAppAccess]);
  const defaultIntegrationUnavailable =
    defaultIntegrationKey !== null &&
    (!isIntegrationEnabled(defaultIntegrationKey) || TEMPORARILY_DISABLED_INTEGRATIONS.has(defaultIntegrationKey));
  const defaultIntegrationLocked =
    defaultIntegrationKey !== null &&
    ADMIN_ONLY_INTEGRATIONS.has(defaultIntegrationKey) &&
    !canManageAdminIntegrations;
  const [search, setSearch] = useState("");
  const [, setMetaOAuthPayload] = useState<MetaOAuthPayload | null>(null);
  const [, setMetaOAuthStatus] = useState<MetaOAuthStatus | null>(null);
  const [activeIntegration, setActiveIntegration] = useState<IntegrationKey | null>(
    defaultIntegrationKey && !defaultIntegrationLocked && !defaultIntegrationUnavailable ? defaultIntegrationKey : null,
  );
  const handledMetaOAuthEventRef = useRef<string | number | null>(null);
  const openedDefaultIntegrationRef = useRef<IntegrationKey | null>(null);
  const disabledIntegrations = TEMPORARILY_DISABLED_INTEGRATIONS;

  useEffect(() => {
    if (!defaultIntegrationKey || defaultIntegrationLocked || defaultIntegrationUnavailable) {
      openedDefaultIntegrationRef.current = null;
      if (defaultIntegrationKey && activeIntegration === defaultIntegrationKey) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Mantem links diretos para modulos indisponiveis sem modal vazio.
        setActiveIntegration(null);
      }
      return;
    }

    if (openedDefaultIntegrationRef.current !== defaultIntegrationKey) {
      openedDefaultIntegrationRef.current = defaultIntegrationKey;
      setActiveIntegration(defaultIntegrationKey);
    }
  }, [activeIntegration, defaultIntegrationKey, defaultIntegrationLocked, defaultIntegrationUnavailable]);

  const closeIntegration = useCallback(() => {
    setActiveIntegration(null);
    onCloseIntegration?.();
  }, [onCloseIntegration]);

  const handleMetaOAuthMessage = useCallback((message: MetaOAuthWindowMessage) => {
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
          error: "O retorno antigo da Meta foi bloqueado por segurança. Inicie a conexão novamente.",
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
  }, [refetchMetaIntegrations]);

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
        status: hasLegacyPayload && !flowId ? "error" : status || (flowId ? "success" : undefined),
        flowId,
        error: hasLegacyPayload && !flowId
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
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
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
        handleMetaOAuthMessage(JSON.parse(event.newValue) as MetaOAuthWindowMessage);
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
        channel.onmessage = (event) => handleMetaOAuthMessage(event.data as MetaOAuthWindowMessage);
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
    const metaConnected = metaIntegrations.some((item) => item.is_connected);
    const whatsappConnected = whatsappSessions.some((item) => item.status === "connected");
    const googleCalendarConnected = !!googleCalendarStatus;
    const grupoOLXConnected = grupoOLXIntegration?.status === "connected" || !!grupoOLXIntegration?.last_feed_accessed_at;

    return [
      {
        key: "whatsapp" as const,
        title: "WhatsApp",
        description: "Conecte números, gerencie permissões, etiquetas e sincronizações.",
        enabled: hasWhatsAppAccess,
        locked: !canManageWhatsApp,
        connected: whatsappConnected,
        loadError: whatsappSessionsLoadFailed,
        detail: whatsappSessionsLoadFailed
          ? "Falha ao carregar"
          : `${whatsappSessions.length} ${whatsappSessions.length === 1 ? "conexão" : "conexões"}`,
        icon: <MessageCircle className="h-7 w-7 text-primary" />,
      },
      {
        key: "ai" as const,
        title: "IA de atendimento",
        description: "Atenda, qualifique e direcione leads no WhatsApp com contexto do CRM.",
        enabled: canManageAI && hasAIModule,
        connected: whatsappSessions.some((item) => {
          const settings = item.advanced_settings;
          return !!settings && typeof settings === "object" && !Array.isArray(settings) && settings.ai_auto_reply_enabled === true;
        }),
        detail: "WhatsApp e CRM",
        icon: <Bot className="h-7 w-7 text-primary" />,
      },
      {
        key: "meta" as const,
        title: "Facebook / Meta",
        description: "Receba leads de formulários do Facebook e Instagram no CRM.",
        enabled: canManageIntegrations,
        requiresAdmin: true,
        connected: metaConnected,
        loadError: metaIntegrationsLoadFailed,
        detail: metaIntegrationsLoadFailed
          ? "Falha ao carregar"
          : metaIntegrationsLoading
            ? "Carregando..."
            : `${metaIntegrations.length} página${metaIntegrations.length === 1 ? "" : "s"}`,
        icon: <LogoImage src="https://cdn.simpleicons.org/facebook/1877F2" alt="Facebook" />,
      },
      {
        key: "grupo-olx" as const,
        title: "Grupo OLX / Canal Pro",
        description: "Publique imóveis no ZAP, Viva Real e OLX e receba leads no CRM.",
        enabled: canManageIntegrations && hasPortalsModule,
        requiresAdmin: true,
        connected: grupoOLXConnected,
        loadError: grupoOLXLoadFailed,
        detail: grupoOLXLoadFailed
          ? "Falha ao carregar"
          : grupoOLXIntegration?.status === "pending_setup" ? "Aguardando Canal Pro" : "Portais imobiliários",
        icon: <Building2 className="h-7 w-7 text-primary" />,
      },
      {
        key: "google-calendar" as const,
        title: "Google Agenda",
        description: "Sincronize atividades e compromissos com sua agenda.",
        enabled: true,
        connected: googleCalendarConnected,
        loadError: googleCalendarLoadFailed,
        detail: googleCalendarLoadFailed ? "Falha ao carregar" : googleCalendarStatus?.account_email || "Agenda",
        icon: <LogoImage src="https://cdn.simpleicons.org/googlecalendar/4285F4" alt="Google Agenda" />,
      },
      {
        key: "webhooks" as const,
        title: "Webhook",
        description: "Receba leads de sistemas externos por URLs seguras.",
        enabled: canManageIntegrations && hasWebhooksModule,
        connected: false,
        detail: "Entrada de dados",
        icon: <Webhook className="h-7 w-7 text-primary" />,
      },
      {
        key: "api" as const,
        title: "API",
        description: "Prepare credenciais para integrações liberadas explicitamente pelo Vimob.",
        enabled: canManageIntegrations && hasAPIModule,
        connected: false,
        detail: "Escopo controlado",
        icon: <Key className="h-7 w-7 text-primary" />,
      },
    ].filter((item) => item.enabled);
  }, [canManageAI, canManageIntegrations, canManageWhatsApp, googleCalendarLoadFailed, googleCalendarStatus, grupoOLXIntegration, grupoOLXLoadFailed, hasAIModule, hasAPIModule, hasPortalsModule, hasWebhooksModule, hasWhatsAppAccess, metaIntegrations, metaIntegrationsLoadFailed, metaIntegrationsLoading, whatsappSessions, whatsappSessionsLoadFailed]);

  const filteredIntegrations = integrations.filter((item) => {
    const query = normalizeSearchText(search);
    if (!query) return true;
    return normalizeSearchText(`${item.title} ${item.description}`).includes(query);
  });

  const effectiveActiveIntegration =
    activeIntegration &&
    (activeIntegration === "meta" ||
      (ADMIN_ONLY_INTEGRATIONS.has(activeIntegration) && !canManageAdminIntegrations) ||
      disabledIntegrations.has(activeIntegration))
      ? null
      : activeIntegration;
  const activeTitle = integrations.find((item) => item.key === effectiveActiveIntegration)?.title;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-normal">Integrações</h2>
          <p className="text-sm text-muted-foreground">Conexões nativas e canais de entrada do sistema.</p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pesquisar integrações"
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredIntegrations.map((item) => {
          const isTemporarilyDisabled = disabledIntegrations.has(item.key);
          const isAccessLocked = item.locked || (item.requiresAdmin && !canManageAdminIntegrations);
          const isDisabled = isTemporarilyDisabled || isAccessLocked;
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
            <Card key={item.key} data-tour={tourTarget} className={`overflow-hidden shadow-none ${isDisabled ? "opacity-60 grayscale" : ""}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-11 w-11 rounded-[6px] flex items-center justify-center shrink-0">
                      {item.icon}
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{item.title}</CardTitle>
                      <CardDescription className="text-xs">{item.detail}</CardDescription>
                    </div>
                  </div>
                  <Badge
                    variant={isAccessLocked || item.loadError || !item.connected ? "outline" : "default"}
                    className={isAccessLocked || item.loadError || !item.connected ? "!rounded-[6px] border-transparent bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-soft)]" : "!rounded-[6px]"}
                  >
                    {isAccessLocked ? "Sem acesso" : isTemporarilyDisabled ? "Desativado" : item.loadError ? "Indisponível" : item.connected ? "Integrado" : "Não integrado"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="px-4 md:px-6 pb-4 space-y-4">
                <p className="text-sm text-muted-foreground min-h-[40px]">{item.description}</p>
                {isAccessLocked && (
                  <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" />
                    Sua função não permite gerenciar esta integração.
                  </p>
                )}
                <Button
                  data-tour={buttonTourTarget}
                  variant={item.connected ? "outline" : "default"}
                  className="w-full gap-2"
                  disabled={isDisabled}
                  onClick={() => {
                    if (isDisabled) return;
                    if (item.key === "meta") {
                      router.push("/settings/integrations/meta");
                      return;
                    }
                    setActiveIntegration(item.key);
                  }}
                >
                  {isAccessLocked ? <Lock className="h-4 w-4" /> : <Settings2 className="h-4 w-4" />}
                  {isAccessLocked ? "Sem acesso" : isTemporarilyDisabled ? "Indisponível" : item.loadError ? "Ver detalhes" : item.connected ? "Gerenciar" : "Conectar"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={!!effectiveActiveIntegration}
        onOpenChange={(open) => !open && closeIntegration()}
      >
        <DialogContent
          data-tour={effectiveActiveIntegration ? `${effectiveActiveIntegration}-integration-dialog` : undefined}
          className={
            effectiveActiveIntegration === "whatsapp" ?
            "w-[96vw] max-w-[96vw] max-h-[90vh] overflow-y-auto lg:w-[80vw] lg:max-w-[80vw] lg:max-h-[80vh]" :
            "max-w-[96vw] lg:max-w-6xl max-h-[90vh] overflow-y-auto"
          }
        >
          <DialogHeader>
            <DialogTitle>{activeTitle ? `Integração com ${activeTitle}` : "Integração"}</DialogTitle>
            <DialogDescription className="sr-only">
              Configure credenciais, destinos e opções da integração selecionada.
            </DialogDescription>
          </DialogHeader>
          {effectiveActiveIntegration === "whatsapp" && <WhatsAppTab embedded />}
          {effectiveActiveIntegration === "ai" && <AIAssistantTab />}
          {effectiveActiveIntegration === "google-calendar" && <GoogleCalendarConnect />}
          {effectiveActiveIntegration === "grupo-olx" && <GrupoOLXIntegrationSettings />}
          {effectiveActiveIntegration === "webhooks" && <WebhooksTab />}
          {effectiveActiveIntegration === "api" && <APITab />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function isIntegrationKey(value?: string): value is IntegrationKey {
  return value === "whatsapp" || value === "ai" || value === "meta" || value === "grupo-olx" || value === "google-calendar" || value === "webhooks" || value === "api";
}

function LogoImage({ src, alt }: { src: string; alt: string }) {
  return <NextImage src={src} alt={alt} width={28} height={28} className="h-7 w-7 object-contain" unoptimized />;
}
