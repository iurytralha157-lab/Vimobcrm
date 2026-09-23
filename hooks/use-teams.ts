import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  teamsAPI,
  type CreateTeamInput,
  type Team,
  type TeamMember,
  type TeamMemberInput,
  type UpdateTeamInput,
} from "@/lib/api/teams";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { shouldRetryPipelineQuery } from "@/lib/pipeline-reliability";

export type { Team, TeamMember, TeamMemberInput };

const TEAM_SCOPE_DEPENDENT_QUERY_KEYS = [
  "filtered-stage-counts",
  "contacts-list",
  "dashboard-stats",
  "enhanced-dashboard-stats",
  "funnel-data",
  "lead-sources-data",
  "deals-evolution",
  "dashboard-extra-counts",
  "dashboard-lead-distribution",
  "dashboard-first-contact",
  "dashboard-recent-activities",
  "recent-activities",
  "top-brokers",
  "upcoming-tasks",
  "dashboard-alerts",
  "lead-analytics",
  "campaign-insights",
  "gamification-overview",
  "vgv-stats",
  "vgv-by-broker",
  "stage-vgv",
] as const;

function invalidateTeamScopeDependentQueries(queryClient: QueryClient) {
  TEAM_SCOPE_DEPENDENT_QUERY_KEYS.forEach((queryKey) => {
    void queryClient.invalidateQueries({
      queryKey: [queryKey],
      refetchType: "active",
    });
  });
}

export function useTeams(options?: {
  includeInactive?: boolean;
  enabled?: boolean;
}) {
  const includeInactive = options?.includeInactive ?? false;
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;

  return useQuery({
    queryKey: ["teams", organizationId, { includeInactive }],
    queryFn: ({ signal }) => teamsAPI.listTeams({ includeInactive, organizationId, signal }),
    enabled: Boolean(organizationId) && (options?.enabled ?? true),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
    retry: shouldRetryPipelineQuery,
    retryDelay: 800,
  });
}

export function useTeam(
  teamId?: string | null,
  options?: { enabled?: boolean },
) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;

  return useQuery({
    queryKey: ["team", organizationId, teamId],
    queryFn: () => teamsAPI.getTeam(teamId as string, organizationId),
    enabled: Boolean(organizationId && teamId) && (options?.enabled ?? true),
    staleTime: 1000 * 60 * 5,
  });
}

export function useTeamHistory(
  teamId?: string | null,
  options?: { enabled?: boolean },
) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;

  return useQuery({
    queryKey: ["team-history", organizationId, teamId],
    queryFn: () => teamsAPI.getTeamHistory(teamId as string, organizationId),
    enabled: Boolean(organizationId && teamId) && (options?.enabled ?? true),
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
  });
}

export function useTeamDistributionStats(
  teamId?: string | null,
  options?: { enabled?: boolean },
) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;

  return useQuery({
    queryKey: ["team-distribution-stats", organizationId, teamId],
    queryFn: () =>
      teamsAPI.getTeamDistributionStats(teamId as string, organizationId),
    enabled: Boolean(organizationId && teamId) && (options?.enabled ?? true),
    staleTime: 1000 * 30,
    retry: false,
    refetchInterval: (query) =>
      query.state.status === "error" ? false : 1000 * 30,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });
}

export function useCreateTeam() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;

  return useMutation({
    mutationFn: async (data: CreateTeamInput) =>
      teamsAPI.createTeam(data, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      queryClient.invalidateQueries({ queryKey: ["lead-visibility"] });
      queryClient.invalidateQueries(
        { queryKey: ["stages-with-leads"] },
        { cancelRefetch: false },
      );
      invalidateTeamScopeDependentQueries(queryClient);
      toast.success("Equipe criada!");
    },
  });
}

export function useUpdateTeam() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;

  return useMutation({
    mutationFn: async (data: UpdateTeamInput) =>
      teamsAPI.updateTeam(data, organizationId),
    onSuccess: (_, variables) => {
      if (variables.members) {
        const leadershipByUserId = new Map(
          variables.members.map((member) => [
            member.userId,
            member.isLeader ?? false,
          ]),
        );
        const selectedUserIds = new Set(
          variables.members.map((member) => member.userId),
        );

        queryClient.setQueriesData<Team[]>(
          { queryKey: ["teams"] },
          (cachedTeams) => {
            if (!cachedTeams) return cachedTeams;

            return cachedTeams.map((team) => {
              if (team.id !== variables.id) return team;

              return {
                ...team,
                name: variables.name ?? team.name,
                logo_url:
                  variables.logo_url !== undefined
                    ? variables.logo_url
                    : team.logo_url,
                is_active:
                  variables.is_active !== undefined
                    ? variables.is_active
                    : team.is_active,
                members: (team.members || [])
                  .filter((member) => selectedUserIds.has(member.user_id))
                  .map((member) => ({
                    ...member,
                    is_leader: leadershipByUserId.get(member.user_id) ?? false,
                  })),
              };
            });
          },
        );
      }

      queryClient.invalidateQueries({ queryKey: ["teams"] });
      queryClient.invalidateQueries({
        queryKey: ["team", organizationId, variables.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["team-history", organizationId, variables.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["member-availability", organizationId],
      });
      queryClient.invalidateQueries({
        queryKey: ["team-members-availability", organizationId],
      });
      queryClient.invalidateQueries({ queryKey: ["lead-visibility"] });
      queryClient.invalidateQueries(
        { queryKey: ["stages-with-leads"] },
        { cancelRefetch: false },
      );
      invalidateTeamScopeDependentQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["round-robins"] });
      toast.success("Equipe atualizada!");
    },
  });
}

export function useDeleteTeam() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;

  return useMutation({
    mutationFn: async (id: string) => teamsAPI.deleteTeam(id, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      queryClient.invalidateQueries({ queryKey: ["lead-visibility"] });
      queryClient.invalidateQueries(
        { queryKey: ["stages-with-leads"] },
        { cancelRefetch: false },
      );
      invalidateTeamScopeDependentQueries(queryClient);
      toast.success("Equipe excluida!");
    },
    onError: (error) => {
      toast.error("Erro ao excluir equipe: " + error.message);
    },
  });
}

export function useUpdateTeamStatus() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;

  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) =>
      teamsAPI.updateTeamStatus({ id, is_active }, organizationId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      queryClient.invalidateQueries({ queryKey: ["lead-visibility"] });
      queryClient.invalidateQueries(
        { queryKey: ["stages-with-leads"] },
        { cancelRefetch: false },
      );
      invalidateTeamScopeDependentQueries(queryClient);
      toast.success(
        variables.is_active ? "Equipe ativada!" : "Equipe desativada!",
      );
    },
    onError: (error) => {
      toast.error("Erro ao atualizar equipe: " + error.message);
    },
  });
}
