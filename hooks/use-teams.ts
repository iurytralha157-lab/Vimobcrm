import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { teamsAPI, type CreateTeamInput, type Team, type TeamMember, type TeamMemberInput, type UpdateTeamInput } from '@/lib/api/teams'
import { toast } from 'sonner'

export type { Team, TeamMember, TeamMemberInput }

export function useTeams(options?: { includeInactive?: boolean }) {
  const includeInactive = options?.includeInactive ?? false

  return useQuery({
    queryKey: ['teams', { includeInactive }],
    queryFn: () => teamsAPI.listTeams({ includeInactive }),
  })
}

export function useCreateTeam() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreateTeamInput) => teamsAPI.createTeam(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['lead-visibility'] })
      queryClient.invalidateQueries({ queryKey: ['stages-with-leads'] })
      toast.success('Equipe criada!')
    },
    onError: (error) => {
      toast.error('Erro ao criar equipe: ' + error.message)
    },
  })
}

export function useUpdateTeam() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: UpdateTeamInput) => teamsAPI.updateTeam(data),
    onSuccess: (_, variables) => {
      if (variables.members) {
        const leadershipByUserId = new Map(
          variables.members.map((member) => [member.userId, member.isLeader ?? false])
        )
        const selectedUserIds = new Set(variables.members.map((member) => member.userId))

        queryClient.setQueriesData<Team[]>({ queryKey: ['teams'] }, (cachedTeams) => {
          if (!cachedTeams) return cachedTeams

          return cachedTeams.map((team) => {
            if (team.id !== variables.id) return team

            return {
              ...team,
              name: variables.name ?? team.name,
              logo_url: variables.logo_url !== undefined ? variables.logo_url : team.logo_url,
              is_active: variables.is_active !== undefined ? variables.is_active : team.is_active,
              members: (team.members || [])
                .filter((member) => selectedUserIds.has(member.user_id))
                .map((member) => ({
                  ...member,
                  is_leader: leadershipByUserId.get(member.user_id) ?? false,
                })),
            }
          })
        })
      }

      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['lead-visibility'] })
      queryClient.invalidateQueries({ queryKey: ['stages-with-leads'] })
      queryClient.invalidateQueries({ queryKey: ['round-robins'] })
      toast.success('Equipe atualizada!')
    },
    onError: (error) => {
      toast.error('Erro ao atualizar equipe: ' + error.message)
    },
  })
}

export function useDeleteTeam() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => teamsAPI.deleteTeam(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['lead-visibility'] })
      queryClient.invalidateQueries({ queryKey: ['stages-with-leads'] })
      toast.success('Equipe excluida!')
    },
    onError: (error) => {
      toast.error('Erro ao excluir equipe: ' + error.message)
    },
  })
}

export function useUpdateTeamStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) =>
      teamsAPI.updateTeamStatus({ id, is_active }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['lead-visibility'] })
      queryClient.invalidateQueries({ queryKey: ['stages-with-leads'] })
      toast.success(variables.is_active ? 'Equipe ativada!' : 'Equipe desativada!')
    },
    onError: (error) => {
      toast.error('Erro ao atualizar equipe: ' + error.message)
    },
  })
}
