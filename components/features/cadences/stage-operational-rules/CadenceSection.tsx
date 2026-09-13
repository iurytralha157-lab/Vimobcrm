'use client'

import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleOff,
  Clock3,
  Plus,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import {
  AccentIcon,
  DurationField,
  EmptyRuleState,
  Field,
  IconButton,
  OptionalDurationField,
  ToggleRow,
} from './RuleFields'
import {
  type DraftTask,
  type RulesDraft,
  type TaskType,
  SELECT_ITEM_CLASS_NAME,
  TASK_TYPES,
  formatDuration,
  taskTypeMeta,
} from './model'

export function CadenceSection({
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
