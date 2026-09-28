'use client'

import { AlertCircle, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAttentionPolicies, useAttentionSettings } from '@/hooks/attention'
import { useStageOperationalRules } from '@/hooks/cadences'
import { stageOperationalRulesErrorMessage } from '@/hooks/cadences/use-stage-operational-rules'
import { useUserPermissions } from '@/hooks/use-user-permissions'
import { isLocalReadOnlyMode } from '@/lib/local-read-only'
import { cn } from '@/lib/utils'

import { RulesEditor } from './stage-operational-rules/RulesEditor'
import { RulesSkeleton } from './stage-operational-rules/RuleFields'

interface StageOperationalRulesProps {
  stageId: string
  stageName: string
  canEdit: boolean
}

export function StageOperationalRules({
  stageId,
  stageName,
  canEdit,
}: StageOperationalRulesProps) {
  const { hasPermission } = useUserPermissions()
  const canViewAttention = hasPermission('attention_view')
  const rulesQuery = useStageOperationalRules(stageId)
  const attentionSettingsQuery = useAttentionSettings({ enabled: canViewAttention })
  const attentionPoliciesQuery = useAttentionPolicies({ enabled: canViewAttention })
  const localReadOnly = isLocalReadOnlyMode()

  if (rulesQuery.isPending) {
    return <RulesSkeleton />
  }

  if (!rulesQuery.data) {
    return (
      <div
        role="alert"
        className="flex min-h-52 flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface-soft)] px-5 py-10 text-center"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-destructive/10 text-destructive">
          <AlertCircle className="h-4 w-4" strokeWidth={1.5} />
        </div>
        <p className="mt-3 text-sm font-light text-[var(--app-text-primary)]">
          {stageOperationalRulesErrorMessage(rulesQuery.error, 'Não foi possível carregar as regras desta etapa.')}
        </p>
        <p className="mt-1 max-w-sm text-xs font-light leading-[18px] text-[var(--app-text-tertiary)]">
          Nada foi alterado. Verifique a conexão com a API e tente novamente.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-4 rounded-[6px] bg-[var(--app-surface-solid)] text-xs font-light text-[var(--app-text-primary)] shadow-none hover:bg-[var(--app-surface-hover)]"
          onClick={() => rulesQuery.refetch()}
          disabled={rulesQuery.isFetching}
        >
          <RefreshCw
            className={cn('mr-2 h-3.5 w-3.5', rulesQuery.isFetching && 'animate-spin')}
            strokeWidth={1.5}
          />
          Tentar novamente
        </Button>
      </div>
    )
  }

  return (
    <>
      {localReadOnly && canEdit && (
        <p role="status" className="mb-3 rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2 text-xs text-[var(--app-text-secondary)]">
          Ambiente local de consulta: a edição de cadências está bloqueada.
        </p>
      )}
      <RulesEditor
        key={stageId}
        initialRules={rulesQuery.data}
        stageName={stageName}
        canEdit={canEdit && !localReadOnly}
        onReloadCurrent={async () => {
          const result = await rulesQuery.refetch()
          if (result.isError || !result.data) {
            throw result.error || new Error('Não foi possível carregar a versão atual.')
          }
          return result.data
        }}
        globalAttention={{
          engineMode: canViewAttention ? attentionSettingsQuery.data?.engineMode : undefined,
          notificationsEnabled: canViewAttention ? attentionSettingsQuery.data?.notificationsEnabled : undefined,
          isLoading: canViewAttention && attentionSettingsQuery.isPending,
          isError: !canViewAttention || attentionSettingsQuery.isError,
        }}
        attentionPolicies={{
          policies: canViewAttention ? attentionPoliciesQuery.data ?? [] : [],
          isLoading: canViewAttention && attentionPoliciesQuery.isPending,
          isError: !canViewAttention || attentionPoliciesQuery.isError,
        }}
      />
    </>
  )
}
