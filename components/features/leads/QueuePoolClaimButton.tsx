'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useClaimQueuePool } from '@/hooks/leads/use-claim-queue-pool';
import { canClaimQueuePool, type QueuePoolLead } from '@/lib/queue-pool';
import { cn } from '@/lib/utils';

export function QueuePoolClaimButton({ lead, compact = false, className, disabled = false }: { lead: QueuePoolLead; compact?: boolean; className?: string; disabled?: boolean }) {
  const claim = useClaimQueuePool();
  if (!lead.queue_pool || lead.assigned_user_id) return null;
  if (!canClaimQueuePool(lead)) return <span className={cn('text-[11px] text-muted-foreground', className)}>Bolsão da fila</span>;
  return <Button type="button" size="sm" disabled={claim.isPending || disabled} className={cn('pointer-events-auto', compact && 'h-10 px-2 text-[10px] md:h-6', className)} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); claim.mutate({ lead }); }}>
    {claim.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />}
    {claim.isPending ? 'Assumindo...' : 'Assumir lead'}
  </Button>;
}
