import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useWebPush } from '@/hooks/use-web-push';
import { useAuth } from '@/contexts/AuthContext';
import { Bell, BellOff } from 'lucide-react';
import { toast } from 'sonner';

export const NotificationsTab = () => {
  const { user, profile } = useAuth();
  const { isSupported, permission, isSubscribed, subscribe, unsubscribe } = useWebPush();

  const handleToggle = async () => {
    if (isSubscribed) {
      await unsubscribe();
      toast.success('Notificações desativadas');
      return;
    }

    const result = await subscribe();
    if (result.ok) {
      toast.success('Notificações ativadas com sucesso!');
    } else {
      toast.error(result.message);
    }
  };

  const handleTestNotification = async () => {
    try {
      if (!user) return;

      const organizationId = profile?.organization_id || '';

      if (!organizationId) {
        toast.error('Não encontramos a organização para enviar o teste.');
        return;
      }

      const { notificationService } = await import('@/services/NotificationService');
      const { error } = await notificationService.send({
        eventKey: 'test_push',
        organizationId,
        userId: user.id,
        variables: {}
      });

      if (error) throw error;
      toast.success('Solicitacao de teste enviada!');
    } catch (err) {
      console.error('Erro ao testar push:', err);
      toast.error('Erro ao enviar notificacao de teste.');
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
              disabled={!isSubscribed}
            >
              Testar
            </Button>
            <Button
              variant={isSubscribed ? "destructive" : "default"}
              onClick={handleToggle}
            >
              {isSubscribed ? 'Desativar' : 'Ativar'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
