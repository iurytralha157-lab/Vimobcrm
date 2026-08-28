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
    contains_any: 'contém qualquer', not_contains_any: 'não contém nenhum',
    greater_than: '>', less_than: '<', is_set: 'existe', is_not_set: 'não existe',
  };

  const isResponseSentiment = conditionType === 'response_sentiment';

  return (
    <div className={`automation-node min-w-[220px] max-w-[280px] rounded-[8px] px-4 py-3 ${
      selected ? 'automation-node-selected' : ''
    }`} style={{ '--node-accent': 'var(--warning)' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-yellow-400 !w-3 !h-3 !border-2 !border-yellow-500/50" />
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${isResponseSentiment ? 'bg-emerald-500' : 'bg-yellow-500'} shrink-0`}>
          {isResponseSentiment ? (
            <MessageCircle className="h-5 w-5 text-primary-foreground" />
          ) : (
            <GitBranch className="h-5 w-5 text-primary-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className={`text-[12px] font-normal ${isResponseSentiment ? 'text-emerald-600 dark:text-emerald-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
            {isResponseSentiment ? 'Resposta do Lead' : 'Condição'}
          </span>
          {isResponseSentiment ? (
            <p className="text-xs text-muted-foreground mt-1">Classificar resposta com segurança</p>
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
        className="!bg-green-400 !w-3 !h-3 !border-2 !border-green-500/50" style={{ top: isResponseSentiment ? '25%' : '35%' }} />
      <Handle type="source" position={Position.Right} id="false"
        className="!bg-red-400 !w-3 !h-3 !border-2 !border-red-500/50" style={{ top: isResponseSentiment ? '50%' : '65%' }} />
      {isResponseSentiment && (
        <Handle type="source" position={Position.Right} id="unknown"
          className="!bg-amber-400 !w-3 !h-3 !border-2 !border-amber-500/50" style={{ top: '75%' }} />
      )}
      <div className={`flex flex-col absolute text-[10px] ${isResponseSentiment ? 'right-[-48px] top-[18%] gap-[13px]' : 'right-[-28px] top-1/2 -translate-y-1/2 gap-4'}`}>
        <span className="text-green-400 font-medium">{isResponseSentiment ? 'Positiva' : 'Sim'}</span>
        <span className="text-red-400 font-medium">{isResponseSentiment ? 'Negativa' : 'Não'}</span>
        {isResponseSentiment && <span className="text-amber-400 font-medium">Incerta</span>}
      </div>
    </div>
  );
});

ConditionNode.displayName = 'ConditionNode';
