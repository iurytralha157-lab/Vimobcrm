"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { whatsappCallsAPI } from "@/lib/api/whatsapp-calls";

type Recording = Awaited<ReturnType<typeof whatsappCallsAPI.recordingURLs>>;

type Props = {
  callId: string | null;
  onOpenChange: (open: boolean) => void;
};

export function WhatsAppRecordingDialog({ callId, onOpenChange }: Props) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId;
  const [recording, setRecording] = useState<Recording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!callId || !organizationId) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setRecording(null);
        setError(null);
        setLoading(true);
      }
    });
    void whatsappCallsAPI.recordingURLs(callId, organizationId)
      .then((result) => {
        if (!cancelled) setRecording(result);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Gravação indisponível");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      setRecording(null);
    };
  }, [callId, organizationId, refreshKey]);

  return (
    <Dialog open={Boolean(callId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Gravação da ligação</DialogTitle>
          <DialogDescription>
            Os dois sentidos do áudio são armazenados separadamente. Cada faixa pode começar em um instante diferente.
          </DialogDescription>
        </DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">Carregando gravação...</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {callId && <Button type="button" variant="outline" size="sm" disabled={loading}
          onClick={() => setRefreshKey((current) => current + 1)}>Atualizar acesso à gravação</Button>}
        {recording && (
          <div className="space-y-4">
            {recording.incoming_url && (
              <div className="space-y-1">
                <p className="text-xs font-medium">Áudio do contato</p>
                <audio key={recording.incoming_url} controls preload="metadata" src={recording.incoming_url}
                  onError={() => setError("Falha ao reproduzir. Atualize o acesso à gravação e tente novamente.")}
                  className="w-full" />
              </div>
            )}
            {recording.outgoing_url && (
              <div className="space-y-1">
                <p className="text-xs font-medium">Áudio da equipe</p>
                <audio key={recording.outgoing_url} controls preload="metadata" src={recording.outgoing_url}
                  onError={() => setError("Falha ao reproduzir. Atualize o acesso à gravação e tente novamente.")}
                  className="w-full" />
              </div>
            )}
            {!recording.incoming_url && !recording.outgoing_url && (
              <p className="text-sm text-muted-foreground">Nenhuma faixa disponível para esta ligação.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
