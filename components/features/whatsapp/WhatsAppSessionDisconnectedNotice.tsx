import { Button } from "@/components/ui/button";
import type { WhatsAppSession } from "@/hooks/use-whatsapp-sessions";

type WhatsAppSessionDisconnectedNoticeProps = {
  hasUnconfirmedMessages: boolean;
  canStartWithOwnSession: boolean;
  ownConnectedSessions: WhatsAppSession[];
  isStarting: boolean;
  onStart: (sessionId: string) => void;
  onConnect: () => void;
};

export function WhatsAppSessionDisconnectedNotice({
  hasUnconfirmedMessages,
  canStartWithOwnSession,
  ownConnectedSessions,
  isStarting,
  onStart,
  onConnect,
}: WhatsAppSessionDisconnectedNoticeProps) {
  return (
    <div role="alert" className="space-y-2 border-t border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-100">
      <p className="font-semibold">WhatsApp sem conexão. O envio por este número está indisponível.</p>
      <p>
        {hasUnconfirmedMessages
          ? "Há mensagens nesta conversa sem confirmação de envio. Confira o estado antes de tentar novamente para evitar duplicidade."
          : "Seu rascunho foi mantido. Reconecte o número ou peça ao dono para reconectá-lo."}
      </p>
      {canStartWithOwnSession ? (
        ownConnectedSessions.length ? (
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
        )
      ) : null}
    </div>
  );
}
