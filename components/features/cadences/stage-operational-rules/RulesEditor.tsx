'use client'

import { type FormEvent, type ReactNode, useEffect, useLayoutEffect, useState, useRef } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { StageSettingsActions } from '@/components/features/pipelines/stage-settings-footer'
import { useUpdateStageOperationalRules } from '@/hooks/cadences'
import { stageOperationalRulesErrorMessage } from '@/hooks/cadences/use-stage-operational-rules'
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
  decideRulesRevisionUpdate,
  normalizePositions,
  toDraft,
  toPayload,
} from './model'

/**
 * A rule saved by another service but edited and saved together with the stage
 * rules (the inactivity alert inside "Atenção e permanência").
 */
export type RulesExtraEditor = {
  node: ReactNode
  /** Line added to "O que o corretor verá"; null when it changes nothing. */
  summary: ReactNode | null
  isDirty: boolean
  isSaving: boolean
  /** Resolves false when the error is already shown inside the node. */
  save: () => Promise<boolean>
}

const CONFLICT_MESSAGE = 'Outra pessoa alterou esta etapa. Seu rascunho foi preservado. Carregar a versão atual substituirá suas alterações não salvas.'

export function RulesEditor({
  initialRules,
  stageName,
  canEdit,
  globalAttention,
  attentionPolicies,
  onReloadCurrent,
  onEditorStateChange,
  extraEditor,
}: {
  initialRules: StageOperationalRulesContract
  stageName: string
  canEdit: boolean
  globalAttention: GlobalAttentionState
  attentionPolicies: AttentionPoliciesState
  onReloadCurrent: () => Promise<StageOperationalRulesContract>
  onEditorStateChange?: (state: { isDirty: boolean; isSaving: boolean }) => void
  extraEditor?: RulesExtraEditor
}) {
  const [draft, setDraft] = useState<RulesDraft>(() => toDraft(initialRules))
  const [expandedTaskKey, setExpandedTaskKey] = useState<string | null>(
    draft.cadence.tasks[0]?.clientKey || null,
  )
  const [isDirty, setIsDirty] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [hasConflict, setHasConflict] = useState(false)
  const [isReloading, setIsReloading] = useState(false)
  const [disableCadenceConfirmationOpen, setDisableCadenceConfirmationOpen] = useState(false)
  const [lastTaskToRemove, setLastTaskToRemove] = useState<string | null>(null)
  const saveInFlight = useRef(false)
  const mounted = useRef(true)
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const updateRules = useUpdateStageOperationalRules(initialRules.stage_id)
  const extraDirty = extraEditor?.isDirty === true
  const extraSaving = extraEditor?.isSaving === true
  const anyDirty = isDirty || extraDirty
  const isSaving = updateRules.isPending || extraSaving
  useEffect(() => { onEditorStateChange?.({ isDirty: anyDirty, isSaving }) }, [anyDirty, isSaving, onEditorStateChange])

  /* eslint-disable react-hooks/set-state-in-effect -- External revisions are adopted only when the local editor has no unsaved changes. */
  useEffect(() => {
    const decision = decideRulesRevisionUpdate(draft.revision, initialRules.revision, isDirty)
    if (decision === 'adopt') {
      const latestDraft = toDraft(initialRules)
      setDraft(latestDraft)
      setExpandedTaskKey(latestDraft.cadence.tasks[0]?.clientKey || null)
      setHasConflict(false)
      setFormError(null)
    } else if (decision === 'conflict' && !hasConflict) {
      setHasConflict(true)
      setFormError(CONFLICT_MESSAGE)
    }
  }, [draft.revision, hasConflict, initialRules, isDirty])
  /* eslint-enable react-hooks/set-state-in-effect */

  const updateDraft = (updater: (current: RulesDraft) => RulesDraft) => {
    if (!mounted.current || !updateRules.captureScopeGuard()() || saveInFlight.current) return
    setDraft((current) => updater(current))
    setIsDirty(true)
    if (!hasConflict) setFormError(null)
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
    if (draft.cadence.enabled && draft.cadence.tasks.length === 1) {
      setLastTaskToRemove(clientKey)
      return
    }
    removeTaskFromDraft(clientKey)
  }

  const removeTaskFromDraft = (clientKey: string) => {
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
    const isCurrent = updateRules.captureScopeGuard()
    if (!mounted.current || !isCurrent() || isReloading) return
    if (saveInFlight.current || isSaving) return
    if (!isDirty) {
      if (!extraDirty || !extraEditor) return
      saveInFlight.current = true
      try { await extraEditor.save() } finally { if (mounted.current) saveInFlight.current = false }
      return
    }
    if (hasConflict || !canEdit) return
    const payload = toPayload(draft)
    const validation = updateStageOperationalRulesInputSchema.safeParse(payload)

    if (!validation.success) {
      const issue = validation.error.issues[0]
      const message = issue?.message || 'Revise os campos antes de salvar.'
      setFormError(message)
      toast.error(message)
      return
    }

    saveInFlight.current = true
    onEditorStateChange?.({ isDirty, isSaving: true })
    let saved = false
    try {
      const savedRules = await updateRules.mutateAsync(validation.data)
      if (!mounted.current || !isCurrent()) return
      saved = true
      const savedDraft = toDraft(savedRules)
      setDraft(savedDraft)
      setExpandedTaskKey(savedDraft.cadence.tasks[0]?.clientKey || null)
      setIsDirty(false)
      setFormError(null)
      setHasConflict(false)
      if (extraEditor?.isDirty) await extraEditor.save()
    } catch (error) {
      if (!mounted.current || !isCurrent()) return
      if (
        error instanceof VimobAPIError
        && error.code === 'stage_operational_rules_changed'
      ) {
        setHasConflict(true)
        setFormError(CONFLICT_MESSAGE)
        return
      }
      setFormError(stageOperationalRulesErrorMessage(
        error,
        'Não foi possível salvar as regras desta etapa.',
      ))
    } finally {
      if (mounted.current && isCurrent()) {
        saveInFlight.current = false
        onEditorStateChange?.({ isDirty: (saved ? false : isDirty) || extraDirty, isSaving: false })
      }
    }
  }

  const formId = `stage-rules-form-${initialRules.stage_id}`

  const handleReloadCurrent = async () => {
    const isCurrent = updateRules.captureScopeGuard()
    if (!mounted.current || !isCurrent() || isReloading || saveInFlight.current || updateRules.isPending) return
    saveInFlight.current = true
    setIsReloading(true)
    try {
      const currentRules = await onReloadCurrent()
      if (!mounted.current || !isCurrent()) return
      if (decideRulesRevisionUpdate(draft.revision, currentRules.revision, false) !== 'adopt') {
        throw new Error('A versão atualizada ainda não está disponível. Seu rascunho continua aqui; tente novamente.')
      }
      const currentDraft = toDraft(currentRules)
      setDraft(currentDraft)
      setExpandedTaskKey(currentDraft.cadence.tasks[0]?.clientKey || null)
      setIsDirty(false)
      setHasConflict(false)
      setFormError(null)
    } catch (error) {
      if (mounted.current && isCurrent()) setFormError(stageOperationalRulesErrorMessage(error, 'Não foi possível carregar a versão atual. Seu rascunho continua aqui.'))
    } finally {
      if (mounted.current && isCurrent()) {
        saveInFlight.current = false
        setIsReloading(false)
      }
    }
  }

  return (
    <>
      <form id={formId} onSubmit={handleSubmit} className="space-y-4 pb-2">
        <fieldset disabled={updateRules.isPending || isReloading} className="space-y-4">
        <CadenceSection
          draft={draft}
          canEdit={canEdit && !updateRules.isPending && !isReloading}
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
          canEdit={canEdit && !updateRules.isPending && !isReloading}
          globalAttention={globalAttention}
          onUpdateDraft={updateDraft}
          onUpdateDeadline={updateAttentionDeadline}
          extra={extraEditor?.node}
        />

        <BrokerPreview
          draft={draft}
          stageName={stageName}
          globalAttention={globalAttention}
          attentionPolicies={attentionPolicies}
          extraSummary={extraEditor?.summary}
        />
        </fieldset>

        {formError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[8px] bg-destructive/10 px-3 py-2.5 text-xs font-light leading-[18px] text-destructive"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            <span>{formError}</span>
          </div>
        )}

        {hasConflict && canEdit && (
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light shadow-none hover:bg-[var(--app-surface-hover)]"
            onClick={handleReloadCurrent}
            disabled={isReloading}
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isReloading ? 'animate-spin' : ''}`} strokeWidth={1.5} />
            Carregar versão atual
          </Button>
        )}

        <StageSettingsActions
          status={canEdit ? (anyDirty ? 'Alterações ainda não salvas' : 'Tudo salvo') : null}
          cancelLabel={canEdit ? 'Cancelar' : 'Fechar'}
          cancelDisabled={isSaving}
          primary={canEdit ? {
            label: 'Salvar regras',
            form: formId,
            loading: isSaving,
            disabled: !anyDirty || (isDirty && hasConflict) || isSaving || isReloading,
          } : undefined}
        />
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
              A configuração fica guardada para reativação. Ao salvar as regras, as tarefas
              pendentes de cadência nesta coluna serão canceladas, inclusive as de cadências individuais.
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
      <AlertDialog open={lastTaskToRemove !== null} onOpenChange={(open) => { if (!open) setLastTaskToRemove(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover a última tarefa desta cadência?</AlertDialogTitle>
            <AlertDialogDescription>Ao salvar sem tarefas, as tarefas pendentes de cadência nesta coluna serão canceladas, inclusive as de cadências individuais.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter tarefa</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (lastTaskToRemove) removeTaskFromDraft(lastTaskToRemove); setLastTaskToRemove(null) }}>Remover do rascunho</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
