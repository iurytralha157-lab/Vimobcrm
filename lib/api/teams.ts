import {
  apiAvailabilityListResponseSchema,
  apiAvailabilityResponseSchema,
  apiTeamListResponseSchema,
  apiTeamLogoResponseSchema,
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
} from '@/lib/validation'
import { chunkUniqueTeamMemberIDs } from '@/lib/teams/member-availability-batches'
import { vimobAPIRequest } from './vimob-client'

type Envelope<T> = {
  data: T
}

export interface TeamUser {
  id: string
  name: string | null
  email?: string | null
  avatar_url?: string | null
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string
  created_at: string
  is_leader?: boolean
  user?: TeamUser | null
}

export interface Team {
  id: string
  name: string
  organization_id: string
  created_at: string
  is_active?: boolean
  logo_url?: string | null
  created_by?: string | null
  created_by_user?: TeamUser | null
  members?: TeamMember[]
}

export interface TeamPipelineRelation {
  id: string
  team_id: string
  pipeline_id: string
  created_at: string
  pipeline: {
    id: string
    name: string
  } | null
  team?: {
    id: string
    name: string
  } | null
}

export interface MemberAvailability {
  id: string
  team_member_id: string
  day_of_week: number
  start_time: string | null
  end_time: string | null
  is_all_day: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface TeamMemberInput {
  userId: string
  isLeader?: boolean
  availability?: TeamMemberAvailabilityInput[]
}

export type TeamMemberAvailabilityInput = {
  day_of_week: number
  start_time?: string | null
  end_time?: string | null
  is_all_day?: boolean
  is_active?: boolean
}

export type CreateTeamInput = {
  name: string
  memberIds?: string[]
  members?: TeamMemberInput[]
  logo_url?: string | null
  is_active?: boolean
}

export type UpdateTeamInput = {
  id: string
  name?: string
  memberIds?: string[]
  members?: TeamMemberInput[]
  logo_url?: string | null
  is_active?: boolean
  preserveLeadership?: boolean
}

export interface AvailabilityInput {
  team_member_id: string
  day_of_week: number
  start_time?: string | null
  end_time?: string | null
  is_all_day?: boolean
  is_active?: boolean
}

export const teamsAPI = {
  async listTeams(options?: { includeInactive?: boolean; organizationId?: string | null }) {
    const response = await vimobAPIRequest<Envelope<Team[]>>('/v1/teams', {
      organizationId: options?.organizationId,
      query: {
        includeInactive: options?.includeInactive,
      },
    })
    validateDomainResponse(apiTeamListResponseSchema, response, 'teams.list')
    return response.data
  },

  async getTeam(id: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<Team>>(`/v1/teams/${id}`, {
      organizationId,
    })
    validateDomainResponse(apiTeamResponseSchema, response, 'teams.get')
    return response.data
  },

  async createTeam(input: CreateTeamInput, organizationId?: string | null) {
    const body = parseDomainInput(createTeamInputSchema, input, 'teams.create')
    const response = await vimobAPIRequest<Envelope<Team>>('/v1/teams', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiTeamResponseSchema, response, 'teams.create')
    return response.data
  },

  async updateTeam(input: UpdateTeamInput, organizationId?: string | null) {
    const { id, ...body } = input
    const validatedBody = parseDomainInput(updateTeamBodySchema, body, 'teams.update')
    const response = await vimobAPIRequest<Envelope<Team>>(`/v1/teams/${id}`, {
      method: 'PATCH',
      organizationId,
      body: validatedBody,
    })
    validateDomainResponse(apiTeamResponseSchema, response, 'teams.update')
    return response.data
  },

  async deleteTeam(id: string, organizationId?: string | null) {
    await vimobAPIRequest<null>(`/v1/teams/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async updateTeamStatus(input: { id: string; is_active: boolean }, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<Team>>(`/v1/teams/${input.id}/status`, {
      method: 'PATCH',
      organizationId,
      body: { is_active: input.is_active },
    })
    validateDomainResponse(apiTeamResponseSchema, response, 'teams.status')
    return response.data
  },

  async uploadLogo(file: File, organizationId?: string | null) {
    const formData = new FormData()
    formData.append('file', file)
    const response = await vimobAPIRequest<Envelope<{ url: string }>>('/v1/teams/logo', {
      method: 'POST',
      organizationId,
      body: formData,
    })
    validateDomainResponse(apiTeamLogoResponseSchema, response, 'teams.logo')
    return response.data.url
  },

  async listTeamPipelines(options?: { teamId?: string | null; organizationId?: string | null }) {
    const response = await vimobAPIRequest<Envelope<TeamPipelineRelation[]>>('/v1/team-pipelines', {
      organizationId: options?.organizationId,
      query: {
        teamId: options?.teamId,
      },
    })
    validateDomainResponse(apiTeamPipelineListResponseSchema, response, 'teams.pipelines.list')
    return response.data
  },

  async assignPipelineToTeam(input: { teamId: string; pipelineId: string }, organizationId?: string | null) {
    const body = parseDomainInput(teamPipelineInputSchema, input, 'teams.pipelines.assign')
    const response = await vimobAPIRequest<Envelope<TeamPipelineRelation>>('/v1/team-pipelines', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiTeamPipelineResponseSchema, response, 'teams.pipelines.assign')
    return response.data
  },

  async removePipelineFromTeam(input: { teamId: string; pipelineId: string }, organizationId?: string | null) {
    const query = parseDomainInput(teamPipelineInputSchema, input, 'teams.pipelines.remove')
    await vimobAPIRequest<null>('/v1/team-pipelines', {
      method: 'DELETE',
      organizationId,
      query,
    })
  },

  async setTeamLeader(input: { teamId: string; userId: string; isLeader: boolean }, organizationId?: string | null) {
    const body = parseDomainInput(teamLeaderInputSchema, input, 'teams.leader')
    await vimobAPIRequest<null>('/v1/team-members/leader', {
      method: 'PATCH',
      organizationId,
      body,
    })
  },

  async listMemberAvailability(
    options?: { teamMemberId?: string | null; teamMemberIds?: string[]; organizationId?: string | null },
  ) {
    const batches = chunkUniqueTeamMemberIDs(options?.teamMemberIds)
    const responses = await Promise.all(
      batches.map((teamMemberIds) =>
        vimobAPIRequest<Envelope<MemberAvailability[]>>('/v1/member-availability', {
          organizationId: options?.organizationId,
          query: {
            teamMemberId: options?.teamMemberId,
            teamMemberIds: teamMemberIds?.join(','),
          },
        }),
      ),
    )
    const items = new Map<string, MemberAvailability>()
    for (const response of responses) {
      validateDomainResponse(apiAvailabilityListResponseSchema, response, 'teams.availability.list')
      for (const availability of response.data) items.set(availability.id, availability)
    }
    return [...items.values()]
  },

  async updateMemberAvailability(input: AvailabilityInput, organizationId?: string | null) {
    const body = parseDomainInput(availabilityInputSchema, input, 'teams.availability.update')
    const response = await vimobAPIRequest<Envelope<MemberAvailability>>('/v1/member-availability', {
      method: 'PATCH',
      organizationId,
      body,
    })
    validateDomainResponse(apiAvailabilityResponseSchema, response, 'teams.availability.update')
    return response.data
  },

  async replaceMemberAvailability(
    input: { teamMemberId: string; availability: Omit<AvailabilityInput, 'team_member_id'>[] },
    organizationId?: string | null,
  ) {
    const body = parseDomainInput(bulkAvailabilityInputSchema, { availability: input.availability }, 'teams.availability.replace')
    const response = await vimobAPIRequest<Envelope<MemberAvailability[]>>(`/v1/team-members/${input.teamMemberId}/availability`, {
      method: 'PUT',
      organizationId,
      body,
    })
    validateDomainResponse(apiAvailabilityListResponseSchema, response, 'teams.availability.replace')
    return response.data
  },
}
