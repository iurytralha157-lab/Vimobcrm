type LeadHistoryConversation = {
  lead_id?: string | null;
  lead?: { id?: string | null } | null;
  session_id?: string | null;
  historical_lead_view?: boolean | null;
};

export function findInaccessibleLeadHistoryConversation<T extends LeadHistoryConversation>(input: {
  leadId: string;
  conversations: readonly T[];
  accessibleSessionIds: readonly string[];
  hasSelectedConversation: boolean;
  sessionsLoading: boolean;
}): T | null {
  if (input.hasSelectedConversation || input.sessionsLoading) return null;
  const accessible = new Set(input.accessibleSessionIds);
  const sameLead = (conversation: T) =>
    conversation.lead_id === input.leadId || conversation.lead?.id === input.leadId;

  // An active conversation can be absent from the bounded inbox page while
  // remaining visible in the lead's full history. Do not mistake an older,
  // inaccessible conversation for the current sending route.
  if (input.conversations.some((conversation) => sameLead(conversation)
    && !conversation.historical_lead_view
    && Boolean(conversation.session_id && accessible.has(conversation.session_id)))) {
    return null;
  }

  return input.conversations.find((conversation) => {
    const sessionId = conversation.session_id;
    return sameLead(conversation) && Boolean(sessionId && !accessible.has(sessionId));
  }) || null;
}
