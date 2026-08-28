import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Type, Hash, AtSign, Globe, Phone, Calendar, MousePointerClick } from 'lucide-react';

const INPUT_TYPES: Record<string, { label: string; icon: typeof Type }> = {
  text: { label: 'Texto', icon: Type },
  number: { label: 'Número', icon: Hash },
  email: { label: 'Email', icon: AtSign },
  website: { label: 'Website', icon: Globe },
  phone: { label: 'Telefone', icon: Phone },
  date: { label: 'Data', icon: Calendar },
  button: { label: 'Botão', icon: MousePointerClick },
};

export const InputNode = memo(({ data, selected }: NodeProps) => {
  const inputType = data.input_type || 'text';
  const config = INPUT_TYPES[inputType] || INPUT_TYPES.text;
  const Icon = config.icon;
  const variable = data.variable_name || '';
  const prompt = data.prompt || '';

  return (
    <div className={`automation-node min-w-[220px] max-w-[280px] rounded-[8px] px-4 py-3 ${
      selected ? 'automation-node-selected' : ''
    }`} style={{ '--node-accent': 'var(--chart-4)' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-cyan-400 !w-3 !h-3 !border-2 !border-cyan-500/50" />
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-cyan-500 shrink-0">
          <Icon className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[12px] font-normal text-cyan-600 dark:text-cyan-400">Input</span>
            <span className="rounded-[4px] bg-[var(--app-surface-soft)] px-1.5 py-0.5 text-[10px] font-light text-[var(--app-text-secondary)]">
              {config.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1">
            {prompt || 'Clique para configurar...'}
          </p>
          {variable && (
            <code className="mt-1 inline-block rounded-[4px] bg-[var(--app-surface-soft)] px-1 text-[10px] text-[var(--app-text-secondary)]">
              {`{{${variable}}}`}
            </code>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-cyan-400 !w-3 !h-3 !border-2 !border-cyan-500/50" />
    </div>
  );
});

InputNode.displayName = 'InputNode';
