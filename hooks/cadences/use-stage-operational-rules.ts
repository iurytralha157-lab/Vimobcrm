'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useOptionalActiveOrganizationId as useOrganizationId } from '@/hooks/use-active-organization'
import {
  cadencesAPI,
  type UpdateStageOperationalRulesInput,
} from '@/lib/api/cadences'
import { VimobAPIError } from '@/lib/api/vimob-client'
import { getNonEmptyErrorMessageOrFallback } from '@/lib/api/vimob-error'

export function stageOperationalRulesErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof VimobAPIError)) {
    return getNonEmptyErrorMessageOrFallback(error, fallback)
  }

  switch (error.code) {
    case 'permission_denied':
      return 'Seu perfil não tem permissão para acessar as regras desta etapa.'
    case 'stage_attention_policy_conflict':
      return 'Esta etapa já tem uma regra na Central de Atenção. Revise-a antes de salvar.'
    case 'stage_operational_rules_changed':
      return 'Outra pessoa alterou esta etapa. Recarregue as regras antes de salvar.'
    case 'invalid_cadence_input':
      return 'Revise os campos da cadência antes de salvar.'
    case 'local_read_only':
      return error.message
    default:
      return error.requestId ? `${fallback} Referência: ${error.requestId}.` : fallback
  }
}

export const stageOperationalRulesQueryKey = (
  organizationId: string | undefined,
  stageId: string | undefined,
) => ['cadences', 'stage-operational-rules', organizationId, stageId] as const

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
    onError: (error) => {
      if (
        error instanceof VimobAPIError
        && error.code === 'stage_operational_rules_changed'
      ) {
        toast.error('Outra pessoa alterou esta etapa. Seu rascunho foi preservado; carregue a versão atual para continuar.')
        return
      }
      toast.error(stageOperationalRulesErrorMessage(error, 'Não foi possível salvar as regras desta etapa.'))
    },
  })
}
