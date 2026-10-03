type WhatsAppSessionDisconnectedNoticeProps = {
  hasUnconfirmedMessages: boolean;
};

export function WhatsAppSessionDisconnectedNotice({
  hasUnconfirmedMessages,
}: WhatsAppSessionDisconnectedNoticeProps) {
  return (
    <div role="alert" className="border-t border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-100">
      <p className="font-semibold">WhatsApp sem conexão. O envio por este número está indisponível.</p>
      <p className="mt-1">
        {hasUnconfirmedMessages
          ? "Há mensagens nesta conversa sem confirmação de envio. Confira o estado antes de tentar novamente para evitar duplicidade."
          : "Você pode manter o rascunho e enviar quando o número voltar a conectar."}
        {" "}Reconecte o número ou peça ao dono para reconectá-lo.
      </p>
    </div>
  );
}
