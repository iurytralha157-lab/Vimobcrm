'use client'

import { type FormEvent, useState } from 'react'
import { AlertCircle, Loader2, Lock, Save } from 'lucide-react'
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
import { useUpdateStageOperationalRules } from '@/hooks/cadences'
import type {
  StageOperationalRules as StageOperationalRulesContract,
} from '@/lib/api/cadences'
import { VimobAPIError } from '@/lib/api/vimob-client'
import { updateStageOperationalRulesInputSchema } from '@/lib/validation/cadences'

import { AttentionSection } from './AttentionSection'
import { BrokerPreview } from './BrokerPreview'
import { CadenceSection } from './CadenceSection'
import {
  type AttentionDeadlineField,
  type AttentionPoliciesState,
  type DraftTask,
  type GlobalAttentionState,
  type RulesDraft,
  createTask,
  normalizePositions,
  toDraft,
  toPayload,
} from './model'

export function RulesEditor({
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
