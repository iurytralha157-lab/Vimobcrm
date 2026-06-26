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
    <div className={`automation-node px-4 py-3 rounded-xl min-w-[220px] max-w-[280px] ${
      selected ? 'ring-2 ring-cyan-400/60' : ''
    }`} style={{ '--node-accent': '#06b6d4' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-cyan-400 !w-3 !h-3 !border-2 !border-cyan-500/50" />
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-cyan-500 shrink-0">
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold text-cyan-600 dark:text-cyan-400 uppercase tracking-wider">Input</span>
            <span className="text-[10px] bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 px-1.5 py-0.5 rounded-md">
              {config.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1">
            {prompt || 'Clique para configurar...'}
          </p>
          {variable && (
            <code className="text-[10px] text-cyan-700 dark:text-cyan-300 bg-cyan-500/15 px-1 rounded mt-1 inline-block">
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
