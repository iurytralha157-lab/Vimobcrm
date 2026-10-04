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
  accessLost?: boolean;
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

export type WhatsAppTextSendIntent = {
  draftKey: string;
  rawText: string;
  text: string;
  revision: number;
};

// A reservation lasts only through the attendance check. Once a send has
// started, a new draft may be sent while the previous request is still open.
// Keeping the current value here also closes the double-click gap before
// React has rendered the cleared draft.
export function createWhatsAppTextSendGuard() {
  let current = { draftKey: null as string | null, text: '', revision: 0 };
  let joining: WhatsAppTextSendIntent | null = null;
  let awaitingClear: Pick<WhatsAppTextSendIntent, 'draftKey' | 'rawText'> | null = null;

  return {
    observeDraft(draftKey: string | null, text: string) {
      if (awaitingClear?.draftKey === draftKey) {
        if (text === awaitingClear.rawText) return;
        awaitingClear = null;
      }
      if (current.draftKey === draftKey && current.text === text) return;
      current = { draftKey, text, revision: current.revision + 1 };
    },
    editDraft(draftKey: string | null, text: string) {
      // A user edit is authoritative even if it exactly matches a just-sent
      // text. Only observeDraft suppresses a late React render of the old text.
      awaitingClear = null;
      if (current.draftKey === draftKey && current.text === text) return;
      current = { draftKey, text, revision: current.revision + 1 };
    },
    begin(): WhatsAppTextSendIntent | null {
      if (joining || !current.draftKey || !current.text.trim()) return null;
      joining = {
        draftKey: current.draftKey,
        rawText: current.text,
        text: current.text.trim(),
        revision: current.revision,
      };
      return joining;
    },
    accepted(intent: WhatsAppTextSendIntent) {
      if (joining !== intent) return false;
      joining = null;
      // A confirmation for a tab/tenant that is no longer open cannot send
      // from that old conversation after navigation.
      if (current.draftKey !== intent.draftKey) return false;
      if (current.draftKey === intent.draftKey && current.revision === intent.revision) {
        current = { ...current, text: '', revision: current.revision + 1 };
        awaitingClear = { draftKey: intent.draftKey, rawText: intent.rawText };
      }
      return true;
    },
    aborted(intent: WhatsAppTextSendIntent) {
      if (joining === intent) joining = null;
    },
    allowRetry(intent: WhatsAppTextSendIntent) {
      if (awaitingClear?.draftKey === intent.draftKey && awaitingClear.rawText === intent.rawText) {
        awaitingClear = null;
      }
    },
    canRestore(intent: WhatsAppTextSendIntent) {
      return current.draftKey === intent.draftKey
        && current.text === ''
        && current.revision === intent.revision + 1;
    },
  };
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

  // A persisted conversation belongs to its original WhatsApp account. Once
  // that account disappears from the authorized list, never send through a
  // different account without explicitly starting a new conversation.
  if (conversation?.id && conversation.session_id) {
    return findSessionById(sessions, conversation.session_id)?.id;
  }

  if (selectedSessionId && selectedSessionId !== "all") {
    return findSessionById(sessions, selectedSessionId)?.id;
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

  if (conversation.historical_lead_view) {
		return {
			disabled: true,
			placeholder: "Histórico deste card (somente leitura)",
		};
	}

  if (conversation.id && conversation.session_id && sessions
    && !findSessionById(sessions, conversation.session_id)) {
    return {
      disabled: true,
      placeholder: "Você não tem mais acesso a este WhatsApp. Inicie uma nova conversa pelo seu número.",
      accessLost: true,
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
