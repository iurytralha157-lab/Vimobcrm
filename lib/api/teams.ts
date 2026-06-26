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
    return response.data
  },

  async createTeam(input: CreateTeamInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<Team>>('/v1/teams', {
      method: 'POST',
      organizationId,
      body: input,
    })
    return response.data
  },

  async updateTeam(input: UpdateTeamInput, organizationId?: string | null) {
    const { id, ...body } = input
    const response = await vimobAPIRequest<Envelope<Team>>(`/v1/teams/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
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
    return response.data.url
  },

  async listTeamPipelines(options?: { teamId?: string | null; organizationId?: string | null }) {
    const response = await vimobAPIRequest<Envelope<TeamPipelineRelation[]>>('/v1/team-pipelines', {
      organizationId: options?.organizationId,
      query: {
        teamId: options?.teamId,
      },
    })
    return response.data
  },

  async assignPipelineToTeam(input: { teamId: string; pipelineId: string }, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<TeamPipelineRelation>>('/v1/team-pipelines', {
      method: 'POST',
      organizationId,
      body: input,
    })
    return response.data
  },

  async removePipelineFromTeam(input: { teamId: string; pipelineId: string }, organizationId?: string | null) {
    await vimobAPIRequest<null>('/v1/team-pipelines', {
      method: 'DELETE',
      organizationId,
      query: input,
    })
  },

  async setTeamLeader(input: { teamId: string; userId: string; isLeader: boolean }, organizationId?: string | null) {
    await vimobAPIRequest<null>('/v1/team-members/leader', {
      method: 'PATCH',
      organizationId,
      body: input,
    })
  },

  async listMemberAvailability(
    options?: { teamMemberId?: string | null; teamMemberIds?: string[]; organizationId?: string | null },
  ) {
    const response = await vimobAPIRequest<Envelope<MemberAvailability[]>>('/v1/member-availability', {
      organizationId: options?.organizationId,
      query: {
        teamMemberId: options?.teamMemberId,
        teamMemberIds: options?.teamMemberIds?.join(','),
      },
    })
    return response.data
  },

  async updateMemberAvailability(input: AvailabilityInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<MemberAvailability>>('/v1/member-availability', {
      method: 'PATCH',
      organizationId,
      body: input,
    })
    return response.data
  },

  async replaceMemberAvailability(
    input: { teamMemberId: string; availability: Omit<AvailabilityInput, 'team_member_id'>[] },
    organizationId?: string | null,
  ) {
    const response = await vimobAPIRequest<Envelope<MemberAvailability[]>>(`/v1/team-members/${input.teamMemberId}/availability`, {
      method: 'PUT',
      organizationId,
      body: {
        availability: input.availability,
      },
    })
    return response.data
  },
}
