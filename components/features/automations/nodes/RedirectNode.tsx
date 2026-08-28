import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ExternalLink } from 'lucide-react';

export const RedirectNode = memo(({ data, selected }: NodeProps) => {
  const url = data.redirect_url || '';

  return (
    <div className={`automation-node min-w-[220px] max-w-[280px] rounded-[8px] px-4 py-3 ${
      selected ? 'automation-node-selected' : ''
    }`} style={{ '--node-accent': 'var(--chart-4)' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-teal-400 !w-3 !h-3 !border-2 !border-teal-500/50" />
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-teal-500 shrink-0">
          <ExternalLink className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <span className="text-[12px] font-normal text-teal-600 dark:text-teal-400">Redirecionar</span>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {url || 'Clique para configurar...'}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-teal-400 !w-3 !h-3 !border-2 !border-teal-500/50" />
    </div>
  );
});

RedirectNode.displayName = 'RedirectNode';
