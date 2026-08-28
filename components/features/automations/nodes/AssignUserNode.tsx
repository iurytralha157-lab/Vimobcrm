import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { UserCheck } from 'lucide-react';

export const AssignUserNode = memo(({ data, selected }: NodeProps) => {
  const userName = data.user_name || '';

  return (
    <div className={`automation-node min-w-[220px] max-w-[280px] rounded-[8px] px-4 py-3 ${
      selected ? 'automation-node-selected' : ''
    }`} style={{ '--node-accent': 'var(--chart-2)' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-sky-400 !w-3 !h-3 !border-2 !border-sky-500/50" />
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-sky-500 shrink-0">
          <UserCheck className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <span className="text-[12px] font-normal text-sky-600 dark:text-sky-400">Responsável</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            {userName || 'Clique para configurar...'}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-sky-400 !w-3 !h-3 !border-2 !border-sky-500/50" />
    </div>
  );
});

AssignUserNode.displayName = 'AssignUserNode';
