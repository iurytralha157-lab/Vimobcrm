import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Tag } from 'lucide-react';

export const TagNode = memo(({ data, selected }: NodeProps) => {
  const tagName = data.tag_name || '';
  const action = data.tag_action || 'add';

  return (
    <div className={`automation-node min-w-[220px] max-w-[280px] rounded-[8px] px-4 py-3 ${
      selected ? 'automation-node-selected' : ''
    }`} style={{ '--node-accent': 'var(--chart-4)' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-teal-400 !w-3 !h-3 !border-2 !border-teal-500/50" />
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-teal-500 shrink-0">
          <Tag className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[12px] font-normal text-teal-600 dark:text-teal-400">Tag</span>
            <span className="rounded-[4px] bg-[var(--app-surface-soft)] px-1.5 py-0.5 text-[10px] font-light text-[var(--app-text-secondary)]">
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
