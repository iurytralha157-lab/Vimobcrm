import { managementAPIRequest } from '@/lib/api/management-request'
import {
  apiAvailabilityListResponseSchema,
  apiAvailabilityMutationResponseSchema,
  apiAvailabilitySnapshotResponseSchema,
  apiTeamListResponseSchema,
  teamFilterCatalogResponseSchema,
  type TeamFilterCatalog,
  apiTeamLogoResponseSchema,
  apiTeamHistoryListResponseSchema,
  apiTeamDistributionStatsResponseSchema,
  apiTeamPipelineListResponseSchema,
  apiTeamPipelineResponseSchema,
  apiTeamResponseSchema,
  availabilityInputSchema,
  bulkAvailabilityInputSchema,
  createTeamInputSchema,
  parseDomainInput,
  teamLeaderInputSchema,
  teamPipelineInputSchema,
  updateTeamBodySchema,
  validateDomainResponse,
} from "@/lib/validation";
import { chunkUniqueTeamMemberIDs } from "@/lib/teams/member-availability-batches";
import { PIPELINE_READ_TIMEOUT_MS } from "@/lib/pipeline-reliability";
import { vimobAPIRequest, type VimobAPIRequestIntent } from "./vimob-client";

type Envelope<T> = {
  data: T;
};

export interface TeamUser {
  id: string;
  name: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  created_at: string;
  is_leader?: boolean;
  user?: TeamUser | null;
}

export interface Team {
  id: string;
  name: string;
  organization_id: string;
  created_at: string;
  revision: number;
  is_active?: boolean;
  logo_url?: string | null;
  created_by?: string | null;
  created_by_user?: TeamUser | null;
  members?: TeamMember[];
}

export interface TeamHistoryEvent {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_data?: Record<string, unknown> | null;
  new_data?: Record<string, unknown> | null;
  diff?: Record<string, unknown> | null;
  created_at: string;
  user?: TeamUser | null;
  subject_user?: TeamUser | null;
}

export interface TeamDistributionStats {
  totalEvents: number;
  uniqueLeads: number;
  redistributionEvents: number;
  coverage: "complete" | "partial";
  completeSince: string;
}

export interface TeamPipelineRelation {
  id: string;
  team_id: string;
  pipeline_id: string;
  created_at: string;
  pipeline: {
    id: string;
    name: string;
  } | null;
  team?: {
    id: string;
    name: string;
  } | null;
}

export interface MemberAvailability {
  id: string;
  team_member_id: string;
  day_of_week: number;
  start_time: string | null;
  end_time: string | null;
  is_all_day: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MemberAvailabilitySnapshot {
  availability: MemberAvailability[];
  revision: number;
}

export interface TeamMemberInput {
  userId: string;
  isLeader?: boolean;
  availability?: TeamMemberAvailabilityInput[];
}

export type TeamMemberAvailabilityInput = {
  day_of_week: number;
  start_time?: string | null;
  end_time?: string | null;
  is_all_day?: boolean;
  is_active?: boolean;
};

export type CreateTeamInput = {
  name: string;
  memberIds?: string[];
  members?: TeamMemberInput[];
  logo_url?: string | null;
  is_active?: boolean;
};

export type UpdateTeamInput = {
  id: string;
  expected_revision: number;
  expected_member_ids: string[];
  name?: string;
  memberIds?: string[];
  members?: TeamMemberInput[];
  logo_url?: string | null;
  is_active?: boolean;
  preserveLeadership?: boolean;
};

export interface AvailabilityInput {
  expected_revision: number;
  team_member_id: string;
  day_of_week: number;
  start_time?: string | null;
  end_time?: string | null;
  is_all_day?: boolean;
  is_active?: boolean;
}

const TEAM_MUTATION_TIMEOUT_MS = 30_000;

export const teamsAPI = {
  async catalog(organizationId: string, options: VimobAPIRequestIntent & { includeInactive?: boolean } = {}): Promise<TeamFilterCatalog[]> {
    const { includeInactive = false, ...intent } = options;
    const response = await vimobAPIRequest<Envelope<TeamFilterCatalog[]>>("/v1/teams", {
      ...intent,
      organizationId,
      query: { includeInactive },
      timeoutMs: PIPELINE_READ_TIMEOUT_MS,
      retry: false,
    });
    const parsed = validateDomainResponse(teamFilterCatalogResponseSchema, response, "teams.catalog");
    if (parsed.data.some(team => team.organization_id !== organizationId)) {
      throw new Error("O catálogo de equipes pertence a outra organização.");
    }
    return parsed.data;
  },

  async listTeams(options?: {
    includeInactive?: boolean;
    organizationId?: string | null;
    signal?: AbortSignal;
  }) {
    const response = await vimobAPIRequest<Envelope<Team[]>>("/v1/teams", {
      organizationId: options?.organizationId,
      signal: options?.signal,
      timeoutMs: PIPELINE_READ_TIMEOUT_MS,
      retry: false,
      query: {
        includeInactive: options?.includeInactive,
      },
    });
    validateDomainResponse(apiTeamListResponseSchema, response, "teams.list");
    return response.data;
  },

  async getTeam(id: string, organizationId?: string | null, signal?: AbortSignal) {
    const response = await vimobAPIRequest<Envelope<Team>>(`/v1/teams/${id}`, {
      organizationId,
      signal,
    });
    validateDomainResponse(apiTeamResponseSchema, response, "teams.get");
    return response.data;
  },

  async getTeamHistory(id: string, organizationId?: string | null, options?: { limit?: number; offset?: number }) {
    const response = await vimobAPIRequest<Envelope<TeamHistoryEvent[]>>(
      `/v1/teams/${id}/history`,
      {
        organizationId,
        query: { limit: options?.limit, offset: options?.offset },
      },
    );
    validateDomainResponse(
      apiTeamHistoryListResponseSchema,
      response,
      "teams.history",
    );
    return response.data;
  },

  async getTeamDistributionStats(id: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<TeamDistributionStats>>(
      `/v1/teams/${id}/distribution-stats`,
      { organizationId },
    );
    validateDomainResponse(
      apiTeamDistributionStatsResponseSchema,
      response,
      "teams.distributionStats",
    );
    return response.data;
  },

  async createTeam(input: CreateTeamInput, organizationId: string | null, idempotencyKey: string, userId: string, intent: VimobAPIRequestIntent = {}) {
    const body = parseDomainInput(createTeamInputSchema, input, "teams.create");
    const response = await managementAPIRequest<Envelope<Team>>("/v1/teams", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      organizationId,
      ...intent,
      expectedUserId: userId,
      body,
      timeoutMs: TEAM_MUTATION_TIMEOUT_MS,
    });
    validateDomainResponse(apiTeamResponseSchema, response, "teams.create");
    return response.data;
  },

  async updateTeam(input: UpdateTeamInput, organizationId?: string | null, intent: VimobAPIRequestIntent = {}) {
    const { id, ...body } = input;
    const validatedBody = parseDomainInput(
      updateTeamBodySchema,
      body,
      "teams.update",
    );
    const response = await managementAPIRequest<Envelope<Team>>(`/v1/teams/${id}`, {
      ...intent,
      method: "PATCH",
      organizationId,
      body: validatedBody,
      timeoutMs: TEAM_MUTATION_TIMEOUT_MS,
    });
    validateDomainResponse(apiTeamResponseSchema, response, "teams.update");
    return response.data;
  },

  async deleteTeam(id: string, organizationId?: string | null) {
    await managementAPIRequest<null>(`/v1/teams/${id}`, {
      method: "DELETE",
      organizationId,
    });
  },

  async updateTeamStatus(
    input: { id: string; is_active: boolean },
    organizationId?: string | null,
  ) {
    const response = await managementAPIRequest<Envelope<Team>>(
      `/v1/teams/${input.id}/status`,
      {
        method: "PATCH",
        organizationId,
        body: { is_active: input.is_active },
      },
    );
    validateDomainResponse(apiTeamResponseSchema, response, "teams.status");
    return response.data;
  },

  async uploadLogo(file: File, organizationId?: string | null, intent: VimobAPIRequestIntent = {}) {
    const formData = new FormData();
    formData.append("file", file);
    const response = await managementAPIRequest<Envelope<{ url: string }>>(
      "/v1/teams/logo",
      {
        ...intent,
        method: "POST",
        organizationId,
        body: formData,
      },
    );
    validateDomainResponse(apiTeamLogoResponseSchema, response, "teams.logo");
    return response.data.url;
  },

  async listTeamPipelines(options?: {
    teamId?: string | null;
    organizationId?: string | null;
  }) {
    const response = await vimobAPIRequest<Envelope<TeamPipelineRelation[]>>(
      "/v1/team-pipelines",
      {
        organizationId: options?.organizationId,
        query: {
          teamId: options?.teamId,
        },
      },
    );
    validateDomainResponse(
      apiTeamPipelineListResponseSchema,
      response,
      "teams.pipelines.list",
    );
    return response.data;
  },

  async assignPipelineToTeam(
    input: { teamId: string; pipelineId: string },
    organizationId?: string | null,
  ) {
    const body = parseDomainInput(
      teamPipelineInputSchema,
      input,
      "teams.pipelines.assign",
    );
    const response = await managementAPIRequest<Envelope<TeamPipelineRelation>>(
      "/v1/team-pipelines",
      {
        method: "POST",
        organizationId,
        body,
      },
    );
    validateDomainResponse(
      apiTeamPipelineResponseSchema,
      response,
      "teams.pipelines.assign",
    );
    return response.data;
  },

  async removePipelineFromTeam(
    input: { teamId: string; pipelineId: string },
    organizationId?: string | null,
  ) {
    const query = parseDomainInput(
      teamPipelineInputSchema,
      input,
      "teams.pipelines.remove",
    );
    await managementAPIRequest<null>("/v1/team-pipelines", {
      method: "DELETE",
      organizationId,
      query,
    });
  },

  async setTeamLeader(
    input: { teamId: string; userId: string; isLeader: boolean },
    organizationId?: string | null,
  ) {
    const body = parseDomainInput(teamLeaderInputSchema, input, "teams.leader");
    await managementAPIRequest<null>("/v1/team-members/leader", {
      method: "PATCH",
      organizationId,
      body,
    });
  },

  async listMemberAvailability(options?: {
    teamMemberId?: string | null;
    teamMemberIds?: string[];
    organizationId?: string | null;
    signal?: AbortSignal;
  }) {
    const batches = chunkUniqueTeamMemberIDs(options?.teamMemberIds);
    const responses = await Promise.all(
      batches.map((teamMemberIds) =>
        vimobAPIRequest<Envelope<MemberAvailability[]>>(
          "/v1/member-availability",
          {
            organizationId: options?.organizationId,
            signal: options?.signal,
            query: {
              teamMemberId: options?.teamMemberId,
              teamMemberIds: teamMemberIds?.join(","),
            },
          },
        ),
      ),
    );
    const items = new Map<string, MemberAvailability>();
    for (const response of responses) {
      validateDomainResponse(
        apiAvailabilityListResponseSchema,
        response,
        "teams.availability.list",
      );
      for (const availability of response.data)
        items.set(availability.id, availability);
    }
    return [...items.values()];
  },

  async getMemberAvailabilitySnapshot(teamMemberId: string, organizationId?: string | null, signal?: AbortSignal): Promise<MemberAvailabilitySnapshot> {
    const response = await vimobAPIRequest<Envelope<MemberAvailability[]> & { revision: number }>(
      `/v1/team-members/${teamMemberId}/availability`,
      { organizationId, signal },
    );
    validateDomainResponse(apiAvailabilitySnapshotResponseSchema, response, "teams.availability.snapshot");
    return { availability: response.data, revision: response.revision };
  },

  async updateMemberAvailability(
    input: AvailabilityInput,
    organizationId?: string | null,
  ) {
    const body = parseDomainInput(
      availabilityInputSchema,
      input,
      "teams.availability.update",
    );
    const response = await managementAPIRequest<Envelope<MemberAvailability> & { revision: number }>(
      "/v1/member-availability",
      {
        method: "PATCH",
        organizationId,
        body,
      },
    );
    validateDomainResponse(
      apiAvailabilityMutationResponseSchema,
      response,
      "teams.availability.update",
    );
    return { availability: response.data, revision: response.revision };
  },

  async replaceMemberAvailability(
    input: {
      teamMemberId: string;
      expected_revision: number;
      availability: Omit<AvailabilityInput, "team_member_id" | "expected_revision">[];
    },
    organizationId?: string | null,
  ) {
    const body = parseDomainInput(
      bulkAvailabilityInputSchema,
      { availability: input.availability, expected_revision: input.expected_revision },
      "teams.availability.replace",
    );
    const response = await managementAPIRequest<Envelope<MemberAvailability[]> & { revision: number }>(
      `/v1/team-members/${input.teamMemberId}/availability`,
      {
        method: "PUT",
        organizationId,
        body,
      },
    );
    validateDomainResponse(
      apiAvailabilitySnapshotResponseSchema,
      response,
      "teams.availability.replace",
    );
    return { availability: response.data, revision: response.revision };
  },
};
