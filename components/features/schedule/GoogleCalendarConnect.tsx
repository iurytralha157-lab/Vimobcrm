import {
  AlertCircle,
  Calendar,
  Check,
  Link2,
  RefreshCw,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FEATURES } from "@/config/constants";
import { cn } from "@/lib/utils";
import {
  useConnectGoogleCalendar,
  useDisconnectGoogleCalendar,
  useGoogleCalendarStatus,
  useSyncGoogleCalendarNow,
  useToggleGoogleCalendarSync,
} from "@/hooks/use-google-calendar";

type GoogleCalendarConnectProps = {
  compact?: boolean;
};

export function GoogleCalendarConnect({
  compact = false,
}: GoogleCalendarConnectProps) {
  const { data: calendarStatus, isLoading } = useGoogleCalendarStatus();
  const connectCalendar = useConnectGoogleCalendar();
  const disconnectCalendar = useDisconnectGoogleCalendar();
  const toggleSync = useToggleGoogleCalendarSync();
  const syncNow = useSyncGoogleCalendarNow();

  const isConnected = !!calendarStatus;
  const isSyncing =
    syncNow.isPending || calendarStatus?.sync_status === "syncing";
  const statusLabel =
    calendarStatus?.sync_status === "error"
      ? "Erro"
      : calendarStatus?.sync_enabled
        ? "Ativo"
        : "Pausado";

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
                    calendarStatus.sync_status === "error"
                      ? "destructive"
                      : "secondary"
                  }
                  className={cn(
                    "h-5 rounded-[6px] border-0 px-2 text-[11px] font-light",
                    calendarStatus.sync_status !== "error" &&
                      calendarStatus.sync_enabled &&
                      "bg-[var(--app-surface-solid)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-solid)]",
                    calendarStatus.sync_status !== "error" &&
                      !calendarStatus.sync_enabled &&
                      "bg-[var(--app-surface-hover)] text-[var(--color-text-secondary)] hover:bg-[var(--app-surface-hover)]",
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
                : "Conecte para enviar e receber compromissos"}
            </p>
          </div>
        </div>

        {isConnected ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-2 py-1.5">
              <span className="text-[12px] font-light text-[var(--app-text-secondary)]">
                Auto
              </span>
              <Switch
                checked={calendarStatus.sync_enabled}
                onCheckedChange={(checked) => toggleSync.mutate(checked)}
                disabled={toggleSync.isPending}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-[6px] bg-[var(--app-surface-solid)] px-3 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
              onClick={() => syncNow.mutate()}
              disabled={isSyncing}
            >
              <RefreshCw
                className={cn("h-4 w-4", isSyncing && "animate-spin")}
              />
              Sincronizar
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            className="h-8 shrink-0 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-white shadow-none hover:bg-primary"
            onClick={() => connectCalendar.mutate()}
            disabled={connectCalendar.isPending}
          >
            <Link2 className="h-4 w-4" />
            {connectCalendar.isPending ? "Conectando..." : "Conectar"}
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
                : "Conecte para sincronizar suas atividades"}
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
                    calendarStatus.sync_status === "error" &&
                      "bg-destructive/10 text-destructive",
                  )}
                >
                  {calendarStatus.sync_status === "error" ? (
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
              <Button
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 self-end rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-destructive shadow-none hover:bg-[var(--app-surface-hover)] hover:text-destructive sm:self-auto"
                onClick={() => disconnectCalendar.mutate(calendarStatus.id)}
                disabled={disconnectCalendar.isPending}
              >
                <Unlink className="mr-2 h-3.5 w-3.5" />
                Desconectar
              </Button>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-[8px] bg-[var(--app-surface-solid)] p-3">
              <Label
                htmlFor="sync-enabled"
                className="flex flex-col gap-1 text-[12px] font-light text-[var(--app-text-primary)]"
              >
                <span>Sincronização automática</span>
                <span className="text-[12px] font-light text-[var(--app-text-tertiary)]">
                  Enviar e receber eventos automaticamente
                </span>
              </Label>
              <Switch
                id="sync-enabled"
                checked={calendarStatus.sync_enabled}
                onCheckedChange={(checked) => toggleSync.mutate(checked)}
                disabled={toggleSync.isPending}
              />
            </div>

            <div className="flex flex-col gap-3 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-[11px] font-light text-[var(--app-text-secondary)]",
                      calendarStatus.sync_status === "error" &&
                        "bg-destructive/10 text-destructive",
                    )}
                  >
                    {statusLabel}
                  </Badge>
                  {calendarStatus.last_synced_at && (
                    <span className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                      Último sync:{" "}
                      {new Date(calendarStatus.last_synced_at).toLocaleString(
                        "pt-BR",
                      )}
                    </span>
                  )}
                </div>
                {calendarStatus.last_error && (
                  <p className="line-clamp-2 rounded-[6px] bg-destructive/10 px-2 py-1.5 text-[11px] font-light leading-4 text-destructive">
                    {calendarStatus.last_error}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-2 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
                onClick={() => syncNow.mutate()}
                disabled={isSyncing}
              >
                <RefreshCw
                  className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`}
                />
                Sincronizar
              </Button>
            </div>
          </>
        ) : (
          <Button
            className="h-9 w-full rounded-[6px] border-0 bg-primary/50 text-[12px] font-light text-white shadow-none hover:bg-primary"
            onClick={() => connectCalendar.mutate()}
            disabled={connectCalendar.isPending}
          >
            <Link2 className="mr-2 h-4 w-4" />
            {connectCalendar.isPending
              ? "Conectando..."
              : "Conectar Google Agenda"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
