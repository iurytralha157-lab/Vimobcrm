import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ArrowRightLeft } from 'lucide-react';

export const MoveStageNode = memo(({ data, selected }: NodeProps) => {
  const stageName = data.stage_name || '';

  return (
    <div className={`automation-node px-4 py-3 rounded-xl min-w-[220px] max-w-[280px] ${
      selected ? 'ring-2 ring-violet-400/60' : ''
    }`} style={{ '--node-accent': '#8b5cf6' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-violet-400 !w-3 !h-3 !border-2 !border-violet-500/50" />
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-violet-500 shrink-0">
          <ArrowRightLeft className="h-5 w-5 text-white" />
        </div>
        <div>
          <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wider">Mudar Etapa</span>
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
