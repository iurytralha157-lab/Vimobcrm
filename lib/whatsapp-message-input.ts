type MessageInputConversation = {
  session_id?: string | null;
  contact_phone?: string | null;
  remote_jid?: string | null;
  is_group?: boolean | null;
  session?: {
    id?: string | null;
    status?: string | null;
    provider?: string | null;
  } | null;
};

type MessageInputSession = {
  id: string;
  status?: string | null;
  provider?: string | null;
};

export type WhatsAppMessageInputState = {
  disabled: boolean;
  placeholder: string;
  sendSessionId?: string;
};

export function isUsableWhatsAppSessionStatus(status?: string | null) {
  return status === "connected";
}

function findSessionById(
  sessions: MessageInputSession[] | null | undefined,
  sessionId: string | null | undefined,
) {
  if (!sessionId) return null;
  return sessions?.find((session) => session.id === sessionId) || null;
}

function getConnectedSessions(sessions?: MessageInputSession[] | null) {
  return (sessions || []).filter((session) =>
    isUsableWhatsAppSessionStatus(session.status) &&
    session.provider !== "evolution"
  );
}

function getConversationSession(
  conversation?: MessageInputConversation | null,
  sessions?: MessageInputSession[] | null,
): MessageInputSession | null {
  if (!conversation?.session_id) return null;
  if (conversation.session?.id === conversation.session_id) {
    return {
      id: conversation.session_id,
      status: conversation.session.status,
      provider: conversation.session.provider,
    };
  }

  return findSessionById(sessions, conversation.session_id) || {
    id: conversation.session_id,
    status: null,
  };
}

export function getWhatsAppSendSessionId(
  conversation?: MessageInputConversation | null,
  selectedSessionId?: string | null,
  sessions?: MessageInputSession[] | null,
) {
  if (selectedSessionId && selectedSessionId !== "all") {
    return selectedSessionId;
  }

  const conversationSession = getConversationSession(conversation, sessions);
  if (conversationSession?.id && isUsableWhatsAppSessionStatus(conversationSession.status)) {
    return conversationSession.id;
  }

  const connectedSessions = getConnectedSessions(sessions);
  if (connectedSessions.length === 1) {
    return connectedSessions[0].id;
  }

  if (conversationSession?.id && conversationSession.status == null) {
    return conversationSession.id;
  }

  return undefined;
}

export function getWhatsAppMessageInputState(
  conversation?: MessageInputConversation | null,
  selectedSessionId?: string | null,
  sessions?: MessageInputSession[] | null,
): WhatsAppMessageInputState {
  if (!conversation) {
    return {
      disabled: true,
      placeholder: "Selecione uma conversa",
    };
  }

  const sendSessionId = getWhatsAppSendSessionId(conversation, selectedSessionId, sessions);
  if (!sendSessionId) {
    const connectedSessions = getConnectedSessions(sessions);
    return {
      disabled: true,
      placeholder: connectedSessions.length > 1
        ? "Selecione qual WhatsApp deseja usar para enviar"
        : "Conecte uma conta de WhatsApp para enviar",
    };
  }

  const selectedSession = selectedSessionId && selectedSessionId !== "all"
    ? findSessionById(sessions, selectedSessionId)
    : null;
  const linkedSession = selectedSession || findSessionById(sessions, sendSessionId) || (
    conversation.session?.id === sendSessionId ? conversation.session : null
  );
  if (linkedSession?.status && !isUsableWhatsAppSessionStatus(linkedSession.status)) {
    return {
      disabled: true,
      placeholder: selectedSession
        ? "A conexao selecionada esta desconectada"
        : "A conexao deste WhatsApp esta desconectada",
      sendSessionId,
    };
  }

  const hasDestination =
    Boolean(conversation.is_group) ||
    Boolean(conversation.remote_jid) ||
    Boolean(conversation.contact_phone?.replace(/\D/g, ""));

  if (!hasDestination) {
    return {
      disabled: true,
      placeholder: "Contato sem telefone cadastrado",
      sendSessionId,
    };
  }

  return {
    disabled: false,
    placeholder: "Digite sua mensagem...",
    sendSessionId,
  };
}
