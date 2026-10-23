'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

type LoadOlderMessagesButtonProps = {
  onClick: () => void;
  loading: boolean;
  error?: boolean;
};

export function LoadOlderMessagesButton({ onClick, loading, error = false }: LoadOlderMessagesButtonProps) {
  return (
    <Button
      type="button"
      data-load-older-messages
      variant="default"
      size="sm"
      className="h-8 rounded-[6px] border-0 bg-primary/50 px-3 text-[11px] font-light text-primary-foreground shadow-none hover:bg-primary/70 hover:text-primary-foreground [&_svg]:size-3"
      style={{ fontWeight: 'var(--app-font-weight-body)' }}
      onClick={onClick}
      disabled={loading}
      aria-busy={loading}
    >
      {loading && <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      {error ? 'Tentar carregar mensagens anteriores' : 'Carregar mensagens anteriores'}
    </Button>
  );
}
