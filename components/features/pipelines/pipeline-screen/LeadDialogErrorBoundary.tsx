import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { getPipelineErrorMessage } from './model';

const LEAD_DIALOG_CHUNK_RELOAD_KEY = 'vimob:lead-dialog-chunk-reload-at';
const LEAD_DIALOG_CHUNK_RELOAD_WINDOW_MS = 5 * 60 * 1000;

function isChunkLoadError(error: unknown) {
  const message = getPipelineErrorMessage(error).toLowerCase();
  return (
    message.includes('failed to load chunk') ||
    message.includes('chunkloaderror') ||
    message.includes('/_next/static/chunks/')
  );
}

type LeadDialogErrorBoundaryProps = {
  leadId?: string | null;
  onClose: () => void;
  children: ReactNode;
};

type LeadDialogErrorBoundaryState = {
  error: Error | null;
  leadId?: string | null;
};

export class LeadDialogErrorBoundary extends Component<
  LeadDialogErrorBoundaryProps,
  LeadDialogErrorBoundaryState
> {
  state: LeadDialogErrorBoundaryState = {
    error: null,
    leadId: this.props.leadId,
  };

  static getDerivedStateFromError(
    error: Error,
  ): Partial<LeadDialogErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: LeadDialogErrorBoundaryProps,
    state: LeadDialogErrorBoundaryState,
  ): Partial<LeadDialogErrorBoundaryState> | null {
    if (props.leadId !== state.leadId) {
      return { error: null, leadId: props.leadId };
    }

    return null;
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[LeadDialogErrorBoundary] Erro ao abrir lead', error, errorInfo);
    if (!isChunkLoadError(error) || typeof window === 'undefined') return;

    const previousAttempt = Number(
      window.sessionStorage.getItem(LEAD_DIALOG_CHUNK_RELOAD_KEY) || 0,
    );
    if (
      !previousAttempt ||
      Date.now() - previousAttempt > LEAD_DIALOG_CHUNK_RELOAD_WINDOW_MS
    ) {
      window.sessionStorage.setItem(
        LEAD_DIALOG_CHUNK_RELOAD_KEY,
        String(Date.now()),
      );
      window.location.reload();
    }
  }

  render() {
    if (this.state.error) {
      const chunkError = isChunkLoadError(this.state.error);
      return (
        <Dialog open onOpenChange={() => this.props.onClose()}>
          <DialogContent className="app-card w-[calc(100vw-32px)] max-w-md rounded-[8px] !bg-[var(--app-surface-solid)] p-5 text-[var(--app-text-primary)] !shadow-none sm:w-full">
            <DialogHeader className="space-y-1.5 text-left">
              <DialogTitle className="text-[14px] font-normal leading-5 text-foreground">
                {chunkError
                  ? 'Aplicativo atualizado'
                  : 'Não foi possível abrir o lead'}
              </DialogTitle>
              <DialogDescription className="text-[12px] font-light leading-[18px] text-muted-foreground">
                {chunkError
                  ? 'Recarregue a página para usar a versão mais recente.'
                  : 'Feche esta janela e tente abrir o lead novamente.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-[12px] font-light leading-[18px] text-muted-foreground">
              <p>
                {chunkError
                  ? 'Uma versão nova do Vimob foi publicada. Recarregue para continuar com os arquivos atualizados.'
                  : 'O lead não pôde ser carregado agora. Feche esta janela e tente novamente.'}
              </p>
              <Button
                onClick={
                  chunkError ? () => window.location.reload() : this.props.onClose
                }
                className="h-10 w-full rounded-[6px] border-0 bg-primary/50 px-3 text-[12px] font-light text-white shadow-none transition-colors hover:bg-primary focus-visible:ring-1 focus-visible:ring-primary/40"
              >
                {chunkError ? 'Recarregar' : 'Fechar'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      );
    }

    return this.props.children;
  }
}
