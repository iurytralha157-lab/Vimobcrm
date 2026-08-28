'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useAuth } from '@/contexts/AuthContext'
import {
  cadencesAPI,
  type UpdateStageOperationalRulesInput,
} from '@/lib/api/cadences'
import { VimobAPIError } from '@/lib/api/vimob-client'

export const stageOperationalRulesQueryKey = (
  organizationId: string | undefined,
  stageId: string | undefined,
) => ['cadences', 'stage-operational-rules', organizationId, stageId] as const

function useOrganizationId() {
  const { organization, profile } = useAuth()
  return organization?.id || profile?.organization_id || undefined
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : 'Não foi possível salvar as regras desta etapa.'
}

export function useStageOperationalRules(stageId?: string) {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: stageOperationalRulesQueryKey(organizationId, stageId),
    enabled: Boolean(organizationId && stageId),
    queryFn: () => cadencesAPI.getStageOperationalRules(stageId!, organizationId),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export function useUpdateStageOperationalRules(stageId?: string) {
  const organizationId = useOrganizationId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateStageOperationalRulesInput) => (
      cadencesAPI.updateStageOperationalRules(input, organizationId)
    ),
    onSuccess: (rules) => {
      queryClient.setQueryData(
        stageOperationalRulesQueryKey(organizationId, stageId || rules.stage_id),
        rules,
      )
      queryClient.invalidateQueries({ queryKey: ['cadence-templates'] })
      queryClient.invalidateQueries({ queryKey: ['attention'] })
      queryClient.invalidateQueries({ queryKey: ['home'] })
      toast.success('Regras da etapa salvas.')
    },
    onError: async (error) => {
      if (
        error instanceof VimobAPIError
        && error.code === 'stage_operational_rules_changed'
      ) {
        await queryClient.refetchQueries({
          queryKey: stageOperationalRulesQueryKey(organizationId, stageId),
          type: 'active',
        })
        toast.error('Outra pessoa alterou esta etapa. Recarregamos a versão mais recente.')
        return
      }
      toast.error(getErrorMessage(error))
    },
  })
}
