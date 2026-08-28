import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { FlipHorizontal } from 'lucide-react';

export const ABTestNode = memo(({ data, selected }: NodeProps) => {
  const splitA = data.split_a || 50;
  const splitB = 100 - splitA;

  return (
    <div className={`automation-node min-w-[220px] max-w-[280px] rounded-[8px] px-4 py-3 ${
      selected ? 'automation-node-selected' : ''
    }`} style={{ '--node-accent': 'var(--chart-5)' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-pink-400 !w-3 !h-3 !border-2 !border-pink-500/50" />
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-pink-500 shrink-0">
          <FlipHorizontal className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[12px] font-normal text-pink-600 dark:text-pink-400">Teste A/B</span>
          <div className="flex items-center gap-2 mt-1">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--app-surface-soft)]">
              <div className="h-full bg-blue-400 rounded-full" style={{ width: `${splitA}%` }} />
            </div>
            <span className="text-[10px] text-muted-foreground">{splitA}/{splitB}</span>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="a"
        className="!bg-blue-400 !w-3 !h-3 !border-2 !border-blue-500/50" style={{ top: '35%' }} />
      <Handle type="source" position={Position.Right} id="b"
        className="!bg-orange-400 !w-3 !h-3 !border-2 !border-orange-500/50" style={{ top: '65%' }} />
      <div className="flex flex-col absolute right-[-28px] top-1/2 -translate-y-1/2 gap-4 text-[10px]">
        <span className="text-blue-400 font-medium">A</span>
        <span className="text-orange-400 font-medium">B</span>
      </div>
    </div>
  );
});

ABTestNode.displayName = 'ABTestNode';
