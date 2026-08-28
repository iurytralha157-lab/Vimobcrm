import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useWebPush } from '@/hooks/use-web-push';
import { useAuth } from '@/contexts/AuthContext';
import { settingsAPI, type PushDevice } from '@/lib/api/settings';
import { Bell, BellOff, CircleAlert, MonitorSmartphone, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useState } from 'react';
import { Capacitor } from '@capacitor/core';

export const NotificationsTab = () => {
  const { user, profile, organization } = useAuth();
  const {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    isReady,
    configurationStatus,
    error: pushStateError,
    subscribe,
    unsubscribe,
  } = useWebPush();
  const [testing, setTesting] = useState(false);
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const organizationId = organization?.id || profile?.organization_id;
  const {
    data: devices = [],
    isFetching: loadingDevices,
    isPending: devicesPending,
    isError: devicesFailed,
    refetch: refetchDevices,
  } = useQuery<PushDevice[]>({
    queryKey: ['settings', 'push-devices', organizationId],
    queryFn: () => settingsAPI.listPushDevices(organizationId!),
    enabled: Boolean(organizationId),
    staleTime: 30_000,
  });
  const isNativePlatform = Capacitor.isNativePlatform();
  const activeDevices = devices.filter((device) => device.active);
  const nativeDeviceActive = activeDevices.some((device) => (
    device.platform === 'android' || device.platform === 'ios'
  ));
  const currentDeviceActive = isNativePlatform ? nativeDeviceActive : isSubscribed;
  const configurationUnavailable = !isNativePlatform && configurationStatus === 'unavailable';

  const loadDevices = async () => {
    await refetchDevices();
  };

  const handleToggle = async () => {
    if (isSubscribed) {
      setDisableDialogOpen(true);
      return;
    }

    const result = await subscribe();
    if (result.ok) {
      toast.success('Notificações ativadas com sucesso!');
      await loadDevices();
    } else {
      toast.error(result.message);
    }
  };

  const handleDisable = async () => {
    const removed = await unsubscribe();
    if (!removed) {
      toast.error('Não foi possível desativar as notificações neste dispositivo.');
      return;
    }

    toast.success('Notificações desativadas');
    setDisableDialogOpen(false);
    await loadDevices();
  };

  const handleTestNotification = async () => {
    try {
      if (!user) return;

      setTesting(true);

      if (!organizationId) {
        toast.error('Não encontramos a organização para enviar o teste.');
        return;
      }

      const { notificationService } = await import('@/services/NotificationService');
      const result = await notificationService.send({
        eventKey: 'test_push',
        organizationId,
        userId: user.id,
        variables: {},
        isTest: true,
        channels: ['push'],
        dedupeKey: `test-push:${user.id}:${Date.now()}`,
      });

      if (result.error) throw new Error(String(result.error));
      const push = result.push;
      if (!push?.ok || !push.attempted || (push.sent ?? 0) < 1) {
        const code = push?.error || 'push_delivery_not_confirmed';
        if (code === 'push_tokens_missing') {
          throw new Error('Nenhum dispositivo ativo foi encontrado. Desative e ative novamente neste aparelho.');
        }
        if (code === 'push_sender_not_configured' || code === 'vapid_private_key_missing') {
          throw new Error('O servidor de push ainda não está configurado para este ambiente.');
        }
        throw new Error(`O provedor não confirmou a entrega (${code}).`);
      }
      toast.success(`Push entregue em ${push.sent} dispositivo(s).`);
      await loadDevices();
    } catch (err) {
      console.error('Erro ao testar push:', err);
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar notificacao de teste.');
    } finally {
      setTesting(false);
    }
  };

  if (
    (!isNativePlatform && !isReady)
    || (isNativePlatform && Boolean(organizationId) && devicesPending)
  ) {
    return (
      <Card className="app-card" aria-busy="true">
        <CardHeader>
          <CardTitle>Notificações Push</CardTitle>
          <CardDescription className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            Verificando este dispositivo...
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!isNativePlatform && !isSupported) {
    return (
      <Card className="app-card">
        <CardHeader>
          <CardTitle>Notificações Push</CardTitle>
          <CardDescription>
            Seu navegador não suporta notificações push nativas.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="app-card">
      <CardHeader>
        <CardTitle>Notificações Push</CardTitle>
        <CardDescription>
          Receba notificações em tempo real diretamente no seu dispositivo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-4 rounded-[8px] bg-[var(--app-surface-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {currentDeviceActive ? (
              <Bell className="h-5 w-5 text-success" aria-hidden="true" />
            ) : (
              <BellOff className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            )}
            <div>
              <p className="font-medium">
                {currentDeviceActive ? 'Notificações Ativas' : 'Notificações Inativas'}
              </p>
              <p className="text-sm text-muted-foreground">
                {isNativePlatform
                  ? 'A permissão deste aplicativo é gerenciada nas configurações do sistema.'
                  : configurationUnavailable
                    ? 'O envio push ainda não está configurado neste ambiente.'
                    : permission === 'denied'
                  ? 'Permissao negada no navegador'
                  : currentDeviceActive
                    ? 'Você está inscrito para receber notificações neste dispositivo.'
                    : 'Clique no botão para ativar as notificações.'}
              </p>
              {!isNativePlatform && pushStateError && !configurationUnavailable ? (
                <p className="mt-1 text-xs text-destructive" role="status">
                  {pushStateError}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={handleTestNotification}
              disabled={activeDevices.length === 0 || testing || devicesPending}
            >
              {testing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
              Testar entrega
            </Button>
            {!isNativePlatform ? (
              <Button
                variant={isSubscribed ? "destructive" : "default"}
                className="w-full sm:w-auto"
                onClick={handleToggle}
                disabled={
                  isLoading
                  || (!isSubscribed && (configurationUnavailable || permission === 'denied'))
                }
              >
                {isLoading ? 'Aguarde...' : isSubscribed ? 'Desativar' : 'Ativar'}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="space-y-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">Dispositivos registrados</p>
              <p className="text-sm text-muted-foreground">O histórico abaixo mostra se o servidor conseguiu entregar em cada aparelho.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void loadDevices()} disabled={loadingDevices}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loadingDevices ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </div>

          {!organizationId ? (
            <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground" role="status">
              Selecione uma organização para consultar os dispositivos.
            </div>
          ) : devicesPending ? (
            <div className="flex items-center gap-2 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground" role="status">
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              Carregando dispositivos registrados...
            </div>
          ) : devicesFailed ? (
            <div className="flex flex-col gap-3 rounded-md bg-destructive/5 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
              <span>Não foi possível carregar os dispositivos registrados.</span>
              <Button variant="outline" size="sm" onClick={() => void loadDevices()} disabled={loadingDevices}>
                Tentar novamente
              </Button>
            </div>
          ) : devices.length === 0 ? (
            <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Nenhum dispositivo registrado. Ative as notificações neste aparelho para criar a inscrição.
            </div>
          ) : (
            <div className="space-y-2">
              {devices.map((device) => (
                <div key={device.id} className="flex items-start gap-3 rounded-md bg-muted/40 p-3">
                  <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="max-w-full truncate text-sm font-medium">{device.label}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${device.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
                        {device.active ? 'Ativo' : 'Inativo'}
                      </span>
                      <span className="text-[11px] font-light text-muted-foreground">{device.platform}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {device.lastSuccessAt
                        ? `Última entrega: ${new Date(device.lastSuccessAt).toLocaleString('pt-BR')}`
                        : 'Ainda sem entrega confirmada.'}
                    </p>
                    {device.lastFailureReason ? (
                      <p className="mt-1 text-xs text-destructive">
                        Última falha: {device.lastFailureReason} ({device.failureCount} consecutiva(s))
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
      <AlertDialog
        open={disableDialogOpen}
        onOpenChange={(open) => {
          if (!open && isLoading) return;
          setDisableDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar notificações neste dispositivo?</AlertDialogTitle>
            <AlertDialogDescription>
              Este navegador deixará de receber alertas do CRM. Você poderá ativá-los novamente depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDisable();
              }}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
