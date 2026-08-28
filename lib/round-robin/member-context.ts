export type QueueMemberDraft = {
  id?: string;
  type: "user" | "team";
  entityId: string;
  teamId?: string;
  weight: number;
  name?: string;
};

export type QueueMemberSource = {
  id?: string;
  team_id?: string | null;
  user_id?: string | null;
  weight?: number | null;
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
  | { status: "requires-team"; teamIds: string[] }
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
  ignoreAvailability: boolean,
): DirectUserTeamResolution {
  const uniqueTeamIds = Array.from(new Set(teamIds.filter(Boolean)));

  if (requestedTeamId) {
    return uniqueTeamIds.includes(requestedTeamId)
      ? { status: "resolved", teamId: requestedTeamId }
      : { status: "unavailable" };
  }

  if (uniqueTeamIds.length === 1) {
    return { status: "resolved", teamId: uniqueTeamIds[0] };
  }
  if (uniqueTeamIds.length > 1) {
    return { status: "requires-team", teamIds: uniqueTeamIds };
  }
  if (ignoreAvailability) {
    return { status: "resolved" };
  }
  return { status: "unavailable" };
}
