'use client'

import {
  AlertCircle,
  BellRing,
  CircleOff,
  Eye,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

import {
  AccentIcon,
  DurationField,
  EmptyRuleState,
  OptionalDurationField,
  ToggleRow,
} from './RuleFields'
import {
  type AttentionDeadlineField,
  type GlobalAttentionState,
  type RulesDraft,
  ATTENTION_RULES,
  SELECT_ITEM_CLASS_NAME,
} from './model'

export function AttentionSection({
  draft,
  canEdit,
  globalAttention,
  onUpdateDraft,
  onUpdateDeadline,
}: {
  draft: RulesDraft
  canEdit: boolean
  globalAttention: GlobalAttentionState
  onUpdateDraft: (updater: (current: RulesDraft) => RulesDraft) => void
  onUpdateDeadline: (field: AttentionDeadlineField, minutes: number | undefined) => void
}) {
  const sourceMode = draft.attention.source_mode ?? 'inherit'

  return (
    <section
      aria-labelledby="stage-attention-title"
      className="rounded-[8px] bg-[var(--app-surface-soft)] p-3.5 text-[var(--app-text-primary)] sm:p-4"
    >
      <div className="flex min-w-0 gap-3">
        <AccentIcon icon={BellRing} />
        <div className="min-w-0">
          <h4 id="stage-attention-title" className="text-sm font-light">
            Atenção e permanência
          </h4>
          <p className="mt-1 text-xs font-light leading-[18px] text-[var(--app-text-tertiary)]">
            Mostra quando o lead precisa de ação ou de mudança de etapa.
          </p>
        </div>
      </div>

      <div
        role="radiogroup"
        aria-label="Origem das regras de atenção"
        className="mt-4 grid gap-2 sm:grid-cols-2"
      >
        <button
          type="button"
          role="radio"
          aria-checked={sourceMode === 'inherit'}
          disabled={!canEdit}
          onClick={() => (
            onUpdateDraft((current) => ({
              ...current,
              attention: { ...current.attention, source_mode: 'inherit' },
            }))
          )}
          className={cn(
            'flex min-h-16 items-start gap-2.5 rounded-[8px] p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
            sourceMode === 'inherit'
              ? 'bg-primary/10'
              : 'bg-[var(--app-surface-solid)] hover:bg-[var(--app-surface-hover)]',
          )}
        >
          <span
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] transition-colors',
              sourceMode === 'inherit'
                ? 'bg-primary text-primary-foreground'
                : 'bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]',
            )}
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-light text-[var(--app-text-primary)]">
              Herdar do pipeline
            </span>
            <span className="mt-0.5 block text-[10px] font-light leading-[15px] text-[var(--app-text-tertiary)]">
              Usa, por tipo, a regra mais específica da etapa, do pipeline ou da organização.
            </span>
          </span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={sourceMode === 'local'}
          disabled={!canEdit}
          onClick={() => (
            onUpdateDraft((current) => ({
              ...current,
              attention: { ...current.attention, source_mode: 'local' },
            }))
          )}
          className={cn(
            'flex min-h-16 items-start gap-2.5 rounded-[8px] p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
            sourceMode === 'local'
              ? 'bg-primary/10'
              : 'bg-[var(--app-surface-solid)] hover:bg-[var(--app-surface-hover)]',
          )}
        >
          <span
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] transition-colors',
              sourceMode === 'local'
                ? 'bg-primary text-primary-foreground'
                : 'bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]',
            )}
          >
            <BellRing className="h-3.5 w-3.5" strokeWidth={1.5} />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-light text-[var(--app-text-primary)]">
              Configurar nesta etapa
            </span>
            <span className="mt-0.5 block text-[10px] font-light leading-[15px] text-[var(--app-text-tertiary)]">
              Substitui a herança e permite definir ou bloquear cada tipo de alerta aqui.
            </span>
          </span>
        </button>
      </div>

      {sourceMode === 'inherit' ? (
        <>
          <div className="mt-3 flex items-start gap-2 rounded-[8px] bg-[var(--app-surface-solid)] px-3 py-2.5">
            <ShieldCheck
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
              strokeWidth={1.5}
            />
            <div className="min-w-0">
              <p className="text-[11px] font-light text-[var(--app-text-primary)]">
                Herança aplicada automaticamente
              </p>
              <p className="mt-0.5 text-[10px] font-light leading-[15px] text-[var(--app-text-tertiary)]">
                Os controles locais ficam protegidos. A prévia abaixo mostra qual política efetiva será usada em cada tipo de atenção.
              </p>
            </div>
          </div>
          <GlobalAttentionNotice
            sourceMode={sourceMode}
            localMode={draft.attention.mode}
            globalAttention={globalAttention}
          />
        </>
      ) : (
        <>
          <div className="mt-3 flex flex-col gap-2.5 rounded-[8px] bg-[var(--app-surface-solid)] p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-light text-[var(--app-text-primary)]">
                Comportamento local
              </p>
              <p className="mt-0.5 text-[10px] font-light leading-[15px] text-[var(--app-text-tertiary)]">
                Este modo vale somente para esta etapa.
              </p>
            </div>
            <div className="w-full sm:w-44">
              <Label htmlFor="stage-attention-mode" className="sr-only">
                Modo das regras de atenção
              </Label>
              <Select
                value={draft.attention.mode}
                disabled={!canEdit}
                onValueChange={(mode: RulesDraft['attention']['mode']) => (
                  onUpdateDraft((current) => ({
                    ...current,
                    attention: { ...current.attention, mode },
                  }))
                )}
              >
                <SelectTrigger
                  id="stage-attention-mode"
                  className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1 shadow-none">
                  <SelectItem value="disabled" className={SELECT_ITEM_CLASS_NAME}>
                    Desativada
                  </SelectItem>
                  <SelectItem value="shadow" className={SELECT_ITEM_CLASS_NAME}>
                    Observação
                  </SelectItem>
                  <SelectItem value="enabled" className={SELECT_ITEM_CLASS_NAME}>
                    Ativa
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {draft.attention.mode === 'disabled' ? (
            <EmptyRuleState
              className="mt-3"
              icon={CircleOff}
              title="Atenção silenciada nesta etapa"
              description="Políticas da organização, do pipeline e da própria etapa não geram alertas aqui. A cadência continua independente e pode seguir criando tarefas."
            />
          ) : (
            <>
              {draft.attention.mode === 'shadow' && (
                <div className="mt-3 flex items-start gap-2 rounded-[8px] bg-warning/10 px-3 py-2.5">
                  <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={1.5} />
                  <p className="text-[11px] font-light leading-[17px] text-[var(--app-text-secondary)]">
                    Modo observação: acompanha os prazos sem exibir cobranças em
                    Prioridades e atenções. Use para calibrar as regras antes de ativá-las.
                  </p>
                </div>
              )}
              {draft.attention.mode === 'enabled' && (
                <div className="mt-3 flex items-start gap-2 rounded-[8px] bg-success/10 px-3 py-2.5">
                  <ShieldCheck
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success"
                    strokeWidth={1.5}
                  />
                  <p className="text-[11px] font-light leading-[17px] text-[var(--app-text-secondary)]">
                    Ativação segura: leads que já estão nesta etapa não recebem cobrança
                    retroativa. A regra começa numa nova entrada na etapa ou num novo ciclo
                    de responsável.
                  </p>
                </div>
              )}

              <GlobalAttentionNotice
                sourceMode={sourceMode}
                localMode={draft.attention.mode}
                globalAttention={globalAttention}
              />

              <div className="mt-4 space-y-2">
                {ATTENTION_RULES.map((rule) => (
                  <DeadlineRule
                    key={rule.field}
                    {...rule}
                    minutes={draft.attention[rule.field]}
                    disabled={!canEdit}
                    showInheritedBlockCopy
                    onChange={(minutes) => onUpdateDeadline(rule.field, minutes)}
                  />
                ))}
              </div>

              <div className="mt-3 grid gap-3 rounded-[8px] bg-[var(--app-surface-solid)] p-3 sm:grid-cols-2">
                <DurationField
                  id="stage-attention-warning"
                  label="Avisar antes do limite"
                  minutes={draft.attention.warning_minutes}
                  minMinutes={0}
                  disabled={!canEdit}
                  onChange={(warningMinutes) => (
                    onUpdateDraft((current) => ({
                      ...current,
                      attention: {
                        ...current.attention,
                        warning_minutes: warningMinutes,
                      },
                    }))
                  )}
                />
                <OptionalDurationField
                  id="stage-attention-escalation"
                  label="Escalar após o limite"
                  minutes={draft.attention.escalation_minutes}
                  defaultMinutes={1_440}
                  minMinutes={1}
                  disabled={!canEdit}
                  onChange={(escalationMinutes) => (
                    onUpdateDraft((current) => ({
                      ...current,
                      attention: {
                        ...current.attention,
                        escalation_minutes: escalationMinutes,
                      },
                    }))
                  )}
                />
              </div>

              <div className="mt-3">
                <ToggleRow
                  id="stage-business-hours"
                  title="Contar somente horário comercial"
                  description="Pausa estes relógios fora da jornada configurada para a organização."
                  checked={draft.attention.business_hours_only}
                  disabled={!canEdit}
                  onCheckedChange={(businessHoursOnly) => (
                    onUpdateDraft((current) => ({
                      ...current,
                      attention: {
                        ...current.attention,
                        business_hours_only: businessHoursOnly,
                      },
                    }))
                  )}
                />
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

function GlobalAttentionNotice({
  sourceMode,
  localMode,
  globalAttention,
}: {
  sourceMode: RulesDraft['attention']['source_mode']
  localMode: RulesDraft['attention']['mode']
  globalAttention: GlobalAttentionState
}) {
  if (sourceMode === 'local' && localMode === 'disabled') return null

  let title: string | null = null
  let description = ''
  let Icon: LucideIcon = AlertCircle
  let loading = false
  let tone: 'neutral' | 'danger' | 'warning' = 'neutral'

  if (globalAttention.isLoading) {
    title = 'Verificando o motor global'
    description = sourceMode === 'inherit'
      ? 'As políticas herdadas dependem das configurações operacionais da organização.'
      : 'A regra local será combinada com as configurações operacionais da organização.'
    Icon = Loader2
    loading = true
  } else if (globalAttention.isError) {
    title = 'Modo global não confirmado'
    description = sourceMode === 'inherit'
      ? 'Não foi possível confirmar se as políticas herdadas estão liberadas pelo motor global.'
      : 'A regra local pode ser salva, mas confirme as configurações da organização antes de ativá-la.'
    tone = 'danger'
  } else if (globalAttention.engineMode === 'disabled') {
    title = 'Motor global desativado'
    description = sourceMode === 'inherit'
      ? 'As políticas continuam configuradas, mas não criam prioridades enquanto o motor estiver desligado.'
      : 'A regra local pode ser salva, mas não cria prioridades enquanto o motor estiver desligado.'
    tone = 'warning'
  } else if (globalAttention.engineMode === 'shadow') {
    title = 'Motor global em observação'
    description = 'A configuração global prevalece: os prazos ficam em observação, sem notificações nem cobrança ativa.'
    Icon = Eye
    tone = 'warning'
  } else if (
    (sourceMode === 'inherit' || localMode === 'enabled')
    && globalAttention.engineMode === 'enabled'
    && globalAttention.notificationsEnabled === false
  ) {
    title = 'Notificações globais desativadas'
    description = 'Os itens continuam ativos em Prioridades e atenções, mas não enviam notificações.'
    Icon = BellRing
    tone = 'warning'
  }

  if (!title) return null

  return (
    <div
      role={globalAttention.isError || globalAttention.engineMode === 'disabled' ? 'alert' : 'status'}
      aria-live="polite"
      className="mt-3 flex items-start gap-2 rounded-[8px] bg-[var(--app-surface-solid)] px-3 py-2.5"
    >
      <Icon
        className={cn(
          'mt-0.5 h-3.5 w-3.5 shrink-0',
          tone === 'danger' && 'text-destructive',
          tone === 'warning' && 'text-warning',
          tone === 'neutral' && 'text-[var(--app-text-secondary)]',
          loading && 'animate-spin',
        )}
        strokeWidth={1.5}
      />
      <div className="min-w-0">
        <p className="text-[11px] font-light text-[var(--app-text-primary)]">{title}</p>
        <p className="mt-0.5 text-[10px] font-light leading-[15px] text-[var(--app-text-tertiary)]">
          {description}
        </p>
      </div>
    </div>
  )
}

function DeadlineRule({
  field,
  title,
  description,
  defaultMinutes,
  icon: Icon,
  minutes,
  disabled,
  showInheritedBlockCopy = false,
  onChange,
}: {
  field: AttentionDeadlineField
  title: string
  description: string
  defaultMinutes: number
  icon: LucideIcon
  minutes: number | undefined
  disabled: boolean
  showInheritedBlockCopy?: boolean
  onChange: (minutes: number | undefined) => void
}) {
  const enabled = minutes != null

  return (
    <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
            <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <Label
              htmlFor={`attention-${field}`}
              className="text-xs font-light text-[var(--app-text-primary)]"
            >
              {title}
            </Label>
            <p className="mt-0.5 text-[11px] font-light leading-[17px] text-[var(--app-text-tertiary)]">
              {description}
            </p>
          </div>
        </div>
        <Switch
          id={`attention-${field}`}
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked ? defaultMinutes : undefined)}
          aria-label={`${enabled ? 'Desativar' : 'Ativar'} regra de ${title.toLowerCase()}`}
        />
      </div>

      {enabled && (
        <div className="mt-3 pl-0 sm:pl-9">
          <DurationField
            id={`attention-${field}-duration`}
            label="Limite"
            minutes={minutes}
            minMinutes={1}
            disabled={disabled}
            onChange={onChange}
          />
        </div>
      )}

      {!enabled && showInheritedBlockCopy && (
        <p className="mt-2 pl-0 text-[10px] font-light leading-[15px] text-[var(--app-text-tertiary)] sm:pl-9">
          Sem limite local: bloqueia a política herdada deste tipo nesta etapa.
        </p>
      )}
    </div>
  )
}
