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
