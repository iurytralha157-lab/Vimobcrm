import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Tag } from 'lucide-react';

export const TagNode = memo(({ data, selected }: NodeProps) => {
  const tagName = data.tag_name || '';
  const action = data.tag_action || 'add';

  return (
    <div className={`automation-node px-4 py-3 rounded-xl min-w-[220px] max-w-[280px] ${
      selected ? 'ring-2 ring-teal-400/60' : ''
    }`} style={{ '--node-accent': '#14b8a6' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-teal-400 !w-3 !h-3 !border-2 !border-teal-500/50" />
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-teal-500 shrink-0">
          <Tag className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wider">Tag</span>
            <span className="text-[10px] bg-teal-500/20 text-teal-700 dark:text-teal-300 px-1.5 py-0.5 rounded-md">
              {action === 'add' ? 'Adicionar' : 'Remover'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {tagName || 'Clique para configurar...'}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-teal-400 !w-3 !h-3 !border-2 !border-teal-500/50" />
    </div>
  );
});

TagNode.displayName = 'TagNode';
