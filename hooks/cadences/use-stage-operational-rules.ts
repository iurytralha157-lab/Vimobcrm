'use client'

import { useLayoutEffect, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  cadencesAPI,
  type UpdateStageOperationalRulesInput,
  type StageOperationalRules,
} from '@/lib/api/cadences'
import { VimobAPIError } from '@/lib/api/vimob-client'
import { getNonEmptyErrorMessageOrFallback } from '@/lib/api/vimob-error'
import { useStageOperationalRulesScope } from './use-stage-operational-rules-scope'

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
  const scope = useStageOperationalRulesScope(stageId)
  const organizationId = scope.organizationId || undefined
  const key = stageOperationalRulesQueryKey(organizationId, stageId)
  const readGuards = useRef(new WeakMap<StageOperationalRules, () => boolean>())

  const query = useQuery({
    queryKey: key,
    enabled: Boolean(organizationId && stageId),
    queryFn: async ({ signal }) => {
      const operation = scope.captureRead(signal)
      try {
        const rules = await cadencesAPI.getStageOperationalRules(stageId!, organizationId, operation.intent)
        if (!scope.isCurrent(operation.captured)) throw new VimobAPIError('A sessão mudou. Reabra as regras antes de continuar.', { code: 'stage_operational_rules_scope_changed', status: 409 })
        const current = scope.client.getQueryData<StageOperationalRules>(key)
        if (rules.stage_id !== stageId || (current && current.pipeline_id !== rules.pipeline_id)) throw responseMismatch()
        const selected = current && current.revision >= rules.revision ? current : rules
        readGuards.current.set(selected, () => scope.isCurrent(operation.captured))
        return selected
      } finally { operation.finish() }
    },
    structuralSharing: (oldData, newData) => {
      const previous = oldData as StageOperationalRules | undefined
      const incoming = newData as StageOperationalRules
      // React Query commits after queryFn resolves. Fence that final boundary too.
      if (readGuards.current.get(incoming)?.() === false) return previous
      return previous && previous.stage_id === incoming.stage_id && previous.pipeline_id === incoming.pipeline_id && previous.revision >= incoming.revision ? previous : incoming
    },
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })
  return { ...query, scopeKey: scope.editorKey }
}

const responseMismatch = () => new VimobAPIError('A resposta não corresponde à etapa solicitada.', { code: 'stage_operational_rules_response_mismatch', status: 409 })
const revisionConflict = () => new VimobAPIError('As regras já possuem uma revisão mais recente.', { code: 'stage_operational_rules_changed', status: 409 })
const matchesCommand = (rules: StageOperationalRules, input: UpdateStageOperationalRulesInput) => rules.stage_id === input.stage_id && rules.pipeline_id === input.pipeline_id && rules.revision > input.revision

export function useUpdateStageOperationalRules(stageId?: string) {
  const scope = useStageOperationalRulesScope(stageId)
  const mutation = useMutation({
    onMutate: (input: UpdateStageOperationalRulesInput) => scope.get(input),
    mutationFn: async (input: UpdateStageOperationalRulesInput) => {
      const operation = scope.require(input)
      const rules = await cadencesAPI.updateStageOperationalRules(input, operation.organizationId, operation.intent)
      scope.requireReconciliation(operation.captured)
      if (!matchesCommand(rules, input)) throw responseMismatch()
      const current = operation.captured.scope.access.client.getQueryData<StageOperationalRules>(stageOperationalRulesQueryKey(operation.organizationId || undefined, input.stage_id))
      if (current && current.revision > rules.revision) throw revisionConflict()
      return current && current.revision === rules.revision ? current : rules
    },
    retry: false,
    onSuccess: (rules, input, captured) => {
      if (!captured) return
      scope.requireReconciliation(captured)
      if (!matchesCommand(rules, input)) throw responseMismatch()
      const current = captured.scope.access.client.getQueryData<StageOperationalRules>(stageOperationalRulesQueryKey(captured.scope.access.organizationId || undefined, input.stage_id))
      if (current && current.revision > rules.revision) throw revisionConflict()
      captured.scope.access.client.setQueryData<StageOperationalRules>(
        stageOperationalRulesQueryKey(captured.scope.access.organizationId || undefined, input.stage_id),
        current => current && current.revision >= rules.revision ? current : rules,
      )
      if (scope.isCurrent(captured)) toast.success('Regras da etapa salvas.')
    },
    onError: (error, input, captured) => {
      if (!scope.isCurrent(captured || scope.get(input))) return
      if (
        error instanceof VimobAPIError
        && error.code === 'stage_operational_rules_changed'
      ) {
        toast.error('Outra pessoa alterou esta etapa. Seu rascunho foi preservado; carregue a versão atual para continuar.')
        return
      }
      toast.error(stageOperationalRulesErrorMessage(error, 'Não foi possível salvar as regras desta etapa.'))
    },
    onSettled: (_data, _error, input) => {
      const captured = scope.get(input)
      scope.discard(input)
      if (!captured || !scope.canReconcile(captured)) return
      const access = captured.scope.access
      void access.client.invalidateQueries({ predicate: query => {
        const key = query.queryKey
        return (key[0] === 'cadence-templates' && key.length === 1) ||
          (key[0] === 'lead-cadence-state' && key[1] === access.organizationId && key[3] === input.stage_id) ||
          (key[0] === 'attention' && key[2] === access.organizationId) ||
          (key[0] === 'home' && key[2] === access.organizationId && key[3] === access.actorId && ['focus', 'upcoming-tasks'].includes(String(key[1])))
      }, refetchType: scope.isCurrent(captured) ? 'active' : 'none' })
    },
  })
  const reset = mutation.reset
  useLayoutEffect(() => { reset() }, [reset, scope.scopeKey])
  type Options = NonNullable<Parameters<typeof mutation.mutate>[1]>
  const prepare = (input: UpdateStageOperationalRulesInput, options?: Options) => {
    const variables = scope.capture(input)
    const captured = scope.get(variables)
    const canPublish = (rules?: StageOperationalRules) => {
      if (!captured || !scope.isCurrent(captured)) return false
      const latest = captured.scope.access.client.getQueryData<StageOperationalRules>(stageOperationalRulesQueryKey(captured.scope.access.organizationId || undefined, variables.stage_id))
      return !rules || (matchesCommand(rules, variables) && (!latest || latest.revision <= rules.revision))
    }
    return { variables, captured, options: options && { ...options,
      onSuccess: (...args: Parameters<NonNullable<Options['onSuccess']>>) => { if (canPublish(args[0])) return options.onSuccess?.(...args) },
      onError: (...args: Parameters<NonNullable<Options['onError']>>) => { if (scope.isCurrent(captured)) return options.onError?.(...args) },
      onSettled: (...args: Parameters<NonNullable<Options['onSettled']>>) => { if (canPublish(args[0])) return options.onSettled?.(...args) },
    } }
  }
  return { ...mutation, scopeKey: scope.scopeKey, captureScopeGuard: scope.captureScopeGuard,
    mutate: (input: UpdateStageOperationalRulesInput, options?: Options) => {
      const prepared = prepare(input, options)
      mutation.mutate(prepared.variables, prepared.options)
    },
    mutateAsync: (input: UpdateStageOperationalRulesInput, options?: Options) => {
      const prepared = prepare(input, options)
      return mutation.mutateAsync(prepared.variables, prepared.options).then(rules => {
        if (!prepared.captured) throw responseMismatch()
        scope.requireReconciliation(prepared.captured)
        if (!matchesCommand(rules, prepared.variables)) throw responseMismatch()
        const latest = prepared.captured.scope.access.client.getQueryData<StageOperationalRules>(stageOperationalRulesQueryKey(prepared.captured.scope.access.organizationId || undefined, prepared.variables.stage_id))
        if (latest && latest.revision > rules.revision) throw revisionConflict()
        return latest && latest.revision === rules.revision ? latest : rules
      })
    },
  }
}
