import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ArrowRightLeft } from 'lucide-react';

export const MoveStageNode = memo(({ data, selected }: NodeProps) => {
  const stageName = data.stage_name || '';

  return (
    <div className={`automation-node min-w-[220px] max-w-[280px] rounded-[8px] px-4 py-3 ${
      selected ? 'automation-node-selected' : ''
    }`} style={{ '--node-accent': 'var(--chart-3)' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-violet-400 !w-3 !h-3 !border-2 !border-violet-500/50" />
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-violet-500 shrink-0">
          <ArrowRightLeft className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <span className="text-[12px] font-normal text-violet-600 dark:text-violet-400">Mudar etapa</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            {stageName || 'Clique para configurar...'}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-violet-400 !w-3 !h-3 !border-2 !border-violet-500/50" />
    </div>
  );
});

MoveStageNode.displayName = 'MoveStageNode';
