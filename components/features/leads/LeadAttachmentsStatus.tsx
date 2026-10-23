import { Button } from '@/components/ui/button';

export function LeadAttachmentsStatus({ loading, error, empty, retrying, onRetry }: {
  loading: boolean; error: boolean; empty: boolean; retrying: boolean; onRetry: () => void;
}) {
  if (loading) return <p role="status" className="text-xs text-[var(--app-text-secondary)]">Carregando documentos...</p>;
  if (error) return <div role="alert" className="space-y-2 text-xs"><p>Não foi possível carregar os documentos.</p><Button variant="outline" disabled={retrying} onClick={onRetry}>{retrying ? 'Carregando...' : 'Tentar novamente'}</Button></div>;
  if (empty) return <p className="text-xs text-[var(--app-text-tertiary)]">Nenhum documento anexado.</p>;
  return null;
}
