import { AlertCircle, Calendar, Check, Link2, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  useConnectGoogleCalendar,
  useDisconnectGoogleCalendar,
  useGoogleCalendarStatus,
  useSyncGoogleCalendarNow,
  useToggleGoogleCalendarSync,
} from "@/hooks/use-google-calendar";

export function GoogleCalendarConnect() {
  const { data: calendarStatus, isLoading } = useGoogleCalendarStatus();
  const connectCalendar = useConnectGoogleCalendar();
  const disconnectCalendar = useDisconnectGoogleCalendar();
  const toggleSync = useToggleGoogleCalendarSync();
  const syncNow = useSyncGoogleCalendarNow();

  const isConnected = !!calendarStatus;
  const isSyncing = syncNow.isPending || calendarStatus?.sync_status === "syncing";

  if (isLoading) {
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

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-accent">
            <Calendar className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">Google Agenda</CardTitle>
            <CardDescription>
              {isConnected ? calendarStatus.account_email || "Sua agenda esta conectada" : "Conecte para sincronizar suas atividades"}
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
                <span>Sincronizacao automatica</span>
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
                    {calendarStatus.sync_status === "error" ? "Erro" : "Ativo"}
                  </Badge>
                  {calendarStatus.last_synced_at && (
                    <span className="text-xs text-muted-foreground">
                      Ultimo sync: {new Date(calendarStatus.last_synced_at).toLocaleString("pt-BR")}
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
