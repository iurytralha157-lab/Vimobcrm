import { getWhatsAppMessageInputState } from "@/lib/whatsapp-message-input";

type Conversation = Parameters<typeof getWhatsAppMessageInputState>[0];
type Session = NonNullable<Parameters<typeof getWhatsAppMessageInputState>[2]>[number];

export type OwnWhatsAppStartNoticeState = {
  kind: "start" | "connect";
  ownConnectedSessionIds: string[];
  /** Keep the authorized original route available while offering an owned route. */
  preserveComposer?: boolean;
  resumeCapture?: boolean;
};

export function getOwnWhatsAppStartNotice({
  conversation,
  sessions,
  currentUserId,
  canOperate,
  loadingSessions = false,
  attendanceMissing = false,
}: {
  conversation: Conversation;
  sessions: Session[] | null | undefined;
  currentUserId: string | null | undefined;
  canOperate: boolean;
  loadingSessions?: boolean;
  attendanceMissing?: boolean;
}): OwnWhatsAppStartNoticeState | null {
  if (!canOperate || !currentUserId || loadingSessions || !sessions || !conversation) return null;
  if (conversation.supervisory_lead_view) return null;
  if (conversation.is_group || (!conversation.lead_id && !conversation.lead?.id)) return null;

  const ownConnectedSessionIds = sessions.filter((session) =>
    session.owner_user_id === currentUserId &&
    session.status === "connected" &&
    session.can_send !== false &&
    session.provider !== "evolution"
  ).map((session) => session.id);

  const currentRouteAvailable = !getWhatsAppMessageInputState(conversation, null, sessions, currentUserId).disabled;
  if (currentRouteAvailable) {
    if (!conversation.id) return null;
    const currentSession = sessions.find(session => session.id === conversation.session_id);
    if (attendanceMissing && conversation.lead?.assignee?.id === currentUserId
      && currentSession?.provider === "evolution_go" && ownConnectedSessionIds.includes(currentSession.id)) {
      return { kind: "start", ownConnectedSessionIds: [currentSession.id], preserveComposer: true, resumeCapture: true };
    }
    // Choosing an owned route creates/reuses a different physical conversation;
    // it never changes the session used by the original composer.
    return currentSession?.owner_user_id !== currentUserId && ownConnectedSessionIds.length > 0
      ? { kind: "start", ownConnectedSessionIds, preserveComposer: true }
      : null;
  }

  if (ownConnectedSessionIds.length === 0) {
    return { kind: "connect", ownConnectedSessionIds };
  }

  // A new lead already has the composer's own-account preparation flow.
  // Only a captured conversation needs a separate account-start action.
  if (!conversation.id) return null;
  return { kind: "start", ownConnectedSessionIds };
}
