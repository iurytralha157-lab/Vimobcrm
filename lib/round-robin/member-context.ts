export type QueueMemberDraft = {
  id?: string;
  type: "user" | "team";
  entityId: string;
  teamId?: string;
  weight: number;
  isActive?: boolean;
  reenroll?: boolean;
  name?: string;
};

export type QueueMemberSource = {
  id?: string;
  team_id?: string | null;
  user_id?: string | null;
  weight?: number | null;
  is_active?: boolean | null;
  user?: {
    name?: string | null;
  } | null;
};

export type QueueTeamSource = {
  id: string;
  name?: string | null;
  is_active?: boolean;
  members?: Array<{
    user_id: string;
  }>;
};

export type DirectUserTeamResolution =
  | { status: "resolved"; teamId?: string }
  | { status: "unavailable" };

export function queueIgnoresAvailability(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes"].includes(value.trim().toLowerCase());
}

export function queueMemberKey(member: QueueMemberDraft): string {
  if (member.id) return `row:${member.id}`;
  return `${member.type}:${member.entityId}:${member.teamId || "none"}`;
}

export function canEditQueueMember(member: QueueMemberDraft, allowedUserIds?: string[], allowedTeamIds?: string[]): boolean {
  if (member.type === "team") return !allowedTeamIds || allowedTeamIds.includes(member.entityId);
  return (!allowedUserIds || allowedUserIds.includes(member.entityId)) &&
    (!member.teamId || !allowedTeamIds || allowedTeamIds.includes(member.teamId));
}

export function isUnchangedQueueMember(member: QueueMemberDraft, source?: QueueMemberSource): boolean {
  if (!source?.id || source.id !== member.id || member.reenroll) return false;
  const sameIdentity = member.type === "user"
    ? source.user_id === member.entityId && (source.team_id || undefined) === member.teamId
    : !source.user_id && source.team_id === member.entityId;
  return sameIdentity && member.weight === (source.weight || 10);
}

export function moveEditableQueueMember(members: QueueMemberDraft[], activeKey: string, overKey: string, editable: (member: QueueMemberDraft) => boolean): QueueMemberDraft[] {
  const from = members.findIndex((member) => queueMemberKey(member) === activeKey);
  const to = members.findIndex((member) => queueMemberKey(member) === overKey);
  if (from < 0 || to < 0 || from === to || members.slice(Math.min(from, to), Math.max(from, to) + 1).some((member) => !editable(member))) return members;
  const moved = [...members];
  const [member] = moved.splice(from, 1);
  moved.splice(to, 0, member);
  return moved;
}

export function hydrateQueueMembers(
  members: QueueMemberSource[],
  teams: QueueTeamSource[],
): QueueMemberDraft[] {
  return members.flatMap<QueueMemberDraft>((member) => {
    if (member.user_id) {
      return [
        {
          id: member.id,
          type: "user" as const,
          entityId: member.user_id,
          teamId: member.team_id || undefined,
          weight: member.weight || 10,
          isActive: member.is_active !== false,
          name: member.user?.name || "Usuario",
        },
      ];
    }

    if (!member.team_id) return [];
    const team = teams.find((candidate) => candidate.id === member.team_id);
    return [
      {
        id: member.id,
        type: "team" as const,
        entityId: member.team_id,
        weight: member.weight || 10,
        isActive: member.is_active !== false,
        name: team?.name || "Equipe",
      },
    ];
  });
}

export function activeTeamsForUser(
  userId: string,
  teams: QueueTeamSource[],
): QueueTeamSource[] {
  return teams.filter(
    (team) =>
      team.is_active !== false &&
      team.members?.some((member) => member.user_id === userId),
  );
}

export function resolveDirectUserTeamContext(
  teamIds: string[],
  requestedTeamId: string | undefined,
): DirectUserTeamResolution {
  const uniqueTeamIds = Array.from(new Set(teamIds.filter(Boolean)));

  if (requestedTeamId) {
    return uniqueTeamIds.includes(requestedTeamId)
      ? { status: "resolved", teamId: requestedTeamId }
      : { status: "unavailable" };
  }

  return { status: "resolved" };
}
