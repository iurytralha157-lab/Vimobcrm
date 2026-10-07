type MessageInputConversation = {
  id?: string | null;
  lead_id?: string | null;
  session_id?: string | null;
  contact_phone?: string | null;
  remote_jid?: string | null;
  is_group?: boolean | null;
	historical_lead_view?: boolean | null;
  lead?: {
    id?: string | null;
    assignee?: { id?: string | null } | null;
  } | null;
  session?: {
    id?: string | null;
    status?: string | null;
    provider?: string | null;
  } | null;
};

type MessageInputSession = {
  id: string;
  owner_user_id?: string;
  status?: string | null;
  provider?: string | null;
  can_send?: boolean;
};

export type WhatsAppMessageInputState = {
  disabled: boolean;
  placeholder: string;
  sendSessionId?: string;
};

type RefreshableConversation = MessageInputConversation & {
  unread_count?: number | null;
};

export type WhatsAppConversationMessageScope = {
	expectedLeadId: string | null;
	historyLeadId: string | null;
	canMutate: boolean;
	canManage: boolean;
};

// Explicit snapshot for a conversation that has not been linked to a card.
// The API accepts it only while the persisted lead_id is still NULL.
export const WHATSAPP_UNLINKED_LEAD_SNAPSHOT = 'unlinked';

export function getWhatsAppConversationDraftKey(params: {
  tenantKey?: string | null;
  conversationId?: string | null;
  expectedLeadId?: string | null;
}): string | null {
  const tenantKey = params.tenantKey?.trim();
  const conversationId = params.conversationId?.trim();
  const expectedLeadId = params.expectedLeadId?.trim();
  if (!tenantKey || !conversationId || !expectedLeadId) return null;

  // JSON encoding keeps every boundary explicit, so tenant/conversation/card
  // combinations cannot collide even when an identifier contains separators.
  return JSON.stringify([tenantKey, conversationId, expectedLeadId]);
}

export function updateWhatsAppConversationDraft(
  drafts: Record<string, string>,
  draftKey: string,
  value: string | ((current: string) => string),
): Record<string, string> {
  const currentValue = drafts[draftKey] ?? '';
  const nextValue = typeof value === 'function' ? value(currentValue) : value;
  if (nextValue === currentValue) return drafts;
  if (!nextValue) {
    const { [draftKey]: _removed, ...remainingDrafts } = drafts;
    void _removed;
    return remainingDrafts;
  }
  return { ...drafts, [draftKey]: nextValue };
}

export function getWhatsAppConversationMessageScope(
	conversation?: MessageInputConversation | null,
): WhatsAppConversationMessageScope {
	const linkedLeadId = conversation?.lead_id || conversation?.lead?.id || null;
	const expectedLeadId = conversation
		? linkedLeadId || WHATSAPP_UNLINKED_LEAD_SNAPSHOT
		: null;
	const historicalLeadView = Boolean(conversation?.historical_lead_view);
	return {
		expectedLeadId,
		historyLeadId: historicalLeadView ? linkedLeadId : null,
		canMutate: Boolean(linkedLeadId) && !historicalLeadView,
		canManage: Boolean(expectedLeadId) && !historicalLeadView,
	};
}

// A list/realtime refresh may expose the same physical conversation after its
// active binding moved from card A to card B. Keep the browser's card-A
// snapshot as an immutable history projection instead of silently replacing
// the open tab with card B.
export function preserveWhatsAppConversationCardSnapshot<
  T extends RefreshableConversation,
>(snapshot: T, refreshed: T): T & RefreshableConversation {
  if (snapshot.historical_lead_view) return snapshot;

  const snapshotLeadId = snapshot.lead_id || snapshot.lead?.id || null;
  const refreshedLeadId = refreshed.lead_id || refreshed.lead?.id || null;
  if (snapshotLeadId !== refreshedLeadId) {
    return {
      ...snapshot,
      historical_lead_view: true,
      unread_count: 0,
    };
  }

  return refreshed;
}

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

function canSendFromSession(session: MessageInputSession | null, currentUserId?: string | null) {
  return isUsableWhatsAppSessionStatus(session?.status) && (session?.can_send === true || Boolean(
    session?.can_send == null && currentUserId && session?.owner_user_id === currentUserId
  ));
}

function canStartFromSession(session: MessageInputSession | null, currentUserId?: string | null) {
  return canSendFromSession(session, currentUserId) && session?.owner_user_id === currentUserId;
}

function canSendExistingConversation(
  conversation: MessageInputConversation,
  session: MessageInputSession | null,
  currentUserId?: string | null,
) {
  if (!session || !canSendFromSession(session, currentUserId)) return false;
  if (session.owner_user_id === currentUserId) return true;
  // A delegated send grant applies only to the recipient's assigned lead.
  // Missing assignee data fails closed; the API validates this again on POST.
  return Boolean(currentUserId && conversation.lead?.assignee?.id === currentUserId);
}

function getConnectedSessions(sessions?: MessageInputSession[] | null, currentUserId?: string | null) {
  return (sessions || []).filter((session) =>
    canStartFromSession(session, currentUserId) &&
    isUsableWhatsAppSessionStatus(session.status) &&
    session.provider !== "evolution"
  );
}

export function getWhatsAppSendSessionId(
  conversation?: MessageInputConversation | null,
  selectedSessionId?: string | null,
  sessions?: MessageInputSession[] | null,
  currentUserId?: string | null,
) {
  if (conversation?.id) {
    // A physical conversation belongs to exactly one WhatsApp. Its nested
    // session status is history, not proof that this user may send on it.
    const session = findSessionById(sessions, conversation.session_id);
    if (!session || !canSendExistingConversation(conversation, session, currentUserId) || session.provider === "evolution") return undefined;
    if (selectedSessionId && selectedSessionId !== "all" && selectedSessionId !== session.id) {
      return undefined;
    }
    return session.id;
  }

  if (selectedSessionId && selectedSessionId !== "all") {
    const session = findSessionById(sessions, selectedSessionId);
    return canStartFromSession(session, currentUserId) && session?.provider !== "evolution" ? session!.id : undefined;
  }

  const conversationSession = findSessionById(sessions, conversation?.session_id);
  if (canStartFromSession(conversationSession, currentUserId) && isUsableWhatsAppSessionStatus(conversationSession?.status)) {
    return conversationSession!.id;
  }

  const connectedSessions = getConnectedSessions(sessions, currentUserId);
  if (connectedSessions.length === 1) {
    return connectedSessions[0].id;
  }
  if (connectedSessions.length > 1) {
    return undefined;
  }

  return undefined;
}

export function getWhatsAppMessageInputState(
  conversation?: MessageInputConversation | null,
  selectedSessionId?: string | null,
  sessions?: MessageInputSession[] | null,
  currentUserId?: string | null,
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

  if (conversation.historical_lead_view) {
    return {
      disabled: true,
      placeholder: "Histórico deste card (somente leitura)",
    };
  }

  if (conversation.id && conversation.session_id && !findSessionById(sessions, conversation.session_id)) {
    return {
      disabled: true,
      placeholder: sessions == null
        ? "Verificando acesso a este WhatsApp..."
        : "Sem acesso a este WhatsApp. Inicie pelo seu número.",
    };
  }

  if (conversation.id && conversation.session_id) {
    const session = findSessionById(sessions, conversation.session_id);
    if (!session || !canSendFromSession(session, currentUserId)) {
      return {
        disabled: true,
        placeholder: session && !isUsableWhatsAppSessionStatus(session.status)
          ? "WhatsApp desconectado. Reconecte ou selecione outra conversa."
          : "Sem permissão para enviar por este WhatsApp. Inicie pelo seu número.",
      };
    }
    if (!canSendExistingConversation(conversation, session, currentUserId)) {
      return {
        disabled: true,
        placeholder: "Este lead não está sob sua responsabilidade. Inicie pelo seu número.",
      };
    }
    if (selectedSessionId && selectedSessionId !== "all" && selectedSessionId !== session.id) {
      return {
        disabled: true,
        placeholder: "Esta conversa usa outro WhatsApp. Abra a conversa do número selecionado.",
      };
    }
  }

  const sendSessionId = getWhatsAppSendSessionId(conversation, selectedSessionId, sessions, currentUserId);
  if (!sendSessionId) {
    const connectedSessions = getConnectedSessions(sessions, currentUserId);
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
