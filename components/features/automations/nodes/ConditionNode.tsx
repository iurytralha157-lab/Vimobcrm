import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { GitBranch, MessageCircle } from 'lucide-react';

export const ConditionNode = memo(({ data, selected }: NodeProps) => {
  const conditionType = data.condition_type || 'custom';
  const variable = data.variable || '';
  const operator = data.operator || 'equals';
  const value = data.value || '';

  const operatorLabels: Record<string, string> = {
    equals: '=', not_equals: '≠', contains: 'contém', not_contains: 'não contém',
    greater_than: '>', less_than: '<', is_set: 'existe', is_not_set: 'não existe',
  };

  const isResponseSentiment = conditionType === 'response_sentiment';

  return (
    <div className={`automation-node px-4 py-3 rounded-xl min-w-[220px] max-w-[280px] ${
      selected ? 'ring-2 ring-yellow-400/60' : ''
    }`} style={{ '--node-accent': '#eab308' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-yellow-400 !w-3 !h-3 !border-2 !border-yellow-500/50" />
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${isResponseSentiment ? 'bg-emerald-500' : 'bg-yellow-500'} shrink-0`}>
          {isResponseSentiment ? (
            <MessageCircle className="h-5 w-5 text-white" />
          ) : (
            <GitBranch className="h-5 w-5 text-white" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className={`text-[10px] font-bold ${isResponseSentiment ? 'text-emerald-600 dark:text-emerald-400' : 'text-yellow-600 dark:text-yellow-400'} uppercase tracking-wider`}>
            {isResponseSentiment ? 'Resposta do Lead' : 'Condição'}
          </span>
          {isResponseSentiment ? (
            <p className="text-xs text-muted-foreground mt-1">Resposta positiva?</p>
          ) : variable ? (
            <p className="text-xs text-muted-foreground mt-1">
              {variable} {operatorLabels[operator] || operator} {value}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-1">Clique para configurar...</p>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="true"
        className="!bg-green-400 !w-3 !h-3 !border-2 !border-green-500/50" style={{ top: '35%' }} />
      <Handle type="source" position={Position.Right} id="false"
        className="!bg-red-400 !w-3 !h-3 !border-2 !border-red-500/50" style={{ top: '65%' }} />
      <div className="flex flex-col absolute right-[-28px] top-1/2 -translate-y-1/2 gap-4 text-[10px]">
        <span className="text-green-400 font-medium">Sim</span>
        <span className="text-red-400 font-medium">Não</span>
      </div>
    </div>
  );
});

ConditionNode.displayName = 'ConditionNode';
