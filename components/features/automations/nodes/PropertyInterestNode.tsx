import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Home } from 'lucide-react';

export const PropertyInterestNode = memo(({ data, selected }: NodeProps) => {
  const propertyName = data.property_name || '';

  return (
    <div className={`automation-node min-w-[220px] max-w-[280px] rounded-[8px] px-4 py-3 ${
      selected ? 'automation-node-selected' : ''
    }`} style={{ '--node-accent': 'var(--success)' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-emerald-400 !w-3 !h-3 !border-2 !border-emerald-500/50" />
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-emerald-500 shrink-0">
          <Home className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <span className="text-[12px] font-normal text-emerald-600 dark:text-emerald-400">Interesse em imóvel</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            {propertyName || 'Clique para configurar...'}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-emerald-400 !w-3 !h-3 !border-2 !border-emerald-500/50" />
    </div>
  );
});

PropertyInterestNode.displayName = 'PropertyInterestNode';
