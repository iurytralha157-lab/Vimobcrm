import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Play, Tag, UserPlus, ArrowRightLeft, Hand, MessageSquareText, Clock } from 'lucide-react';

const getTriggerIcon = (triggerType?: string) => {
  switch (triggerType) {
    case 'tag_added': return Tag;
    case 'lead_created': return UserPlus;
    case 'lead_stage_changed': return ArrowRightLeft;
    case 'manual': return Hand;
    case 'message_received': return MessageSquareText;
    case 'inactivity': return Clock;
    default: return Play;
  }
};

const getTriggerLabel = (triggerType?: string) => {
  switch (triggerType) {
    case 'tag_added': return 'Tag adicionada';
    case 'lead_created': return 'Lead criado';
    case 'lead_stage_changed': return 'Mudou de etapa';
    case 'manual': return 'Disparo manual';
    case 'message_received': return 'Mensagem recebida';
    case 'inactivity': return 'Inatividade';
    default: return 'Clique para configurar';
  }
};

export const StartNode = memo(({ data, selected }: NodeProps) => {
  const Icon = getTriggerIcon(data.trigger_type);

  return (
    <div className={`automation-node px-4 py-3 rounded-xl min-w-[180px] cursor-pointer ${
      selected ? 'ring-2 ring-orange-400/60' : ''
    }`} style={{ '--node-accent': '#f97316' } as React.CSSProperties}>
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-orange-500 shrink-0">
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-[10px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider">Início</div>
          <div className="text-sm font-semibold text-foreground">{getTriggerLabel(data.trigger_type)}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-orange-400 !w-3 !h-3 !border-2 !border-orange-500/50" />
    </div>
  );
});

StartNode.displayName = 'StartNode';
