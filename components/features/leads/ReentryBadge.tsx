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

  const tooltipText = lastEntryAt
    ? `Última reentrada: ${format(new Date(lastEntryAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`
    : `${value} reentrada${value > 1 ? 's' : ''}`;

  const sizeClass = size === 'sm' ? 'h-5 px-1.5 text-[10px]' : 'h-6 px-2 text-xs';
  const iconClass = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full font-semibold',
              'bg-warning/15 text-warning border border-warning/30',
              sizeClass,
              className
            )}
          >
            <RotateCw className={iconClass} />
            {value}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltipText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}