import { memo, type CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { UsersRound } from 'lucide-react';

export const DistributeLeadNode = memo(function DistributeLeadNode({ data, selected }: NodeProps<{ queue_name?: string }>) {
  return (
    <div className={`automation-node min-w-[220px] max-w-[280px] rounded-lg px-4 py-3${selected ? ' automation-node-selected' : ''}`}
      style={{ '--node-accent': 'var(--chart-2)' } as CSSProperties}>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-sky-400" />
      <div className="flex items-center gap-3">
        <div className="shrink-0 rounded-lg bg-sky-500 p-2">
          <UsersRound className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <span className="text-xs text-sky-600 dark:text-sky-400">Enviar para distribuição</span>
          <p className="mt-0.5 text-xs text-muted-foreground">{data.queue_name || 'Selecione uma fila'}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-sky-400" />
    </div>
  );
});
