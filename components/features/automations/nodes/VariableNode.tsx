import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { PenLine } from 'lucide-react';

export const VariableNode = memo(({ data, selected }: NodeProps) => {
  const variableName = data.variable_name || '';
  const variableValue = data.variable_value || '';

  return (
    <div className={`automation-node min-w-[220px] max-w-[280px] rounded-[8px] px-4 py-3 ${
      selected ? 'automation-node-selected' : ''
    }`} style={{ '--node-accent': 'var(--warning)' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-yellow-400 !w-3 !h-3 !border-2 !border-yellow-500/50" />
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-yellow-500 shrink-0">
          <PenLine className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[12px] font-normal text-yellow-600 dark:text-yellow-400">Variável</span>
          {variableName ? (
            <p className="text-xs text-muted-foreground mt-1">
              <code className="rounded-[4px] bg-[var(--app-surface-soft)] px-1 text-[var(--app-text-secondary)]">{variableName}</code> = {variableValue || '...'}
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
