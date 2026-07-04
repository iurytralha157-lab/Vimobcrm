import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Key, Lock, MessageCircle, Search, Settings2, Webhook } from "lucide-react";
import NextImage from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { WhatsAppTab } from "@/components/features/settings/WhatsAppTab";
import { WebhooksTab } from "@/components/features/settings/WebhooksTab";
import { APITab } from "@/components/features/settings/APITab";
import { MetaIntegrationSettings } from "@/components/features/integrations/MetaIntegrationSettings";
import { GoogleCalendarConnect } from "@/components/features/schedule/GoogleCalendarConnect";
import { VistaImportDialog } from "@/components/features/properties/VistaImportDialog";
import { ImoviewImportDialog } from "@/components/features/properties/ImoviewImportDialog";
import { useMetaIntegrations, type MetaPage } from "@/hooks/use-meta-integration";
import { useWhatsAppSessions } from "@/hooks/use-whatsapp-sessions";
import { useVistaIntegration } from "@/hooks/use-vista-integration";
import { useImoviewIntegration } from "@/hooks/use-imoview-integration";
import { useGoogleCalendarStatus } from "@/hooks/use-google-calendar";
import { useAuth } from "@/contexts/AuthContext";

type IntegrationKey = "whatsapp" | "meta" | "google-calendar" | "vista" | "imoview" | "webhooks" | "api";
const ADMIN_ONLY_INTEGRATIONS = new Set<IntegrationKey>(["meta", "vista", "imoview"]);

interface MetaOAuthPayload {
  pages?: MetaPage[];
  user_token?: string;
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
}

interface IntegrationsTabProps {
  defaultIntegration?: string;
  hasWhatsAppModule: boolean;
  hasWebhooksModule: boolean;
  hasAPIModule: boolean;
}

export function IntegrationsTab({
  defaultIntegration,
  hasWhatsAppModule,
  hasWebhooksModule,
  hasAPIModule,
}: IntegrationsTabProps) {
  const { profile, isSuperAdmin, organization, userOrganizations } = useAuth();
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === activeOrganizationId)?.member_role;
  const canManageAdminIntegrations =
    isSuperAdmin ||
    profile?.role === "admin" ||
    profile?.role === "super_admin" ||
    activeMemberRole === "admin" ||
    activeMemberRole === "owner";
  const defaultIntegrationKey = isIntegrationKey(defaultIntegration) ? defaultIntegration : null;
  const defaultIntegrationLocked =
    defaultIntegrationKey !== null &&
    ADMIN_ONLY_INTEGRATIONS.has(defaultIntegrationKey) &&
    !canManageAdminIntegrations;
  const [search, setSearch] = useState("");
  const [metaOAuthPayload, setMetaOAuthPayload] = useState<MetaOAuthPayload | null>(null);
  const [metaOAuthStatus, setMetaOAuthStatus] = useState<MetaOAuthStatus | null>(null);
  const [activeIntegration, setActiveIntegration] = useState<IntegrationKey | null>(
    defaultIntegrationKey && !defaultIntegrationLocked ? defaultIntegrationKey : null,
  );
  const handledMetaOAuthEventRef = useRef<string | number | null>(null);
  const { data: metaIntegrations = [], refetch: refetchMetaIntegrations } = useMetaIntegrations();
  const { data: whatsappSessions = [] } = useWhatsAppSessions();
  const { data: vistaIntegration } = useVistaIntegration();
  const { data: imoviewIntegration } = useImoviewIntegration();
  const { data: googleCalendarStatus } = useGoogleCalendarStatus();
  const disabledIntegrations = new Set<IntegrationKey>();

  const handleMetaOAuthMessage = useCallback((message: MetaOAuthWindowMessage) => {
    if (!message?.type) return;
    const eventKey =
      message.nonce ??
      `${message.type}:${message.flowId ?? ""}:${message.status ?? ""}:${message.error ?? ""}:${message.data?.facebook_user_id ?? ""}`;
    if (handledMetaOAuthEventRef.current === eventKey) return;
    handledMetaOAuthEventRef.current = eventKey;

    if (message.type === "META_OAUTH_SUCCESS") {
      setMetaOAuthPayload(message.data || null);
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
    const parseOAuthPayload = (raw: string): MetaOAuthPayload => {
      try {
        return JSON.parse(raw) as MetaOAuthPayload;
      } catch {
        return JSON.parse(decodeURIComponent(raw)) as MetaOAuthPayload;
      }
    };

    const params = new URLSearchParams(window.location.search);
    const raw = params.get("meta_oauth_data");
    const status = params.get("meta_oauth_status");
    const flowId = params.get("meta_oauth_flow_id");
    const error = params.get("meta_oauth_error");
    const isOAuthPopupReturn = params.get("meta_oauth_popup") === "1";
    if (!raw && !status && !flowId && !error) return;

    try {
      if (raw) {
        const payload = parseOAuthPayload(raw);

        if ((window.opener && !window.opener.closed) || isOAuthPopupReturn) {
          publishMetaOAuthReturn({ type: "META_OAUTH_SUCCESS", data: payload });
          window.close();
          return;
        }

        /* eslint-disable react-hooks/set-state-in-effect -- Consome o retorno OAuth da URL apenas uma vez ao abrir a tela. */
        setMetaOAuthPayload(payload);
        setActiveIntegration("meta");
        /* eslint-enable react-hooks/set-state-in-effect */
      } else {
        const oauthStatus: MetaOAuthStatus = {
          status: status || undefined,
          flowId,
          error,
          nonce: Date.now(),
        };

        if ((window.opener && !window.opener.closed) || isOAuthPopupReturn) {
          publishMetaOAuthReturn({ type: "META_OAUTH_STATUS", ...oauthStatus });
          window.close();
          return;
        }

        setMetaOAuthStatus(oauthStatus);
        setActiveIntegration("meta");
        refetchMetaIntegrations();
      }
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

    return [
      {
        key: "whatsapp" as const,
        title: "WhatsApp",
        description: "Conecte números, gerencie permissões, etiquetas e sincronizações.",
        enabled: hasWhatsAppModule,
        connected: whatsappConnected,
        detail: `${whatsappSessions.length} ${whatsappSessions.length === 1 ? "conexão" : "conexões"}`,
        icon: <MessageCircle className="h-7 w-7 text-primary" />,
      },
      {
        key: "meta" as const,
        title: "Facebook / Meta",
        description: "Receba leads de formulários do Facebook e Instagram no CRM.",
        enabled: true,
        requiresAdmin: true,
        connected: metaConnected,
        detail: `${metaIntegrations.length} página${metaIntegrations.length === 1 ? "" : "s"}`,
        icon: <LogoImage src="https://cdn.simpleicons.org/facebook/1877F2" alt="Facebook" />,
      },
      {
        key: "google-calendar" as const,
        title: "Google Agenda",
        description: "Sincronize atividades e compromissos com sua agenda.",
        enabled: true,
        connected: googleCalendarConnected,
        detail: googleCalendarStatus?.account_email || "Agenda",
        icon: <LogoImage src="https://cdn.simpleicons.org/googlecalendar/4285F4" alt="Google Agenda" />,
      },
      {
        key: "vista" as const,
        title: "Portal Vista",
        description: "Conecte o Vista para importar e sincronizar sua carteira de imóveis.",
        enabled: true,
        requiresAdmin: true,
        connected: !!vistaIntegration,
        detail: "Imóveis",
        icon: <LogoImage src="https://www.google.com/s2/favicons?domain=vistahost.com.br&sz=64" alt="Portal Vista" />,
      },
      {
        key: "imoview" as const,
        title: "Imoview",
        description: "Conecte o Imoview para trazer seus imóveis para o CRM.",
        enabled: true,
        requiresAdmin: true,
        connected: !!imoviewIntegration,
        detail: "Imóveis",
        icon: <LogoImage src="https://www.google.com/s2/favicons?domain=imoview.com.br&sz=64" alt="Imoview" />,
      },
      {
        key: "webhooks" as const,
        title: "Webhook",
        description: "Receba leads de sistemas externos por URLs seguras.",
        enabled: hasWebhooksModule,
        connected: false,
        detail: "Entrada de dados",
        icon: <Webhook className="h-7 w-7 text-primary" />,
      },
      {
        key: "api" as const,
        title: "API",
        description: "Gere chaves para integrações externas autenticadas.",
        enabled: hasAPIModule,
        connected: false,
        detail: "Chaves",
        icon: <Key className="h-7 w-7 text-primary" />,
      },
    ].filter((item) => item.enabled);
  }, [googleCalendarStatus, hasAPIModule, hasWebhooksModule, hasWhatsAppModule, imoviewIntegration, metaIntegrations, vistaIntegration, whatsappSessions]);

  const filteredIntegrations = integrations.filter((item) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return `${item.title} ${item.description}`.toLowerCase().includes(query);
  });

  const effectiveActiveIntegration =
    activeIntegration && ADMIN_ONLY_INTEGRATIONS.has(activeIntegration) && !canManageAdminIntegrations
      ? null
      : activeIntegration;
  const activeTitle = integrations.find((item) => item.key === effectiveActiveIntegration)?.title;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Integrações</h2>
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
          const isAccessLocked = item.requiresAdmin && !canManageAdminIntegrations;
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
                    variant={isAccessLocked || !item.connected ? "outline" : "default"}
                    className={isAccessLocked || !item.connected ? "border-transparent bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-soft)]" : ""}
                  >
                    {isAccessLocked ? "Sem acesso" : isTemporarilyDisabled ? "Em breve" : item.connected ? "Integrado" : "Não integrado"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="px-4 md:px-6 pb-4 space-y-4">
                <p className="text-sm text-muted-foreground min-h-[40px]">{item.description}</p>
                {isAccessLocked && (
                  <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" />
                    Acesso apenas para administradores.
                  </p>
                )}
                <Button
                  data-tour={buttonTourTarget}
                  variant={item.connected ? "outline" : "default"}
                  className="w-full gap-2"
                  disabled={isDisabled}
                  onClick={() => {
                    if (isDisabled) return;
                    setActiveIntegration(item.key);
                  }}
                >
                  {isAccessLocked ? <Lock className="h-4 w-4" /> : <Settings2 className="h-4 w-4" />}
                  {isAccessLocked ? "Sem acesso" : isTemporarilyDisabled ? "Indisponível" : item.connected ? "Gerenciar" : "Conectar"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={!!effectiveActiveIntegration && effectiveActiveIntegration !== "vista" && effectiveActiveIntegration !== "imoview"}
        onOpenChange={(open) => !open && setActiveIntegration(null)}
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
          </DialogHeader>
          {effectiveActiveIntegration === "whatsapp" && <WhatsAppTab embedded />}
          {effectiveActiveIntegration === "meta" && (
            <MetaIntegrationSettings
              oauthPayload={metaOAuthPayload}
              oauthStatus={metaOAuthStatus}
              listenForOAuthMessages={false}
            />
          )}
          {effectiveActiveIntegration === "google-calendar" && <GoogleCalendarConnect />}
          {effectiveActiveIntegration === "webhooks" && <WebhooksTab />}
          {effectiveActiveIntegration === "api" && <APITab />}
        </DialogContent>
      </Dialog>
      <VistaImportDialog open={effectiveActiveIntegration === "vista"} onOpenChange={(open) => !open && setActiveIntegration(null)} />
      <ImoviewImportDialog open={effectiveActiveIntegration === "imoview"} onOpenChange={(open) => !open && setActiveIntegration(null)} />
    </div>
  );
}

function isIntegrationKey(value?: string): value is IntegrationKey {
  return value === "whatsapp" || value === "meta" || value === "google-calendar" || value === "vista" || value === "imoview" || value === "webhooks" || value === "api";
}

function LogoImage({ src, alt }: { src: string; alt: string }) {
  return <NextImage src={src} alt={alt} width={28} height={28} className="h-7 w-7 object-contain" unoptimized />;
}
