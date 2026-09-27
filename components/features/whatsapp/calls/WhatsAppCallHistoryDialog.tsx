"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Phone, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { whatsappCallsAPI } from "@/lib/api/whatsapp-calls";
import type { WhatsAppCall } from "@/lib/validation/whatsapp-calls";

const PAGE_SIZE = 50;

const statusLabels: Record<WhatsAppCall["state"], string> = {
  incoming: "Tocando",
  outgoing: "Iniciando",
  ringing: "Chamando",
  active: "Em andamento",
  end_pending: "Encerrando",
  reject_pending: "Recusando",
  outcome_unknown: "Resultado em confirmação",
  rejected: "Recusada",
  ended: "Encerrada",
  failed: "Não concluída",
};

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Horário indisponível";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlayRecording: (callId: string) => void;
};

export function WhatsAppCallHistoryDialog({ open, onOpenChange, onPlayRecording }: Props) {
  const { activeOrganization, user } = useAuth();
  const organizationId = activeOrganization.organizationId;
  const query = useInfiniteQuery({
    queryKey: ["whatsapp-calls", "history", organizationId, user?.id],
    initialPageParam: null as { at: string; id: string } | null,
    queryFn: ({ pageParam }) => whatsappCallsAPI.listHistory(organizationId!, pageParam || undefined),
    getNextPageParam: (page) => page.length === PAGE_SIZE
      ? { at: page[page.length - 1].created_at, id: page[page.length - 1].id }
      : undefined,
    enabled: Boolean(open && organizationId && user?.id),
    staleTime: 10_000,
  });
  const calls = query.data?.pages.flat() ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Histórico de ligações pelo WhatsApp</DialogTitle>
          <DialogDescription>
            Chamadas das conexões sob sua responsabilidade, inclusive as que ainda não têm lead vinculado.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[55vh]">
          <div className="space-y-2 pr-3">
            {query.isPending && <p className="py-5 text-center text-sm text-muted-foreground">Carregando ligações...</p>}
            {query.isError && (
              <div role="alert" className="space-y-2 py-4 text-center">
                <p className="text-sm text-destructive">Não foi possível carregar o histórico.</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>Tentar novamente</Button>
              </div>
            )}
            {!query.isPending && !query.isError && calls.length === 0 && (
              <p className="py-5 text-center text-sm text-muted-foreground">Nenhuma ligação registrada.</p>
            )}
            {calls.map((call) => (
              <div key={call.id} className="rounded-[8px] border border-[var(--app-border)] p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-medium">
                      <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {call.direction === "incoming" ? "Recebida" : "Realizada"} · {statusLabels[call.state]}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{call.remote_jid.split("@")[0]}</p>
                    <p className="text-xs text-muted-foreground">{formatWhen(call.offered_at || call.created_at)}</p>
                    {!call.lead_id && <p className="text-xs text-muted-foreground">Sem lead vinculado</p>}
                  </div>
                  {["ready", "partial"].includes(call.recording_status) && (
                    <Button type="button" variant="outline" size="sm" onClick={() => {
                      onOpenChange(false);
                      onPlayRecording(call.id);
                    }}>
                      <Volume2 className="mr-1.5 h-3.5 w-3.5" /> Ouvir
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {query.hasNextPage && (
              <div className="flex justify-center py-2">
                <Button type="button" variant="outline" size="sm" disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}>
                  {query.isFetchingNextPage ? "Carregando..." : "Carregar mais"}
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
