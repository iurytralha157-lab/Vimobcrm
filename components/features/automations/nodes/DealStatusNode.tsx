import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { CircleDot } from 'lucide-react';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  open: { label: 'Em aberto', color: 'text-blue-500' },
  won: { label: 'Ganho', color: 'text-green-500' },
  lost: { label: 'Perdido', color: 'text-red-500' },
};

export const DealStatusNode = memo(({ data, selected }: NodeProps) => {
  const status = data.deal_status || '';
  const statusInfo = STATUS_LABELS[status];

  return (
    <div className={`automation-node px-4 py-3 rounded-xl min-w-[220px] max-w-[280px] ${
      selected ? 'ring-2 ring-pink-400/60' : ''
    }`} style={{ '--node-accent': '#ec4899' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-pink-400 !w-3 !h-3 !border-2 !border-pink-500/50" />
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-pink-500 shrink-0">
          <CircleDot className="h-5 w-5 text-white" />
        </div>
        <div>
          <span className="text-[10px] font-bold text-pink-600 dark:text-pink-400 uppercase tracking-wider">Status</span>
          <p className={`text-xs mt-0.5 ${statusInfo ? statusInfo.color : 'text-muted-foreground'}`}>
            {statusInfo ? statusInfo.label : 'Clique para configurar...'}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-pink-400 !w-3 !h-3 !border-2 !border-pink-500/50" />
    </div>
  );
});

DealStatusNode.displayName = 'DealStatusNode';
