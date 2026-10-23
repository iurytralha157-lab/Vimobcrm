import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import NextImage from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Plus,
  Smartphone,
  QrCode,
  LogOut,
  RefreshCw,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  Users,
  Bell } from
"lucide-react";
import {
  useWhatsAppSessions,
  useCreateWhatsAppSession,
  useDeleteWhatsAppSession,
  useGetQRCode,
  useGetConnectionStatus,
  useWhatsAppLiveStatusSync,
  useLogoutSession,
  useToggleNotificationSession,
  type WhatsAppSession } from
  "@/hooks/use-whatsapp-sessions";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { canManageOrganization } from "@/lib/access/organization";
import { canShareOwnWhatsAppSession } from "@/lib/access/whatsapp-session-sharing";
import { isTenantContextForOrganization } from "@/lib/access/tenant-navigation";
import { WhatsAppSessionAccessDialog } from "@/components/features/integrations/whatsapp/WhatsAppSessionAccessDialog";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import { resolveWhatsAppSessionStatus } from "@/lib/whatsapp-query-cache";
import { useWhatsAppSessionStatuses } from "@/hooks/integrations/whatsapp";
import { formatWhatsAppContactPhoneForDisplay } from "@/lib/phone-utils";
import { WhatsAppSessionStatusPanel } from "@/components/features/integrations/whatsapp/WhatsAppSessionStatusPanel";
import { WhatsAppActionTooltip } from "@/components/features/integrations/whatsapp/WhatsAppActionTooltip";
import {
  getUnifiedWhatsAppStatusRows,
  WHATSAPP_SESSION_LIST_COLUMNS_CLASS_NAME,
  WHATSAPP_SESSION_LIST_ROW_CLASS_NAME,
  WHATSAPP_SESSION_LIST_ROW_STYLE,
} from "@/components/features/integrations/whatsapp/session-list-presentation";
import { formatPtBRNumber } from "@/lib/utils/formatting";
import {
  getWhatsAppStatusBadgeClassName,
  getWhatsAppStatusPresentation,
  WHATSAPP_SESSION_ACTION_CLASS_NAME,
  WHATSAPP_SESSION_STATUS_SIZE_CLASS_NAME,
} from "@/components/features/integrations/whatsapp/session-status-presentation";

interface WhatsAppTabProps {
  embedded?: boolean;
  compactPage?: boolean;
  unifiedPage?: boolean;
  allowManagement?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getQrCodeValue(data: unknown) {
  if (!isRecord(data)) return null;
  const qrCode = data.qrcode ?? data.base64;
  return typeof qrCode === "string" ? qrCode : null;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (isRecord(error)) {
    const message = error.message || error.error || error.details;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

type QrIntent = { scope: string; sessionId: string; generation: number; controller: AbortController };

export function WhatsAppTab({ embedded = false, compactPage = false, unifiedPage = false, allowManagement = true }: WhatsAppTabProps = {}) {
  const {
    activeOrganization,
    profile,
    isSuperAdmin,
    userOrganizations,
    tenantContext,
  } = useAuth();
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();
  const managementAllowed = !unifiedPage || allowManagement;
  const uiScope = JSON.stringify([scope.organizationId, scope.userId, scope.accessScope, profile?.organization_id, managementAllowed]);
  const uiScopeRef = useRef(uiScope);
  const uiGenerationRef = useRef(0);
  const [uiOwner, setUiOwner] = useState(uiScope);
  const uiCurrent = uiOwner === uiScope;
  const qrIntentRef = useRef<QrIntent | null>(null);
  const pollingRequestRef = useRef<QrIntent | null>(null);
  const qrGenerationRef = useRef(0);
  const [qrGeneration, setQrGeneration] = useState(0);
  const { data: sessions, isLoading, isError: sessionsFailed, isSuccess: sessionsLoaded, refetch: refetchSessions } = useWhatsAppSessions({ live: true, enabled: managementAllowed });
  const ownerStatuses = useWhatsAppSessionStatuses({ enabled: unifiedPage, live: unifiedPage });
  const operationalRows = unifiedPage
    ? managementAllowed && sessionsLoaded ? Array.from(new Map((sessions ?? []).filter((session) => session.owner_user_id === profile?.id).map((session) => [session.id, session])).values()) : []
    : sessions;
  const operationalIds = (operationalRows ?? []).map((session) => session.id);
  const operationalIdSet = new Set(operationalIds);
  const additionalSessions = managementAllowed && sessionsLoaded
    ? (sessions ?? []).filter((session) => !operationalIdSet.has(session.id))
    : [];
  const remainingStatusRows = getUnifiedWhatsAppStatusRows(
    (ownerStatuses.data?.data ?? []).filter((session) => !operationalIdSet.has(session.id)),
    additionalSessions,
    profile?.id,
  );
  const visibleRowCount = (operationalRows?.length ?? 0) + remainingStatusRows.length;
  const connectedCount = [...(operationalRows ?? []), ...remainingStatusRows]
    .filter((session) => getWhatsAppStatusPresentation(session.status).tone === "connected").length;
  const createSession = useCreateWhatsAppSession();
  const deleteSession = useDeleteWhatsAppSession();
  const getQRCode = useGetQRCode();
  const getConnectionStatus = useGetConnectionStatus();
  const requestConnectionStatus = getConnectionStatus.mutateAsync;
  const logoutSession = useLogoutSession();
  const toggleNotification = useToggleNotificationSession();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [instanceName, setInstanceName] = useState("");
  const [selectedSession, setSelectedSession] = useState<WhatsAppSession | null>(null);
  const [sessionToDisconnect, setSessionToDisconnect] = useState<WhatsAppSession | null>(null);
  const [sessionToShare, setSessionToShare] = useState<WhatsAppSession | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isRefreshingQr, setIsRefreshingQr] = useState(false);
  const [verifyingSessionId, setVerifyingSessionId] = useState<string | null>(null);
  const originalOrganization = Boolean(profile?.organization_id && profile.organization_id === activeOrganization.organizationId);
  const sessionQuota = sessions?.meta;
  const activeSessionCount = sessions?.length ?? 0;
  const maxSessions = sessionQuota?.maxSessions ?? null;
  const canCreateSession = managementAllowed && originalOrganization && (sessionQuota?.canCreate ?? false);
  const sessionLimitLabel = maxSessions
    ? `${canCreateSession ? "" : "Limite atingido: "}${sessionQuota?.currentSessions ?? activeSessionCount}/${maxSessions} conexoes`
    : sessionQuota ? null : "Verificando limite";
  const newSessionDisabled = !canCreateSession || isLoading;
  const newSessionTitle = !originalOrganization ? "Atendimento disponível somente na organização original do cadastro" : !canCreateSession ? "Limite do plano atingido" : undefined;
  const activeMemberRole = userOrganizations.find(
    (membership) =>
      membership.organization_id === activeOrganization.organizationId,
  )?.member_role || (isTenantContextForOrganization(activeOrganization.organizationId, tenantContext)
    ? tenantContext?.memberRole
    : undefined);
  const currentTenantContext = isTenantContextForOrganization(activeOrganization.organizationId, tenantContext)
    ? tenantContext
    : null;
  const sharingActor = {
    userId: profile?.id || "",
    memberRole: activeMemberRole,
    isSuperAdmin,
    isTeamLeader: Boolean(currentTenantContext?.isTeamLeader),
    ledUserIds: currentTenantContext?.ledUserIds || [],
  };
  const canManageNotificationSession = canManageOrganization({
    isSuperAdmin,
    memberRole: activeMemberRole,
  });
  useWhatsAppLiveStatusSync(managementAllowed && originalOrganization ? sessions?.filter((session) => session.owner_user_id === profile?.id) : []);

  // Refs para evitar stale closures no polling
  const selectedSessionRef = useRef(selectedSession);
  const qrDialogOpenRef = useRef(qrDialogOpen);

  useLayoutEffect(() => {
    selectedSessionRef.current = uiCurrent ? selectedSession : null;
    qrDialogOpenRef.current = uiCurrent && qrDialogOpen;
  }, [selectedSession, qrDialogOpen, uiCurrent]);

  const qrCurrent = useCallback((intent: QrIntent) => uiScopeRef.current === intent.scope
    && qrIntentRef.current === intent && !intent.controller.signal.aborted
    && qrDialogOpenRef.current && selectedSessionRef.current?.id === intent.sessionId, []);
  const closeQr = useCallback(() => {
    qrIntentRef.current?.controller.abort();
    qrIntentRef.current = null;
    qrDialogOpenRef.current = false;
    setQrDialogOpen(false);
    setQrCode(null);
    setIsRefreshingQr(false);
  }, []);
  const beginQr = (session: WhatsAppSession): QrIntent => {
    qrIntentRef.current?.controller.abort();
    const intent = { scope: uiScope, sessionId: session.id,
      generation: ++qrGenerationRef.current, controller: new AbortController() };
    qrIntentRef.current = intent;
    selectedSessionRef.current = session;
    qrDialogOpenRef.current = true;
    setUiOwner(uiScope);
    setSelectedSession(session);
    setQrDialogOpen(true);
    setQrCode(null);
    setQrGeneration(intent.generation);
    return intent;
  };
  useLayoutEffect(() => {
    uiScopeRef.current = uiScope;
    uiGenerationRef.current += 1;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Cancel and mask old dialogs before painting another tenant.
    setUiOwner(uiScope);
    closeQr();
    setCreateDialogOpen(false);
    setDeleteDialogOpen(false);
    setSelectedSession(null);
    setSessionToDisconnect(null);
    setSessionToShare(null);
    setInstanceName("");
    setVerifyingSessionId(null);
    return () => { uiScopeRef.current = ""; uiGenerationRef.current += 1; qrIntentRef.current?.controller.abort(); qrIntentRef.current = null; };
  }, [closeQr, uiScope]);

  // Funcao de check separada para usar no polling
  const checkConnection = useCallback(async (session: WhatsAppSession): Promise<boolean | null> => {
    try {
      if (session.provider !== "evolution_go") {
        return false;
      }

      const status = await requestConnectionStatus({
        provider: "evolution_go",
        instanceName: session.instance_name,
        sessionId: session.id,
        instanceId: session.instance_id,
      });

      const resolvedStatus = resolveWhatsAppSessionStatus(status);
      if (resolvedStatus === "connected") return true;
      if (resolvedStatus === "disconnected" || resolvedStatus === "qr_ready") return false;
      return null;
    } catch {
      return null;
    }
  }, [requestConnectionStatus]);


  // Polling is serial and belongs to the exact open QR request.
  useEffect(() => {
    const intent = qrIntentRef.current;
    const session = selectedSessionRef.current;
    if (!intent || !session || !qrCurrent(intent)) return;
    const interval = setInterval(async () => {
      if (pollingRequestRef.current === intent || !qrCurrent(intent)) return;
      pollingRequestRef.current = intent;
      try {
        const connected = await checkConnection(session);
        if (!qrCurrent(intent)) return;
        if (connected === true) {
          toast({ title: "Conectado!", description: "WhatsApp conectado com sucesso" });
          closeQr();
          queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
          queryClient.invalidateQueries({ queryKey: ["round-robin-whatsapp-sessions"] });
        }
      } finally { if (pollingRequestRef.current === intent) pollingRequestRef.current = null; }
    }, 5000);
    return () => clearInterval(interval);
  }, [qrDialogOpen, qrGeneration, checkConnection, qrCurrent, closeQr, queryClient]);

  useEffect(() => {
    const intent = qrIntentRef.current;
    if (!intent || !qrCurrent(intent) || sessions?.find(s => s.id === intent.sessionId)?.status !== "connected") return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || !qrCurrent(intent)) return;
      toast({ title: "Conectado!", description: "WhatsApp conectado com sucesso" });
      closeQr();
    });
    return () => { cancelled = true; };
  }, [sessions, qrDialogOpen, qrGeneration, qrCurrent, closeQr]);

  const handleCreateDialogOpenChange = (open: boolean) => {
    setCreateDialogOpen(open);
    if (!open && !createSession.isPending) {
      setInstanceName("");
    }
  };

  const handleOpenCreateDialog = () => {
    if (!canCreateSession) {
      toast({
        title: "Limite do plano atingido",
        description: sessionQuota?.maxSessions
          ? `Esta organização já usa ${sessionQuota.currentSessions} de ${sessionQuota.maxSessions} conexões WhatsApp. Apague uma conexão ou aumente o limite do plano.`
          : "Esta organização não pode criar novas conexões WhatsApp no plano atual.",
        variant: "destructive",
      });
      return;
    }

    setCreateDialogOpen(true);
  };

  const handleCreateSession = async () => {
    if (!instanceName.trim()) return;

    const requestScope = uiScope;
    const requestGeneration = uiGenerationRef.current;
    try {
      const result = await createSession.mutateAsync({
        displayName: instanceName.trim(),
        provider: "evolution_go",
      });
      if ((uiScopeRef.current !== requestScope || uiGenerationRef.current !== requestGeneration)) return;
      setCreateDialogOpen(false);
      setInstanceName("");
      await refreshQRCode(result.session, 5, beginQr(result.session));
    } catch (error) {
      if ((uiScopeRef.current !== requestScope || uiGenerationRef.current !== requestGeneration)) return;
      const message = getErrorMessage(error, "Não foi possível criar a conexão WhatsApp.");
      console.warn("WhatsApp session create failed:", message);
      toast({
        title: "Erro ao criar conexão",
        description: message,
        variant: "destructive",
      });
    }
  };

  const refreshQRCode = async (session: WhatsAppSession, retries = 5, existingIntent?: QrIntent): Promise<"ready" | "empty" | "error" | "cancelled"> => {
    const intent = existingIntent ?? beginQr(session);
    if (!qrCurrent(intent)) return "cancelled";
    setIsRefreshingQr(true);
    try {
      const isGo = session.provider === "evolution_go";
      if (!isGo) {
        throw new Error("Evolution legada está desativada. Crie uma nova conexão Evolution Go.");
      }

      let lastQr: string | null = null;
      let lastError: unknown = null;
      let attempt = 0;

      while (attempt < retries && !lastQr) {
        if (!qrCurrent(intent)) return "cancelled";
        if (attempt > 0) {
          await wait(1500, intent.controller.signal);
          if (!qrCurrent(intent)) return "cancelled";
        }

        try {
          const data = await getQRCode.mutateAsync({
            provider: "evolution_go",
            instanceName: session.instance_name,
            sessionId: session.id,
            instanceId: session.instance_id,
          });

          if (!qrCurrent(intent)) return "cancelled";
          lastQr = getQrCodeValue(data);
        } catch (error) {
          if (!qrCurrent(intent)) return "cancelled";
          lastError = error;
          console.warn("WhatsApp QR attempt failed:", getErrorMessage(error, "QR Code ainda não está pronto."));
        }
        attempt++;
      }

      if (!qrCurrent(intent)) return "cancelled";
      if (lastQr) {
        setQrCode(lastQr);
        queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
        queryClient.invalidateQueries({ queryKey: ["round-robin-whatsapp-sessions"] });
        return "ready";
      } else {
        const description = lastError
          ? getErrorMessage(lastError, "A conexão foi criada, mas o QR Code ainda não ficou pronto. Tente atualizar em alguns instantes.")
          : "A conexão foi criada, mas o QR Code ainda não ficou pronto. Tente atualizar em alguns instantes.";

        toast({
          title: "QR Code ainda nao pronto",
          description,
          variant: "default"
        });
        return "empty";
      }

    } catch (error) {
      if (!qrCurrent(intent)) return "cancelled";
      console.warn("WhatsApp QR code request failed:", getErrorMessage(error, "Falha ao obter QR Code"));
      toast({ title: "Erro", description: getErrorMessage(error, "Falha ao obter QR Code"), variant: "destructive" });
      return "error";
    } finally {
      if (qrCurrent(intent)) setIsRefreshingQr(false);
    }
  };

  const checkConnectionStatus = async (session: WhatsAppSession) => {
    const intent = qrIntentRef.current;
    if (!intent || !qrCurrent(intent) || intent.sessionId !== session.id) return;
    const connected = await checkConnection(session);
    if (!qrCurrent(intent)) return;
    if (connected === true) {
      toast({ title: "Conectado!", description: "WhatsApp conectado com sucesso" });
      closeQr();
    }
  };

  const handleOpenQRDialog = async (session: WhatsAppSession) => {
    await refreshQRCode(session, 5, beginQr(session));
  };

  const handleVerifyConnection = async (session: WhatsAppSession) => {
    const requestScope = uiScope;
    const requestGeneration = uiGenerationRef.current;
    setVerifyingSessionId(session.id);
    try {
      const connected = await checkConnection(session);
      if ((uiScopeRef.current !== requestScope || uiGenerationRef.current !== requestGeneration)) return;
      if (connected === true) {
        toast({ title: "Conectado", description: "WhatsApp está online." });
      } else if (connected === false) {
        toast({ title: "Desconectado", description: "Essa conexão ainda não está online.", variant: "destructive" });
      } else {
        toast({ title: "Não foi possível confirmar", description: "O estado anterior foi mantido. Tente novamente em alguns segundos." });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["round-robin-whatsapp-sessions"] }),
      ]);
    } catch (error) {
      if ((uiScopeRef.current !== requestScope || uiGenerationRef.current !== requestGeneration)) return;
      console.warn("WhatsApp verification failed:", getErrorMessage(error, "Não foi possível verificar a conexão."));
      toast({ title: "Erro", description: "Não foi possível verificar a conexão.", variant: "destructive" });
    } finally {
      if (uiScopeRef.current === requestScope && uiGenerationRef.current === requestGeneration) setVerifyingSessionId((current) => current === session.id ? null : current);
    }
  };

  const handleOpenDeleteDialog = (session: WhatsAppSession) => {
    setSelectedSession(session);
    setDeleteDialogOpen(true);
  };

  const handleDeleteSession = async () => {
    if (!selectedSession) return;
    try {
      const requestScope = uiScope;
      const requestGeneration = uiGenerationRef.current;
      await deleteSession.mutateAsync(selectedSession);
      if ((uiScopeRef.current !== requestScope || uiGenerationRef.current !== requestGeneration)) return;
      setDeleteDialogOpen(false);
      setSelectedSession(null);
    } catch {
      // The mutation already shows the toast; avoid bubbling into the Next.js overlay.
    }
  };

  const handleLogout = async () => {
    if (!sessionToDisconnect) return;
    try {
      const requestScope = uiScope;
      const requestGeneration = uiGenerationRef.current;
      await logoutSession.mutateAsync(sessionToDisconnect);
      if ((uiScopeRef.current !== requestScope || uiGenerationRef.current !== requestGeneration)) return;
      setSessionToDisconnect(null);
    } catch {
      // The mutation already shows the toast; avoid bubbling into the Next.js overlay.
    }
  };


  const getStatusBadge = (status: string) => {
    if (compactPage) {
      const presentation = getWhatsAppStatusPresentation(status);
      return (
        <Badge
          variant="outline"
          title={presentation.label}
          className={`${WHATSAPP_SESSION_STATUS_SIZE_CLASS_NAME} ${getWhatsAppStatusBadgeClassName(status)}`}
        >
          <span className="min-w-0 truncate">{presentation.label}</span>
        </Badge>
      );
    }
    switch (status) {
      case "connected":
        return <Badge className="bg-green-500 hover:bg-green-600"><CheckCircle className="w-3 h-3 mr-1" />Conectado</Badge>;
      case "qr_ready":
        return <Badge className="bg-blue-500 hover:bg-blue-600"><QrCode className="w-3 h-3 mr-1" />Aguardando Leitura</Badge>;
      case "connecting":
        return <Badge className="bg-yellow-500 hover:bg-yellow-600"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Conectando</Badge>;
      case "error":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Erro</Badge>;
      default:
        return <Badge variant="secondary"><XCircle className="w-3 h-3 mr-1" />Desconectado</Badge>;
    }

  };

  return (
    <Card className={unifiedPage ? "flex h-full min-h-0 min-w-0 flex-col gap-3 border-0 bg-transparent shadow-none" : compactPage ? "@container min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none" : embedded ? "border-0 bg-transparent shadow-none" : undefined}>
      {embedded &&
      <Button
        data-tour="whatsapp-new-session"
        size="sm"
        onClick={handleOpenCreateDialog}
        disabled={newSessionDisabled}
        className="absolute right-14 top-4 z-10 shrink-0"
        title={newSessionTitle}
      >
          <Plus className="w-4 h-4 mr-1.5" />
          {canCreateSession ? "Nova" : "Limite atingido"}
        </Button>
      }
      {!embedded &&
      <CardHeader data-whatsapp-toolbar={unifiedPage ? "true" : undefined} className={unifiedPage ? "app-toolbar shrink-0 overflow-visible px-2 py-1" : compactPage ? "px-3 pb-3 pt-3 sm:px-4 sm:pt-4" : "pb-3"}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {unifiedPage ? (
              <div data-whatsapp-connected-count={connectedCount} aria-label="Conexões WhatsApp conectadas" title={`${visibleRowCount} conexões visíveis`} className="flex h-8 shrink-0 items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 text-[12px] font-light text-[var(--app-text-secondary)]">
                <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground"><Smartphone className="h-3 w-3" aria-hidden="true" /></span>
                <span className="text-[var(--app-text-primary)]">{ownerStatuses.isLoading || (managementAllowed && isLoading) ? "..." : formatPtBRNumber(connectedCount)}</span>
                <span>conectadas</span>
              </div>
            ) :
            <CardTitle className={compactPage ? "flex items-center gap-2 text-sm font-medium text-[var(--app-text-primary)]" : "flex items-center gap-2 text-base sm:text-lg"}>
              <Smartphone className={compactPage ? "h-4 w-4 shrink-0" : "h-4 w-4 sm:h-5 sm:w-5 shrink-0"} />
              Conexões WhatsApp
            </CardTitle>
            }
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!unifiedPage && sessionLimitLabel && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {sessionLimitLabel}
              </span>
            )}
            {managementAllowed && <Button
              data-tour="whatsapp-new-session"
              size="sm"
              onClick={handleOpenCreateDialog}
              disabled={newSessionDisabled}
              className={unifiedPage ? `h-8 shrink-0 gap-1.5 rounded-[6px] px-2.5 text-[11px] focus-visible:ring-1 focus-visible:ring-primary/30 ${WHATSAPP_SESSION_ACTION_CLASS_NAME}` : compactPage ? `h-9 shrink-0 gap-1.5 rounded-[6px] px-4 text-[12px] ${WHATSAPP_SESSION_ACTION_CLASS_NAME}` : "shrink-0"}
              title={newSessionTitle}
              aria-label={unifiedPage ? "Conectar nova conexão WhatsApp" : undefined}
            >
              <Plus className={compactPage ? "h-4 w-4" : "w-4 h-4 mr-1.5"} />
              {unifiedPage ? <><span className="hidden sm:inline">Nova conexão</span><span className="sm:hidden">Nova</span></> : "Nova"}
            </Button>}
          </div>
        </div>
      </CardHeader>
      }
      <CardContent className={unifiedPage ? "flex min-h-0 min-w-0 flex-1 flex-col p-0" : compactPage ? "px-3 pb-3 sm:px-4 sm:pb-4" : embedded ? "px-0 pb-0 pt-2" : undefined}>
        {!unifiedPage && isLoading ?
        <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div> :
        !unifiedPage && sessionsFailed ?
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">Não foi possível carregar as conexões WhatsApp.</p>
            <Button variant="outline" size="sm" className={compactPage ? `rounded-[6px] ${WHATSAPP_SESSION_ACTION_CLASS_NAME}` : undefined} onClick={() => void refetchSessions()}>
              Tentar novamente
            </Button>
          </div> :
        !unifiedPage && sessions?.length === 0 ?
        <div className="flex flex-col items-center justify-center py-12">
            <Smartphone className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Nenhuma conexão</h3>
            <p className="text-muted-foreground text-center mb-4">
              Conecte seu primeiro WhatsApp para começar a receber mensagens
            </p>
            <Button data-tour="whatsapp-new-session" className={compactPage ? `h-9 rounded-[6px] text-[12px] ${WHATSAPP_SESSION_ACTION_CLASS_NAME}` : undefined} onClick={handleOpenCreateDialog} disabled={!canCreateSession || isLoading}>
              <Plus className="w-4 h-4 mr-2" />
              Conectar WhatsApp
            </Button>
          </div> :

        <div style={unifiedPage ? { background: "var(--app-surface-solid)" } : undefined} className={unifiedPage ? "@container app-card relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-0 shadow-none" : undefined}>
        <div data-whatsapp-scroll-region={unifiedPage ? "true" : undefined} role={compactPage ? "list" : undefined} aria-label={compactPage ? "Conexões WhatsApp" : undefined} className={unifiedPage ? "app-scrollbar min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain" : compactPage ? "space-y-2" : embedded ? "grid gap-3 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 px-[10px]"}>
          {compactPage ? (
            <div data-whatsapp-list-header aria-hidden="true" className={unifiedPage ? `crm-management-sticky-header sticky top-0 z-20 hidden h-8 shrink-0 items-center gap-x-2.5 px-2.5 text-[10px] font-light text-[var(--app-text-tertiary)] @min-[840px]:grid ${WHATSAPP_SESSION_LIST_COLUMNS_CLASS_NAME}` : "mb-2 hidden grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,0.7fr)_136px_146px] items-center gap-x-3 rounded-[6px] bg-[var(--app-surface-hover)] px-3 py-2 text-[12px] font-light text-[var(--app-text-secondary)] @min-[840px]:grid"}>
              <span>Usuário</span>
              <span>Conexão</span>
              <span>Número</span>
              <span>Status</span>
              <span className="text-right">Ações</span>
            </div>
          ) : null}
            {unifiedPage && managementAllowed && sessionsFailed ? (
              <div role="listitem" className="flex items-center justify-between gap-3 px-2.5 py-3 text-[12px] font-light text-[var(--app-text-secondary)]">
                <span>Não foi possível carregar os controles das suas conexões.</span>
                <Button size="sm" className={`h-8 shrink-0 rounded-[6px] text-[11px] ${WHATSAPP_SESSION_ACTION_CLASS_NAME}`} onClick={() => void refetchSessions()}>Tentar novamente</Button>
              </div>
            ) : null}
            {operationalRows?.map((session, index) => {
              const canManageThisSession = managementAllowed && originalOrganization && session.owner_user_id === profile?.id;
              const ownerSummary = ownerStatuses.data?.data.find((item) => item.id === session.id)?.owner;
              const ownerName = ownerSummary?.name || session.owner?.name || (session.owner_user_id === profile?.id ? profile?.name : null) || "Usuário";
              const ownerAvatar = ownerSummary?.avatar_url || (session.owner_user_id === profile?.id ? profile?.avatar_url : null);
              const phoneLabel = formatWhatsAppContactPhoneForDisplay(session.phone_number) || session.profile_name || "Número não identificado";
              const canShareThisSession = managementAllowed && originalOrganization && canShareOwnWhatsAppSession({
                ownerUserId: session.owner_user_id,
                currentUserId: sharingActor.userId,
                memberRole: sharingActor.memberRole,
                isSuperAdmin: sharingActor.isSuperAdmin,
                isTeamLeader: sharingActor.isTeamLeader,
              });

              return (
          <Card key={session.id} role={compactPage ? "listitem" : undefined} data-whatsapp-session-id={session.id} data-whatsapp-row-kind={unifiedPage ? "managed" : undefined} data-whatsapp-owner-id={session.owner_user_id} data-tour={index === 0 ? "whatsapp-session-card" : undefined} className={unifiedPage ? "w-full min-w-0 rounded-none border-0 bg-transparent shadow-none" : compactPage ? "w-full min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] shadow-none" : "border"}>
                <CardContent style={unifiedPage ? WHATSAPP_SESSION_LIST_ROW_STYLE : undefined} className={unifiedPage ? WHATSAPP_SESSION_LIST_ROW_CLASS_NAME : compactPage ? "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 p-3 @min-[840px]:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,0.7fr)_136px_146px]" : "p-3 space-y-2.5"}>
                  {/* Row 1: Avatar + name + status badge */}
                  <div data-whatsapp-column={compactPage ? "identity" : undefined} className={compactPage ? "col-start-1 row-start-1 flex min-w-0 items-center gap-2.5" : "flex items-center gap-2.5"}>
                    <Avatar className={unifiedPage ? "h-9 w-9 shrink-0 rounded-[6px] [&_img]:rounded-[6px]" : compactPage ? "h-8 w-8 shrink-0 rounded-[8px]" : "h-9 w-9 shrink-0"}>
                      <AvatarImage src={(compactPage ? ownerAvatar : session.profile_picture) || undefined} alt={compactPage ? ownerName : undefined} />
                      <AvatarFallback className={unifiedPage ? "rounded-[6px] bg-primary/50 text-[11px] font-light text-primary-foreground" : compactPage ? "rounded-[8px] bg-primary/50 text-[12px] font-light text-white" : undefined}>
                        {compactPage ? ownerName.trim().slice(0, 1).toUpperCase() :
                        <Smartphone className="w-4 h-4" />
                        }
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p title={compactPage ? ownerName : session.display_name || session.instance_name} className={unifiedPage ? "min-w-0 truncate text-[13px] font-light text-[var(--app-text-primary)]" : compactPage ? "truncate text-[13px] font-medium leading-tight text-[var(--app-text-primary)]" : "font-medium text-sm truncate leading-tight"}>{compactPage ? ownerName : session.display_name || session.instance_name}</p>
                      {!compactPage && <p title={session.phone_number || session.profile_name || undefined} className="text-xs text-muted-foreground truncate leading-tight">
                        {session.status === "connected" ?
                    session.phone_number || session.profile_name || "Conectado" :
                    "Não conectado"}
                      </p>}
                    </div>
                    {!compactPage && <div data-whatsapp-column="status" className="shrink-0">{getStatusBadge(session.status)}</div>}
                  </div>
                  {compactPage ? (
                    <>
                      <span data-whatsapp-column="connection" title={session.display_name || session.instance_name} className="col-start-1 row-start-2 min-w-0 truncate text-[12px] font-light text-[var(--app-text-secondary)] @min-[840px]:col-start-2 @min-[840px]:row-start-1">{session.display_name || session.instance_name}</span>
                      <span data-whatsapp-column="phone" title={phoneLabel} className="col-start-1 row-start-3 min-w-0 truncate text-[12px] font-light text-[var(--app-text-secondary)] @min-[840px]:col-start-3 @min-[840px]:row-start-1">{phoneLabel}</span>
                      <div data-whatsapp-column="status" className="col-start-2 row-start-1 flex justify-end @min-[840px]:col-start-4">{getStatusBadge(session.status)}</div>
                    </>
                  ) : null}

                  {/* Row 2: Responsavel + notificacao toggle */}
                  <div data-whatsapp-column="owner" className={compactPage ? "contents" : "flex items-center justify-between gap-2 border-y border-[var(--app-border)] py-1.5"}>
                    {!compactPage &&
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      {session.is_notification_session &&
                  <Badge variant="outline" className={compactPage ? "shrink-0 border-0 bg-primary/10 px-1.5 py-0 text-[10px] text-primary" : "text-orange-600 border-orange-300 bg-orange-50 text-[10px] px-1.5 py-0 shrink-0"}>
                          <Bell className="w-2.5 h-2.5 mr-0.5" />
                          Notif.
                        </Badge>
                  }
                      <span title={session.owner?.name || (canManageThisSession ? "-" : "Compartilhado com você")} className="text-xs text-muted-foreground truncate">
                        {session.owner?.name || (canManageThisSession ? "-" : "Compartilhado com você")}
                      </span>
                    </div>
                    }
                    {!compactPage && canManageThisSession && canManageNotificationSession &&
                <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div data-tour={index === 0 ? "whatsapp-notification-toggle" : undefined} className="flex items-center gap-1.5 shrink-0">
                              <Bell className="w-3.5 h-3.5 text-muted-foreground" />
                              <Switch
                          checked={session.is_notification_session || false}
                          onCheckedChange={(checked) =>
                          toggleNotification.mutate({ sessionId: session.id, enabled: checked })
                          }
                          disabled={toggleNotification.isPending} />

                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Usar para enviar notificações via WhatsApp</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                }
                  </div>
                  {/* Row 3: Action buttons */}
                  <div data-whatsapp-column="actions" className={compactPage ? "col-start-2 row-start-3 flex min-h-8 items-center justify-end gap-1.5 @min-[840px]:col-start-5 @min-[840px]:row-start-1" : "flex flex-wrap items-center justify-end gap-2"}>
                    {compactPage && canManageThisSession && canManageNotificationSession ? (
                      <WhatsAppActionTooltip label="Usar para enviar notificações via WhatsApp">
                            <Button
                              type="button"
                              role="switch"
                              aria-checked={session.is_notification_session || false}
                              aria-label="Usar para enviar notificações via WhatsApp"
                              data-tour={index === 0 ? "whatsapp-notification-toggle" : undefined}
                              className={`h-8 w-8 shrink-0 rounded-[6px] p-0 border-0 text-primary-foreground shadow-none hover:bg-primary hover:text-primary-foreground ${session.is_notification_session ? "bg-primary" : "bg-primary/50"}`}
                              disabled={toggleNotification.isPending}
                              onClick={() => toggleNotification.mutate({ sessionId: session.id, enabled: !session.is_notification_session })}
                            ><Bell className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                      </WhatsAppActionTooltip>
                    ) : null}
                    {canShareThisSession ? (
                      <WhatsAppActionTooltip enabled={compactPage} label="Compartilhar">
                      <Button type="button" variant="outline" size="sm" aria-label="Compartilhar" title={compactPage ? undefined : "Compartilhar"} className={compactPage ? `h-8 w-8 shrink-0 rounded-[6px] p-0 ${WHATSAPP_SESSION_ACTION_CLASS_NAME}` : "h-8 gap-1.5 px-3 text-xs"} onClick={() => setSessionToShare(session)}>
                        <Users className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className={compactPage ? "sr-only" : undefined}>Compartilhar</span>
                      </Button>
                      </WhatsAppActionTooltip>
                    ) : null}
                    {canManageThisSession && !compactPage && <Button
                      data-tour={index === 0 ? "whatsapp-verify-button" : undefined}
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 px-3 text-xs"
                      onClick={() => handleVerifyConnection(session)}
                      disabled={verifyingSessionId === session.id}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${verifyingSessionId === session.id ? "animate-spin" : ""}`} />
                      Verificar
                    </Button>}
                    {canManageThisSession && session.status !== "connected" ? (
                      <>
                        <WhatsAppActionTooltip enabled={compactPage} label="QR Code">
                        <Button data-tour={index === 0 ? "whatsapp-qr-button" : undefined} variant="outline" size="sm" aria-label="QR Code" title={compactPage ? undefined : "QR Code"} className={compactPage ? `h-8 w-8 shrink-0 rounded-[6px] p-0 ${WHATSAPP_SESSION_ACTION_CLASS_NAME}` : "h-8 gap-1.5 px-3 text-xs"} onClick={() => handleOpenQRDialog(session)}>
                          <QrCode className="w-3.5 h-3.5" />
                          <span className={compactPage ? "sr-only" : undefined}>QR Code</span>
                        </Button>
                        </WhatsAppActionTooltip>
                        <WhatsAppActionTooltip enabled={compactPage} label="Apagar conexão">
                        <Button
                          data-tour={index === 0 ? "whatsapp-delete-button" : undefined}
                          variant="destructive"
                          size="sm"
                          className={compactPage ? `h-8 w-8 shrink-0 rounded-[6px] p-0 ${WHATSAPP_SESSION_ACTION_CLASS_NAME}` : "h-8 w-8 p-0"}
                          onClick={() => handleOpenDeleteDialog(session)}
                          aria-label="Apagar conexão"
                          title={compactPage ? undefined : "Apagar conexão"}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                        </WhatsAppActionTooltip>
                      </>
                    ) : canManageThisSession ? (
                      <>
                        <WhatsAppActionTooltip enabled={compactPage} label="Desconectar">
                        <Button data-tour={index === 0 ? "whatsapp-disconnect-button" : undefined} variant="destructive" size="sm" aria-label="Desconectar" title={compactPage ? undefined : "Desconectar"} className={compactPage ? `h-8 w-8 shrink-0 rounded-[6px] p-0 ${WHATSAPP_SESSION_ACTION_CLASS_NAME}` : "h-8 gap-1.5 px-3 text-xs"} onClick={() => setSessionToDisconnect(session)}>
                          <LogOut className="w-3.5 h-3.5" />
                          <span className={compactPage ? "sr-only" : undefined}>Desconectar</span>
                        </Button>
                        </WhatsAppActionTooltip>
                        <WhatsAppActionTooltip enabled={compactPage} label="Apagar conexão">
                        <Button
                          data-tour={index === 0 ? "whatsapp-delete-button" : undefined}
                          variant="destructive"
                          size="sm"
                          className={compactPage ? `h-8 w-8 shrink-0 rounded-[6px] p-0 ${WHATSAPP_SESSION_ACTION_CLASS_NAME}` : "h-8 w-8 p-0"}
                          onClick={() => handleOpenDeleteDialog(session)}
                          aria-label="Apagar conexão"
                          title={compactPage ? undefined : "Apagar conexão"}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                        </WhatsAppActionTooltip>
                      </>
                    ) : null}
                  </div></CardContent>
              </Card>
              );
            })}
            {unifiedPage ? <WhatsAppSessionStatusPanel embedded excludedSessionIds={operationalIds} additionalSessions={additionalSessions} viewerUserId={profile?.id} allowProviderVerification={managementAllowed} /> : null}
          </div>
        </div>
        }

        {/* Create Session Dialog */}
        <WhatsAppSessionAccessDialog
          session={uiCurrent ? sessionToShare : null}
          actor={sharingActor}
          open={uiCurrent && Boolean(sessionToShare)}
          onOpenChange={(open) => { if (!open) setSessionToShare(null); }}
        />
        <Dialog open={uiCurrent && createDialogOpen} onOpenChange={handleCreateDialogOpenChange}>
          <DialogContent data-tour="whatsapp-create-dialog" className="w-[calc(100vw-2rem)] max-w-md rounded-[8px] p-5">
            <DialogHeader>
              <DialogTitle>Nova conexão WhatsApp</DialogTitle>
            </DialogHeader>
            <div className="py-2">
              <div className="space-y-2">
                <Label>Nome da conexão</Label>
                <Input
                  data-tour="whatsapp-instance-name"
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                  placeholder="Ex: Vendas" />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:space-x-0">
              <Button variant="outline" className={compactPage ? `rounded-[6px] ${WHATSAPP_SESSION_ACTION_CLASS_NAME}` : undefined} onClick={() => handleCreateDialogOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                className={compactPage ? `rounded-[6px] ${WHATSAPP_SESSION_ACTION_CLASS_NAME}` : undefined}
                onClick={handleCreateSession}
                disabled={!instanceName.trim() || createSession.isPending}>
                {createSession.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Criar e Conectar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* QR Code Dialog */}
        <Dialog open={uiCurrent && qrDialogOpen} onOpenChange={(open) => { if (!open) closeQr(); }}>
          <DialogContent data-tour="whatsapp-qr-dialog" className="w-[92vw] max-w-[92vw] rounded-lg md:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Escanear QR Code</DialogTitle>
              <DialogDescription>
                Abra o WhatsApp no seu celular e escaneie o código abaixo
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-6 md:grid-cols-[minmax(240px,280px)_1fr] md:items-center">
              <div className="flex justify-center">
                {isRefreshingQr ?
                <div className="flex h-64 w-64 items-center justify-center rounded-lg bg-[var(--app-surface-soft)]">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  </div> :
                qrCode ?
                <NextImage
                  src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                  alt="QR Code"
                  width={256}
                  height={256}
                  className="h-64 w-64 rounded-lg"
                  unoptimized
                /> :


                <div className="flex h-64 w-64 items-center justify-center rounded-lg bg-[var(--app-surface-soft)]">
                    <p className="text-muted-foreground text-center px-4">
                      Não foi possível gerar o QR Code
                    </p>
                  </div>
                }
              </div>
              <div className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-soft)] p-4 text-left">
                <p className="mb-3 text-sm font-normal text-foreground">Como conectar:</p>
                <ol className="list-decimal space-y-1 pl-4 text-sm leading-relaxed text-muted-foreground">
                  <li>Abra o WhatsApp no seu celular</li>
                  <li>Toque em Menu ou Configurações</li>
                  <li>Toque em Dispositivos conectados</li>
                  <li>Toque em Conectar um dispositivo</li>
                  <li>Aponte seu celular para esta tela para capturar o código</li>
                </ol>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row md:col-span-2 md:justify-center">
                <Button
                  variant="outline"
                  className={compactPage ? `rounded-[6px] ${WHATSAPP_SESSION_ACTION_CLASS_NAME}` : undefined}
                  onClick={() => selectedSession && refreshQRCode(selectedSession)}
                  disabled={isRefreshingQr}>

                  <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshingQr ? "animate-spin" : ""}`} />
                  Atualizar
                </Button>
                <Button
                  className={compactPage ? `rounded-[6px] ${WHATSAPP_SESSION_ACTION_CLASS_NAME}` : undefined}
                  onClick={() => selectedSession && checkConnectionStatus(selectedSession)}
                  disabled={getConnectionStatus.isPending}>

                  {getConnectionStatus.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Verificar Conexão
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={uiCurrent && deleteDialogOpen}
          onOpenChange={(open) => {
            if (!open && deleteSession.isPending) return;
            setDeleteDialogOpen(open);
            if (!open) setSelectedSession(null);
          }}
        >
          <AlertDialogContent className="w-[95%] max-w-[400px] rounded-lg">
            <AlertDialogHeader>
              <AlertDialogTitle>Apagar conexão</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja apagar a conexão &quot;{selectedSession?.display_name || selectedSession?.instance_name}&quot;?
                As conversas e mensagens salvas serão preservadas no histórico.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex flex-row justify-end gap-3 pt-2 sm:gap-2">
              <AlertDialogCancel disabled={deleteSession.isPending} className={compactPage ? `flex-1 rounded-[6px] sm:flex-none ${WHATSAPP_SESSION_ACTION_CLASS_NAME}` : "flex-1 sm:flex-none"}>
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void handleDeleteSession();
                }}
                disabled={deleteSession.isPending}
                className={compactPage ? `flex-1 rounded-[6px] sm:flex-none ${WHATSAPP_SESSION_ACTION_CLASS_NAME}` : "flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:flex-none"}>
                {deleteSession.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Apagar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={uiCurrent && !!sessionToDisconnect}
          onOpenChange={(open) => !open && !logoutSession.isPending && setSessionToDisconnect(null)}
        >
          <AlertDialogContent className="w-[95%] max-w-[400px] rounded-lg">
            <AlertDialogHeader>
              <AlertDialogTitle>Desconectar WhatsApp?</AlertDialogTitle>
              <AlertDialogDescription>
                A conexão &quot;{sessionToDisconnect?.display_name || sessionToDisconnect?.instance_name}&quot; deixará de enviar e receber mensagens até uma nova leitura do QR Code.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={logoutSession.isPending} className={compactPage ? `rounded-[6px] ${WHATSAPP_SESSION_ACTION_CLASS_NAME}` : undefined}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void handleLogout();
                }}
                disabled={logoutSession.isPending}
                className={compactPage ? `rounded-[6px] ${WHATSAPP_SESSION_ACTION_CLASS_NAME}` : "bg-destructive text-destructive-foreground hover:bg-destructive/90"}
              >
                {logoutSession.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Desconectar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>


      </CardContent>
    </Card>);

}
