import { useState, useEffect, useRef, useCallback } from "react";
import NextImage from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  Bell } from
"lucide-react";
import {
  useWhatsAppSessions,
  useCreateWhatsAppSession,
  useDeleteWhatsAppSession,
  useGetQRCode,
  useGetConnectionStatus,
  useLogoutSession,
  useRecreateWhatsAppInstance,
  useToggleNotificationSession,
  type WhatsAppSession } from
  "@/hooks/use-whatsapp-sessions";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { canManageOrganization } from "@/lib/access/organization";

interface WhatsAppTabProps {
  embedded?: boolean;
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

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function WhatsAppTab({ embedded = false }: WhatsAppTabProps = {}) {
  const { profile, tenantContext, isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const { data: sessions, isLoading, isError: sessionsFailed, refetch: refetchSessions } = useWhatsAppSessions();
  const createSession = useCreateWhatsAppSession();
  const deleteSession = useDeleteWhatsAppSession();
  const getQRCode = useGetQRCode();
  const getConnectionStatus = useGetConnectionStatus();
  const logoutSession = useLogoutSession();
  const recreateSession = useRecreateWhatsAppInstance();
  const toggleNotification = useToggleNotificationSession();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [instanceName, setInstanceName] = useState("");
  const [selectedSession, setSelectedSession] = useState<WhatsAppSession | null>(null);
  const [sessionToDisconnect, setSessionToDisconnect] = useState<WhatsAppSession | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isRefreshingQr, setIsRefreshingQr] = useState(false);
  const [verifyingSessionId, setVerifyingSessionId] = useState<string | null>(null);
  const sessionQuota = sessions?.meta;
  const activeSessionCount = sessions?.length ?? 0;
  const maxSessions = sessionQuota?.maxSessions ?? null;
  const canCreateSession = sessionQuota?.canCreate ?? false;
  const sessionLimitLabel = maxSessions
    ? `${canCreateSession ? "" : "Limite atingido: "}${sessionQuota?.currentSessions ?? activeSessionCount}/${maxSessions} conexoes`
    : sessionQuota ? null : "Verificando limite";
  const newSessionDisabled = !canCreateSession || isLoading;
  const newSessionTitle = !canCreateSession ? "Limite do plano atingido" : undefined;
  const canManageNotificationSession = canManageOrganization({
    isSuperAdmin,
    memberRole: tenantContext?.memberRole,
  });

  // Refs para evitar stale closures no polling
  const selectedSessionRef = useRef(selectedSession);
  const qrDialogOpenRef = useRef(qrDialogOpen);

  useEffect(() => {
    selectedSessionRef.current = selectedSession;
    qrDialogOpenRef.current = qrDialogOpen;
  }, [selectedSession, qrDialogOpen]);

  // Funcao de check separada para usar no polling
  const checkConnection = useCallback(async (session: WhatsAppSession): Promise<boolean | null> => {
    try {
      if (session.provider !== "evolution_go") {
        return false;
      }

      const status = await getConnectionStatus.mutateAsync({
        provider: "evolution_go",
        instanceName: session.instance_name,
        sessionId: session.id,
        instanceId: session.instance_id,
      });

      return status?.connected === true || status?.state === "open" || status?.status === "connected";
    } catch {
      return null;
    }
  }, [getConnectionStatus]);


  // Polling para verificar conexao automaticamente quando o QR dialog esta aberto
  useEffect(() => {
    if (!qrDialogOpen || !selectedSessionRef.current) return;

    const pollInterval = setInterval(async () => {
      if (!qrDialogOpenRef.current || !selectedSessionRef.current) {
        clearInterval(pollInterval);
        return;
      }

      const connected = await checkConnection(selectedSessionRef.current);

      if (connected === true) {
        toast({ title: "Conectado!", description: "WhatsApp conectado com sucesso" });
        setQrDialogOpen(false);
        setQrCode(null);
        queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
        clearInterval(pollInterval);
      }
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [qrDialogOpen, selectedSession?.id, checkConnection, queryClient]);

  // Fechar o dialogo de QR Code automaticamente se o status mudar para conectado (via Realtime)
  useEffect(() => {
    if (!qrDialogOpen || !selectedSession) return;

    const currentSession = sessions?.find(s => s.id === selectedSession.id);
    if (currentSession?.status === 'connected') {
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        toast({ title: "Conectado!", description: "WhatsApp conectado com sucesso" });
        setQrDialogOpen(false);
        setQrCode(null);
        setSelectedSession(null);
      });

      return () => {
        cancelled = true;
      };
    }
  }, [sessions, qrDialogOpen, selectedSession]);


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

    try {
      const result = await createSession.mutateAsync({
        displayName: instanceName.trim(),
        provider: "evolution_go",
      });
      setCreateDialogOpen(false);
      setInstanceName("");

      setSelectedSession(result.session);
      setQrDialogOpen(true);

      await refreshQRCode(result.session);
    } catch (error) {
      const message = getErrorMessage(error, "Não foi possível criar a conexão WhatsApp.");
      console.warn("WhatsApp session create failed:", message);
      toast({
        title: "Erro ao criar conexão",
        description: message,
        variant: "destructive",
      });
    }
  };

  const refreshQRCode = async (session: WhatsAppSession, retries = 5): Promise<"ready" | "empty" | "error"> => {
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
        if (attempt > 0) {
          await wait(1500);
        }

        try {
          const data = await getQRCode.mutateAsync({
            provider: "evolution_go",
            instanceName: session.instance_name,
            sessionId: session.id,
            instanceId: session.instance_id,
          });

          lastQr = getQrCodeValue(data);
        } catch (error) {
          lastError = error;
          console.warn("WhatsApp QR attempt failed:", getErrorMessage(error, "QR Code ainda não está pronto."));
        }
        attempt++;
      }

      if (lastQr) {
        setQrCode(lastQr);
        queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
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
      console.warn("WhatsApp QR code request failed:", getErrorMessage(error, "Falha ao obter QR Code"));
      toast({ title: "Erro", description: getErrorMessage(error, "Falha ao obter QR Code"), variant: "destructive" });
      return "error";
    } finally {
      setIsRefreshingQr(false);
    }
  };

  const checkConnectionStatus = async (session: WhatsAppSession) => {
    try {
      const isGo = session.provider === "evolution_go";
      if (!isGo) {
        throw new Error("Evolution legada está desativada. Crie uma nova conexão Evolution Go.");
      }
      const data = await getConnectionStatus.mutateAsync({
        provider: "evolution_go",
        instanceName: session.instance_name,
        sessionId: session.id,
        instanceId: session.instance_id,
      });
      if (data?.state === "open" || data?.connected === true) {
        toast({ title: "Conectado!", description: "WhatsApp conectado com sucesso" });
        setQrDialogOpen(false);
        setQrCode(null);
      }
    } catch (error) {
      console.warn("WhatsApp status check failed:", getErrorMessage(error, "Não foi possível verificar a conexão."));
    }
  };

  const handleOpenQRDialog = async (session: WhatsAppSession) => {
    setSelectedSession(session);
    setQrDialogOpen(true);
    const refreshStatus = await refreshQRCode(session);

    if (refreshStatus === "error") {
      try {
        if (session.provider !== "evolution_go") {
          throw new Error("Evolution legada está desativada. Crie uma nova conexão Evolution Go.");
        }

        const result = await recreateSession.mutateAsync(session);
        const nextSession = result.session || session;
        setSelectedSession(nextSession);
        await wait(1500);
        await refreshQRCode(nextSession);
      } catch (e) {
        console.warn("WhatsApp instance recreate failed:", getErrorMessage(e, "Não foi possível reconectar."));
        toast({ title: "Erro", description: "Não foi possível reconectar. Tente excluir e criar uma nova conexão.", variant: "destructive" });
      }
    }
  };

  const handleVerifyConnection = async (session: WhatsAppSession) => {
    setVerifyingSessionId(session.id);
    try {
      const connected = await checkConnection(session);
      if (connected) {
        toast({ title: "Conectado", description: "WhatsApp está online." });
      } else {
        toast({ title: "Desconectado", description: "Essa conexão ainda não está online.", variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
    } catch (error) {
      console.warn("WhatsApp verification failed:", getErrorMessage(error, "Não foi possível verificar a conexão."));
      toast({ title: "Erro", description: "Não foi possível verificar a conexão.", variant: "destructive" });
    } finally {
      setVerifyingSessionId(null);
    }
  };

  const handleOpenDeleteDialog = (session: WhatsAppSession) => {
    setSelectedSession(session);
    setDeleteDialogOpen(true);
  };

  const handleDeleteSession = async () => {
    if (!selectedSession) return;
    try {
      await deleteSession.mutateAsync(selectedSession);
      setDeleteDialogOpen(false);
      setSelectedSession(null);
    } catch {
      // The mutation already shows the toast; avoid bubbling into the Next.js overlay.
    }
  };

  const handleLogout = async () => {
    if (!sessionToDisconnect) return;
    try {
      await logoutSession.mutateAsync(sessionToDisconnect);
      setSessionToDisconnect(null);
    } catch {
      // The mutation already shows the toast; avoid bubbling into the Next.js overlay.
    }
  };


  const getStatusBadge = (status: string) => {
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
    <Card className={embedded ? "border-0 bg-transparent shadow-none" : undefined}>
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
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Smartphone className="h-4 w-4 sm:h-5 sm:w-5 shrink-0" />
              Conexões WhatsApp
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm mt-0.5">
              Gerencie suas conexões via Evolution Go
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {sessionLimitLabel && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {sessionLimitLabel}
              </span>
            )}
            <Button
              data-tour="whatsapp-new-session"
              size="sm"
              onClick={handleOpenCreateDialog}
              disabled={newSessionDisabled}
              className="shrink-0"
              title={newSessionTitle}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Nova
            </Button>
          </div>
        </div>
      </CardHeader>
      }
      <CardContent className={embedded ? "px-0 pb-0 pt-2" : undefined}>
        {isLoading ?
        <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div> :
        sessionsFailed ?
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">Não foi possível carregar as conexões WhatsApp.</p>
            <Button variant="outline" size="sm" onClick={() => void refetchSessions()}>
              Tentar novamente
            </Button>
          </div> :
        sessions?.length === 0 ?
        <div className="flex flex-col items-center justify-center py-12">
            <Smartphone className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Nenhuma conexão</h3>
            <p className="text-muted-foreground text-center mb-4">
              Conecte seu primeiro WhatsApp para começar a receber mensagens
            </p>
            <Button data-tour="whatsapp-new-session" onClick={handleOpenCreateDialog} disabled={!canCreateSession || isLoading}>
              <Plus className="w-4 h-4 mr-2" />
              Conectar WhatsApp
            </Button>
          </div> :

        <div className={embedded ? "grid gap-3 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 px-[10px]"}>
            {sessions?.map((session, index) => {
              const canManageThisSession = session.owner_user_id === profile?.id;

              return (
          <Card key={session.id} data-tour={index === 0 ? "whatsapp-session-card" : undefined} className="border">
                <CardContent className="p-3 space-y-2.5">
                  {/* Row 1: Avatar + name + status badge */}
                  <div className="flex items-center gap-2.5">
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarImage src={session.profile_picture || undefined} />
                      <AvatarFallback>
                        <Smartphone className="w-4 h-4" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate leading-tight">{session.display_name || session.instance_name}</p>
                      <p className="text-xs text-muted-foreground truncate leading-tight">
                        {session.status === "connected" ?
                    session.phone_number || session.profile_name || "Conectado" :
                    "Não conectado"}
                      </p>
                    </div>
                    <div className="shrink-0">{getStatusBadge(session.status)}</div>
                  </div>

                  {/* Row 2: Responsavel + notificacao toggle */}
                  <div className="flex items-center justify-between gap-2 border-y border-[var(--app-border)] py-1.5">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      {session.is_notification_session &&
                  <Badge variant="outline" className="text-orange-600 border-orange-300 bg-orange-50 text-[10px] px-1.5 py-0 shrink-0">
                          <Bell className="w-2.5 h-2.5 mr-0.5" />
                          Notif.
                        </Badge>
                  }
                      <span className="text-xs text-muted-foreground truncate">
                        {session.owner?.name || "-"}
                      </span>
                    </div>
                    {canManageThisSession && canManageNotificationSession &&
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
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      data-tour={index === 0 ? "whatsapp-verify-button" : undefined}
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 px-3 text-xs"
                      onClick={() => handleVerifyConnection(session)}
                      disabled={verifyingSessionId === session.id}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${verifyingSessionId === session.id ? "animate-spin" : ""}`} />
                      Verificar
                    </Button>
                    {canManageThisSession && session.status !== "connected" ? (
                      <>
                        <Button data-tour={index === 0 ? "whatsapp-qr-button" : undefined} variant="outline" size="sm" className="h-8 gap-1.5 px-3 text-xs" onClick={() => handleOpenQRDialog(session)}>
                          <QrCode className="w-3.5 h-3.5" />
                          QR Code
                        </Button>
                        <Button
                          data-tour={index === 0 ? "whatsapp-delete-button" : undefined}
                          variant="destructive"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => handleOpenDeleteDialog(session)}
                          aria-label="Apagar conexão"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    ) : canManageThisSession ? (
                      <>
                        <Button data-tour={index === 0 ? "whatsapp-disconnect-button" : undefined} variant="destructive" size="sm" className="h-8 gap-1.5 px-3 text-xs" onClick={() => setSessionToDisconnect(session)}>
                          <LogOut className="w-3.5 h-3.5" />
                          Desconectar
                        </Button>
                        <Button
                          data-tour={index === 0 ? "whatsapp-delete-button" : undefined}
                          variant="destructive"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => handleOpenDeleteDialog(session)}
                          aria-label="Apagar conexão"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    ) : null}
                  </div></CardContent>
              </Card>
              );
            })}
          </div>
        }

        {/* Create Session Dialog */}
        <Dialog open={createDialogOpen} onOpenChange={handleCreateDialogOpenChange}>
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
              <Button variant="outline" onClick={() => handleCreateDialogOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleCreateSession}
                disabled={!instanceName.trim() || createSession.isPending}>
                {createSession.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Criar e Conectar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* QR Code Dialog */}
        <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
          <DialogContent data-tour="whatsapp-qr-dialog" className="w-[92vw] max-w-[92vw] rounded-lg md:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Escanear QR Code</DialogTitle>
              <DialogDescription>
                Abra o WhatsApp no seu celular e escaneie o código abaixo
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-6 md:grid-cols-[minmax(240px,280px)_1fr] md:items-center">
              <div className="flex justify-center">
                {isRefreshingQr || getQRCode.isPending ?
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
                  onClick={() => selectedSession && refreshQRCode(selectedSession)}
                  disabled={isRefreshingQr}>

                  <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshingQr ? "animate-spin" : ""}`} />
                  Atualizar
                </Button>
                <Button
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
          open={deleteDialogOpen}
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
              <AlertDialogCancel disabled={deleteSession.isPending} className="flex-1 sm:flex-none">
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void handleDeleteSession();
                }}
                disabled={deleteSession.isPending}
                className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:flex-none">
                {deleteSession.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Apagar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={!!sessionToDisconnect}
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
              <AlertDialogCancel disabled={logoutSession.isPending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void handleLogout();
                }}
                disabled={logoutSession.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
