import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LeadAssigneeCatalogState } from '@/components/features/leads/lead-detail/types';

export function LeadAssigneeCatalogNotice({ state }: {
  state?: LeadAssigneeCatalogState;
}) {
  if (!state || (!state.loading && !state.error)) return null;
  return <div role="status" className="space-y-2 px-2 py-3 text-xs font-light text-[var(--app-text-secondary)]">
    <p className="flex items-center gap-2">
      {(state.loading || state.retrying) && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}
      {state.error ? 'Não foi possível carregar os responsáveis.' : 'Carregando responsáveis…'}
    </p>
    {state.error && <Button type="button" size="sm" disabled={state.retrying} onClick={state.retry}
      className="h-8 rounded-[6px] bg-primary/50 px-2 text-xs font-light text-white hover:bg-primary/60">
      {state.retrying ? 'Atualizando…' : 'Tentar novamente'}
    </Button>}
  </div>;
}
