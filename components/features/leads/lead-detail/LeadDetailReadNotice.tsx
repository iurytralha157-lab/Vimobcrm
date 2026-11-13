import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LeadDetailReadState } from '@/components/features/leads/lead-detail/read-recovery';

export function LeadDetailReadNotice({ state, onRetry, onClose }: {
  state: LeadDetailReadState;
  onRetry: () => void;
  onClose?: () => void;
}) {
  if (state.kind === 'ready' || state.kind === 'revalidating') return null;
  return (
    <div data-lead-read-notice role="status" aria-live="polite" aria-busy={state.retrying}
      className="shrink-0 space-y-2 bg-[var(--app-surface-soft)] px-3 py-2 text-xs font-light text-[var(--app-text-secondary)]">
      <p className="flex items-start gap-2">
        {state.retrying && <Loader2 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />}
        {state.message}
      </p>
      {(state.canRetry || onClose) && <div className="flex flex-wrap gap-2">
        {state.canRetry && <Button type="button" size="sm" disabled={state.retrying} onClick={onRetry}
          className="h-8 rounded-[6px] bg-primary/50 px-2 text-xs font-light text-white hover:bg-primary/60">
          <RefreshCw aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
          {state.retrying ? 'Atualizando…' : 'Tentar novamente'}
        </Button>}
        {onClose && <Button type="button" variant="ghost" size="sm" onClick={onClose}
          className="h-8 rounded-[6px] px-2 text-xs font-light">Fechar</Button>}
      </div>}
    </div>
  );
}
