"use client";

import { Button } from "@/components/ui/button";
import type { WhatsAppSession } from "@/hooks/use-whatsapp-sessions";

export function WhatsAppAccessLostNotice({
  ownConnectedSessions,
  isStarting,
  onStart,
  onConnect,
}: {
  ownConnectedSessions: WhatsAppSession[];
  isStarting: boolean;
  onStart: (sessionId: string) => void;
  onConnect: () => void;
}) {
  return (
    <div role="alert" className="space-y-2 border-t border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <p>Você não tem mais acesso ao WhatsApp desta conversa. O histórico continua disponível conforme seu acesso ao lead.</p>
      {ownConnectedSessions.length ? (
        <div className="flex flex-wrap gap-2">
          {ownConnectedSessions.map((session) => (
            <Button
              key={session.id}
              type="button"
              size="sm"
              variant="outline"
              disabled={isStarting}
              onClick={() => onStart(session.id)}
            >
              Iniciar nova conversa pelo meu WhatsApp {session.display_name || session.phone_number || ""}
            </Button>
          ))}
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={onConnect}>
          Conectar meu WhatsApp para iniciar uma conversa
        </Button>
      )}
    </div>
  );
}
