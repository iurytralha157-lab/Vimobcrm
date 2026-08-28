import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { GripVertical, Trash2, Loader2, Pencil, Check, X, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { createClientId } from '@/lib/client-id';
import { useDeleteStage, useReorderStages } from '@/hooks/use-stages';
import { PIPELINE_STAGE_COLOR_FALLBACK } from '@/config/pipeline-stage-colors';
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

interface Stage {
  id: string;
  name: string;
  color: string;
  position: number;
  lead_count?: number;
  stage_key?: string;
}

type StageDraft = {
  sourceKey: string;
  stages: Stage[];
  hasChanges: boolean;
};

interface StagesEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  pipelineName: string;
  stages: Stage[];
  onStagesUpdated: () => void;
}

export function StagesEditorDialog({
  open,
  onOpenChange,
  pipelineId,
  pipelineName,
  stages: initialStages,
  onStagesUpdated,
}: StagesEditorDialogProps) {
  const sortedInitialStages = [...initialStages].sort((a, b) => a.position - b.position);
  const initialStagesKey = open
    ? sortedInitialStages
      .map((stage) => `${stage.id}:${stage.position}:${stage.name}:${stage.color}:${stage.stage_key ?? ''}`)
      .join('|')
    : 'closed';
  const [stageDraft, setStageDraft] = useState<StageDraft>({
    sourceKey: '',
    stages: [],
    hasChanges: false,
  });
  const isDraftCurrent = stageDraft.sourceKey === initialStagesKey;
  const stages = isDraftCurrent ? stageDraft.stages : sortedInitialStages;
  const hasChanges = isDraftCurrent ? stageDraft.hasChanges : false;
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingColor, setEditingColor] = useState('');
  const [deleteStage, setDeleteStage] = useState<Stage | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>(PIPELINE_STAGE_COLOR_FALLBACK);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const saveInFlightRef = useRef(false);
  const deleteInFlightRef = useRef(false);
  const reorderStages = useReorderStages();
  const deleteStageMutation = useDeleteStage();
  const isMutating = isSaving || deleteStageMutation.isPending;

  useEffect(() => {
    if (open) return;

    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      setEditingId(null);
      setIsAdding(false);
      setDeleteStage(null);
      setNewName('');
      setStageDraft({ sourceKey: '', stages: [], hasChanges: false });
    });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const setDraftStages = (nextStages: Stage[], nextHasChanges = true) => {
    setStageDraft({
      sourceKey: initialStagesKey,
      stages: nextStages,
      hasChanges: nextHasChanges,
    });
  };

  const buildStageKey = (name: string) =>
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'coluna';

  const buildUniqueStageKey = (name: string, currentStages: Stage[]) => {
    const baseKey = buildStageKey(name);
    const existingKeys = new Set(
      currentStages
        .map((stage) => stage.stage_key)
        .filter((stageKey): stageKey is string => Boolean(stageKey))
    );

    if (!existingKeys.has(baseKey)) return baseKey;

    let suffix = 2;
    let nextKey = `${baseKey}_${suffix}`;
    while (existingKeys.has(nextKey)) {
      suffix += 1;
      nextKey = `${baseKey}_${suffix}`;
    }

    return nextKey;
  };

  const createLocalUuid = () => {
    return createClientId('stage');
  };

  const createDraftStage = (currentStages: Stage[], name: string): Stage => ({
    id: createLocalUuid(),
    name: name.trim(),
    color: newColor,
    position: currentStages.length,
    lead_count: 0,
    stage_key: buildUniqueStageKey(name, currentStages),
  });

  const pendingNewStageName = isAdding ? newName.trim() : '';
  const hasPendingNewStage = pendingNewStageName.length > 0;
  const canSave = hasChanges || hasPendingNewStage;

  const getErrorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message;
    return String(error);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isMutating) return;
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
    if (isMutating || saveInFlightRef.current) return;

    if (isAdding && pendingNewStageName.length < 2) {
      toast.error('O nome da coluna deve ter pelo menos 2 caracteres.');
      return;
    }

    if (!canSave) {
      handleOpenChange(false);
      return;
    }

    saveInFlightRef.current = true;
    setIsSaving(true);
    try {
      const stagesForSave = hasPendingNewStage
        ? [...stages, createDraftStage(stages, pendingNewStageName)]
        : stages;

      // First, handle any new stages that don't exist in the database yet
      // These have a UUID generated by crypto.randomUUID() which won't match existing rows

      const stagesToUpsert = stagesForSave.map((stage, index) => {
        // Preserva a stage_key existente ou gera uma nova se for realmente uma nova coluna
        const stageKey = stage.stage_key || buildUniqueStageKey(stage.name, stagesForSave);

        return {
          id: stage.id,
          pipeline_id: pipelineId,
          name: stage.name,
          color: stage.color,
          position: index,
          stage_key: stageKey
        };
      });

      await reorderStages.mutateAsync({
        pipelineId,
        stages: stagesToUpsert,
      });

      toast.success('Colunas atualizadas com sucesso!');
      setDraftStages(stagesForSave, false);
      setIsAdding(false);
      setNewName('');
      onStagesUpdated();
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error('Erro ao salvar: ' + getErrorMessage(error));
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  };

  const handleStartEdit = (stage: Stage) => {
    setEditingId(stage.id);
    setEditingName(stage.name);
    setEditingColor(stage.color);
  };

  const handleSaveEdit = () => {
    if (!editingId) return;
    const normalizedName = editingName.trim();
    if (normalizedName.length < 2) {
      toast.error('O nome da coluna deve ter pelo menos 2 caracteres.');
      return;
    }

    setDraftStages(stages.map(s =>
      s.id === editingId
        ? { ...s, name: normalizedName, color: editingColor }
        : s
    ));
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingName('');
    setEditingColor('');
  };

  const handleDeleteStage = async () => {
    const target = deleteStage;
    if (!target || deleteStageMutation.isPending || deleteInFlightRef.current) return;

    const isPersistedStage = sortedInitialStages.some((stage) => stage.id === target.id);
    if (!isPersistedStage) {
      setDraftStages(stages.filter((stage) => stage.id !== target.id));
      setDeleteStage(null);
      return;
    }

    deleteInFlightRef.current = true;
    try {
      await deleteStageMutation.mutateAsync(target.id);

      setDraftStages(stages.filter(s => s.id !== target.id), false);
      toast.success('Coluna excluída!');
      onStagesUpdated();
      setDeleteStage(null);
    } catch (error: unknown) {
      toast.error('Erro ao excluir: ' + getErrorMessage(error));
    } finally {
      deleteInFlightRef.current = false;
    }
  };

  const requestDeleteStage = (stage: Stage) => {
    const isPersistedStage = sortedInitialStages.some((candidate) => candidate.id === stage.id);
    if (isPersistedStage && (canSave || Boolean(editingId) || isAdding)) {
      toast.info('Salve ou descarte as alterações antes de excluir uma coluna existente.');
      return;
    }

    setDeleteStage(stage);
  };

  const handleAddStage = () => {
    if (newName.trim().length < 2) {
      toast.error('O nome da coluna deve ter pelo menos 2 caracteres.');
      return;
    }
    const newStage = createDraftStage(stages, newName);

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
        <DialogContent className="sm:max-w-md w-[90%] sm:w-full p-4 sm:p-6 rounded-[8px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] shadow-none">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3 pr-8">
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

          <ScrollArea ref={scrollAreaRef} className="max-h-[55vh] pr-2 sm:pr-4">
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="stages-list">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="space-y-1.5 sm:space-y-2"
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
                              "flex items-center gap-1.5 sm:gap-2 rounded-[6px] bg-[var(--app-surface-soft)] p-2 sm:p-3 transition-colors",
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
                              <div className="flex-1 flex items-center gap-1.5 sm:gap-2">
                                <input
                                  type="color"
                                  value={editingColor}
                                  onChange={(e) => setEditingColor(e.target.value)}
                                  aria-label={`Cor da coluna ${stage.name}`}
                                  disabled={isMutating}
                                  className="w-7 h-7 sm:w-8 sm:h-8 rounded cursor-pointer border-0"
                                />
                                <Input
                                  value={editingName}
                                  onChange={(e) => setEditingName(e.target.value)}
                                  className="h-7 sm:h-8 flex-1 text-sm"
                                  autoFocus
                                  disabled={isMutating}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveEdit();
                                    if (e.key === 'Escape') handleCancelEdit();
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
                                <span className="flex-1 text-sm sm:text-base font-medium truncate">
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
                      <div className="flex items-center gap-1.5 sm:gap-2 rounded-[6px] bg-[var(--app-surface-soft)] p-2 sm:p-3 animate-in slide-in-from-top-2">
                        <input
                          type="color"
                          value={newColor}
                          onChange={(e) => setNewColor(e.target.value)}
                          aria-label="Cor da nova coluna"
                          disabled={isMutating}
                          className="w-7 h-7 sm:w-8 sm:h-8 rounded cursor-pointer border-0"
                        />
                        <Input
                          placeholder="Nome da coluna..."
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          className="h-7 sm:h-8 flex-1 text-sm"
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

          <div className="flex gap-2 pt-3 sm:pt-4">
            <Button variant="outline" size="sm" className="w-[40%] rounded-[6px] border-0 bg-transparent hover:bg-[var(--app-surface-hover)]" onClick={() => handleOpenChange(false)} disabled={isMutating}>
              Cancelar
            </Button>
            <Button size="sm" className="w-[60%] rounded-[6px]" onClick={handleSave} disabled={isMutating}>
              {isSaving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {hasPendingNewStage ? 'Criar e salvar' : hasChanges ? 'Salvar' : 'Fechar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteStage}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !deleteStageMutation.isPending) setDeleteStage(null);
        }}
      >
        <AlertDialogContent className="w-[calc(100vw-32px)] max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 shadow-none sm:w-full">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir coluna &quot;{deleteStage?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Certifique-se de que não há leads nesta coluna.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteStageMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteStage();
              }}
              disabled={deleteStageMutation.isPending}
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
