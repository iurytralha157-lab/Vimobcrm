"use client";

import { Phone, PhoneOff, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WhatsAppCall } from "@/lib/validation/whatsapp-calls";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactName: string;
  call: WhatsAppCall | null;
  lastCall: WhatsAppCall | null;
  busy: boolean;
  audioStatus: "disconnected" | "connecting" | "connected";
  audioError: string | null;
  canControlCall: boolean;
  onStart: () => void;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onDismissUnknown: () => void;
  onReconnectAudio: () => void;
  onPlayRecording: (callId: string) => void;
};

const stateLabels: Record<WhatsAppCall["state"], string> = {
  incoming: "Ligação recebida",
  outgoing: "Iniciando ligação",
  ringing: "Chamando",
  active: "Em ligação",
  end_pending: "Encerramento solicitado",
  reject_pending: "Recusa solicitada",
  outcome_unknown: "Resultado incerto. Confira no WhatsApp.",
  rejected: "Ligação recusada",
  ended: "Ligação encerrada",
  failed: "Falha na ligação",
};

export function WhatsAppCallDialog({
  open,
  onOpenChange,
  contactName,
  call,
  lastCall,
  busy,
  audioStatus,
  audioError,
  canControlCall,
  onStart,
  onAccept,
  onReject,
  onEnd,
  onDismissUnknown,
  onReconnectAudio,
  onPlayRecording,
}: Props) {
  const displayCall = call || lastCall;
  const incoming = call?.direction === "incoming" && (call.state === "incoming" || call.state === "ringing");
  const ongoing = call && ["outgoing", "ringing", "active"].includes(call.state) && !incoming;
  const hasRecording = lastCall?.recording_status === "ready" || lastCall?.recording_status === "partial";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-4 w-4" /> Ligação pelo WhatsApp
          </DialogTitle>
          <DialogDescription>{contactName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-3 text-center">
          <p className="text-sm font-medium">{displayCall ? stateLabels[displayCall.state] : "Pronto para ligar"}</p>
          {call?.state === "active" && (
            <p className="text-xs text-muted-foreground">
              Áudio {audioStatus === "connected" ? "conectado" : audioStatus === "connecting" ? "conectando" : "desconectado"}
            </p>
          )}
          {audioError && <p role="alert" className="text-xs text-destructive">{audioError}</p>}
          {call?.state === "active" && canControlCall && audioStatus === "disconnected" && (
            <Button variant="outline" onClick={onReconnectAudio} disabled={busy}>Reconectar áudio</Button>
          )}
          {hasRecording && (
            <Button variant="outline" onClick={() => onPlayRecording(lastCall.id)}>
              <Volume2 className="mr-2 h-4 w-4" /> Ouvir gravação
            </Button>
          )}
        </div>
        <DialogFooter className="gap-2">
          {!call && (
            <Button onClick={onStart} disabled={busy}>
              <Phone className="mr-2 h-4 w-4" /> Ligar
            </Button>
          )}
          {incoming && (
            <>
              <Button variant="destructive" onClick={onReject} disabled={busy}>
                <PhoneOff className="mr-2 h-4 w-4" /> Recusar
              </Button>
              <Button onClick={onAccept} disabled={busy}>
                <Phone className="mr-2 h-4 w-4" /> Atender
              </Button>
            </>
          )}
          {ongoing && canControlCall && (
            <Button variant="destructive" onClick={onEnd} disabled={busy}>
              <PhoneOff className="mr-2 h-4 w-4" /> Encerrar
            </Button>
          )}
          {call?.state === "outcome_unknown" && (
            <Button variant="outline" onClick={onDismissUnknown} disabled={busy}>Dispensar painel</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
