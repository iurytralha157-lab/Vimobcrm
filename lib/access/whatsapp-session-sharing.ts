type SessionSharingActor = {
  ownerUserId: string;
  currentUserId: string | null | undefined;
  memberRole?: string | null;
  isSuperAdmin?: boolean;
  isTeamLeader?: boolean;
};

export function isWhatsAppOrganizationManager(input: {
  memberRole?: string | null;
}) {
  return ["admin", "owner", "manager"].includes(input.memberRole?.trim().toLowerCase() || "");
}

export function canShareOwnWhatsAppSession(actor: SessionSharingActor) {
  if (!actor.currentUserId || actor.ownerUserId !== actor.currentUserId) return false;
  return isWhatsAppOrganizationManager(actor) || actor.isTeamLeader === true;
}

export function eligibleWhatsAppAccessRecipients<T extends { id: string; is_active: boolean }>(
  users: readonly T[],
  input: {
    currentUserId: string;
    memberRole?: string | null;
    isSuperAdmin?: boolean;
    isTeamLeader?: boolean;
    ledUserIds?: readonly string[] | null;
  },
): T[] {
  const canGrantOrganizationWide = isWhatsAppOrganizationManager(input);
  if (!canGrantOrganizationWide && !input.isTeamLeader) return [];
  const ledUserIds = new Set(input.ledUserIds || []);
  return users.filter((user) => user.is_active
    && user.id !== input.currentUserId
    && (canGrantOrganizationWide || ledUserIds.has(user.id)));
}

export function getOwnConnectedWhatsAppSessions<T extends {
  organization_id: string;
  owner_user_id: string;
  status: string;
  provider?: string;
}>(
  sessions: readonly T[] | null | undefined,
  currentUserId: string | null | undefined,
  organizationId: string | null | undefined,
): T[] {
  if (!currentUserId || !organizationId) return [];
  return (sessions || []).filter((session) => session.organization_id === organizationId
    && session.owner_user_id === currentUserId
    && session.status === "connected"
    && session.provider === "evolution_go");
}

export function isExactExistingLeadConversation<T extends {
  session_id: string | null;
  lead_id: string | null;
  contact_phone: string | null;
  remote_jid: string | null;
  historical_lead_view?: boolean;
  is_group: boolean;
  session?: { organization_id: string; provider?: string | null };
}>(conversation: T | null, input: {
  organizationId: string;
  sessionId: string;
  leadId: string;
  phone: string;
}): conversation is T {
  return Boolean(conversation
    && conversation.session?.organization_id === input.organizationId
    && conversation.session?.provider === "evolution_go"
    && conversation.session_id === input.sessionId
    && conversation.lead_id === input.leadId
    && !conversation.historical_lead_view
    && !conversation.is_group
    && normalizeWhatsAppContactPhoneToE164(conversation.contact_phone, conversation.remote_jid) === input.phone);
}
import { normalizeWhatsAppContactPhoneToE164 } from "@/lib/phone-utils";
