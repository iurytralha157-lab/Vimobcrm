"use client";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { WhatsAppSession } from "@/hooks/use-whatsapp-sessions";

function sessionLabel(session: WhatsAppSession) {
  return session.display_name || session.phone_number || "número conectado";
}

export function WhatsAppSendOriginChoice({
  open,
  entrySession,
  ownSessions,
  isStarting,
  onContinue,
  onStart,
  onCancel,
}: {
  open: boolean;
  entrySession: WhatsAppSession;
  ownSessions: WhatsAppSession[];
  isStarting: boolean;
  onContinue: () => void;
  onStart: (sessionId: string) => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 shadow-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Qual WhatsApp deseja usar?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta conversa chegou pelo WhatsApp {sessionLabel(entrySession)}. Escolha o número para o primeiro envio.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <Button type="button" variant="outline" disabled={isStarting} onClick={onContinue}>
            Continuar pelo WhatsApp de entrada
          </Button>
          {ownSessions.map((session) => (
            <Button key={session.id} type="button" variant="outline" disabled={isStarting} onClick={() => onStart(session.id)}>
              Iniciar pelo meu WhatsApp {sessionLabel(session)}
            </Button>
          ))}
          <Button type="button" variant="ghost" disabled={isStarting} onClick={onCancel}>
            Agora não
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
