import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  CircleOff,
  Eye,
  ShieldCheck,
} from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { AccentIcon, EmptyRuleState, LifecycleLine } from './RuleFields'
import {
  type AttentionPoliciesState,
  type GlobalAttentionState,
  type RulesDraft,
  ATTENTION_POLICY_SOURCE_LABELS,
  ATTENTION_RULES,
  formatDuration,
  getAttentionPreviewCopy,
  policySuppressesInherited,
  resolveEffectiveAttentionPolicies,
  taskTypeMeta,
} from './model'

export function BrokerPreview({
  draft,
  stageName,
  globalAttention,
  attentionPolicies,
}: {
  draft: RulesDraft
  stageName: string
  globalAttention: GlobalAttentionState
  attentionPolicies: AttentionPoliciesState
}) {
  const sourceMode = draft.attention.source_mode ?? 'inherit'
  const tasks = draft.cadence.enabled ? draft.cadence.tasks : []
  const firstTask = tasks[0]
  const enabledAttentionRules = ATTENTION_RULES.filter(
    (rule) => draft.attention[rule.field] != null,
  )
  const effectivePolicies = resolveEffectiveAttentionPolicies(
    attentionPolicies.policies,
    draft.stage_id,
    draft.pipeline_id,
  )
  const hasLocalAttention = draft.attention.mode !== 'disabled' && enabledAttentionRules.length > 0
  const noObligations = tasks.length === 0 && sourceMode === 'local' && !hasLocalAttention

  const attentionSummary = enabledAttentionRules
    .slice(0, 2)
    .map((rule) => `${rule.title}: ${formatDuration(draft.attention[rule.field])}`)
    .join(' · ')

  return (
    <section
      aria-labelledby="broker-preview-title"
      className="rounded-[8px] bg-[var(--app-surface-soft)] p-3.5 text-[var(--app-text-primary)] sm:p-4"
    >
      <div className="flex items-start gap-3">
        <AccentIcon icon={Eye} />
        <div className="min-w-0">
          <h4 id="broker-preview-title" className="text-sm font-light">
            O que o corretor verá
          </h4>
          <p className="mt-1 text-xs font-light leading-[18px] text-[var(--app-text-tertiary)]">
            Prévia das obrigações para novos ciclos em {stageName}.
          </p>
        </div>
      </div>

      {noObligations ? (
        <EmptyRuleState
          className="mt-4"
          icon={CircleOff}
          title={draft.attention.mode === 'disabled'
            ? 'Atenção silenciada nesta etapa'
            : 'Nenhum limite local ativo'}
          description={draft.attention.mode === 'disabled'
            ? 'Esta etapa não gera alertas herdados nem locais. A cadência continua independente e pode ser ativada separadamente.'
            : 'Sem limites locais, os tipos herdados ficam bloqueados nesta etapa. A cadência continua independente.'}
        />
      ) : (
        <div className="mt-4 rounded-[8px] bg-[var(--app-surface-solid)] p-3">
          {firstTask && (
            <div className="group flex items-center gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-solid)] text-[var(--app-text-secondary)] transition-colors group-hover:bg-[var(--app-surface-hover)] group-hover:text-[var(--app-text-primary)]">
                {(() => {
                  const Icon = taskTypeMeta(firstTask.type).icon
                  return <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                })()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-light">
                  {firstTask.title.trim() || 'Tarefa sem título'}
                </p>
                <p className="mt-0.5 text-[11px] font-light text-[var(--app-text-tertiary)]">
                  Prazo: {formatDuration(firstTask.due_minutes)}
                  {firstTask.outcome_required ? ' · resultado obrigatório' : ''}
                </p>
              </div>
              <span className="rounded-[4px] bg-primary/10 px-2 py-1 text-[10px] font-light text-primary">
                Próxima ação
              </span>
            </div>
          )}

          {sourceMode === 'inherit' && (
            <InheritedAttentionPreview
              className={cn(firstTask && 'mt-3')}
              policies={effectivePolicies}
              isLoading={attentionPolicies.isLoading}
              isError={attentionPolicies.isError}
              globalAttention={globalAttention}
              localMode={draft.attention.mode}
            />
          )}

          {sourceMode === 'local' && hasLocalAttention && (
            <div className={cn('flex items-start gap-2.5 px-1', firstTask && 'mt-3')}>
              <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--app-text-secondary)]" strokeWidth={1.5} />
              <div>
                <p className="text-[11px] font-light text-[var(--app-text-secondary)]">
                  {getAttentionPreviewCopy(sourceMode, draft.attention.mode, globalAttention)}
                </p>
                <p className="mt-0.5 text-[10px] font-light leading-[15px] text-[var(--app-text-tertiary)]">
                  {attentionSummary}
                  {enabledAttentionRules.length > 2
                    ? ` · +${enabledAttentionRules.length - 2} regras`
                    : ''}
                </p>
              </div>
            </div>
          )}

          {sourceMode === 'local' && !hasLocalAttention && firstTask && (
            <div className="mt-3 flex items-start gap-2.5 px-1">
              <CircleOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" strokeWidth={1.5} />
              <p className="text-[11px] font-light leading-[17px] text-[var(--app-text-tertiary)]">
                {draft.attention.mode === 'disabled'
                  ? 'A atenção está silenciada nesta etapa; somente a cadência acima continua ativa.'
                  : 'Nenhum limite local está ativo; regras herdadas desses tipos ficam bloqueadas nesta etapa.'}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <LifecycleLine
          icon={ShieldCheck}
          text="O lead continua livre para mudar de etapa."
        />
        <LifecycleLine
          icon={CheckCircle2}
          text="Mover, ganhar ou perder encerra as pendências abertas."
        />
      </div>
    </section>
  )
}

function InheritedAttentionPreview({
  className,
  policies,
  isLoading,
  isError,
  globalAttention,
  localMode,
}: {
  className?: string
  policies: ReturnType<typeof resolveEffectiveAttentionPolicies>
  isLoading: boolean
  isError: boolean
  globalAttention: GlobalAttentionState
  localMode: RulesDraft['attention']['mode']
}) {
  return (
    <div className={className}>
      <div className="flex items-start gap-2.5 px-1">
        <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--app-text-secondary)]" strokeWidth={1.5} />
        <div className="min-w-0">
          <p className="text-[11px] font-light text-[var(--app-text-secondary)]">
            {getAttentionPreviewCopy('inherit', localMode, globalAttention)}
          </p>
          <p className="mt-0.5 text-[10px] font-light leading-[15px] text-[var(--app-text-tertiary)]">
            Prioridade: política desta etapa, depois do pipeline e, por último, da organização.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Carregando políticas herdadas">
          {ATTENTION_RULES.map((rule) => (
            <Skeleton key={rule.field} className="h-[68px] rounded-[8px]" />
          ))}
        </div>
      ) : isError ? (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-[8px] bg-[var(--app-surface-soft)] px-3 py-2.5">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" strokeWidth={1.5} />
          <p className="text-[10px] font-light leading-[15px] text-[var(--app-text-tertiary)]">
            Não foi possível carregar as políticas da organização. A origem herdada permanece salva, mas esta prévia pode estar incompleta.
          </p>
        </div>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {policies.map(({ rule, effective }) => {
            const Icon = rule.icon
            const inheritedBlocked = effective
              ? policySuppressesInherited(effective.policy)
              : false
            return (
              <div
                key={rule.policyType}
                className="flex min-h-[68px] items-start gap-2.5 rounded-[8px] bg-[var(--app-surface-soft)] p-2.5"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-solid)] text-[var(--app-text-secondary)]">
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[11px] font-light text-[var(--app-text-primary)]">
                      {rule.title}
                    </p>
                    {effective && (
                      <>
                        <span className="rounded-[4px] bg-[var(--app-surface-solid)] px-1.5 py-0.5 text-[9px] font-light text-[var(--app-text-tertiary)]">
                          {ATTENTION_POLICY_SOURCE_LABELS[effective.source]}
                        </span>
                        <span className={cn(
                          'rounded-[4px] px-1.5 py-0.5 text-[9px] font-light',
                          inheritedBlocked
                            ? 'bg-[var(--app-surface-solid)] text-[var(--app-text-tertiary)]'
                            : effective.policy.status === 'shadow'
                            ? 'bg-warning/10 text-warning'
                            : 'bg-success/10 text-success',
                        )}>
                          {inheritedBlocked
                            ? 'Bloqueada'
                            : effective.policy.status === 'shadow'
                              ? 'Observação'
                              : 'Ativa'}
                        </span>
                      </>
                    )}
                  </div>
                  {effective ? (
                    <>
                      <p className="mt-0.5 truncate text-[10px] font-light text-[var(--app-text-secondary)]">
                        {effective.policy.name}
                      </p>
                      {inheritedBlocked ? (
                        <p className="mt-0.5 text-[9px] font-light leading-[14px] text-[var(--app-text-tertiary)]">
                          Bloqueia a política mais ampla deste tipo neste escopo.
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[9px] font-light leading-[14px] text-[var(--app-text-tertiary)]">
                          Limite: {formatDuration(effective.policy.thresholdMinutes)}
                          {effective.policy.warningMinutes > 0
                            ? ` · aviso ${formatDuration(effective.policy.warningMinutes)} antes`
                            : ' · sem aviso antecipado'}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-0.5 text-[10px] font-light leading-[15px] text-[var(--app-text-tertiary)]">
                      Nenhuma política aplicável.
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
