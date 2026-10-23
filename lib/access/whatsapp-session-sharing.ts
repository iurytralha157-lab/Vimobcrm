type SessionSharingActor = {
  ownerUserId: string;
  currentUserId: string | null | undefined;
  memberRole?: string | null;
  isSuperAdmin?: boolean;
  isTeamLeader?: boolean;
};

export function isWhatsAppOrganizationAdmin(input: {
  memberRole?: string | null;
}) {
  return ["admin", "owner"].includes(input.memberRole?.trim().toLowerCase() || "");
}

export function canShareOwnWhatsAppSession(actor: SessionSharingActor) {
  if (!actor.currentUserId || actor.ownerUserId !== actor.currentUserId) return false;
  return isWhatsAppOrganizationAdmin(actor);
}

export function eligibleWhatsAppAccessRecipients<T extends { id: string; is_active: boolean; home_organization_id?: string | null }>(
  users: readonly T[],
  input: {
    currentUserId: string;
    organizationId: string | null | undefined;
    memberRole?: string | null;
    isSuperAdmin?: boolean;
    isTeamLeader?: boolean;
    ledUserIds?: readonly string[] | null;
  },
): T[] {
  if (!isWhatsAppOrganizationAdmin(input) || !input.organizationId) return [];
  return users.filter((user) => user.is_active
    && user.home_organization_id === input.organizationId
    && user.id !== input.currentUserId);
}
