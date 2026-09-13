import { MessageCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

type ConversationEmptyStateProps = {
  sessionsDisconnected: boolean;
  canManageWhatsApp: boolean;
  onConnectWhatsApp: () => void;
  onRequestConnectionHelp: () => void;
};

export function ConversationEmptyState({
  sessionsDisconnected,
  canManageWhatsApp,
  onConnectWhatsApp,
  onRequestConnectionHelp,
}: ConversationEmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-[var(--app-surface-soft)] p-6 text-center text-muted-foreground">
      <MessageCircle className="mb-4 h-24 w-24 opacity-30" />
      {sessionsDisconnected ? (
        <>
          <p className="mb-2 text-[14px] font-normal text-foreground">WhatsApp ainda não conectado</p>
          <p className="mb-4 max-w-sm text-[12px] font-light">
            Para começar a receber e enviar mensagens, conecte sua conta do WhatsApp escaneando o QR Code.
          </p>
          <ol className="text-xs text-left max-w-sm mb-6 space-y-1.5 list-decimal list-inside text-muted-foreground">
            <li>Clique no botão abaixo para abrir as configurações.</li>
            <li>Crie uma nova sessão e escaneie o QR Code com seu celular.</li>
            <li>Aguarde alguns segundos até o status ficar como &quot;Conectado&quot;.</li>
          </ol>
          {canManageWhatsApp && (
            <Button onClick={onConnectWhatsApp}>
              <Plus className="w-4 h-4 mr-2" />
              Conectar WhatsApp agora
            </Button>
          )}
          <button
            type="button"
            onClick={onRequestConnectionHelp}
            className="text-xs text-muted-foreground underline mt-3 hover:text-foreground"
          >
            Preciso de ajuda para conectar
          </button>
        </>
      ) : (
        <>
          <p className="font-medium">Selecione uma conversa</p>
          <p className="text-sm">para começar a enviar mensagens</p>
        </>
      )}
    </div>
  );
}
