import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Webhook } from 'lucide-react';

export const WebhookNode = memo(({ data, selected }: NodeProps) => {
  const url = data.webhook_url || '';
  const method = data.method || 'POST';

  return (
    <div className={`automation-node min-w-[220px] max-w-[280px] rounded-[8px] px-4 py-3 ${
      selected ? 'automation-node-selected' : ''
    }`} style={{ '--node-accent': 'var(--chart-3)' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-indigo-400 !w-3 !h-3 !border-2 !border-indigo-500/50" />
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-indigo-500 shrink-0">
          <Webhook className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[12px] font-normal text-indigo-600 dark:text-indigo-400">Webhook</span>
            <span className="rounded-[4px] bg-[var(--app-surface-soft)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--app-text-secondary)]">
              {method}
            </span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1">
            {url || 'Clique para configurar...'}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-indigo-400 !w-3 !h-3 !border-2 !border-indigo-500/50" />
    </div>
  );
});

WebhookNode.displayName = 'WebhookNode';
