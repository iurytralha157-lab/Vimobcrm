import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useMyFeatureRequests } from '@/hooks/use-feature-requests';
import { FileText, Clock, CheckCircle2, XCircle, Search } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const STATUS_CONFIG = {
  pending: { label: 'Pendente', variant: 'secondary' as const, icon: Clock },
  analyzing: { label: 'Em Análise', variant: 'default' as const, icon: Search },
  approved: { label: 'Aprovada', variant: 'default' as const, icon: CheckCircle2, className: "bg-green-500 hover:bg-green-600 text-white border-transparent" },
  rejected: { label: 'Não Aprovada', variant: 'destructive' as const, icon: XCircle },
};

export function MyRequestsList() {
  const { data: requests = [], isLoading } = useMyFeatureRequests();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Minhas Solicitações</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            Carregando...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (requests.length === 0) {
    return null; // Don't show section if no requests
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="h-5 w-5 text-primary" />
          Minhas Solicitações
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {requests.map((request) => {
          const config = STATUS_CONFIG[request.status];
          const StatusIcon = config.icon;

          return (
            <div
              key={request.id}
              className="border rounded-lg p-4 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-sm">{request.title}</h4>
                    <Badge variant={config.variant} className={cn("text-xs", "className" in config ? config.className : undefined)}>
                      <StatusIcon className="h-3 w-3 mr-1" />
                      {config.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {request.category} • {format(new Date(request.created_at), "dd 'de' MMM 'de' yyyy", { locale: ptBR })}
                  </p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground line-clamp-2">
                {request.description}
              </p>

              {request.admin_response && (
                <div className="bg-white/[0.045] rounded-md p-3 mt-2">
                  <p className="text-xs font-medium text-foreground mb-1">Resposta:</p>
                  <p className="text-sm text-muted-foreground">{request.admin_response}</p>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
