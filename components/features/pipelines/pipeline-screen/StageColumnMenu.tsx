'use client';

import { useRef } from 'react';
import { MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { StageSettingsTab } from '@/components/features/pipelines/StageSettingsDialog';
import { cn } from '@/lib/utils';

interface StageColumnMenuProps {
  stageName: string;
  isMobile: boolean;
  tourTarget?: string;
  onSelect: (tab: StageSettingsTab, returnFocusElement: HTMLButtonElement | null) => void;
}

const MENU_ITEMS: ReadonlyArray<{ tab: StageSettingsTab; label: string }> = [
  { tab: 'general', label: 'Configurações da coluna' },
  { tab: 'cadence', label: 'Regras da etapa' },
  { tab: 'automations', label: 'Automações' },
];

export function StageColumnMenu({ stageName, isMobile, tourTarget, onSelect }: StageColumnMenuProps) {
  const selectedItem = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) selectedItem.current = false; }}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          data-tour={tourTarget}
          aria-label={`Configurar coluna ${stageName}`}
          variant="ghost"
          size="icon"
          className={cn(
            'shrink-0 rounded-[6px] text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground',
            isMobile ? 'h-10 w-10' : 'h-7 w-7',
          )}
        >
          <MoreVertical className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        collisionPadding={8}
        aria-label={`Opções da coluna ${stageName}`}
        className="w-[220px] max-w-[calc(100vw-16px)] !rounded-[6px] p-1 text-[12px] font-light"
        onCloseAutoFocus={(event) => {
          // A selected item opens the settings sheet, which owns the next focus.
          if (!selectedItem.current) return;
          event.preventDefault();
          selectedItem.current = false;
        }}
      >
        {MENU_ITEMS.map(({ tab, label }) => (
          <DropdownMenuItem
            key={tab}
            className={cn(
              'cursor-pointer rounded-[6px] px-3 text-[12px] font-light text-[var(--app-text-primary)] focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]',
              isMobile ? 'min-h-11' : 'h-9',
            )}
            onSelect={() => {
              selectedItem.current = true;
              onSelect(tab, triggerRef.current);
            }}
          >
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
