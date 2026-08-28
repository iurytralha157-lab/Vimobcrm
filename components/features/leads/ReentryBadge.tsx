import { RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ReentryBadgeProps {
  count: number | null | undefined;
  lastEntryAt?: string | null;
  className?: string;
  size?: 'sm' | 'md';
}

/**
 * Badge que sinaliza quantas vezes um lead reentrou.
 * Visível apenas quando count > 0.
 */
export function ReentryBadge({ count, lastEntryAt, className, size = 'sm' }: ReentryBadgeProps) {
  const value = count ?? 0;
  if (value <= 0) return null;

  const lastEntryDate = lastEntryAt ? new Date(lastEntryAt) : null;
  const tooltipText = lastEntryDate && !Number.isNaN(lastEntryDate.getTime())
    ? `Última reentrada: ${format(lastEntryDate, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`
    : `${value} reentrada${value > 1 ? 's' : ''}`;

  const sizeClass = size === 'sm' ? 'h-5 px-1.5 text-[10px]' : 'h-6 px-2 text-xs';
  const iconClass = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="status"
            tabIndex={0}
            aria-label={tooltipText}
            className={cn(
              'inline-flex items-center gap-1 rounded-full font-normal',
              'bg-warning/15 text-warning border border-warning/30',
              sizeClass,
              className
            )}
          >
            <RotateCw aria-hidden="true" className={iconClass} />
            {value}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltipText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
