import { normalizePhoneToE164 } from '@/lib/phone-utils';

type ReplacementConversation = {
  id?: string | null;
  lead_id?: string | null;
  lead?: { id?: string | null } | null;
  session_id?: string | null;
  session?: { id?: string | null; status?: string | null } | null;
  contact_phone?: string | null;
  remote_jid?: string | null;
  historical_lead_view?: boolean | null;
  is_group?: boolean | null;
};

type OwnedSession = {
  id: string;
  status?: string | null;
  provider?: string | null;
};

export type WhatsAppReplacementPlan = {
  reason: 'historical' | 'unavailable-session';
  leadId: string;
  phone: string | null;
  sourceConversationId: string;
  sourceSessionId: string | null;
  connectedSessionIds: string[];
};

export type WhatsAppReplacementCandidateDecision =
  | { action: 'start' }
  | { action: 'open'; conversationId: string }
  | { action: 'blocked'; reason: 'source-conversation' | 'identity-mismatch' | 'another-lead' };

function conversationPhone(conversation: ReplacementConversation): string | null {
  const contactPhone = normalizePhoneToE164(conversation.contact_phone);
  // Historical summaries contain the lead's current phone, while their JID
  // can belong to an older number used before the lead updated its contact.
  if (conversation.historical_lead_view && contactPhone) return contactPhone;
  // A phone JID can recover an absent contact_phone. LID and group JIDs must
  // never be converted to a guessed destination.
  const phoneJid = conversation.remote_jid?.match(/^(\d+)@s\.whatsapp\.net$/i);
  const jidPhone = phoneJid ? normalizePhoneToE164(phoneJid[1]) : null;
  if (contactPhone && jidPhone && contactPhone !== jidPhone) return null;
  return contactPhone || jidPhone;
}

export function getWhatsAppReplacementPlan(
  conversation?: ReplacementConversation | null,
  ownedSessions?: OwnedSession[] | null,
): WhatsAppReplacementPlan | null {
  const leadId = conversation?.lead_id || conversation?.lead?.id;
  if (!conversation?.id || !leadId || conversation.is_group) return null;

  const sourceSessionId = conversation.session_id || null;
  const listedSource = ownedSessions?.find((session) => session.id === sourceSessionId);
  const sourceStatus = listedSource?.status
    ?? (conversation.session?.id === sourceSessionId ? conversation.session.status : null);
  const unavailableSession = Boolean(sourceSessionId && sourceStatus && sourceStatus !== 'connected');
  const reason = conversation.historical_lead_view
    ? 'historical'
    : unavailableSession
      ? 'unavailable-session'
      : null;
  if (!reason) return null;

  return {
    reason,
    leadId,
    phone: conversationPhone(conversation),
    sourceConversationId: conversation.id,
    sourceSessionId,
    connectedSessionIds: (ownedSessions || [])
      .filter((session) => (
        session.status === 'connected'
        && session.provider === 'evolution_go'
        && session.id !== sourceSessionId
      ))
      .map((session) => session.id),
  };
}

export function getWhatsAppReplacementCandidateDecision(
  candidate: ReplacementConversation | null,
  request: Pick<WhatsAppReplacementPlan, 'leadId' | 'phone' | 'sourceConversationId'> & { sessionId: string },
): WhatsAppReplacementCandidateDecision {
  if (!candidate) return { action: 'start' };
  if (candidate.id === request.sourceConversationId) {
    return { action: 'blocked', reason: 'source-conversation' };
  }
  if (candidate.session_id !== request.sessionId || conversationPhone(candidate) !== request.phone) {
    return { action: 'blocked', reason: 'identity-mismatch' };
  }
  const candidateLeadId = candidate.lead_id || candidate.lead?.id;
  if (candidateLeadId && candidateLeadId !== request.leadId) {
    return { action: 'blocked', reason: 'another-lead' };
  }
  return candidateLeadId === request.leadId && candidate.id
    ? { action: 'open', conversationId: candidate.id }
    : { action: 'start' };
}
