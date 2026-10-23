import { useQueryWithDataTrust, type QueryDataTrustScope, type QueryWithDataTrust } from '@/hooks/shared/use-query-data-trust';
import {
  useMutation,
  useInfiniteQuery,
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
import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { VimobAPIRequestIntent } from "@/lib/api/vimob-client";
import { assertManagementRequestIntent, captureManagementRequestIntent } from "@/lib/api/management-request";
import { shouldRetryPipelineQuery } from "@/lib/pipeline-reliability";
import { getGlobalSignOutSessionId } from "@/lib/auth/global-sign-out";
import type { TeamFilterCatalog } from "@/lib/validation/team-filter-catalog";
import {
  cacheTeamEditorSnapshot,
  loadConsistentTeamEditorSnapshot,
  observeTeamCache,
} from "@/lib/teams/team-editor-snapshot";

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
  "dashboard-campaigns",
  "dashboard-creatives",
  "dashboard-creative-media",
  "dashboard-first-contact",
  "dashboard-first-contact-leads",
  "dashboard-lead-entries",
  "dashboard-visits",
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

function useTeamMutationScope(organizationId: string | null) {
  const current = useRef(organizationId);
  useEffect(() => { current.current = organizationId; return () => { current.current = null; }; }, [organizationId]);
  return (requestedOrganizationId: string) => current.current === requestedOrganizationId;
}

type TeamQueryOptions = {
  cacheTrustScope?: QueryDataTrustScope;
  includeInactive?: boolean;
  enabled?: boolean;
  catalog?: boolean;
};
export function useTeams(options: TeamQueryOptions & { catalog: true }): QueryWithDataTrust<TeamFilterCatalog[], Error>;
export function useTeams(options?: TeamQueryOptions & { catalog?: false }): QueryWithDataTrust<Team[], Error>;
export function useTeams(options?: TeamQueryOptions) {
  const includeInactive = options?.includeInactive ?? false;
  const { activeOrganization, user, session } = useAuth();
  const organizationId = activeOrganization.organizationId || null;
  const catalog = options?.catalog === true;
  const userId = user?.id || null;
  const sessionId = catalog ? getGlobalSignOutSessionId(session) : null;

  return useQueryWithDataTrust<Team[] | TeamFilterCatalog[], Error>({
    queryKey: catalog
      ? ["teams", organizationId, "filter-catalog", userId, sessionId, { includeInactive }]
      : ["teams", organizationId, { includeInactive }],
    queryFn: ({ signal }) => catalog
      ? teamsAPI.catalog(organizationId!, { includeInactive, signal, expectedUserId: userId, expectedSessionId: sessionId })
      : teamsAPI.listTeams({ includeInactive, organizationId, signal }),
    enabled: Boolean(organizationId) && (!catalog || Boolean(userId && sessionId)) && (options?.enabled ?? true),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
    retry: shouldRetryPipelineQuery,
    retryDelay: 800,
  }, options?.cacheTrustScope);
}

export function useTeam(
  teamId?: string | null,
  options?: { enabled?: boolean },
) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;

  return useQuery({
    queryKey: ["team", organizationId, teamId],
    queryFn: ({ signal }) => teamsAPI.getTeam(teamId as string, organizationId, signal),
    enabled: Boolean(organizationId && teamId) && (options?.enabled ?? true),
    staleTime: 1000 * 60 * 5,
  });
}

export function useReloadTeamEditor() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;

  return async (teamId: string, intent = captureManagementRequestIntent()) => {
    const assertCurrent = () => { intent.signal?.throwIfAborted(); assertManagementRequestIntent(intent); };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assertCurrent();
      const observedCache = observeTeamCache(queryClient, organizationId, teamId);
      const snapshot = await loadConsistentTeamEditorSnapshot(
        teamId,
        async (id) => {
          assertCurrent();
          const team = await teamsAPI.getTeam(id, organizationId, intent.signal);
          assertCurrent();
          return team;
        },
        async (memberIds) => {
          assertCurrent();
          const availability = await teamsAPI.listMemberAvailability({ teamMemberIds: memberIds, organizationId, signal: intent.signal });
          assertCurrent();
          return availability;
        },
      );
      try {
        await cacheTeamEditorSnapshot(
          queryClient,
          organizationId,
          teamId,
          snapshot,
          observedCache,
          assertCurrent,
        );
        assertCurrent();
      } catch (error) {
        if (attempt === 0) continue;
        throw error;
      }
      queryClient.setQueryData(["team-editor-snapshot", organizationId, teamId], snapshot);
      void queryClient.invalidateQueries({ queryKey: ["teams", organizationId] });
      return snapshot;
    }
    throw new Error("A equipe mudou durante a recarga. Tente novamente.");
  };
}

export function useTeamEditorSnapshot(
  teamId?: string | null,
  options?: { enabled?: boolean },
) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;
  const reloadTeamEditor = useReloadTeamEditor();

  return useQuery({
    queryKey: ["team-editor-snapshot", organizationId, teamId],
    queryFn: ({ signal }) => reloadTeamEditor(teamId as string, captureManagementRequestIntent(signal)),
    enabled: Boolean(organizationId && teamId) && (options?.enabled ?? true),
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: shouldRetryPipelineQuery,
    retryDelay: 800,
  });
}

export function useTeamHistory(
  teamId?: string | null,
  options?: { enabled?: boolean },
) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;

  return useInfiniteQuery({
    queryKey: ["team-history", organizationId, teamId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => teamsAPI.getTeamHistory(teamId as string, organizationId, { limit: 50, offset: pageParam }),
    getNextPageParam: (lastPage, pages) => lastPage.length === 50 && pages.length * 50 <= 1_000_000 ? pages.length * 50 : undefined,
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
  const isCurrentScope = useTeamMutationScope(organizationId);

  return useMutation({
    mutationFn: async ({ input, idempotencyKey, organizationId: requestedOrganizationId, userId, intent }: { input: CreateTeamInput; idempotencyKey: string; organizationId: string; userId: string; intent?: VimobAPIRequestIntent }) =>
      teamsAPI.createTeam(input, requestedOrganizationId, idempotencyKey, userId, intent),
    onSuccess: (team) => {
      queryClient.invalidateQueries({ queryKey: ["teams", team.organization_id] });
      queryClient.invalidateQueries({ queryKey: ["lead-visibility"] });
      queryClient.invalidateQueries(
        { queryKey: ["stages-with-leads"] },
        { cancelRefetch: false },
      );
      invalidateTeamScopeDependentQueries(queryClient);
      if (isCurrentScope(team.organization_id)) toast.success("Equipe criada!");
    },
  });
}

export function useUpdateTeam() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;
  const isCurrentScope = useTeamMutationScope(organizationId);

  return useMutation({
    mutationFn: async ({ organizationId: requestedOrganizationId, intent, ...data }: UpdateTeamInput & { organizationId: string; intent?: VimobAPIRequestIntent }) =>
      teamsAPI.updateTeam(data, requestedOrganizationId, intent),
    onSuccess: (savedTeam, variables) => {
      const organizationId = variables.organizationId;
      if (isCurrentScope(organizationId)) {
      queryClient.setQueriesData<Team[]>(
        { queryKey: ["teams", organizationId], predicate: query => query.queryKey[2] !== "filter-catalog" },
        (cachedTeams) => cachedTeams?.map((team) =>
          team.id === savedTeam.id ? savedTeam : team
        ),
      );

      queryClient.setQueryData(["team", organizationId, variables.id], savedTeam);
      }
      queryClient.invalidateQueries({ queryKey: ["teams", organizationId] });
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
      if (isCurrentScope(organizationId)) toast.success("Equipe atualizada!");
    },
  });
}

export function useDeleteTeam() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;
  const isCurrentScope = useTeamMutationScope(organizationId);

  return useMutation({
    mutationFn: async ({ id, organizationId: requestedOrganizationId }: { id: string; organizationId: string }) => teamsAPI.deleteTeam(id, requestedOrganizationId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["teams", variables.organizationId] });
      queryClient.invalidateQueries({ queryKey: ["lead-visibility"] });
      queryClient.invalidateQueries(
        { queryKey: ["stages-with-leads"] },
        { cancelRefetch: false },
      );
      invalidateTeamScopeDependentQueries(queryClient);
      if (isCurrentScope(variables.organizationId)) toast.success("Equipe excluida!");
    },
    onError: (error, variables) => {
      if (!isCurrentScope(variables.organizationId)) return;
      toast.error("Erro ao excluir equipe: " + error.message);
    },
  });
}

export function useUpdateTeamStatus() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;
  const isCurrentScope = useTeamMutationScope(organizationId);

  return useMutation({
    mutationFn: async ({ id, is_active, organizationId: requestedOrganizationId }: { id: string; is_active: boolean; organizationId: string }) =>
      teamsAPI.updateTeamStatus({ id, is_active }, requestedOrganizationId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["teams", variables.organizationId] });
      queryClient.invalidateQueries({ queryKey: ["team", variables.organizationId, variables.id] });
      queryClient.invalidateQueries({ queryKey: ["team-history", variables.organizationId, variables.id] });
      queryClient.invalidateQueries({ queryKey: ["lead-visibility"] });
      queryClient.invalidateQueries(
        { queryKey: ["stages-with-leads"] },
        { cancelRefetch: false },
      );
      invalidateTeamScopeDependentQueries(queryClient);
      if (isCurrentScope(variables.organizationId)) toast.success(
        variables.is_active ? "Equipe ativada!" : "Equipe desativada!",
      );
    },
    onError: (error, variables) => {
      if (!isCurrentScope(variables.organizationId)) return;
      toast.error("Erro ao atualizar equipe: " + error.message);
    },
  });
}
