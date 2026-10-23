import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function PipelineLeadLoadingDialog({ onClose, accessError = false, retrying = false, onRetry }: {
  onClose: () => void;
  accessError?: boolean;
  retrying?: boolean;
  onRetry?: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        data-testid="pipeline-lead-loading"
        className="w-[min(360px,calc(100vw-32px))] gap-3 rounded-[6px] p-5 text-center [&>button:last-child]:hidden"
      >
        <DialogHeader className="items-center text-center sm:text-center">
          <DialogTitle className="text-sm">{accessError ? 'Acesso ao lead em verificação' : 'Abrindo lead'}</DialogTitle>
          <DialogDescription className="text-xs">{accessError ? 'Não foi possível confirmar o acesso agora. A edição fica preservada nesta janela até você tentar novamente ou fechar.' : 'Carregando os detalhes do lead.'}</DialogDescription>
        </DialogHeader>
        <div role="status" aria-live="polite" aria-busy={!accessError || retrying} className="flex flex-col items-center justify-center gap-2 py-1 text-xs text-muted-foreground">
          {(!accessError || retrying) && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
          {accessError && !retrying ? 'Os dados estão ocultos e as ações bloqueadas.' : 'Aguarde um instante…'}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button className="rounded-[6px] bg-primary/50 text-xs text-white hover:bg-primary/60" onClick={onClose}>{accessError ? 'Fechar' : 'Cancelar'}</Button>
          {accessError && onRetry && <Button className="rounded-[6px] text-xs" disabled={retrying} onClick={onRetry}>Tentar novamente</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
