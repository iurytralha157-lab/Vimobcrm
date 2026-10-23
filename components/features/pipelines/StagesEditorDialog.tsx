import { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { GripVertical, Trash2, Loader2, Pencil, Check, X, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { stringifyErrorMessage as getErrorMessage } from '@/lib/api/vimob-error';
import { cn } from '@/lib/utils';
import { createClientId } from '@/lib/client-id';
import { stageCreateInputSchema } from '@/lib/validation/pipelines';
import { buildUniquePipelineStageKey } from '@/lib/pipeline-stage-key';
import {
  resolveStageEditorDraft,
  pinStageEditorDraft,
  updateStageEditorDraft,
  type StageEditorDraft,
} from '@/lib/pipeline-stage-editor-draft';
import { useDeleteStage, useReorderStages, useUpdateStage } from '@/hooks/use-stages';
import type { DeleteStageData } from '@/hooks/pipelines/use-stage-delete-intent';
import { usePipelineEditorVisit, type PipelineEditorOperation } from '@/hooks/pipelines/use-pipeline-editor-visit';
import { PIPELINE_STAGE_COLOR_FALLBACK } from '@/config/pipeline-stage-colors';
import { toStageEditorSaveValues, type StageEditorValue } from './pipeline-screen/stage-editor-contract';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type Stage = StageEditorValue;
type DeleteStageConfirmation = { stage: Stage; persisted: boolean; input: DeleteStageData | null };

interface StagesEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  pipelineName: string;
  stages: Stage[];
  archivedStages?: Stage[];
}

export function StagesEditorDialog({
  open,
  onOpenChange,
  pipelineId,
  pipelineName,
  stages: initialStages,
  archivedStages = [],
}: StagesEditorDialogProps) {
  const sortedInitialStages = [...initialStages].sort((a, b) => a.position - b.position);
  const initialStagesKey = open
    ? sortedInitialStages
      .map((stage) => `${stage.id}:${stage.position}:${stage.name}:${stage.color}:${stage.stage_key ?? ''}:${stage.updated_at ?? ''}`)
      .join('|')
    : 'closed';
  const [stageDraft, setStageDraft] = useState<StageEditorDraft<Stage> | null>(null);
  const {
    stages,
    sourceStages,
    hasChanges,
    isStale: isDraftStale,
  } = resolveStageEditorDraft(stageDraft, pipelineId, initialStagesKey, sortedInitialStages);
  const [savingOperation, setSavingOperation] = useState<PipelineEditorOperation | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingColor, setEditingColor] = useState('');
  const [deleteStage, setDeleteStage] = useState<DeleteStageConfirmation | null>(null);
  const deletion = useRef<DeleteStageConfirmation | null>(null);
  const [deleteConflict, setDeleteConflict] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>(PIPELINE_STAGE_COLOR_FALLBACK);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoringOperation, setRestoringOperation] = useState<{ stageId: string; operation: PipelineEditorOperation } | null>(null);
  const [restoredStageIds, setRestoredStageIds] = useState<Set<string>>(() => new Set());
  const restoreInFlight = useRef<PipelineEditorOperation | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const saveInFlightRef = useRef<PipelineEditorOperation | null>(null);
  const deleteInFlightRef = useRef(false);
  const reorderStages = useReorderStages();
  const deleteStageMutation = useDeleteStage(open ? pipelineId : undefined);
  const restoreStageMutation = useUpdateStage();
  const editorVisit = usePipelineEditorVisit(reorderStages.scopeKey, JSON.stringify([open, pipelineId]), reorderStages.captureScopeGuard);
  const isSaving = savingOperation?.visit === editorVisit.key;
  const restoringStageId = restoringOperation?.operation.visit === editorVisit.key ? restoringOperation.stageId : null;
  const isMutating = isSaving || deleteStageMutation.isPending || restoringStageId !== null;
  const closeDeletion = useCallback((candidate: DeleteStageConfirmation | null) => {
    if (deletion.current !== candidate) return;
    if (candidate?.input) deleteStageMutation.discard(candidate.input);
    deletion.current = null;
    setDeleteStage(null);
    setDeleteConflict(false);
  }, [deleteStageMutation]);

  useEffect(() => {
    if (open) return;

    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      setEditingId(null);
      setIsAdding(false);
      closeDeletion(deletion.current);
      setNewName('');
      setStageDraft(null);
    });

    return () => {
      cancelled = true;
    };
  }, [open, closeDeletion]);

  const setDraftStages = (nextStages: Stage[], nextHasChanges = true) => {
    setStageDraft((current) => updateStageEditorDraft(
      current,
      pipelineId,
      initialStagesKey,
      sortedInitialStages,
      nextStages,
      nextHasChanges,
    ));
  };

  const buildUniqueStageKey = (name: string, currentStages: Stage[]) => buildUniquePipelineStageKey(
    name,
    [...currentStages, ...archivedStages]
      .map((stage) => stage.stage_key)
      .filter((stageKey): stageKey is string => Boolean(stageKey)),
  );

  const createLocalUuid = () => {
    return createClientId('stage');
  };

  const createDraftStage = (currentStages: Stage[], name: string, color = newColor): Stage => ({
    id: createLocalUuid(),
    name: name.trim(),
    color,
    position: currentStages.length,
    lead_count: 0,
    stage_key: buildUniqueStageKey(name, currentStages),
  });

  const pendingNewStageName = isAdding ? newName.trim() : '';
  const hasPendingNewStage = pendingNewStageName.length > 0;
  const canSave = hasChanges || hasPendingNewStage || Boolean(editingId);
  const readStageFields = (name: string, color: string) => {
    const parsed = stageCreateInputSchema.safeParse({ name, color });
    if (parsed.success) return { name: parsed.data.name, color: color.trim() };
    toast.error(parsed.error.issues.some(issue => issue.path[0] === 'name')
      ? 'O nome da coluna deve ter entre 2 e 120 caracteres.'
      : 'Use uma cor hexadecimal no formato #RRGGBB.');
    return null;
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isMutating) return;
    if (!nextOpen && (canSave || Boolean(editingId))) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(nextOpen);
  };

  const handleDragEnd = (result: DropResult) => {
    if (isMutating) return;
    if (!result.destination) return;

    const fromIndex = result.source.index;
    const toIndex = result.destination.index;

    if (fromIndex === toIndex) return;

    const newStages = [...stages];
    const [movedStage] = newStages.splice(fromIndex, 1);
    newStages.splice(toIndex, 0, movedStage);

    // Update positions
    const updatedStages = newStages.map((stage, index) => ({
      ...stage,
      position: index,
    }));

    setDraftStages(updatedStages);
  };

  const handleSave = async () => {
    const operation = editorVisit.capture();
    if (!open || !operation.isCurrent() || isMutating || saveInFlightRef.current?.visit === operation.visit) return;
    if (isDraftStale) {
      toast.error('As colunas mudaram em outra sessão. Seu rascunho foi mantido.');
      return;
    }

    if (editingId && !stages.some(stage => stage.id === editingId)) {
      toast.error('A coluna em edição não está mais no rascunho. Cancele a edição e revise as colunas.');
      return;
    }
    const pendingEdit = editingId ? readStageFields(editingName, editingColor) : null;
    if (editingId && !pendingEdit) return;
    const pendingNewStage = isAdding ? readStageFields(pendingNewStageName, newColor) : null;
    if (isAdding && !pendingNewStage) return;

    if (!canSave) {
      handleOpenChange(false);
      return;
    }

    saveInFlightRef.current = operation;
    setSavingOperation(operation);
    setSaveError(null);
    try {
      const editedStages = pendingEdit
        ? stages.map(stage => stage.id === editingId ? { ...stage, ...pendingEdit } : stage)
        : stages;
      const stagesForSave = pendingNewStage
        ? [...editedStages, createDraftStage(editedStages, pendingNewStage.name, pendingNewStage.color)]
        : editedStages;

      const stagesToSave = toStageEditorSaveValues(stagesForSave, sourceStages).map(({ stage_key, ...stage }) => (
        stage.isNew
          ? { ...stage, stage_key: stage_key || buildUniqueStageKey(stage.name, stagesForSave) }
          : stage
      ));

      await reorderStages.mutateAsync({
        pipelineId,
        stages: stagesToSave,
      });

      if (!operation.isCurrent()) return;
      toast.success('Colunas atualizadas com sucesso!');
      setDraftStages(stagesForSave, false);
      setEditingId(null);
      setEditingName('');
      setEditingColor('');
      setIsAdding(false);
      setNewName('');
      onOpenChange(false);
    } catch (error: unknown) {
      if (!operation.isCurrent()) return;
      const message = 'Erro ao salvar: ' + getErrorMessage(error);
      setSaveError(message);
      toast.error(message);
    } finally {
      if (saveInFlightRef.current === operation) saveInFlightRef.current = null;
      if (operation.isCurrent()) setSavingOperation(current => current === operation ? null : current);
    }
  };

  const handleStartEdit = (stage: Stage) => {
    setStageDraft((current) => pinStageEditorDraft(current, pipelineId, initialStagesKey, sortedInitialStages));
    setEditingId(stage.id);
    setEditingName(stage.name);
    setEditingColor(stage.color);
  };

  const handleSaveEdit = () => {
    if (!editingId) return;
    const fields = readStageFields(editingName, editingColor);
    if (!fields) return;

    setDraftStages(stages.map(s =>
      s.id === editingId
        ? { ...s, ...fields }
        : s
    ));
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setStageDraft((current) => current?.hasChanges ? current : null);
    setEditingId(null);
    setEditingName('');
    setEditingColor('');
  };

  const handleDeleteStage = async () => {
    const target = deleteStage;
    if (!open || !deleteStageMutation.isScopeCurrent() || !target || deletion.current !== target || deleteConflict || deleteStageMutation.isPending || deleteInFlightRef.current) return;

    if (!target.persisted) {
      setDraftStages(stages.filter((stage) => stage.id !== target.stage.id));
      closeDeletion(target);
      return;
    }
    if (!target.input || !deleteStageMutation.isCurrent(target.input)) return;

    deleteInFlightRef.current = true;
    setDeleteError(null);
    try {
      await deleteStageMutation.mutateAsync(target.input);
      if (deletion.current !== target || !deleteStageMutation.isCurrent(target.input)) return;

      setDraftStages(stages.filter(s => s.id !== target.stage.id), false);
      toast.success('Coluna excluída!');
      closeDeletion(target);
    } catch (error: unknown) {
      if (deletion.current !== target || !deleteStageMutation.isCurrent(target.input)) return;
      const conflict = typeof error === 'object' && error !== null && 'status' in error && error.status === 409;
      if (conflict) {
        deleteStageMutation.discard(target.input);
        setDeleteConflict(true);
      }
      const message = conflict
        ? 'Esta coluna mudou em outra sessão. Feche esta confirmação, atualize as colunas e confira antes de excluir.'
        : 'Erro ao excluir: ' + getErrorMessage(error);
      setDeleteError(message);
      toast.error(message);
    } finally {
      deleteInFlightRef.current = false;
    }
  };

  const requestDeleteStage = (stage: Stage) => {
    if (!open || !deleteStageMutation.isScopeCurrent() || isMutating || deleteInFlightRef.current) return;
    const isPersistedStage = sortedInitialStages.some((candidate) => candidate.id === stage.id);
    if (isPersistedStage && (canSave || Boolean(editingId) || isAdding)) {
      toast.info('Salve ou descarte as alterações antes de excluir uma coluna existente.');
      return;
    }

    try {
      const input = isPersistedStage && stage.updated_at
        ? deleteStageMutation.capture({ id: stage.id, expectedUpdatedAt: stage.updated_at }) : null;
      closeDeletion(deletion.current);
      const confirmation = { stage: { ...stage }, persisted: isPersistedStage, input };
      deletion.current = confirmation;
      setDeleteStage(confirmation);
      setDeleteConflict(false);
      setDeleteError(isPersistedStage && !input ? 'Não foi possível confirmar a versão desta coluna. Feche a confirmação e atualize as colunas antes de excluir.' : null);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleRestoreStage = async (stageId: string) => {
    const operation = editorVisit.capture();
    if (!open || !operation.isCurrent() || isMutating || restoreInFlight.current?.visit === operation.visit) return;
    if (canSave || editingId) {
      setRestoreError('Salve ou descarte as alterações antes de reativar uma coluna.');
      return;
    }
    restoreInFlight.current = operation;
    setRestoringOperation({ stageId, operation });
    setRestoreError(null);
    try {
      const expectedUpdatedAt = archivedStages.find((stage) => stage.id === stageId)?.updated_at;
      if (!expectedUpdatedAt) throw new Error('Atualize as colunas antes de reativar.');
      await restoreStageMutation.mutateAsync({ id: stageId, expectedUpdatedAt, isActive: true });
      if (!operation.isCurrent()) return;
      setRestoredStageIds((current) => new Set([...current, stageId]));
      toast.success('Coluna reativada. A estrutura será atualizada.');
    } catch (error) {
      if (!operation.isCurrent()) return;
      setRestoreError('Não foi possível reativar: ' + getErrorMessage(error));
    } finally {
      if (restoreInFlight.current === operation) restoreInFlight.current = null;
      if (operation.isCurrent()) setRestoringOperation(current => current?.operation === operation ? null : current);
    }
  };

  const handleAddStage = () => {
    const fields = readStageFields(newName, newColor);
    if (!fields) return;
    const newStage = createDraftStage(stages, fields.name, fields.color);

    setDraftStages([...stages, newStage]);
    setNewName('');
    setIsAdding(false);

    // Scroll to bottom after addition
    setTimeout(() => {
      const scrollArea = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollArea) {
        scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: 'smooth' });
      }
    }, 100);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent onEscapeKeyDown={(event) => { if (editingId) { event.preventDefault(); handleCancelEdit(); } }} className="sm:max-w-md w-[90%] sm:w-full p-4 sm:p-6 rounded-[8px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] shadow-none">
          <DialogHeader className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3 pr-8 sm:flex-nowrap">
              <DialogTitle className="text-base sm:text-lg">Gerenciar Colunas</DialogTitle>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-[6px] border-0 bg-primary/10 text-xs text-primary hover:bg-primary/15 disabled:opacity-50"
                onClick={() => setIsAdding(true)}
                disabled={isAdding || isMutating}
              >
                <Plus className="h-3.5 w-3.5" />
                Nova Coluna
              </Button>
            </div>
            <DialogDescription className="text-xs sm:text-sm truncate">
              Reordene as colunas de &quot;{pipelineName}&quot;
            </DialogDescription>
          </DialogHeader>

          {isDraftStale && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2 text-xs">
              <span>As colunas mudaram em outra sessão. Seu rascunho foi mantido.</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-[6px]"
                onClick={() => {
                  setStageDraft(null);
                  setEditingId(null);
                  setIsAdding(false);
                  setNewName('');
                }}
              >
                Carregar versão atual
              </Button>
            </div>
          )}
          {saveError && <p role="alert" className="rounded-[6px] bg-destructive/10 p-3 text-xs text-destructive">{saveError}</p>}

          {/* Radix's table wrapper otherwise expands these rows to their intrinsic content width. */}
          <ScrollArea ref={scrollAreaRef} className="min-w-0 w-full max-h-[55vh] pr-2 sm:pr-4 [&_[data-radix-scroll-area-viewport]>div]:!block">
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="stages-list">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="min-w-0 w-full space-y-1.5 sm:space-y-2"
                  >
                    {stages.map((stage, index) => (
                      <Draggable key={stage.id} draggableId={stage.id} index={index} isDragDisabled={isMutating}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            style={{
                              ...provided.draggableProps.style,
                              ...(snapshot.isDragging && {
                                top: 'auto',
                                left: 'auto',
                              }),
                            }}
                            className={cn(
                              "flex min-w-0 items-center gap-1.5 sm:gap-2 rounded-[6px] bg-[var(--app-surface-soft)] p-2 sm:p-3 transition-colors",
                              snapshot.isDragging && "bg-[var(--app-surface-hover)] ring-1 ring-primary/30"
                            )}
                          >
                            <button
                              type="button"
                              {...provided.dragHandleProps}
                              className="shrink-0 cursor-grab rounded-[4px] p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/40 active:cursor-grabbing disabled:cursor-not-allowed"
                              aria-label={`Reordenar coluna ${stage.name}`}
                              disabled={isMutating}
                            >
                              <GripVertical className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
                            </button>

                            {editingId === stage.id ? (
                              // Edit mode
                              <div className="min-w-0 flex-1 flex items-center gap-1.5 sm:gap-2">
                                <input
                                  type="color"
                                  value={editingColor}
                                  onChange={(e) => setEditingColor(e.target.value)}
                                  aria-label={`Cor da coluna ${stage.name}`}
                                  disabled={isMutating}
                                  className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 rounded cursor-pointer border-0"
                                />
                                <Input
                                  value={editingName}
                                  aria-label={`Nome da coluna ${stage.name}`}
                                  onChange={(e) => setEditingName(e.target.value)}
                                  className="h-7 sm:h-8 min-w-0 flex-1 text-sm"
                                  autoFocus
                                  disabled={isMutating}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') { e.preventDefault(); handleSaveEdit(); }
                                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); handleCancelEdit(); }
                                  }}
                                />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 sm:h-7 sm:w-7 shrink-0"
                                  onClick={handleSaveEdit}
                                  disabled={isMutating}
                                  aria-label={`Confirmar edição da coluna ${stage.name}`}
                                >
                                  <Check className="h-3.5 w-3.5 text-primary" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 sm:h-7 sm:w-7 shrink-0"
                                  onClick={handleCancelEdit}
                                  disabled={isMutating}
                                  aria-label={`Cancelar edição da coluna ${stage.name}`}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ) : (
                              // View mode
                              <>
                                <div
                                  className="h-3 w-3 sm:h-4 sm:w-4 rounded-full shrink-0"
                                  style={{ backgroundColor: stage.color }}
                                />
                                <span className="min-w-0 flex-1 text-sm sm:text-base font-medium truncate" title={stage.name}>
                                  {stage.name}
                                </span>
                                {stage.lead_count !== undefined && stage.lead_count > 0 && (
                                  <span className="shrink-0 rounded-full bg-[var(--app-surface-soft)] px-1.5 py-0.5 text-xs text-muted-foreground sm:px-2">
                                    {stage.lead_count}
                                  </span>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 sm:h-7 sm:w-7 shrink-0"
                                  onClick={() => handleStartEdit(stage)}
                                  disabled={isMutating}
                                  aria-label={`Editar coluna ${stage.name}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 sm:h-7 sm:w-7 shrink-0 text-destructive hover:text-destructive"
                                  onClick={() => requestDeleteStage(stage)}
                                  disabled={isMutating}
                                  aria-label={`Excluir coluna ${stage.name}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}

                    {isAdding && (
                      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2 rounded-[6px] bg-[var(--app-surface-soft)] p-2 sm:p-3 animate-in slide-in-from-top-2">
                        <input
                          type="color"
                          value={newColor}
                          onChange={(e) => setNewColor(e.target.value)}
                          aria-label="Cor da nova coluna"
                          disabled={isMutating}
                          className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 rounded cursor-pointer border-0"
                        />
                        <Input
                          placeholder="Nome da coluna..."
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          className="h-7 sm:h-8 min-w-0 flex-1 text-sm"
                          autoFocus
                          disabled={isMutating}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAddStage();
                            if (e.key === 'Escape') setIsAdding(false);
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 sm:h-7 sm:w-7 shrink-0"
                          onClick={handleAddStage}
                          disabled={isMutating}
                          aria-label="Adicionar nova coluna ao rascunho"
                        >
                          <Check className="h-3.5 w-3.5 text-primary" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 sm:h-7 sm:w-7 shrink-0"
                          onClick={() => setIsAdding(false)}
                          disabled={isMutating}
                          aria-label="Cancelar nova coluna"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </ScrollArea>

          {archivedStages.some((stage) => !restoredStageIds.has(stage.id)) && (
            <section aria-label="Colunas arquivadas" className="space-y-2 rounded-[8px] bg-[var(--app-surface-soft)] p-3">
              <p className="text-xs text-muted-foreground">Colunas arquivadas preservam o histórico. Reativar não cria tarefas retroativas nem move leads.</p>
              {restoreError && <p role="alert" className="text-xs text-destructive">{restoreError}</p>}
              {archivedStages.filter((stage) => !restoredStageIds.has(stage.id)).map((stage) => (
                <div key={stage.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate" title={stage.name}>{stage.name}</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => void handleRestoreStage(stage.id)} disabled={isMutating} aria-label={`Reativar coluna ${stage.name}`}>
                    {restoringStageId === stage.id ? 'Reativando...' : 'Reativar'}
                  </Button>
                </div>
              ))}
            </section>
          )}
          <div className="flex gap-2 pt-3 sm:pt-4">
            <Button variant="outline" size="sm" className="w-[40%] rounded-[6px] border-0 bg-transparent hover:bg-[var(--app-surface-hover)]" onClick={() => handleOpenChange(false)} disabled={isMutating}>
              Cancelar
            </Button>
            <Button size="sm" className="w-[60%] rounded-[6px]" onClick={handleSave} disabled={isMutating || isDraftStale}>
              {isSaving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {hasPendingNewStage ? 'Criar e salvar' : canSave ? 'Salvar' : 'Fechar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar alterações das colunas?</AlertDialogTitle>
            <AlertDialogDescription>As alterações ainda não salvas serão perdidas. As colunas atuais serão preservadas.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setDiscardOpen(false); onOpenChange(false); }} disabled={isMutating}>Descartar alterações</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteStage}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !deleteStageMutation.isPending) closeDeletion(deleteStage);
        }}
      >
        <AlertDialogContent className="w-[calc(100vw-32px)] max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 shadow-none sm:w-full">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir coluna &quot;{deleteStage?.stage.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Colunas com leads, histórico ou configurações vinculadas não podem ser excluídas.
              {' '}Para ocultar uma coluna vazia preservando o histórico, use Arquivar nas configurações da coluna.
            </AlertDialogDescription>
            {deleteError && <p role="alert" className="text-xs text-destructive">{deleteError}</p>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteStageMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteStage();
              }}
              disabled={deleteStageMutation.isPending || deleteConflict || Boolean(deleteStage?.persisted && !deleteStage.input)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteStageMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {deleteStageMutation.isPending ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
