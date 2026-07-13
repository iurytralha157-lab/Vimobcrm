import { AlertCircle, Calendar, Check, Link2, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

export function GoogleCalendarConnect({ compact = false }: GoogleCalendarConnectProps) {
  const { data: calendarStatus, isLoading } = useGoogleCalendarStatus();
  const connectCalendar = useConnectGoogleCalendar();
  const disconnectCalendar = useDisconnectGoogleCalendar();
  const toggleSync = useToggleGoogleCalendarSync();
  const syncNow = useSyncGoogleCalendarNow();

  const isConnected = !!calendarStatus;
  const isSyncing = syncNow.isPending || calendarStatus?.sync_status === "syncing";
  const statusLabel = calendarStatus?.sync_status === "error" ? "Erro" : calendarStatus?.sync_enabled ? "Ativo" : "Pausado";

  if (!FEATURES.ENABLE_GOOGLE_CALENDAR_INTEGRATION) {
    if (compact) {
      return (
        <div className="flex flex-col gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-3 opacity-70 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface)] text-muted-foreground">
              <Calendar className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-[var(--color-text-primary)]">Google Agenda</span>
                <Badge variant="outline" className="h-5 rounded-[6px] px-2 text-[11px] font-medium">
                  Desativado
                </Badge>
              </div>
              <p className="truncate text-xs text-[var(--color-text-secondary)]">
                Integração indisponível temporariamente
              </p>
            </div>
          </div>

          <Button size="sm" className="h-8 shrink-0 rounded-[6px] px-3 text-xs shadow-none" disabled>
            <Link2 className="h-4 w-4" />
            Indisponível
          </Button>
        </div>
      );
    }

    return (
      <Card className="rounded-[8px] bg-[var(--app-surface)] opacity-70 shadow-none">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent">
              <Calendar className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-base">Google Agenda</CardTitle>
              <CardDescription>Integração desativada temporariamente</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border border-white/[0.055] bg-white/[0.025] p-3 text-sm text-muted-foreground">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Esta integração está indisponível para todos os usuários por enquanto.</p>
          </div>
          <Button className="w-full" disabled>
            <Link2 className="h-4 w-4 mr-2" />
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
      <Card>
        <CardContent className="py-6">
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
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
            <Calendar className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-[var(--color-text-primary)]">Google Agenda</span>
              {isConnected && (
                <Badge
                  variant={calendarStatus.sync_status === "error" ? "destructive" : "secondary"}
                  className={cn(
                    "h-5 rounded-[6px] px-2 text-[11px] font-medium",
                    calendarStatus.sync_status !== "error" && calendarStatus.sync_enabled && "bg-primary/10 text-primary hover:bg-primary/10",
                    calendarStatus.sync_status !== "error" && !calendarStatus.sync_enabled && "bg-[var(--app-surface-hover)] text-[var(--color-text-secondary)] hover:bg-[var(--app-surface-hover)]",
                  )}
                >
                  {statusLabel}
                </Badge>
              )}
            </div>
            <p className="truncate text-xs text-[var(--color-text-secondary)]">
              {isConnected
                ? calendarStatus.account_email || calendarStatus.calendar_summary || "Conta conectada"
                : "Conecte para enviar e receber compromissos"}
            </p>
          </div>
        </div>

        {isConnected ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-[6px] bg-[var(--app-surface)] px-2 py-1.5">
              <span className="text-xs text-[var(--color-text-secondary)]">Auto</span>
              <Switch
                checked={calendarStatus.sync_enabled}
                onCheckedChange={(checked) => toggleSync.mutate(checked)}
                disabled={toggleSync.isPending}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-[6px] bg-[var(--app-surface)] px-3 text-xs shadow-none hover:bg-[var(--app-surface-hover)]"
              onClick={() => syncNow.mutate()}
              disabled={isSyncing}
            >
              <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
              Sincronizar
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            className="h-8 shrink-0 rounded-[6px] px-3 text-xs shadow-none"
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
    <Card className="rounded-[8px] bg-[var(--app-surface)] shadow-none">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-accent">
            <Calendar className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">Google Agenda</CardTitle>
            <CardDescription>
              {isConnected ? calendarStatus.account_email || "Sua agenda está conectada" : "Conecte para sincronizar suas atividades"}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isConnected ? (
          <>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-success/20 bg-success/10 p-3">
              <div className="flex min-w-0 items-center gap-2 text-success">
                {calendarStatus.sync_status === "error" ? (
                  <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                ) : (
                  <Check className="h-4 w-4 shrink-0" />
                )}
                <div className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {calendarStatus.account_email || "Conectado"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {calendarStatus.calendar_summary || calendarStatus.calendar_id || "Agenda principal"}
                  </span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 text-destructive hover:text-destructive"
                onClick={() => disconnectCalendar.mutate(calendarStatus.id)}
                disabled={disconnectCalendar.isPending}
              >
                <Unlink className="h-4 w-4 mr-2" />
                Desconectar
              </Button>
            </div>

            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="sync-enabled" className="flex flex-col gap-1">
                <span>Sincronização automática</span>
                <span className="text-xs text-muted-foreground font-normal">
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

            <div className="flex flex-col gap-3 rounded-lg border border-white/[0.055] bg-white/[0.025] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={calendarStatus.sync_status === "error" ? "destructive" : "outline"}>
                    {statusLabel}
                  </Badge>
                  {calendarStatus.last_synced_at && (
                    <span className="text-xs text-muted-foreground">
                      Último sync: {new Date(calendarStatus.last_synced_at).toLocaleString("pt-BR")}
                    </span>
                  )}
                </div>
                {calendarStatus.last_error && (
                  <p className="line-clamp-2 text-xs text-destructive">{calendarStatus.last_error}</p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => syncNow.mutate()}
                disabled={isSyncing}
              >
                <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
                Sincronizar
              </Button>
            </div>
          </>
        ) : (
          <Button
            className="w-full"
            onClick={() => connectCalendar.mutate()}
            disabled={connectCalendar.isPending}
          >
            <Link2 className="h-4 w-4 mr-2" />
            {connectCalendar.isPending ? "Conectando..." : "Conectar Google Agenda"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
