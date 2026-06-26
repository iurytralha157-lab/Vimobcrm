import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Timer, MessageSquareReply } from 'lucide-react';

export const WaitNode = memo(({ data, selected }: NodeProps) => {
  const getValue = () => {
    const value = data.wait_value || data.delay_value || 1;
    const type = data.wait_type || data.delay_type || 'days';
    const labels: Record<string, string> = { seconds: 'segundo(s)', minutes: 'minuto(s)', hours: 'hora(s)', days: 'dia(s)' };
    return `${value} ${labels[type] || type}`;
  };

  const stopOnReply = data.stop_on_reply === true;

  return (
    <div className={`automation-node px-4 py-3 rounded-xl min-w-[180px] ${
      selected ? 'ring-2 ring-purple-400/60' : ''
    }`} style={{ '--node-accent': '#a855f7' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-purple-400 !w-3 !h-3 !border-2 !border-purple-500/50" />
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-purple-500 shrink-0">
          <Timer className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">Aguardar</div>
          <div className="text-sm font-semibold text-foreground">{getValue()}</div>
          {stopOnReply && (
            <div className="flex items-center gap-1 mt-0.5">
              <MessageSquareReply className="h-3 w-3 text-green-500" />
              <span className="text-[10px] text-muted-foreground">Se responder</span>
            </div>
          )}
        </div>
      </div>
      {/* Default output (no reply / timeout) */}
      <Handle
        type="source"
        position={Position.Right}
        id="no_reply"
        className="!bg-purple-400 !w-3 !h-3 !border-2 !border-purple-500/50"
        style={stopOnReply ? { top: '35%' } : {}}
      />
      {/* Reply output - only shown when stop_on_reply is enabled */}
      {stopOnReply && (
        <Handle
          type="source"
          position={Position.Right}
          id="replied"
          className="!bg-green-400 !w-3 !h-3 !border-2 !border-green-500/50"
          style={{ top: '65%' }}
        />
      )}
      {stopOnReply && (
        <div className="flex flex-col absolute right-[-50px] top-1/2 -translate-y-1/2 gap-4 text-[10px]">
          <span className="text-purple-400 font-medium">Timeout</span>
          <span className="text-green-400 font-medium">Respondeu</span>
        </div>
      )}
    </div>
  );
});

WaitNode.displayName = 'WaitNode';
