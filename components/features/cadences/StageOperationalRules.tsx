'use client'

import { AlertCircle, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAttentionPolicies, useAttentionSettings } from '@/hooks/attention'
import { useStageOperationalRules } from '@/hooks/cadences'
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
  const rulesQuery = useStageOperationalRules(stageId)
  const attentionSettingsQuery = useAttentionSettings()
  const attentionPoliciesQuery = useAttentionPolicies()

  if (rulesQuery.isPending) {
    return <RulesSkeleton />
  }

  if (rulesQuery.isError || !rulesQuery.data) {
    return (
      <div
        role="alert"
        className="flex min-h-52 flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface-soft)] px-5 py-10 text-center"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-destructive/10 text-destructive">
          <AlertCircle className="h-4 w-4" strokeWidth={1.5} />
        </div>
        <p className="mt-3 text-sm font-light text-[var(--app-text-primary)]">
          Não foi possível carregar as regras desta etapa.
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
    <RulesEditor
      key={`${stageId}:${rulesQuery.data.revision}`}
      initialRules={rulesQuery.data}
      stageName={stageName}
      canEdit={canEdit}
      globalAttention={{
        engineMode: attentionSettingsQuery.data?.engineMode,
        notificationsEnabled: attentionSettingsQuery.data?.notificationsEnabled,
        isLoading: attentionSettingsQuery.isPending,
        isError: attentionSettingsQuery.isError,
      }}
      attentionPolicies={{
        policies: attentionPoliciesQuery.data ?? [],
        isLoading: attentionPoliciesQuery.isPending,
        isError: attentionPoliciesQuery.isError,
      }}
    />
  )
}
