import {
  Clock3,
  FileText,
  Mail,
  MessageCircle,
  Phone,
  TimerReset,
  UserRoundCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

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

export type TaskType = StageOperationalCadenceTask['type']
export type DurationUnit = 'hours' | 'days'
export type AttentionDeadlineField =
  | 'first_outreach_minutes'
  | 'first_effective_contact_minutes'
  | 'stage_inactivity_minutes'
  | 'stage_max_age_minutes'

export const MAX_OPERATIONAL_RULE_MINUTES = 5 * 365 * 24 * 60

export type GlobalAttentionState = {
  engineMode?: AttentionEngineMode
  notificationsEnabled?: boolean
  isLoading: boolean
  isError: boolean
}

export type AttentionPoliciesState = {
  policies: AttentionPolicy[]
  isLoading: boolean
  isError: boolean
}

export type EffectiveAttentionPolicy = {
  policy: AttentionPolicy
  source: 'stage' | 'pipeline' | 'organization'
}

export type DraftTask = StageOperationalCadenceTask & {
  clientKey: string
}

export type RulesDraft = Omit<StageOperationalRulesContract, 'cadence'> & {
  cadence: Omit<StageOperationalRulesContract['cadence'], 'tasks'> & {
    tasks: DraftTask[]
  }
}

export const TASK_TYPES: Array<{
  value: TaskType
  label: string
  icon: LucideIcon
}> = [
  { value: 'call', label: 'Ligação', icon: Phone },
  { value: 'message', label: 'Mensagem', icon: MessageCircle },
  { value: 'email', label: 'E-mail', icon: Mail },
  { value: 'note', label: 'Anotação', icon: FileText },
]

export const SELECT_ITEM_CLASS_NAME =
  'rounded-[4px] text-xs font-light focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]'

export const ATTENTION_RULES: Array<{
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

export const ATTENTION_POLICY_SOURCE_LABELS: Record<
  EffectiveAttentionPolicy['source'],
  string
> = {
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

export function policySuppressesInherited(policy: AttentionPolicy) {
  const disabledOverride = policy.config?.disabled_override
  return policy.status === 'paused'
    && (disabledOverride === true || disabledOverride === 'true')
}

export function resolveEffectiveAttentionPolicies(
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

export function getAttentionPreviewCopy(
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

export function taskTypeMeta(type: TaskType) {
  return TASK_TYPES.find((item) => item.value === type) || TASK_TYPES[0]
}

export function toDraft(rules: StageOperationalRulesContract): RulesDraft {
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

export function toPayload(draft: RulesDraft): UpdateStageOperationalRulesInput {
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

export function createTask(position: number, previousDueMinutes?: number): DraftTask {
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

export function formatDuration(minutes: number | undefined) {
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

export function durationUnitFor(minutes: number): DurationUnit {
  return minutes >= 1_440 && minutes % 1_440 === 0 ? 'days' : 'hours'
}

export function formatDurationValue(minutes: number, unit: DurationUnit) {
  const divisor = unit === 'days' ? 1_440 : 60
  return Number((minutes / divisor).toFixed(2))
}

export function normalizePositions(tasks: DraftTask[]) {
  return tasks.map((task, position) => ({ ...task, position }))
}
