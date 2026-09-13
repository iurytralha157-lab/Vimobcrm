type MessageInputConversation = {
  id?: string | null;
  lead_id?: string | null;
  session_id?: string | null;
  contact_phone?: string | null;
  remote_jid?: string | null;
  is_group?: boolean | null;
  lead?: {
    id?: string | null;
  } | null;
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

function getConfiguredSessions(sessions?: MessageInputSession[] | null) {
  return (sessions || []).filter((session) =>
    session.status !== "deleted" && session.provider !== "evolution"
  );
}

function getConversationSession(
  conversation?: MessageInputConversation | null,
  sessions?: MessageInputSession[] | null,
): MessageInputSession | null {
  if (!conversation?.session_id) return null;

  // The session list is the shared, actively refreshed source used by the
  // Integrations screen and every WhatsApp launcher. Conversation payloads can
  // carry an older nested status and must not override the current session.
  const currentSession = findSessionById(sessions, conversation.session_id);
  if (currentSession) return currentSession;

  if (conversation.session?.id === conversation.session_id) {
    return {
      id: conversation.session_id,
      status: conversation.session.status,
      provider: conversation.session.provider,
    };
  }

  return {
    id: conversation.session_id,
    status: null,
  };
}

export function getWhatsAppSendSessionId(
  conversation?: MessageInputConversation | null,
  selectedSessionId?: string | null,
  sessions?: MessageInputSession[] | null,
) {
  // A persisted conversation without a trusted session is historical-only.
  // Never redirect it through another connected account.
  if (conversation?.id && !conversation.session_id) {
    return undefined;
  }

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
  if (connectedSessions.length > 1) {
    return undefined;
  }

  // A configured session can have a stale offline status while Integrations
  // is reconciling it. Let the backend perform the definitive validation when
  // there is no ambiguity about which account should send.
  if (conversationSession?.id && findSessionById(sessions, conversationSession.id)) {
    return conversationSession.id;
  }

  // Preserve a persisted conversation's trusted account when that account is
  // absent from the refreshed list. The backend will validate authorization;
  // the client must not silently redirect history through another account.
  if (conversationSession?.id && conversationSession.status == null) {
    return conversationSession.id;
  }

  const configuredSessions = getConfiguredSessions(sessions);
  if (configuredSessions.length === 1) {
    return configuredSessions[0].id;
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

  if (!conversation.lead_id && !conversation.lead?.id) {
    return {
      disabled: true,
      placeholder: "Crie ou vincule um lead para responder",
    };
  }

  const sendSessionId = getWhatsAppSendSessionId(conversation, selectedSessionId, sessions);
  if (!sendSessionId) {
    const connectedSessions = getConnectedSessions(sessions);
    return {
      disabled: true,
      placeholder: connectedSessions.length > 1
        ? "Selecione qual WhatsApp deseja usar para enviar"
        : "Conecte um WhatsApp para enviar",
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
