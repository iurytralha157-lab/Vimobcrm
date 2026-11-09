import { ArrowRightLeft, CircleDot, UserRound } from 'lucide-react';

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

const leadActionMenuItems = {
  'move-stage': { label: 'Mover para funil/etapa', icon: ArrowRightLeft },
  assign: { label: 'Alterar responsável', icon: UserRound },
  'deal-status': { label: 'Alterar status', icon: CircleDot },
};

export type ContactLeadActionKind = keyof typeof leadActionMenuItems;

export function ContactLeadActionMenuItems({
  onSelect,
}: {
  onSelect: (kind: ContactLeadActionKind) => void;
}) {
  const kinds = Object.keys(leadActionMenuItems) as ContactLeadActionKind[];
  return kinds.map((kind) => {
    const { label, icon: Icon } = leadActionMenuItems[kind];
    return (
      <DropdownMenuItem
        key={kind}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(kind);
        }}
        className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light text-[var(--app-text-primary)] transition-colors focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]"
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
        {label}
      </DropdownMenuItem>
    );
  });
}
