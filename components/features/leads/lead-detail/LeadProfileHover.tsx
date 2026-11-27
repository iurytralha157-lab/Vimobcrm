import { useState } from 'react';
import { Info } from 'lucide-react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import type { LeadDetailLead } from './types';
import { LeadProfileDetails } from './LeadProfileDetails';
import { cn } from '@/lib/utils';
import { normalizeDisplayName } from '@/lib/display-name';

export function LeadProfileHover({
  lead,
  canRevealSensitive,
  variant = 'default',
}: {
  lead: LeadDetailLead;
  canRevealSensitive: boolean;
  variant?: 'default' | 'pipeline';
}) {
  const [open, setOpen] = useState(false);
  const displayName = normalizeDisplayName(lead.name, 'Lead');

  // Closing unmounts the content, which hides revealed documents again.
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={100} closeDelay={420}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="group inline-flex min-w-0 max-w-full items-center justify-end gap-1 text-right font-normal text-[var(--app-text-primary)] outline-none transition-colors hover:text-primary focus-visible:text-primary"
        >
          <span className="truncate underline decoration-dotted decoration-[var(--app-text-tertiary)] underline-offset-4 group-hover:decoration-primary">
            {displayName}
          </span>
          <Info className="h-3 w-3 shrink-0 text-[var(--app-text-tertiary)] group-hover:text-primary" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={4}
        collisionPadding={12}
        className={cn('vimob-popover-content z-[110] w-[min(420px,calc(100vw-2rem))] rounded-[8px] border-0 p-0 text-left text-[var(--app-text-primary)] shadow-none', variant === 'pipeline' && '[&_div]:text-xs [&_p]:text-xs [&_button]:text-xs')}
      >
        <div className="border-b border-[var(--app-border)] px-3 py-2">
          <p className="text-[11px] font-normal text-primary">Ficha do lead</p>
        </div>
        <LeadProfileDetails
          lead={lead}
          canRevealSensitive={canRevealSensitive}
          scrollClassName={variant === 'pipeline' ? 'max-h-[min(430px,calc(100dvh-72px))]' : 'max-h-[430px]'}
        />
      </HoverCardContent>
    </HoverCard>
  );
}
