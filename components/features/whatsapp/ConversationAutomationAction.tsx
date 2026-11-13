import { Loader2, Square, Zap } from "lucide-react";

export function ConversationAutomationAction({ loading, unavailable, active, cancelling, onStart, onCancel, showLabel = false }: {
  loading: boolean; unavailable: boolean; active: boolean; cancelling: boolean;
  onStart: () => void; onCancel: () => void;
  showLabel?: boolean;
}) {
  if (loading) return <span className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground" role="status" aria-label="Verificando automações ativas" title="Verificando automações ativas"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /></span>;
  if (unavailable) return <span className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground/50" role="img" aria-label="Estado das automações indisponível" title="Não foi possível verificar as automações agora"><Zap className="h-4 w-4" aria-hidden="true" /></span>;
  const label = active ? "Parar automação ativa" : "Iniciar automação";
  return <button type="button" onClick={active ? onCancel : onStart} disabled={cancelling} aria-label={label} title={label} aria-busy={cancelling}
    className={showLabel ? "inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-muted disabled:opacity-50" : undefined}>
    {cancelling ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : active ? <Square className="h-5 w-5" aria-hidden="true" /> : <Zap className="h-5 w-5" aria-hidden="true" />}
    {showLabel && label}
  </button>;
}
