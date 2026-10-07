import {
  AlertCircle,
  Calendar,
  Check,
  Link2,
  RefreshCw,
  Unlink,
} from "lucide-react";
import { useEffect, useRef } from "react";
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

  if (!FEATURES.ENABLE_GOOGLE_CALENDAR_INTEGRATION) {
    if (compact) {
      return (
        <div className="flex flex-col gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-3 opacity-70 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-white">
              <Calendar className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-[14px] font-light text-[var(--app-text-primary)]">
                  Google Agenda
                </span>
                <Badge
                  variant="outline"
                  className="h-5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-[11px] font-light"
                >
                  Desativado
                </Badge>
              </div>
              <p className="truncate text-[12px] font-light text-[var(--app-text-tertiary)]">
                Integração indisponível temporariamente
              </p>
            </div>
          </div>

          <Button
            size="sm"
            className="h-8 shrink-0 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-white shadow-none"
            disabled
          >
            <Link2 className="h-4 w-4" />
            Indisponível
          </Button>
        </div>
      );
    }

    return (
      <Card className="rounded-[8px] border-0 bg-transparent opacity-70 shadow-none">
        <CardHeader className="p-0 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-white">
              <Calendar className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-[14px] font-light text-[var(--app-text-primary)]">
                Google Agenda
              </CardTitle>
              <CardDescription className="text-[12px] font-light text-[var(--app-text-tertiary)]">
                Integração desativada temporariamente
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-0">
          <div className="flex items-start gap-2 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Esta integração está indisponível para todos os usuários por
              enquanto.
            </p>
          </div>
          <Button
            className="h-9 w-full rounded-[6px] border-0 bg-primary/50 text-[12px] font-light text-white shadow-none"
            disabled
          >
            <Link2 className="mr-2 h-4 w-4" />
            Indisponível
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    if (compact) {
      return (
        <div className="flex h-11 items-center justify-center rounded-[8px] bg-[var(--app-surface-soft)]">
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      );
    }

    return (
      <Card className="rounded-[8px] border-0 bg-transparent shadow-none">
        <CardContent className="p-4">
          <div className="flex items-center justify-center">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (statusLoadFailed) {
    if (compact) {
      return (
        <div className="flex flex-col gap-3 rounded-[8px] bg-destructive/10 p-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
            <div className="min-w-0">
              <span className="block text-[14px] font-light text-[var(--app-text-primary)]">
                Google Agenda
              </span>
              <span className="block truncate text-[12px] font-light text-destructive">
                {serviceUnavailable
                  ? "Serviço temporariamente indisponível"
                  : "Falha ao verificar a conexão"}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-[6px] px-3 text-[12px] font-light"
            onClick={() => void refetchStatus()}
          >
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      );
    }

    return (
      <Card className="rounded-[8px] border-0 bg-transparent shadow-none">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-[14px] font-light text-[var(--app-text-primary)]">
            <AlertCircle className="h-4 w-4 text-destructive" />
            Google Agenda
          </CardTitle>
          <CardDescription className="text-[12px] font-light text-destructive">
            {serviceUnavailable
              ? "O serviço do Google Agenda está indisponível. Nenhum estado foi alterado."
              : "Não foi possível verificar a conexão. Nenhum estado foi alterado."}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Button
            variant="ghost"
            className="h-9 w-full rounded-[6px] bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none"
            onClick={() => void refetchStatus()}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <div className="flex flex-col gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-white">
            <Calendar className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-[14px] font-light text-[var(--app-text-primary)]">
                Google Agenda
              </span>
              {isConnected && (
                <Badge
                  variant={
                    canUseSchedule && calendarStatus.sync_status === "error"
                      ? "destructive"
                      : "secondary"
                  }
                  className={cn(
                    "h-5 rounded-[6px] border-0 px-2 text-[11px] font-light",
                    (!canUseSchedule || calendarStatus.sync_status !== "error") &&
                      "bg-[var(--app-surface-solid)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-solid)]",
                  )}
                >
                  {statusLabel}
                </Badge>
              )}
            </div>
            <p className="truncate text-[12px] font-light text-[var(--app-text-tertiary)]">
              {isConnected
                ? calendarStatus.account_email ||
                  calendarStatus.calendar_summary ||
                  "Conta conectada"
                : canConnect
                  ? "Envie compromissos do Vimob ao Google"
                  : unavailableMessage}
            </p>
          </div>
        </div>

        {isConnected ? (
          <span className="text-[12px] font-light text-[var(--app-text-tertiary)]">
            {canUseSchedule ? "Vimob → Google" : "Permissão da Agenda necessária"}
          </span>
        ) : (
          <Button
            size="sm"
            className="h-8 shrink-0 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-white shadow-none hover:bg-primary"
            onClick={() => connectCalendar.mutate()}
            disabled={!canConnect || connectCalendar.isPending}
          >
            <Link2 className="h-4 w-4" />
            {!canConnect
              ? unavailableButtonLabel
              : connectCalendar.isPending
                ? "Conectando..."
                : "Conectar"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card className="rounded-[8px] border-0 bg-transparent shadow-none">
      <CardHeader className="p-0 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-white">
            <Calendar className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-[14px] font-light text-[var(--app-text-primary)]">
              Google Agenda
            </CardTitle>
            <CardDescription className="truncate text-[12px] font-light text-[var(--app-text-tertiary)]">
              {isConnected
                ? calendarStatus.account_email || "Sua agenda está conectada"
                : canConnect
                  ? "Envie compromissos do Vimob ao Google Agenda"
                  : unavailableMessage}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        {isConnected ? (
          <>
            <div className="flex flex-col items-stretch gap-3 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3 text-[var(--app-text-secondary)]">
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-white",
                    canUseSchedule && calendarStatus.sync_status === "error" &&
                      "bg-destructive/10 text-destructive",
                  )}
                >
                  {canUseSchedule && calendarStatus.sync_status === "error" ? (
                    <AlertCircle className="h-3.5 w-3.5" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                </span>
                <div className="min-w-0">
                  <span className="block truncate text-[14px] font-light text-[var(--app-text-primary)]">
                    {calendarStatus.account_email || "Conectado"}
                  </span>
                  <span className="block truncate text-[12px] font-light text-[var(--app-text-tertiary)]">
                    {calendarStatus.calendar_summary ||
                      calendarStatus.calendar_id ||
                      "Agenda principal"}
                  </span>
                </div>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 self-end rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-destructive shadow-none hover:bg-[var(--app-surface-hover)] hover:text-destructive sm:self-auto"
                    disabled={disconnectCalendar.isPending}
                  >
                    <Unlink className="mr-2 h-3.5 w-3.5" />
                    Desconectar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Desconectar Google Agenda?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Eventos já enviados permanecem no Google. Depois da desconexão,
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
            </div>

            <p className="rounded-[8px] bg-[var(--app-surface-solid)] p-3 text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
              {canUseSchedule ? (
                calendarStatus.sync_status === "error" ? (
                  <>
                    Um envio ao Google Agenda falhou. Confira o erro abaixo e revise a
                    conexão; compromissos podem continuar pendentes na fila.
                  </>
                ) : (
                  <>
                    Compromissos criados ou alterados no Vimob são enviados ao Google Agenda.
                    Ao excluir no Vimob, a remoção do evento vinculado também é enviada ao Google.
                    Alterações feitas no Google não entram no Vimob e podem ser substituídas
                    pela próxima edição no Vimob.
                  </>
                )
              ) : (
                <>
                  Seu perfil precisa de permissão para usar a Agenda do Vimob.
                  Peça a um administrador para revisar seu acesso à integração.
                </>
              )}
            </p>

            <div className="flex flex-col gap-3 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-[11px] font-light text-[var(--app-text-secondary)]",
                      canUseSchedule && calendarStatus.sync_status === "error" &&
                        "bg-destructive/10 text-destructive",
                    )}
                  >
                    {statusLabel}
                  </Badge>
                </div>
                {calendarStatus.last_error && (
                  <p className="line-clamp-2 rounded-[6px] bg-destructive/10 px-2 py-1.5 text-[11px] font-light leading-4 text-destructive">
                    {calendarStatus.last_error}
                  </p>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            {!canConnect && (
              <p className="flex items-start gap-2 rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {unavailableMessage}.
              </p>
            )}
            <Button
              className="h-9 w-full rounded-[6px] border-0 bg-primary/50 text-[12px] font-light text-white shadow-none hover:bg-primary"
              onClick={() => connectCalendar.mutate()}
              disabled={!canConnect || connectCalendar.isPending}
            >
              <Link2 className="mr-2 h-4 w-4" />
              {!canConnect
                ? unavailableButtonLabel
                : connectCalendar.isPending
                  ? "Conectando..."
                  : "Conectar Google Agenda"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
