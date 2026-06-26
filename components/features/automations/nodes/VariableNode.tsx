import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { PenLine } from 'lucide-react';

export const VariableNode = memo(({ data, selected }: NodeProps) => {
  const variableName = data.variable_name || '';
  const variableValue = data.variable_value || '';

  return (
    <div className={`automation-node px-4 py-3 rounded-xl min-w-[220px] max-w-[280px] ${
      selected ? 'ring-2 ring-yellow-400/60' : ''
    }`} style={{ '--node-accent': '#eab308' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-yellow-400 !w-3 !h-3 !border-2 !border-yellow-500/50" />
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-yellow-500 shrink-0">
          <PenLine className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-bold text-yellow-600 dark:text-yellow-400 uppercase tracking-wider">Variável</span>
          {variableName ? (
            <p className="text-xs text-muted-foreground mt-1">
              <code className="bg-yellow-500/15 px-1 rounded text-yellow-700 dark:text-yellow-300">{variableName}</code> = {variableValue || '...'}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-1">Clique para configurar...</p>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-yellow-400 !w-3 !h-3 !border-2 !border-yellow-500/50" />
    </div>
  );
});

VariableNode.displayName = 'VariableNode';
