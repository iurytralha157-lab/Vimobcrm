import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Home } from 'lucide-react';

export const PropertyInterestNode = memo(({ data, selected }: NodeProps) => {
  const propertyName = data.property_name || '';

  return (
    <div className={`automation-node px-4 py-3 rounded-xl min-w-[220px] max-w-[280px] ${
      selected ? 'ring-2 ring-emerald-400/60' : ''
    }`} style={{ '--node-accent': '#10b981' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-emerald-400 !w-3 !h-3 !border-2 !border-emerald-500/50" />
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-emerald-500 shrink-0">
          <Home className="h-5 w-5 text-white" />
        </div>
        <div>
          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Imóvel Interesse</span>
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
