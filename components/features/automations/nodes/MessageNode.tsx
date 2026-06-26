import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { MessageSquare } from 'lucide-react';

export const MessageNode = memo(({ data, selected }: NodeProps) => {
  const message = data.message || 'Clique para editar...';
  const day = data.day || 1;
  const preview = message.length > 60 ? message.substring(0, 60) + '...' : message;

  return (
    <div className={`automation-node px-4 py-3 rounded-xl min-w-[220px] max-w-[280px] ${
      selected ? 'ring-2 ring-green-400/60' : ''
    }`} style={{ '--node-accent': '#22c55e' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-green-400 !w-3 !h-3 !border-2 !border-green-500/50" />
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-green-500 shrink-0">
          <MessageSquare className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold text-green-600 dark:text-green-400 uppercase tracking-wider">Mensagem</span>
            <span className="text-[10px] bg-green-500/20 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded-md font-medium">
              Dia {day}
            </span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">
            {preview}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-green-400 !w-3 !h-3 !border-2 !border-green-500/50" />
    </div>
  );
});

MessageNode.displayName = 'MessageNode';
