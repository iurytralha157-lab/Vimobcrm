"use client";

import { Clock, History } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { type Property, usePropertyHistory } from '@/hooks/use-properties';

interface PropertyHistoryDialogProps {
  property: Property | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatHistoryDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function metadataString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

export function PropertyHistoryDialog({
  property,
  open,
  onOpenChange,
}: PropertyHistoryDialogProps) {
  const { data: historyEvents = [], isLoading } = usePropertyHistory(open ? property?.id ?? null : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[78vh] max-h-[78vh] w-[min(720px,calc(100vw-2rem))] max-w-[720px] flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base font-medium">
            <History className="h-4 w-4 text-primary" />
            Historico do imovel
          </DialogTitle>
          {property && (
            <p className="truncate text-xs font-normal text-muted-foreground">
              {[property.code, property.title || property.tipo_de_imovel].filter(Boolean).join(' - ')}
            </p>
          )}
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 px-5 py-4">
          {isLoading ? (
            <div className="space-y-2.5">
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
            </div>
          ) : historyEvents.length > 0 ? (
            <div className="space-y-2.5">
              {historyEvents.map((event) => {
                const message = metadataString(event.metadata?.message);
                const userName = metadataString(event.metadata?.user_name);
                const title = event.title || message || 'Atualizacao do imovel';

                return (
                  <article key={event.id} className="rounded-lg bg-[var(--app-surface-soft)] px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[13px] font-normal leading-snug text-foreground">{title}</p>
                      <span className="flex shrink-0 items-center gap-1 text-[11px] font-normal text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatHistoryDate(event.created_at)}
                      </span>
                    </div>
                    {message && message !== title && (
                      <p className="mt-1 text-xs font-normal leading-relaxed text-muted-foreground">{message}</p>
                    )}
                    {userName && (
                      <p className="mt-1 text-[11px] font-normal text-muted-foreground">Por {userName}</p>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg bg-[var(--app-surface-soft)] p-4 text-center text-sm font-normal text-muted-foreground">
              Nenhum historico registrado ainda.
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
