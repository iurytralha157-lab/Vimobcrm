import {
  AlertCircle,
  Calendar,
  Link2,
  RefreshCw,
  Unlink,
} from "lucide-react";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FEATURES } from "@/config/constants";
import { isGoogleCalendarServiceUnavailable } from "@/lib/api/google-calendar";
import { cn } from "@/lib/utils";
import {
  useConnectGoogleCalendar,
  useDisconnectGoogleCalendar,
  useGoogleCalendarStatus,
} from "@/hooks/use-google-calendar";
import { GoogleTasksConnectionPanel } from "@/components/features/schedule/GoogleTasksConnectionPanel";
import { GOOGLE_TASKS_DATE_ONLY_NOTICE } from "@/components/features/schedule/google-sync-presentation";

type GoogleCalendarConnectProps = {
  compact?: boolean;
};

export function GoogleCalendarConnect({
  compact = false,
}: GoogleCalendarConnectProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const handledSettingsOAuthRef = useRef(false);
  const {
    data: statusResponse,
    error: statusError,
    isError: statusLoadFailed,
    isLoading,
    refetch: refetchStatus,
  } = useGoogleCalendarStatus();
  const connectCalendar = useConnectGoogleCalendar();
  const authorizeTasks = useConnectGoogleCalendar({ enableTasks: true });
  const disconnectCalendar = useDisconnectGoogleCalendar();

  const calendarStatus = statusResponse?.connection ?? null;
  const canConnect = statusResponse?.can_connect === true;
  const canUseSchedule = statusResponse?.can_use_schedule ?? canConnect;
  const connectRestriction = statusResponse?.connect_restriction;
  const unavailableMessage = connectRestriction === "GOOGLE_CALENDAR_PILOT_ONLY"
    ? "Conexão disponível apenas para usuários do teste piloto"
    : connectRestriction === "GOOGLE_CALENDAR_CONNECT_DISABLED"
      ? "Novas conexões temporariamente indisponíveis"
      : "Permissão da Agenda necessária";
  const unavailableButtonLabel = connectRestriction === "GOOGLE_CALENDAR_PILOT_ONLY"
    ? "Em teste piloto"
    : connectRestriction === "GOOGLE_CALENDAR_CONNECT_DISABLED"
      ? "Indisponível"
      : "Sem acesso à Agenda";
  const isConnected = !!calendarStatus;
  const tasksAvailable = statusResponse?.tasks_available ?? (calendarStatus?.tasks_authorized !== undefined);
  const routingEnabled = calendarStatus?.routing_v2 === true;
  const tasksAuthorized = calendarStatus?.tasks_authorized === true;
  const connectionPending = connectCalendar.isPending || authorizeTasks.isPending;
  const tasksPanel = isConnected && tasksAvailable ? (
    <GoogleTasksConnectionPanel
      authorized={tasksAuthorized}
      routingEnabled={routingEnabled}
      canAuthorize={canUseSchedule && canConnect && !disconnectCalendar.isPending}
      isPending={connectionPending}
      onAuthorize={() => authorizeTasks.mutate()}
    />
  ) : null;
  const serviceUnavailable = isGoogleCalendarServiceUnavailable(statusError);
  const statusLabel =
    !canUseSchedule
      ? "Sem permissão"
      : calendarStatus?.sync_status === "error"
      ? "Erro"
      : "Conectado";

  useEffect(() => {
    if (!pathname.startsWith("/settings") || handledSettingsOAuthRef.current) return;

    const connected = searchParams.get("google_calendar_connected") === "1";
    const callbackError = searchParams.get("google_calendar_error");
    const callbackWarning = searchParams.get("google_calendar_warning");
    if (!connected && !callbackError && !callbackWarning) return;

    handledSettingsOAuthRef.current = true;
    if (callbackError) {
      toast.error(`Não foi possível conectar o Google Agenda: ${callbackError.slice(0, 300)}`);
    } else if (callbackWarning) {
      toast.warning(
        `Google Agenda conectada, mas o envio precisa de atenção: ${callbackWarning.slice(0, 300)}`,
      );
    } else {
      toast.success("Google Agenda conectada.");
    }
    void refetchStatus();

    const cleanParams = new URLSearchParams(searchParams.toString());
    cleanParams.delete("google_calendar_connected");
    cleanParams.delete("google_calendar_error");
    cleanParams.delete("google_calendar_warning");
    const cleanSearch = cleanParams.toString();
    router.replace(`${pathname}${cleanSearch ? `?${cleanSearch}` : ""}`, { scroll: false });
  }, [pathname, refetchStatus, router, searchParams]);

  const integrationEnabled = FEATURES.ENABLE_GOOGLE_CALENDAR_INTEGRATION;
  const connectWithTasks = statusResponse?.tasks_available === true;
  const connectionTitle = tasksAvailable ? "Google Agenda e Tasks" : "Google Agenda";
  const hasSyncError = canUseSchedule && calendarStatus?.sync_status === "error";
  const connect = () => {
    if (connectWithTasks) authorizeTasks.mutate();
    else connectCalendar.mutate();
  };

  if (integrationEnabled && isLoading) {
    return (
      <div className="mx-auto flex h-16 w-full max-w-md items-center justify-center" aria-label="Verificando conexão Google">
        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card
      data-google-calendar-connection
      className={cn(
        "mx-auto w-full min-w-0 max-w-md rounded-[8px] border-0 bg-transparent shadow-none",
        compact && "bg-[var(--app-surface-soft)] p-3",
        !integrationEnabled && "opacity-70",
      )}
    >
      <CardHeader className="p-0 pb-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-white">
            <Calendar aria-hidden="true" className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-[14px] font-light text-[var(--app-text-primary)]">
                {connectionTitle}
              </CardTitle>
              {!integrationEnabled ? (
                <Badge variant="secondary" className="h-5 rounded-[6px] px-2 text-[11px] font-light">Desativado</Badge>
              ) : !statusLoadFailed && isConnected && (
                <Badge
                  variant={hasSyncError ? "destructive" : "secondary"}
                  className="h-5 rounded-[6px] border-0 px-2 text-[11px] font-light"
                >
                  {statusLabel}
                </Badge>
              )}
            </div>
            <CardDescription className="break-words text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
              {!integrationEnabled
                ? "Integração desativada temporariamente"
                : statusLoadFailed
                  ? serviceUnavailable ? "Serviço temporariamente indisponível" : "Falha ao verificar a conexão"
                  : isConnected
                    ? calendarStatus.account_email || calendarStatus.calendar_summary || "Conta conectada"
                    : canConnect
                      ? connectWithTasks ? "Uma autorização para Agenda e Tasks." : "Envie seus compromissos ao Google."
                      : unavailableMessage}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        {!integrationEnabled ? (
          <Button className="h-9 w-full rounded-[6px] text-[12px] font-light" disabled>
            <Link2 aria-hidden="true" className="mr-2 h-4 w-4" />
            Indisponível
          </Button>
        ) : statusLoadFailed ? (
          <>
            <p role="alert" className="text-[12px] font-light leading-[18px] text-destructive">
              {serviceUnavailable
                ? "O serviço do Google Agenda está indisponível. Nenhum estado foi alterado."
                : "Não foi possível verificar a conexão. Nenhum estado foi alterado."}
            </p>
            <Button
              variant="ghost"
              className="h-9 w-full rounded-[6px] bg-[var(--app-surface-soft)] text-[12px] font-light"
              onClick={() => void refetchStatus()}
            >
              <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
              Tentar novamente
            </Button>
          </>
        ) : (
          <>
            {isConnected ? (
              <>
                {!canUseSchedule ? (
                  <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
                    Seu perfil precisa de permissão para usar a Agenda do Vimob.
                    Peça a um administrador para revisar seu acesso.
                  </p>
                ) : hasSyncError ? (
                  <p role="alert" className="flex items-start gap-2 text-[12px] font-light leading-[18px] text-destructive">
                    <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                    A sincronização com o Google Agenda registrou um erro. Confira os detalhes e o estado da conexão.
                  </p>
                ) : (
                  <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
                    {routingEnabled && tasksAuthorized
                      ? "Reuniões e visitas na Agenda; demais atividades no Tasks."
                      : routingEnabled
                        ? "Agenda conectada. O envio ao Tasks aguarda autorização."
                        : "Compromissos enviados ao Google Agenda."}
                  </p>
                )}
                {calendarStatus.last_error && (
                  <p role="alert" className="break-words rounded-[6px] bg-destructive/10 p-2 text-[12px] font-light leading-[18px] text-destructive">
                    {calendarStatus.last_error}
                  </p>
                )}
                {calendarStatus.sync_status === "error" && (
                  <Button variant="ghost" size="sm" onClick={() => void refetchStatus()}>
                    <RefreshCw aria-hidden="true" className="mr-2 h-3.5 w-3.5" />
                    Atualizar status
                  </Button>
                )}
                {hasSyncError && canConnect && canUseSchedule && (
                  <Button
                    className="h-9 w-full rounded-[6px] bg-primary/50 text-[12px] font-light text-white shadow-none hover:bg-primary"
                    onClick={connect}
                    disabled={connectionPending || disconnectCalendar.isPending}
                  >
                    <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
                    {connectionPending ? "Conectando..." : "Reconectar Google"}
                  </Button>
                )}
                {tasksPanel}
              </>
            ) : (
              <>
                {canConnect && (
                  <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
                    {connectWithTasks
                      ? "O Vimob envia reuniões e visitas ao Google Agenda e atividades a uma lista do Google Tasks."
                      : "O Vimob envia seus compromissos ao Google Agenda."}{" "}
                    <Link href="/politica-de-privacidade" target="_blank" rel="noopener noreferrer" className="underline">
                      Política de privacidade
                    </Link>
                  </p>
                )}
                <Button
                  className="h-9 w-full rounded-[6px] border-0 bg-primary/50 text-[12px] font-light text-white shadow-none hover:bg-primary"
                  onClick={connect}
                  disabled={!canConnect || connectionPending}
                >
                  <Link2 aria-hidden="true" className="mr-2 h-4 w-4" />
                  {!canConnect
                    ? unavailableButtonLabel
                    : connectionPending
                      ? "Conectando..."
                      : connectWithTasks ? "Conectar Google Agenda e Tasks" : "Conectar Google Agenda"}
                </Button>
              </>
            )}
            <details className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
              <summary className="cursor-pointer rounded-[6px] py-1 text-[var(--app-text-secondary)] focus-visible:outline focus-visible:outline-primary">
                Como funciona
              </summary>
              <div className="space-y-2 pt-2">
                <p>
                  {tasksAvailable
                    ? "Reuniões e visitas vão para o Google Agenda. Tarefas, mensagens, e-mails e ligações vão para o Tasks após sua autorização."
                    : "Compromissos criados ou alterados no Vimob são enviados ao Google Agenda."}
                </p>
                {tasksAvailable && <p>{GOOGLE_TASKS_DATE_ONLY_NOTICE}</p>}
                <p>
                  O envio é do Vimob para o Google. Excluir no Vimob também remove a cópia vinculada.
                  Alterações feitas no Google não voltam ao Vimob e podem ser substituídas na próxima edição aqui.
                </p>
                <p>A autorização fica salva. Uma nova permissão só será pedida se for necessário reconectar.</p>
                {isConnected && (
                  <p className="break-words">Agenda: {calendarStatus.calendar_summary || "Agenda principal"}</p>
                )}
              </div>
            </details>
            {isConnected && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-full rounded-[6px] text-[12px] font-light text-destructive hover:text-destructive"
                    disabled={disconnectCalendar.isPending || connectionPending}
                  >
                    <Unlink aria-hidden="true" className="mr-2 h-3.5 w-3.5" />
                    {disconnectCalendar.isPending ? "Desconectando..." : "Desconectar"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Desconectar {routingEnabled ? "Google Agenda e Tasks" : "Google Agenda"}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Atividades já enviadas permanecem no Google. Depois da desconexão,
                      alterações e exclusões no Vimob não serão enviadas para essa conta.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => disconnectCalendar.mutate(calendarStatus.id)}>
                      Desconectar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
