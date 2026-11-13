import { memo, useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from 'reactflow';
import { Timer } from 'lucide-react';

export const WaitNode = memo(({ id, data, selected }: NodeProps) => {
  const getValue = () => {
    const value = data.wait_value || data.delay_value || 1;
    const type = data.wait_type || data.delay_type || 'days';
    const labels: Record<string, string> = { seconds: 'segundo(s)', minutes: 'minuto(s)', hours: 'hora(s)', days: 'dia(s)' };
    return `${value} ${labels[type] || type}`;
  };

  const stopOnReply = data.stop_on_reply === true;
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, stopOnReply, updateNodeInternals]);

  return (
    <div className={`automation-node relative rounded-[8px] py-3 pl-4 ${
      selected ? 'automation-node-selected' : ''
    } ${stopOnReply ? 'min-w-[235px] pr-24' : 'min-w-[180px] pr-4'}`} style={{ '--node-accent': 'var(--chart-3)' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-purple-400 !w-3 !h-3 !border-2 !border-purple-500/50" />
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-purple-500 shrink-0">
          <Timer className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <div className="text-[12px] font-normal text-purple-600 dark:text-purple-400">Aguardar</div>
          <div className="text-[12px] font-normal text-foreground">{getValue()}</div>
        </div>
      </div>
      {/* Default output (no reply / timeout) */}
      <Handle
        type="source"
        position={Position.Right}
        id={stopOnReply ? 'no_reply' : undefined}
        title={stopOnReply ? 'Não respondeu' : 'Continuar após a espera'}
        className="!bg-purple-400 !w-3 !h-3 !border-2 !border-purple-500/50"
        style={stopOnReply ? { top: '30%' } : undefined}
      />
      {/* Reply output - only shown when stop_on_reply is enabled */}
      {stopOnReply && (
        <Handle
          type="source"
          position={Position.Right}
          id="replied"
          title="Respondeu"
          className="!bg-green-400 !w-3 !h-3 !border-2 !border-green-500/50"
          style={{ top: '70%' }}
        />
      )}
      {stopOnReply && (
        <>
          <span className="pointer-events-none absolute right-3 top-[30%] -translate-y-1/2 whitespace-nowrap text-[10px] font-medium text-foreground">Não respondeu</span>
          <span className="pointer-events-none absolute right-3 top-[70%] -translate-y-1/2 whitespace-nowrap text-[10px] font-medium text-foreground">Respondeu</span>
        </>
      )}
    </div>
  );
});

WaitNode.displayName = 'WaitNode';
