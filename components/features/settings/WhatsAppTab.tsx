import { useState, useEffect, useRef, useCallback } from "react";
import NextImage from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Plus,
  Smartphone,
  QrCode,
  LogOut,
  Users,
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
  useSessionAccess,
  useGrantSessionAccess,
  useRevokeSessionAccess,
  useRecreateWhatsAppInstance,
  useToggleNotificationSession,
  type WhatsAppAccessMode,
  type WhatsAppSession,
  type WhatsAppSessionAccess,
  WHATSAPP_LEGACY_EVOLUTION_ENABLED } from
  "@/hooks/use-whatsapp-sessions";
import { type User, useOrganizationUsers } from "@/hooks/use-users";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

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

export function WhatsAppTab({ embedded = false }: WhatsAppTabProps = {}) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { data: sessions, isLoading } = useWhatsAppSessions();
  const { data: users } = useOrganizationUsers();
  const createSession = useCreateWhatsAppSession();
  const deleteSession = useDeleteWhatsAppSession();
  const getQRCode = useGetQRCode();
  const getConnectionStatus = useGetConnectionStatus();
  const logoutSession = useLogoutSession();
  const recreateSession = useRecreateWhatsAppInstance();
  const toggleNotification = useToggleNotificationSession();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [accessDialogOpen, setAccessDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [instanceName, setInstanceName] = useState("");
  const [selectedSession, setSelectedSession] = useState<WhatsAppSession | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isRefreshingQr, setIsRefreshingQr] = useState(false);
  const [verifyingSessionId, setVerifyingSessionId] = useState<string | null>(null);

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
      queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });

      return status?.connected === true || status?.state === "open" || status?.status === "connected";
    } catch {
      return null;
    }
  }, [getConnectionStatus, queryClient]);


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
      const message = getErrorMessage(error, "Nao foi possivel criar a conexao WhatsApp.");
      console.error("Error creating session:", message, error);
      toast({
        title: "Erro ao criar conexao",
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
        throw new Error("Evolution legada esta desativada. Crie uma nova conexao Evolution Go.");
      }

      let lastQr: string | null = null;
      let attempt = 0;

      // Retry loop for QR code
      while (attempt < retries && !lastQr) {
        if (attempt > 0 || isGo) {
          await new Promise(r => setTimeout(r, 3000));
        }


        const data = await getQRCode.mutateAsync({
          provider: "evolution_go",
          instanceName: session.instance_name,
          sessionId: session.id,
          instanceId: session.instance_id,
        });

        lastQr = getQrCodeValue(data);
        attempt++;
      }

      if (lastQr) {
        setQrCode(lastQr);
        queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
        return "ready";
      } else {
        toast({
          title: "Atenção",
          description: "O QR Code ainda não está pronto. Clique em Atualizar em alguns instantes.",
          variant: "default"
        });
        return "empty";
      }

    } catch (error) {
      console.error("Error getting QR code:", error);
      toast({ title: "Erro", description: "Falha ao obter QR Code", variant: "destructive" });
      return "error";
    } finally {
      setIsRefreshingQr(false);
    }
  };

  const checkConnectionStatus = async (session: WhatsAppSession) => {
    try {
      const isGo = session.provider === "evolution_go";
      if (!isGo) {
        throw new Error("Evolution legada esta desativada. Crie uma nova conexao Evolution Go.");
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
      console.error("Error checking status:", error);
    }
  };

  const handleOpenQRDialog = async (session: WhatsAppSession) => {
    setSelectedSession(session);
    setQrDialogOpen(true);
    const refreshStatus = await refreshQRCode(session);

    if (refreshStatus === "error") {
      try {
        if (session.provider !== "evolution_go") {
          throw new Error("Evolution legada esta desativada. Crie uma nova conexao Evolution Go.");
        }

        const result = await recreateSession.mutateAsync(session);
        const nextSession = result.session || session;
        setSelectedSession(nextSession);
        await new Promise(r => setTimeout(r, 3000));
        await refreshQRCode(nextSession);
      } catch (e) {
        console.error("Failed to recreate instance:", e);
        toast({ title: "Erro", description: "Não foi possível reconectar. Tente excluir e criar uma nova conexão.", variant: "destructive" });
      }
    }
  };


  const handleOpenAccessDialog = (session: WhatsAppSession) => {
    setSelectedSession(session);
    setAccessDialogOpen(true);
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
      console.error("Error verifying WhatsApp connection:", error);
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
    await deleteSession.mutateAsync(selectedSession);
    setDeleteDialogOpen(false);
    setSelectedSession(null);
  };

  const handleLogout = async (session: WhatsAppSession) => {
    await logoutSession.mutateAsync(session);
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
        onClick={() => setCreateDialogOpen(true)}
        className="absolute right-14 top-4 z-10 shrink-0"
      >
          <Plus className="w-4 h-4 mr-1.5" />
          Nova
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
            <Button data-tour="whatsapp-new-session" size="sm" onClick={() => setCreateDialogOpen(true)} className="shrink-0">
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
        sessions?.length === 0 ?
        <div className="flex flex-col items-center justify-center py-12">
            <Smartphone className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Nenhuma conexão</h3>
            <p className="text-muted-foreground text-center mb-4">
              Conecte seu primeiro WhatsApp para começar a receber mensagens
            </p>
            <Button data-tour="whatsapp-new-session" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Conectar WhatsApp
            </Button>
          </div> :

        <div className={embedded ? "grid gap-3 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 px-[10px]"}>
            {sessions?.map((session) =>
          <Card key={session.id} className="border">
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
                  <div className="flex items-center justify-between gap-2 py-1.5 border-y border-white/[0.055]">
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
                    {isAdmin &&
                <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1.5 shrink-0">
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
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 px-3 text-xs" onClick={() => handleOpenAccessDialog(session)}>
                      <Users className="w-3.5 h-3.5" />
                      Usuários
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 px-3 text-xs"
                      onClick={() => handleVerifyConnection(session)}
                      disabled={verifyingSessionId === session.id}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${verifyingSessionId === session.id ? "animate-spin" : ""}`} />
                      Verificar
                    </Button>
                    {session.status !== "connected" ? (
                      <>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 px-3 text-xs" onClick={() => handleOpenQRDialog(session)}>
                          <QrCode className="w-3.5 h-3.5" />
                          QR Code
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => handleOpenDeleteDialog(session)}
                          aria-label="Apagar conexão"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    ) : (
                      <Button variant="destructive" size="sm" className="h-8 gap-1.5 px-3 text-xs" onClick={() => handleLogout(session)}>
                        <LogOut className="w-3.5 h-3.5" />
                        Desconectar
                      </Button>
                    )}
                  </div></CardContent>
              </Card>
          )}
          </div>
        }

        {/* Create Session Sheet */}
        <Sheet open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <SheetContent side="right" className="w-[90%] sm:w-[650px] sm:max-w-[650px] p-6 flex flex-col">
            <SheetHeader>
              <SheetTitle>Nova Conexão WhatsApp</SheetTitle>
              <SheetDescription>
                Dê um nome para identificar esta conexão
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                  <Label>Provedor</Label>
                  <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <Badge variant="secondary">Evolution Go</Badge>
                    <span className="text-muted-foreground">Novas conexoes usam apenas Evo Go.</span>
                  </div>
                  {!WHATSAPP_LEGACY_EVOLUTION_ENABLED && (
                    <p className="text-xs text-muted-foreground">
                      Evolution legada esta desativada para novas conexoes.
                    </p>
                  )}
              </div>
              <div className="space-y-2">
                <Label>Nome da Instância</Label>
                <Input
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                  placeholder="Ex: Vendas, Suporte, Marketing..." />
              </div>
            </div>
            <SheetFooter>
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleCreateSession}
                disabled={!instanceName.trim() || createSession.isPending}>
                {createSession.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Criar e Conectar
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {/* QR Code Dialog */}
        <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
          <DialogContent className="w-[92vw] max-w-[92vw] rounded-lg md:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Escanear QR Code</DialogTitle>
              <DialogDescription>
                Abra o WhatsApp no seu celular e escaneie o código abaixo
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-6 md:grid-cols-[minmax(240px,280px)_1fr] md:items-center">
              <div className="flex justify-center">
                {isRefreshingQr || getQRCode.isPending ?
                <div className="flex h-64 w-64 items-center justify-center rounded-lg bg-white/[0.045]">
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


                <div className="flex h-64 w-64 items-center justify-center rounded-lg bg-white/[0.045]">
                    <p className="text-muted-foreground text-center px-4">
                      Não foi possível gerar o QR Code
                    </p>
                  </div>
                }
              </div>
              <div className="w-full rounded-lg border border-white/[0.055] bg-white/[0.045] p-4 text-left">
                <p className="mb-3 text-sm font-semibold text-foreground">Como conectar:</p>
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

        {/* Access Control Dialog */}
        <AccessControlDialog
          open={accessDialogOpen}
          onOpenChange={setAccessDialogOpen}
          session={selectedSession}
          users={users || []} />

        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent className="w-[95%] max-w-[400px] rounded-lg">
            <DialogHeader>
              <DialogTitle>Apagar conexão</DialogTitle>
              <DialogDescription>
                Tem certeza que deseja apagar a conexão &quot;{selectedSession?.display_name || selectedSession?.instance_name}&quot;?
                As conversas e mensagens salvas serão preservadas no histórico.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex flex-row justify-end gap-3 sm:gap-2 pt-2">
              <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} className="flex-1 sm:flex-none">
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteSession}
                disabled={deleteSession.isPending}
                className="flex-1 sm:flex-none">
                {deleteSession.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Apagar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


      </CardContent>
    </Card>);

}

// Access Control Dialog Component
function AccessControlDialog({
  open,
  onOpenChange,
  session,
  users





}: {open: boolean;onOpenChange: (open: boolean) => void;session: WhatsAppSession | null;users: User[];}) {
  const { data: accessList } = useSessionAccess(session?.id || null);
  const grantAccess = useGrantSessionAccess();
  const revokeAccess = useRevokeSessionAccess();

  const handleToggleAccess = async (userId: string, hasAccess: boolean) => {
    if (!session) return;
    if (hasAccess) {
      await revokeAccess.mutateAsync({ sessionId: session.id, userId });
    } else {
      await grantAccess.mutateAsync({ sessionId: session.id, userId, accessMode: "assigned_leads_only" });
    }
  };

  const handleChangeMode = async (userId: string, mode: WhatsAppAccessMode) => {
    if (!session) return;
    await grantAccess.mutateAsync({ sessionId: session.id, userId, accessMode: mode });
  };

  const getAccess = (userId: string): WhatsAppSessionAccess | undefined => {
    return accessList?.find((access) => access.user_id === userId);
  };

  const MODE_LABELS: Record<WhatsAppAccessMode, string> = {
    assigned_leads_only: "Apenas leads atribuídos a este usuário",
    team_leads: "Leads da equipe do usuário",
    all_leads: "Todas as conversas vinculadas a leads",
    full_inbox: "Inbox completo (todas as conversas)",
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[90%] sm:w-[650px] sm:max-w-[650px] p-6 flex flex-col">
        <SheetHeader>
          <SheetTitle>Gerenciar Acessos</SheetTitle>
          <SheetDescription>
            Defina quais usuários podem operar esta conexão e o nível de visibilidade das conversas
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="max-h-[500px]">
          <div className="space-y-4 py-4">
            {users.map((user) => {
              const access = getAccess(user.id);
              const hasAccess = !!access;
              const mode = access?.access_mode || "assigned_leads_only";
              const isOwner = user.id === session?.owner_user_id;

              return (
                <div key={user.id} className="flex flex-col gap-3 py-3 border-b last:border-0 border-white/[0.055]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={user.avatar_url ?? undefined} />
                        <AvatarFallback>{user.name?.[0] || "U"}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{user.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {isOwner && <Badge variant="secondary">Proprietário</Badge>}
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`access-${user.id}`} className="text-[10px] uppercase font-bold text-muted-foreground cursor-pointer">
                          Acesso
                        </Label>
                        <Checkbox
                          id={`access-${user.id}`}
                          checked={hasAccess}
                          onCheckedChange={() => handleToggleAccess(user.id, hasAccess)}
                          disabled={grantAccess.isPending || revokeAccess.isPending}
                        />
                      </div>
                    </div>
                  </div>

                  {hasAccess && !isOwner && (
                    <div className="pl-11">
                      <Label className="text-[10px] uppercase font-bold text-muted-foreground mb-1.5 block">
                        Visibilidade
                      </Label>
                      <Select value={mode} onValueChange={(v) => handleChangeMode(user.id, v as WhatsAppAccessMode)}>
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(MODE_LABELS).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>);
            })}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>);

}
