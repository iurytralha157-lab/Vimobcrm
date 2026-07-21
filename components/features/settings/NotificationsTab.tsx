import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useWebPush } from '@/hooks/use-web-push';
import { useAuth } from '@/contexts/AuthContext';
import { settingsAPI, type PushDevice } from '@/lib/api/settings';
import { Bell, BellOff, CircleAlert, MonitorSmartphone, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useState } from 'react';

export const NotificationsTab = () => {
  const { user, profile } = useAuth();
  const { isSupported, permission, isSubscribed, isLoading, subscribe, unsubscribe } = useWebPush();
  const [testing, setTesting] = useState(false);
  const organizationId = profile?.organization_id;
  const {
    data: devices = [],
    isFetching: loadingDevices,
    refetch: refetchDevices,
  } = useQuery<PushDevice[]>({
    queryKey: ['settings', 'push-devices', organizationId],
    queryFn: () => settingsAPI.listPushDevices(organizationId!),
    enabled: Boolean(organizationId),
    staleTime: 30_000,
  });

  const loadDevices = async () => {
    await refetchDevices();
  };

  const handleToggle = async () => {
    if (isSubscribed) {
      await unsubscribe();
      toast.success('Notificações desativadas');
      await loadDevices();
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

  const handleTestNotification = async () => {
    try {
      if (!user) return;

      setTesting(true);

      const organizationId = profile?.organization_id || '';

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

  if (!isSupported) {
    return (
      <Card>
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
    <Card>
      <CardHeader>
        <CardTitle>Notificações Push</CardTitle>
        <CardDescription>
          Receba notificações em tempo real diretamente no seu dispositivo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="flex items-center gap-3">
            {isSubscribed ? (
              <Bell className="h-5 w-5 text-success" />
            ) : (
              <BellOff className="h-5 w-5 text-muted-foreground" />
            )}
            <div>
              <p className="font-medium">
                {isSubscribed ? 'Notificações Ativas' : 'Notificações Inativas'}
              </p>
              <p className="text-sm text-muted-foreground">
                {permission === 'denied'
                  ? 'Permissao negada no navegador'
                  : isSubscribed
                    ? 'Você está inscrito para receber notificações neste dispositivo.'
                    : 'Clique no botão para ativar as notificações.'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleTestNotification}
              disabled={!isSubscribed || testing}
            >
              {testing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
              Testar entrega
            </Button>
            <Button
              variant={isSubscribed ? "destructive" : "default"}
              onClick={handleToggle}
              disabled={isLoading}
            >
              {isSubscribed ? 'Desativar' : 'Ativar'}
            </Button>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">Dispositivos registrados</p>
              <p className="text-sm text-muted-foreground">O histórico abaixo mostra se o servidor conseguiu entregar em cada aparelho.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void loadDevices()} disabled={loadingDevices}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loadingDevices ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </div>

          {devices.length === 0 ? (
            <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              Nenhum dispositivo registrado. Ative as notificações neste aparelho para criar a inscrição.
            </div>
          ) : (
            <div className="space-y-2">
              {devices.map((device) => (
                <div key={device.id} className="flex items-start gap-3 rounded-md bg-muted/40 p-3">
                  <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="max-w-full truncate text-sm font-medium">{device.label}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${device.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
                        {device.active ? 'Ativo' : 'Inativo'}
                      </span>
                      <span className="text-[11px] uppercase text-muted-foreground">{device.platform}</span>
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
    </Card>
  );
};
