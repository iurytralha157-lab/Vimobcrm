import type { QueryClient } from "@tanstack/react-query";
import type { MemberAvailability, Team } from "@/lib/api/teams";

export type TeamEditorSnapshot = { team: Team; availability: MemberAvailability[] };
export type TeamCacheObservation = { team: Team | undefined; dataUpdatedAt: number };

function teamCacheKey(organizationId: string | null, teamId: string) {
  return ["team", organizationId, teamId] as const;
}

export function observeTeamCache(
  queryClient: QueryClient,
  organizationId: string | null,
  teamId: string,
): TeamCacheObservation {
  const key = teamCacheKey(organizationId, teamId);
  return {
    team: queryClient.getQueryData<Team>(key),
    dataUpdatedAt: queryClient.getQueryState(key)?.dataUpdatedAt ?? 0,
  };
}

export function getVisibleTeamMemberIds(team: Team): string[] {
  return (team.members || []).map((member) => member.id).sort();
}

export function sameTeamMemberIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export async function loadConsistentTeamEditorSnapshot(
  teamId: string,
  readTeam: (id: string) => Promise<Team>,
  readAvailability: (memberIds: string[]) => Promise<MemberAvailability[]>,
): Promise<{ team: Team; availability: MemberAvailability[] }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const team = await readTeam(teamId);
    const memberIds = getVisibleTeamMemberIds(team);
    const availability = memberIds.length ? await readAvailability(memberIds) : [];
    const confirmedTeam = await readTeam(teamId);
    if (
      confirmedTeam.revision === team.revision &&
      sameTeamMemberIds(getVisibleTeamMemberIds(confirmedTeam), memberIds)
    ) {
      return { team: confirmedTeam, availability };
    }
  }
  throw new Error("A equipe mudou durante a recarga. Tente novamente.");
}

export async function cacheTeamEditorSnapshot(
  queryClient: QueryClient,
  organizationId: string | null,
  teamId: string,
  snapshot: TeamEditorSnapshot,
  observedCache: TeamCacheObservation,
  assertCurrent?: () => void,
): Promise<void> {
  const teamKey = teamCacheKey(organizationId, teamId);
  await queryClient.cancelQueries({ queryKey: teamKey, exact: true }, { revert: false });
  assertCurrent?.();
  const { team: cachedTeam, dataUpdatedAt } = observeTeamCache(
    queryClient,
    organizationId,
    teamId,
  );
  if (cachedTeam && cachedTeam.revision > snapshot.team.revision) {
    throw new Error("A equipe mudou durante a recarga. Tente novamente.");
  }
  if (
    cachedTeam &&
    cachedTeam.revision === snapshot.team.revision &&
    !sameTeamMemberIds(
      getVisibleTeamMemberIds(cachedTeam),
      getVisibleTeamMemberIds(snapshot.team),
    ) &&
    (cachedTeam !== observedCache.team || dataUpdatedAt !== observedCache.dataUpdatedAt)
  ) {
    throw new Error("Os membros da equipe mudaram durante a recarga. Tente novamente.");
  }
  queryClient.setQueryData<Team>(teamKey, (current) =>
    current && current.revision > snapshot.team.revision ? current : snapshot.team,
  );
  const memberIds = getVisibleTeamMemberIds(snapshot.team);
  queryClient.setQueryData(
    ["team-members-availability", organizationId, memberIds],
    snapshot.availability,
  );
}
