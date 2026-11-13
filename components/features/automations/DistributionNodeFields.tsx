import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRoundRobins } from '@/hooks/use-round-robins';
import { useUserPermissions } from '@/hooks/use-user-permissions';

interface DistributionNodeFieldsProps {
  nodeId: string;
  queueId: string;
  onQueueChange: (queueId: string, queueName: string) => void;
}

export function DistributionNodeFields({ nodeId, queueId, onQueueChange }: DistributionNodeFieldsProps) {
  const { hasPermission } = useUserPermissions();
  const canManage = hasPermission('distribution_manage') && hasPermission('lead_operate');
  const query = useRoundRobins({ enabled: canManage });
  const queues = canManage ? query.data?.filter((queue) => queue.is_active === true) ?? [] : [];
  const selected = queues.find((queue) => queue.id === queueId);
  const fieldId = `distribution-queue-${nodeId}`;
  const unavailable = !canManage || query.isPending || query.isError || queues.length === 0;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId} className="text-xs">Fila de distribuição</Label>
      <Select value={selected?.id ?? ''} disabled={unavailable} onValueChange={(value) => {
        const queue = queues.find((item) => item.id === value);
        if (queue) onQueueChange(queue.id, queue.name);
      }}>
        <SelectTrigger id={fieldId} className="h-9">
          <SelectValue placeholder={canManage && query.isPending ? 'Carregando filas…' : 'Selecione a fila'} />
        </SelectTrigger>
        <SelectContent className="z-[200]">
          {queues.map((queue) => <SelectItem key={queue.id} value={queue.id}>{queue.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {!canManage ? (
        <p className="text-xs text-muted-foreground">Você precisa de permissão para gerenciar distribuições e operar leads.</p>
      ) : query.isError ? (
        <p role="alert" className="text-xs text-destructive">Não foi possível carregar as filas de distribuição.</p>
      ) : !query.isPending && queueId && !selected ? (
        <p role="alert" className="text-xs text-destructive">A fila configurada não está ativa. Selecione outra fila.</p>
      ) : !query.isPending && queues.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma fila ativa está disponível.</p>
      ) : (
        <p className="text-xs text-muted-foreground">O responsável atual só muda se a fila puder atribuir o lead.</p>
      )}
    </div>
  );
}
