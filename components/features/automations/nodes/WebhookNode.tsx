import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Webhook } from 'lucide-react';

export const WebhookNode = memo(({ data, selected }: NodeProps) => {
  const url = data.webhook_url || '';
  const method = data.method || 'POST';

  return (
    <div className={`automation-node px-4 py-3 rounded-xl min-w-[220px] max-w-[280px] ${
      selected ? 'ring-2 ring-indigo-400/60' : ''
    }`} style={{ '--node-accent': '#6366f1' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-indigo-400 !w-3 !h-3 !border-2 !border-indigo-500/50" />
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-indigo-500 shrink-0">
          <Webhook className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">Webhook</span>
            <span className="text-[10px] bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded-md font-mono">
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
