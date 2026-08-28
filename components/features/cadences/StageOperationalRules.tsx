'use client'

import { type FormEvent, useState } from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleOff,
  Clock3,
  Eye,
  FileText,
  Loader2,
  Lock,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  TimerReset,
  Trash2,
  UserRoundCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  useStageOperationalRules,
  useUpdateStageOperationalRules,
} from '@/hooks/cadences'
import { useAttentionPolicies, useAttentionSettings } from '@/hooks/attention'
import type {
  AttentionEngineMode,
  AttentionPolicy,
  AttentionPolicyType,
} from '@/lib/api/attention'
import type {
  StageOperationalCadenceTask,
  StageOperationalRules as StageOperationalRulesContract,
  UpdateStageOperationalRulesInput,
} from '@/lib/api/cadences'
import { VimobAPIError } from '@/lib/api/vimob-client'
import { updateStageOperationalRulesInputSchema } from '@/lib/validation/cadences'
import { cn } from '@/lib/utils'

type TaskType = StageOperationalCadenceTask['type']
type DurationUnit = 'hours' | 'days'
type AttentionDeadlineField =
  | 'first_outreach_minutes'
  | 'first_effective_contact_minutes'
  | 'stage_inactivity_minutes'
  | 'stage_max_age_minutes'

const MAX_OPERATIONAL_RULE_MINUTES = 5 * 365 * 24 * 60

type GlobalAttentionState = {
  engineMode?: AttentionEngineMode
  notificationsEnabled?: boolean
  isLoading: boolean
  isError: boolean
}

type AttentionPoliciesState = {
  policies: AttentionPolicy[]
  isLoading: boolean
  isError: boolean
}

type EffectiveAttentionPolicy = {
  policy: AttentionPolicy
  source: 'stage' | 'pipeline' | 'organization'
}

type DraftTask = StageOperationalCadenceTask & {
  clientKey: string
}

type RulesDraft = Omit<StageOperationalRulesContract, 'cadence'> & {
  cadence: Omit<StageOperationalRulesContract['cadence'], 'tasks'> & {
    tasks: DraftTask[]
  }
}

const TASK_TYPES: Array<{
  value: TaskType
  label: string
  icon: LucideIcon
}> = [
  { value: 'call', label: 'Ligação', icon: Phone },
  { value: 'message', label: 'Mensagem', icon: MessageCircle },
  { value: 'email', label: 'E-mail', icon: Mail },
  { value: 'note', label: 'Anotação', icon: FileText },
]

const SELECT_ITEM_CLASS_NAME =
  'rounded-[4px] text-xs font-light focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]'

const ATTENTION_RULES: Array<{
  field: AttentionDeadlineField
  policyType: AttentionPolicyType
  title: string
  description: string
  defaultMinutes: number
  icon: LucideIcon
}> = [
  {
    field: 'first_outreach_minutes',
    policyType: 'first_contact',
    title: 'Primeira tentativa',
    description: 'Tempo para o corretor iniciar o primeiro contato.',
    defaultMinutes: 60,
    icon: Phone,
  },
  {
    field: 'first_effective_contact_minutes',
    policyType: 'first_effective_contact',
    title: 'Contato efetivo',
    description: 'Tempo para registrar uma resposta ou contato atendido.',
    defaultMinutes: 1_440,
    icon: UserRoundCheck,
  },
  {
    field: 'stage_inactivity_minutes',
    policyType: 'stage_inactivity',
    title: 'Inatividade na etapa',
    description: 'Alerta quando nenhuma atividade válida acontece.',
    defaultMinutes: 2_880,
    icon: TimerReset,
  },
  {
    field: 'stage_max_age_minutes',
    policyType: 'stage_age',
    title: 'Tempo máximo na etapa',
    description: 'Limite total nesta coluna, mesmo com novas atividades.',
    defaultMinutes: 10_080,
    icon: Clock3,
  },
]

const ATTENTION_POLICY_SOURCE_LABELS: Record<EffectiveAttentionPolicy['source'], string> = {
  stage: 'Esta etapa',
  pipeline: 'Pipeline',
  organization: 'Organização',
}

function getApplicablePolicySource(
  policy: AttentionPolicy,
  stageId: string,
  pipelineId: string,
): EffectiveAttentionPolicy['source'] | null {
  if (policy.stageId) {
    return policy.stageId === stageId ? 'stage' : null
  }
  if (policy.pipelineId) {
    return policy.pipelineId === pipelineId ? 'pipeline' : null
  }
  return 'organization'
}

function sourceRank(source: EffectiveAttentionPolicy['source']) {
  if (source === 'stage') return 3
  if (source === 'pipeline') return 2
  return 1
}

function policySuppressesInherited(policy: AttentionPolicy) {
  const disabledOverride = policy.config?.disabled_override
  return policy.status === 'paused'
    && (disabledOverride === true || disabledOverride === 'true')
}

function resolveEffectiveAttentionPolicies(
  policies: AttentionPolicy[],
  stageId: string,
  pipelineId: string,
) {
  const applicablePolicies = policies
    .filter((policy) => (
      policy.status === 'enabled'
      || policy.status === 'shadow'
      || policySuppressesInherited(policy)
    ))
    .map((policy) => {
      const source = getApplicablePolicySource(policy, stageId, pipelineId)
      return source ? { policy, source } : null
    })
    .filter((value): value is EffectiveAttentionPolicy => value != null)

  return ATTENTION_RULES.map((rule) => {
    const effective = applicablePolicies
      .filter(({ policy }) => policy.policyType === rule.policyType)
      .sort((left, right) => (
        sourceRank(right.source) - sourceRank(left.source)
        || right.policy.version - left.policy.version
        || Date.parse(right.policy.updatedAt) - Date.parse(left.policy.updatedAt)
        || right.policy.id.localeCompare(left.policy.id)
      ))[0]

    return { rule, effective }
  })
}

function taskTypeMeta(type: TaskType) {
  return TASK_TYPES.find((item) => item.value === type) || TASK_TYPES[0]
}

function toDraft(rules: StageOperationalRulesContract): RulesDraft {
  return {
    ...rules,
    attention: {
      ...rules.attention,
      source_mode: rules.attention.source_mode ?? 'inherit',
    },
    cadence: {
      ...rules.cadence,
      tasks: [...rules.cadence.tasks]
        .sort((left, right) => left.position - right.position)
        .map((task, index) => ({
          ...task,
          position: index,
          clientKey: task.id || `persisted-${index}`,
        })),
    },
  }
}

function toPayload(draft: RulesDraft): UpdateStageOperationalRulesInput {
  return {
    stage_id: draft.stage_id,
    pipeline_id: draft.pipeline_id,
    revision: draft.revision,
    cadence: {
      enabled: draft.cadence.enabled,
      tasks: draft.cadence.tasks.map((task, position) => ({
        ...(task.id ? { id: task.id } : {}),
        position,
        type: task.type,
        title: task.title,
        ...(task.description ? { description: task.description } : {}),
        ...(task.observation ? { observation: task.observation } : {}),
        ...(task.recommended_message
          ? { recommended_message: task.recommended_message }
          : {}),
        due_minutes: task.due_minutes,
        ...(task.warning_minutes != null
          ? { warning_minutes: task.warning_minutes }
          : {}),
        is_required: task.is_required,
        outcome_required: task.outcome_required,
      })),
    },
    attention: { ...draft.attention },
    lifecycle: { ...draft.lifecycle },
  }
}

function createTask(position: number, previousDueMinutes?: number): DraftTask {
  return {
    clientKey: `new-${Date.now()}-${position}`,
    position,
    type: 'call',
    title: '',
    due_minutes: previousDueMinutes == null
      ? 60
      : Math.min(MAX_OPERATIONAL_RULE_MINUTES, previousDueMinutes + 1_440),
    warning_minutes: 30,
    is_required: true,
    outcome_required: true,
  }
}

function formatDuration(minutes: number | undefined) {
  if (minutes == null) return 'Sem limite'
  if (minutes === 0) return 'Imediatamente'
  if (minutes % 1_440 === 0) {
    const days = minutes / 1_440
    return `${days} ${days === 1 ? 'dia' : 'dias'}`
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return `${hours} ${hours === 1 ? 'hora' : 'horas'}`
  }
  return `${minutes} min`
}

function durationUnitFor(minutes: number) {
  return minutes >= 1_440 && minutes % 1_440 === 0 ? 'days' : 'hours'
}

function formatDurationValue(minutes: number, unit: DurationUnit) {
  const divisor = unit === 'days' ? 1_440 : 60
  return Number((minutes / divisor).toFixed(2))
}

function normalizePositions(tasks: DraftTask[]) {
  return tasks.map((task, position) => ({ ...task, position }))
}

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

function RulesEditor({
  initialRules,
  stageName,
  canEdit,
  globalAttention,
  attentionPolicies,
}: {
  initialRules: StageOperationalRulesContract
  stageName: string
  canEdit: boolean
  globalAttention: GlobalAttentionState
  attentionPolicies: AttentionPoliciesState
}) {
  const [draft, setDraft] = useState<RulesDraft>(() => toDraft(initialRules))
  const [expandedTaskKey, setExpandedTaskKey] = useState<string | null>(
    draft.cadence.tasks[0]?.clientKey || null,
  )
  const [isDirty, setIsDirty] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [disableCadenceConfirmationOpen, setDisableCadenceConfirmationOpen] = useState(false)
  const updateRules = useUpdateStageOperationalRules(initialRules.stage_id)

  const updateDraft = (updater: (current: RulesDraft) => RulesDraft) => {
    setDraft((current) => updater(current))
    setIsDirty(true)
    setFormError(null)
  }

  const handleCadenceToggle = (enabled: boolean) => {
    if (!enabled && draft.cadence.tasks.length > 0) {
      setDisableCadenceConfirmationOpen(true)
      return
    }

    updateDraft((current) => ({
      ...current,
      cadence: { ...current.cadence, enabled },
    }))
  }

  const confirmCadenceDisable = () => {
    updateDraft((current) => ({
      ...current,
      cadence: { ...current.cadence, enabled: false },
    }))
    setDisableCadenceConfirmationOpen(false)
  }

  const addTask = () => {
    const tasks = draft.cadence.tasks
    const task = createTask(tasks.length, tasks.at(-1)?.due_minutes)
    updateDraft((current) => ({
      ...current,
      cadence: {
        ...current.cadence,
        tasks: [...current.cadence.tasks, task],
      },
    }))
    setExpandedTaskKey(task.clientKey)
  }

  const updateTask = (clientKey: string, patch: Partial<DraftTask>) => {
    updateDraft((current) => ({
      ...current,
      cadence: {
        ...current.cadence,
        tasks: current.cadence.tasks.map((task) => (
          task.clientKey === clientKey ? { ...task, ...patch } : task
        )),
      },
    }))
  }

  const removeTask = (clientKey: string) => {
    updateDraft((current) => ({
      ...current,
      cadence: {
        ...current.cadence,
        tasks: normalizePositions(
          current.cadence.tasks.filter((task) => task.clientKey !== clientKey),
        ),
      },
    }))
    if (expandedTaskKey === clientKey) setExpandedTaskKey(null)
  }

  const moveTask = (clientKey: string, direction: -1 | 1) => {
    updateDraft((current) => {
      const tasks = [...current.cadence.tasks]
      const currentIndex = tasks.findIndex((task) => task.clientKey === clientKey)
      const nextIndex = currentIndex + direction
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= tasks.length) return current

      const [task] = tasks.splice(currentIndex, 1)
      tasks.splice(nextIndex, 0, task)
      return {
        ...current,
        cadence: {
          ...current.cadence,
          tasks: normalizePositions(tasks),
        },
      }
    })
  }

  const updateAttentionDeadline = (
    field: AttentionDeadlineField,
    minutes: number | undefined,
  ) => {
    updateDraft((current) => ({
      ...current,
      attention: {
        ...current.attention,
        [field]: minutes,
        ...(minutes != null
          ? {
              warning_minutes: current.attention.warning_minutes === 0
                ? 0
                : Math.min(current.attention.warning_minutes, Math.max(0, minutes - 1)),
            }
          : {}),
      },
    }))
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const payload = toPayload(draft)
    const validation = updateStageOperationalRulesInputSchema.safeParse(payload)

    if (!validation.success) {
      const issue = validation.error.issues[0]
      const message = issue?.message || 'Revise os campos antes de salvar.'
      setFormError(message)
      toast.error(message)
      return
    }

    try {
      const savedRules = await updateRules.mutateAsync(validation.data)
      const savedDraft = toDraft(savedRules)
      setDraft(savedDraft)
      setExpandedTaskKey(savedDraft.cadence.tasks[0]?.clientKey || null)
      setIsDirty(false)
      setFormError(null)
    } catch (error) {
      if (
        error instanceof VimobAPIError
        && error.code === 'stage_operational_rules_changed'
      ) {
        setFormError('Outra pessoa alterou esta etapa. A versão mais recente foi recarregada.')
        return
      }
      setFormError(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar as regras desta etapa.',
      )
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-light text-[var(--app-text-primary)]">
              Regras da etapa
            </h3>
            <p className="mt-1 text-xs font-light leading-[18px] text-[var(--app-text-tertiary)]">
              Defina o que precisa ser feito e quando esta coluna exige atenção.
            </p>
          </div>
          {!canEdit && (
            <Badge
              variant="secondary"
              className="h-7 gap-1.5 rounded-[4px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[11px] font-light"
            >
              <Lock className="h-3 w-3" strokeWidth={1.5} />
              Somente visualização
            </Badge>
          )}
        </div>

        <CadenceSection
          draft={draft}
          canEdit={canEdit}
          expandedTaskKey={expandedTaskKey}
          onExpandedTaskChange={setExpandedTaskKey}
          onCadenceToggle={handleCadenceToggle}
          onAddTask={addTask}
          onUpdateTask={updateTask}
          onRemoveTask={removeTask}
          onMoveTask={moveTask}
        />

        <AttentionSection
          draft={draft}
          canEdit={canEdit}
          globalAttention={globalAttention}
          onUpdateDraft={updateDraft}
          onUpdateDeadline={updateAttentionDeadline}
        />

        <BrokerPreview
          draft={draft}
          stageName={stageName}
          globalAttention={globalAttention}
          attentionPolicies={attentionPolicies}
        />

        {formError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[8px] bg-destructive/10 px-3 py-2.5 text-xs font-light leading-[18px] text-destructive"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            <span>{formError}</span>
          </div>
        )}

        {canEdit && (
          <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-3 bg-[var(--app-surface-solid)] px-1 pb-1 pt-3">
            <p className="hidden text-[11px] font-light text-[var(--app-text-tertiary)] sm:block">
              {isDirty ? 'Alterações ainda não salvas' : 'Tudo salvo'}
            </p>
            <Button
              type="submit"
              className="h-10 w-full rounded-[6px] bg-primary px-5 text-xs font-light text-primary-foreground shadow-none hover:bg-primary/90 sm:w-auto"
              disabled={!isDirty || updateRules.isPending}
            >
              {updateRules.isPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
              ) : (
                <Save className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              Salvar regras
            </Button>
          </div>
        )}
      </form>

      <AlertDialog
        open={disableCadenceConfirmationOpen}
        onOpenChange={setDisableCadenceConfirmationOpen}
      >
        <AlertDialogContent className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-normal">
              Desativar a cadência desta etapa?
            </AlertDialogTitle>
            <AlertDialogDescription className="font-light leading-5">
              {draft.cadence.tasks.length === 1
                ? 'A tarefa configurada será preservada'
                : `As ${draft.cadence.tasks.length} tarefas configuradas serão preservadas`}
              {' '}para uma futura reativação. As obrigações ainda pendentes dos leads
              que estão nesta etapa serão canceladas agora, e novos ciclos não criarão
              tarefas enquanto a cadência estiver desativada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] font-light text-[var(--app-text-primary)] shadow-none hover:bg-[var(--app-surface-hover)]">
              Manter ativa
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-[6px] bg-destructive font-light text-destructive-foreground shadow-none hover:bg-destructive/90"
              onClick={confirmCadenceDisable}
            >
              Desativar cadência
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function CadenceSection({
  draft,
  canEdit,
  expandedTaskKey,
  onExpandedTaskChange,
  onCadenceToggle,
  onAddTask,
  onUpdateTask,
  onRemoveTask,
  onMoveTask,
}: {
  draft: RulesDraft
  canEdit: boolean
  expandedTaskKey: string | null
  onExpandedTaskChange: (key: string | null) => void
  onCadenceToggle: (enabled: boolean) => void
  onAddTask: () => void
  onUpdateTask: (key: string, patch: Partial<DraftTask>) => void
  onRemoveTask: (key: string) => void
  onMoveTask: (key: string, direction: -1 | 1) => void
}) {
  return (
    <section
      aria-labelledby="stage-cadence-title"
      className="rounded-[8px] bg-[var(--app-surface-soft)] p-3.5 text-[var(--app-text-primary)] sm:p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <AccentIcon icon={CheckCircle2} />
          <div className="min-w-0">
            <h4 id="stage-cadence-title" className="text-sm font-light">
              Cadência da etapa
            </h4>
            <p className="mt-1 text-xs font-light leading-[18px] text-[var(--app-text-tertiary)]">
              Cria ações somente enquanto o lead estiver nesta coluna.
            </p>
          </div>
        </div>
        <Switch
          id="stage-cadence-enabled"
          checked={draft.cadence.enabled}
          onCheckedChange={onCadenceToggle}
          disabled={!canEdit}
          aria-label="Ativar cadência desta etapa"
        />
      </div>

      {!draft.cadence.enabled ? (
        <EmptyRuleState
          className="mt-4"
          icon={CircleOff}
          title="Zero obrigações nesta etapa"
          description={
            draft.cadence.tasks.length > 0
              ? draft.cadence.tasks.length === 1
                ? '1 tarefa permanece guardada para quando a cadência for reativada.'
                : `${draft.cadence.tasks.length} tarefas permanecem guardadas para quando a cadência for reativada.`
              : 'Nenhuma tarefa será criada para o corretor enquanto a cadência estiver desativada.'
          }
        />
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-light text-[var(--app-text-secondary)]">
                Linha do tempo
              </p>
              <p className="mt-0.5 text-[11px] font-light text-[var(--app-text-tertiary)]">
                O prazo conta a partir da entrada na etapa.
              </p>
            </div>
            {canEdit && (
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-[6px] bg-primary/10 px-3 text-[11px] font-light text-primary shadow-none hover:bg-primary hover:text-primary-foreground"
                onClick={onAddTask}
                disabled={draft.cadence.tasks.length >= 100}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
                Nova tarefa
              </Button>
            )}
          </div>

          {draft.cadence.tasks.length === 0 ? (
            <EmptyRuleState
              className="mt-3"
              icon={Clock3}
              title="Nenhuma tarefa configurada"
              description="Esta cadência está ativa, mas ainda gera zero obrigações. Adicione a primeira ação quando estiver pronto."
            />
          ) : (
            <ol className="mt-3 space-y-2" aria-label="Tarefas da cadência em ordem">
              {draft.cadence.tasks.map((task, index) => (
                <TaskCard
                  key={task.clientKey}
                  task={task}
                  index={index}
                  total={draft.cadence.tasks.length}
                  expanded={expandedTaskKey === task.clientKey}
                  canEdit={canEdit}
                  onExpandedChange={(expanded) => (
                    onExpandedTaskChange(expanded ? task.clientKey : null)
                  )}
                  onUpdate={(patch) => onUpdateTask(task.clientKey, patch)}
                  onRemove={() => onRemoveTask(task.clientKey)}
                  onMove={(direction) => onMoveTask(task.clientKey, direction)}
                />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}

function TaskCard({
  task,
  index,
  total,
  expanded,
  canEdit,
  onExpandedChange,
  onUpdate,
  onRemove,
  onMove,
}: {
  task: DraftTask
  index: number
  total: number
  expanded: boolean
  canEdit: boolean
  onExpandedChange: (expanded: boolean) => void
  onUpdate: (patch: Partial<DraftTask>) => void
  onRemove: () => void
  onMove: (direction: -1 | 1) => void
}) {
  const meta = taskTypeMeta(task.type)
  const Icon = meta.icon

  return (
    <li className="group overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)]">
      <div className="flex items-center gap-2 p-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[6px] p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
          aria-expanded={expanded}
          aria-controls={`task-editor-${task.clientKey}`}
          onClick={() => onExpandedChange(!expanded)}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] transition-colors group-hover:bg-[var(--app-surface-hover)] group-hover:text-[var(--app-text-primary)]">
            <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-light">
              {task.title.trim() || `Nova tarefa ${index + 1}`}
            </span>
            <span className="mt-0.5 block text-[11px] font-light text-[var(--app-text-tertiary)]">
              {meta.label} · {formatDuration(task.due_minutes)}
              {task.is_required ? ' · obrigatória' : ' · opcional'}
            </span>
          </span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
          )}
        </button>

        {canEdit && (
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton
              label={`Mover ${task.title || `tarefa ${index + 1}`} para cima`}
              disabled={index === 0}
              onClick={() => onMove(-1)}
              icon={ArrowUp}
            />
            <IconButton
              label={`Mover ${task.title || `tarefa ${index + 1}`} para baixo`}
              disabled={index === total - 1}
              onClick={() => onMove(1)}
              icon={ArrowDown}
            />
          </div>
        )}
      </div>

      {expanded && (
        <div
          id={`task-editor-${task.clientKey}`}
          className="space-y-3 px-3 pb-3 pt-1"
        >
          <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
            <Field label="Tipo" htmlFor={`task-type-${task.clientKey}`}>
              <Select
                value={task.type}
                onValueChange={(value) => {
                  const type = value as TaskType
                  onUpdate({
                    type,
                    ...(type === 'note' ? { outcome_required: false } : {}),
                  })
                }}
                disabled={!canEdit}
              >
                <SelectTrigger
                  id={`task-type-${task.clientKey}`}
                  className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1 shadow-none">
                  {TASK_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value} className={SELECT_ITEM_CLASS_NAME}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Título da tarefa" htmlFor={`task-title-${task.clientKey}`}>
              <Input
                id={`task-title-${task.clientKey}`}
                value={task.title}
                maxLength={180}
                placeholder="Ex.: Fazer a primeira ligação"
                disabled={!canEdit}
                onChange={(event) => onUpdate({ title: event.target.value })}
                className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <DurationField
              id={`task-due-${task.clientKey}`}
              label="Prazo após entrar na etapa"
              minutes={task.due_minutes}
              minMinutes={0}
              disabled={!canEdit}
              onChange={(minutes) => onUpdate({
                due_minutes: minutes,
                ...(task.warning_minutes != null
                  ? {
                      warning_minutes: minutes <= 1
                        ? undefined
                        : Math.min(
                            Math.max(1, task.warning_minutes),
                            minutes - 1,
                          ),
                    }
                  : {}),
              })}
            />
            <OptionalDurationField
              id={`task-warning-${task.clientKey}`}
              label="Avisar antes do prazo"
              minutes={task.warning_minutes}
              defaultMinutes={Math.min(30, Math.max(1, task.due_minutes - 1))}
              disabled={!canEdit || task.due_minutes <= 1}
              onChange={(minutes) => onUpdate({ warning_minutes: minutes })}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow
              id={`task-required-${task.clientKey}`}
              title="Tarefa obrigatória"
              description="Aparece como pendência até ser concluída."
              checked={task.is_required}
              disabled={!canEdit}
              onCheckedChange={(checked) => onUpdate({ is_required: checked })}
            />
            <ToggleRow
              id={`task-outcome-${task.clientKey}`}
              title="Exigir resultado"
              description={task.type === 'note'
                ? 'Anotações não possuem resultado de contato.'
                : 'Pede o desfecho antes de concluir a ação.'}
              checked={task.outcome_required}
              disabled={!canEdit || task.type === 'note'}
              onCheckedChange={(checked) => onUpdate({ outcome_required: checked })}
            />
          </div>

          <Field label="Instrução para o corretor" htmlFor={`task-description-${task.clientKey}`}>
            <Textarea
              id={`task-description-${task.clientKey}`}
              value={task.description || ''}
              maxLength={2_000}
              rows={2}
              placeholder="Explique o objetivo e o que deve ser verificado."
              disabled={!canEdit}
              onChange={(event) => onUpdate({ description: event.target.value || undefined })}
              className="min-h-16 resize-y rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light leading-[18px]"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Observação interna" htmlFor={`task-observation-${task.clientKey}`}>
              <Textarea
                id={`task-observation-${task.clientKey}`}
                value={task.observation || ''}
                maxLength={2_000}
                rows={3}
                placeholder="Roteiro, ressalvas ou contexto."
                disabled={!canEdit}
                onChange={(event) => onUpdate({ observation: event.target.value || undefined })}
                className="min-h-20 resize-y rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light leading-[18px]"
              />
            </Field>
            <Field label="Mensagem recomendada" htmlFor={`task-message-${task.clientKey}`}>
              <Textarea
                id={`task-message-${task.clientKey}`}
                value={task.recommended_message || ''}
                maxLength={4_000}
                rows={3}
                placeholder="Texto que poderá ser usado no atendimento."
                disabled={!canEdit}
                onChange={(event) => onUpdate({
                  recommended_message: event.target.value || undefined,
                })}
                className="min-h-20 resize-y rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light leading-[18px]"
              />
            </Field>
          </div>

          {canEdit && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 rounded-[6px] px-2.5 text-[11px] font-light text-[var(--app-text-tertiary)] hover:bg-destructive/10 hover:text-destructive"
                onClick={onRemove}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
                Remover tarefa
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function AttentionSection({
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

function getAttentionPreviewCopy(
  sourceMode: RulesDraft['attention']['source_mode'],
  localMode: RulesDraft['attention']['mode'],
  globalAttention: GlobalAttentionState,
) {
  if (globalAttention.isLoading) {
    return sourceMode === 'inherit'
      ? 'Verificando como o motor global aplicará as políticas herdadas.'
      : 'Verificando como o motor global aplicará esta regra.'
  }
  if (globalAttention.isError) {
    return sourceMode === 'inherit'
      ? 'Políticas encontradas; não foi possível confirmar o modo global.'
      : 'Regra local configurada; não foi possível confirmar o modo global.'
  }
  if (globalAttention.engineMode === 'disabled') {
    return sourceMode === 'inherit'
      ? 'O motor global está desligado; as políticas herdadas não geram itens.'
      : 'O motor global está desligado; esta regra local não gera itens.'
  }
  if (
    (sourceMode === 'local' && localMode === 'shadow')
    || globalAttention.engineMode === 'shadow'
  ) {
    return 'Fica em observação, sem aparecer como cobrança ativa para o corretor.'
  }
  if (globalAttention.notificationsEnabled === false) {
    return 'Aparece em Prioridades e atenções, mas as notificações globais estão desativadas.'
  }
  return sourceMode === 'inherit'
    ? 'O sistema aplica, em cada tipo, a política mais específica disponível.'
    : 'O corretor recebe atenção quando o prazo se aproxima.'
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

function BrokerPreview({
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

function DurationField({
  id,
  label,
  minutes,
  minMinutes,
  disabled,
  onChange,
  ariaLabel,
}: {
  id: string
  label: string
  minutes: number
  minMinutes: number
  disabled: boolean
  onChange: (minutes: number) => void
  ariaLabel?: string
}) {
  const [unit, setUnit] = useState<DurationUnit>(() => durationUnitFor(minutes))
  const divisor = unit === 'days' ? 1_440 : 60
  const accessibleLabel = ariaLabel || label

  return (
    <Field label={label} htmlFor={id}>
      <div className="grid grid-cols-[minmax(0,1fr)_104px] gap-2">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={minMinutes / divisor}
          max={MAX_OPERATIONAL_RULE_MINUTES / divisor}
          step="any"
          value={formatDurationValue(minutes, unit)}
          aria-label={accessibleLabel}
          disabled={disabled}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber
            if (!Number.isFinite(value)) return
            onChange(Math.min(
              MAX_OPERATIONAL_RULE_MINUTES,
              Math.max(minMinutes, Math.round(value * divisor)),
            ))
          }}
          className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light"
        />
        <Select
          value={unit}
          disabled={disabled}
          onValueChange={(nextUnit: DurationUnit) => setUnit(nextUnit)}
        >
          <SelectTrigger
            aria-label={`Unidade de ${accessibleLabel.toLowerCase()}`}
            className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1 shadow-none">
            <SelectItem value="hours" className={SELECT_ITEM_CLASS_NAME}>Horas</SelectItem>
            <SelectItem value="days" className={SELECT_ITEM_CLASS_NAME}>Dias</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </Field>
  )
}

function OptionalDurationField({
  id,
  label,
  minutes,
  defaultMinutes,
  minMinutes = 0,
  disabled,
  onChange,
}: {
  id: string
  label: string
  minutes: number | undefined
  defaultMinutes: number
  minMinutes?: number
  disabled: boolean
  onChange: (minutes: number | undefined) => void
}) {
  const enabled = minutes != null

  return (
    <div className="space-y-1.5">
      <div className="flex h-5 items-center justify-between gap-2">
        <Label htmlFor={`${id}-enabled`} className="text-[11px] font-light text-[var(--app-text-secondary)]">
          {label}
        </Label>
        <Switch
          id={`${id}-enabled`}
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked ? defaultMinutes : undefined)}
          aria-label={`${enabled ? 'Desativar' : 'Ativar'} ${label.toLowerCase()}`}
        />
      </div>
      {enabled ? (
        <DurationField
          id={id}
          label=""
          minutes={minutes}
          minMinutes={minMinutes}
          disabled={disabled}
          onChange={onChange}
          ariaLabel={label}
        />
      ) : (
        <div className="flex h-9 items-center rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-[11px] font-light text-[var(--app-text-tertiary)]">
          Sem aviso
        </div>
      )}
    </div>
  )
}

function ToggleRow({
  id,
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string
  title: string
  description: string
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[8px] bg-[var(--app-surface-solid)] p-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-xs font-light text-[var(--app-text-primary)]">
          {title}
        </Label>
        <p className="mt-0.5 text-[11px] font-light leading-[17px] text-[var(--app-text-tertiary)]">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      {label && (
        <Label
          htmlFor={htmlFor}
          className="text-[11px] font-light text-[var(--app-text-secondary)]"
        >
          {label}
        </Label>
      )}
      {children}
    </div>
  )
}

function AccentIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-solid)] text-[var(--app-text-secondary)]">
      <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
    </span>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  icon: Icon,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  icon: LucideIcon
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7 rounded-[6px] text-[var(--app-text-tertiary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
    </Button>
  )
}

function EmptyRuleState({
  icon: Icon,
  title,
  description,
  className,
}: {
  icon: LucideIcon
  title: string
  description: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-[8px] bg-[var(--app-surface-solid)] px-3 py-3.5',
        className,
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
      </span>
      <div>
        <p className="text-xs font-light text-[var(--app-text-primary)]">{title}</p>
        <p className="mt-1 text-[11px] font-light leading-[17px] text-[var(--app-text-tertiary)]">
          {description}
        </p>
      </div>
    </div>
  )
}

function LifecycleLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-[8px] bg-[var(--app-surface-solid)] px-3 py-2.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--app-text-secondary)]" strokeWidth={1.5} />
      <span className="text-[11px] font-light leading-[17px] text-[var(--app-text-secondary)]">
        {text}
      </span>
    </div>
  )
}

function RulesSkeleton() {
  return (
    <div className="space-y-4" aria-label="Carregando regras da etapa" aria-busy="true">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32 rounded-[6px]" />
          <Skeleton className="h-3 w-72 max-w-full rounded-[6px]" />
        </div>
        <Skeleton className="h-7 w-24 rounded-[6px]" />
      </div>
      {[220, 280, 190].map((height) => (
        <Skeleton
          key={height}
          className="w-full rounded-[8px]"
          style={{ height }}
        />
      ))}
    </div>
  )
}
