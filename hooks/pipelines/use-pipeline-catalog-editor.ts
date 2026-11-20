import { useCallback, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { PIPELINE_STAGE_COLOR_FALLBACK } from '@/config/pipeline-stage-colors';
import { usePipelineEditorVisit, type PipelineEditorOperation } from '@/hooks/pipelines/use-pipeline-editor-visit';
import {
  usePipelineCreateMutation,
  usePipelineDeleteMutation,
  useStageCreateMutation,
  useStageUpdateMutation,
  type PipelineDeleteData,
} from '@/hooks/pipelines/use-pipeline-mutations';
import type { Stage } from '@/hooks/use-stages';
import { getErrorObjectMessage as getPipelineErrorMessage, VimobAPIError } from '@/lib/api/vimob-error';
import { pipelineRevisionSchema, stageHexColorInputSchema } from '@/lib/validation';

type PipelineCatalogEditorOptions = {
  selectedPipelineId: string | null;
  pipelines: readonly { id: string }[];
  canEditPipeline: boolean;
  handleSelectPipeline: (pipelineId: string | null) => void;
};

export function usePipelineCatalogEditor({
  selectedPipelineId,
  pipelines,
  canEditPipeline,
  handleSelectPipeline,
}: PipelineCatalogEditorOptions) {
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingStageName, setEditingStageName] = useState('');
  // Keep the revision of the stage that opened the inline editor.
  const editingStageBaseRef = useRef<{ id: string; name: string; updatedAt?: string | null } | null>(null);
  const [savingStageName, setSavingStageName] = useState<{ id: string; operation: PipelineEditorOperation } | null>(null);
  const [newPipelineDialogOpen, setNewPipelineDialogOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');
  const [newStageDialogOpen, setNewStageDialogOpen] = useState(false);
  const [newStageName, setNewStageName] = useState('');
  const [newStageColor, setNewStageColor] = useState<string>(PIPELINE_STAGE_COLOR_FALLBACK);
  const newStageColorValidation = useMemo(
    () => stageHexColorInputSchema.safeParse(newStageColor),
    [newStageColor],
  );
  const [pipelineToDelete, setPipelineToDelete] = useState<PipelineDeleteData | null>(null);
  const pipelineDeletionRef = useRef<PipelineDeleteData | null>(null);
  const [deletePipelineBlocked, setDeletePipelineBlocked] = useState(false);
  const [deletePipelineError, setDeletePipelineError] = useState<string | null>(null);
  const stageNameUpdateInFlightRef = useRef(new Map<string, PipelineEditorOperation>());
  const createPipelineInFlightRef = useRef<PipelineEditorOperation | null>(null);
  const createStageInFlightRef = useRef<PipelineEditorOperation | null>(null);
  const deletePipelineInFlightRef = useRef(false);

  const pipelineNavigationRef = useRef({ selectedPipelineId, pipelines });
  useLayoutEffect(() => { pipelineNavigationRef.current = { selectedPipelineId, pipelines }; }, [selectedPipelineId, pipelines]);
  const createPipeline = usePipelineCreateMutation();
  const createStage = useStageCreateMutation();
  const updateStageName = useStageUpdateMutation();
  const createPipelineVisit = usePipelineEditorVisit(createPipeline.scopeKey, JSON.stringify([newPipelineDialogOpen, selectedPipelineId]), createPipeline.captureScopeGuard);
  const createStageVisit = usePipelineEditorVisit(createStage.scopeKey, JSON.stringify([newStageDialogOpen, selectedPipelineId]), createStage.captureScopeGuard);
  const stageNameVisit = usePipelineEditorVisit(updateStageName.scopeKey, JSON.stringify([selectedPipelineId, editingStageId]), updateStageName.captureScopeGuard);
  const savingStageNameId = savingStageName?.operation.visit === stageNameVisit.key ? savingStageName.id : null;
  const deletePipeline = usePipelineDeleteMutation();

  const resetCatalogDialogs = useCallback(() => {
    setNewPipelineDialogOpen(false);
    setNewStageDialogOpen(false);
    setPipelineToDelete(null);
  }, []);

  const handleStageName = async (stageId: string) => {
    const operation = stageNameVisit.capture();
    if (!operation.isCurrent() || stageNameUpdateInFlightRef.current.get(stageId)?.visit === operation.visit) return;

    const nextStageName = editingStageName.trim();
    if (nextStageName.length < 2 || nextStageName.length > 120) {
      toast.error('O nome da coluna deve ter entre 2 e 120 caracteres.');
      return;
    }

    const base = editingStageBaseRef.current;
    if (base?.id !== stageId) return;
    const currentStageName = base.name.trim();
    if (currentStageName === nextStageName) {
      if (editingStageBaseRef.current === base) editingStageBaseRef.current = null;
      setEditingStageId(null);
      return;
    }

    stageNameUpdateInFlightRef.current.set(stageId, operation);
    setSavingStageName({ id: stageId, operation });

    try {
      if (!base.updatedAt) throw new Error('Reabra a edição para carregar a versão atual da coluna.');
      await updateStageName.mutateAsync({ id: stageId, name: nextStageName, expectedUpdatedAt: base.updatedAt });
      if (!operation.isCurrent()) return;
      if (editingStageBaseRef.current === base) editingStageBaseRef.current = null;
      setEditingStageId((current) => current === stageId ? null : current);
      toast.success('Nome atualizado!');
    } catch (error: unknown) {
      if (!operation.isCurrent()) return;
      toast.error('Não foi possível atualizar o nome: ' + getPipelineErrorMessage(error));
    } finally {
      if (stageNameUpdateInFlightRef.current.get(stageId) === operation) stageNameUpdateInFlightRef.current.delete(stageId);
      if (operation.isCurrent()) setSavingStageName(current => current?.operation === operation ? null : current);
    }
  };

  const handleCreatePipeline = async (e: FormEvent) => {
    e.preventDefault();
    const operation = createPipelineVisit.capture();
    if (!newPipelineDialogOpen || !operation.isCurrent() || createPipelineInFlightRef.current?.visit === operation.visit) return;
    const normalizedName = newPipelineName.trim();
    if (normalizedName.length < 2) {
      toast.error('O nome da pipeline deve ter pelo menos 2 caracteres.');
      return;
    }

    createPipelineInFlightRef.current = operation;
    try {
      const pipeline = await createPipeline.mutateAsync({ name: normalizedName });
      if (!operation.isCurrent()) return;
      handleSelectPipeline(pipeline.id);
      setNewPipelineDialogOpen(false);
      setNewPipelineName('');
      toast.success('Pipeline criada com sucesso!');
    } catch (error: unknown) {
      if (!operation.isCurrent()) return;
      toast.error('Erro ao criar pipeline: ' + getPipelineErrorMessage(error));
    } finally {
      if (createPipelineInFlightRef.current === operation) createPipelineInFlightRef.current = null;
    }
  };

  const handleCreateStage = async (event: FormEvent) => {
    event.preventDefault();
    const operation = createStageVisit.capture();
    if (!newStageDialogOpen || !operation.isCurrent() || createStageInFlightRef.current?.visit === operation.visit) return;
    const normalizedName = newStageName.trim();
    if (!selectedPipelineId) return;
    if (normalizedName.length < 2) {
      toast.error('O nome da coluna deve ter pelo menos 2 caracteres.');
      return;
    }
    if (!newStageColorValidation.success) {
      toast.error(
        newStageColorValidation.error.issues[0]?.message ||
          'Informe uma cor válida.',
      );
      return;
    }

    createStageInFlightRef.current = operation;
    try {
      await createStage.mutateAsync({
        pipelineId: selectedPipelineId,
        name: normalizedName,
        color: newStageColorValidation.data,
      });
      if (!operation.isCurrent()) return;
      setNewStageDialogOpen(false);
      setNewStageName('');
      setNewStageColor(PIPELINE_STAGE_COLOR_FALLBACK);
      toast.success('Coluna criada com sucesso!');
    } catch (error: unknown) {
      if (!operation.isCurrent()) return;
      toast.error('Erro ao criar coluna: ' + getPipelineErrorMessage(error));
    } finally {
      if (createStageInFlightRef.current === operation) createStageInFlightRef.current = null;
    }
  };

  const closePipelineDeletion = (target: PipelineDeleteData | null) => {
    if (pipelineDeletionRef.current !== target) return;
    if (target) deletePipeline.discard(target);
    pipelineDeletionRef.current = null;
    setPipelineToDelete(null);
    setDeletePipelineBlocked(false);
    setDeletePipelineError(null);
  };

  const handleRequestDeletePipeline = (pipeline: { id: string; name: string; revision?: string }) => {
    if (!canEditPipeline || !deletePipeline.isScopeCurrent() || deletePipeline.isPending || deletePipelineInFlightRef.current) return;
    const revision = pipelineRevisionSchema.safeParse(pipeline.revision);
    if (!revision.success) {
      toast.error('Não foi possível confirmar a versão desta pipeline. Atualize a lista antes de excluir.');
      return;
    }
    try {
      const captured = deletePipeline.capture({ id: pipeline.id, name: pipeline.name, expectedRevision: revision.data });
      closePipelineDeletion(pipelineDeletionRef.current);
      pipelineDeletionRef.current = captured;
      setPipelineToDelete(captured);
    } catch (error) {
      if (deletePipeline.isScopeCurrent()) toast.error(getPipelineErrorMessage(error));
    }
  };

  const handleDeletePipeline = async () => {
    const target = pipelineToDelete;
    if (!canEditPipeline || !target || pipelineDeletionRef.current !== target || !deletePipeline.isCurrent(target) || deletePipelineBlocked || deletePipeline.isPending || deletePipelineInFlightRef.current) return;

    deletePipelineInFlightRef.current = true;
    setDeletePipelineError(null);
    try {
      await deletePipeline.mutateAsync(target);
      if (pipelineDeletionRef.current !== target || !deletePipeline.isCurrent(target)) return;
      const currentNavigation = pipelineNavigationRef.current;
      const nextPipeline = currentNavigation.pipelines.find((pipeline) => pipeline.id !== target.id) || null;

      if (currentNavigation.selectedPipelineId === target.id) {
        handleSelectPipeline(nextPipeline?.id || null);
      }

      closePipelineDeletion(target);
      toast.success('Pipeline excluída com sucesso!');
    } catch (error: unknown) {
      if (pipelineDeletionRef.current !== target || !deletePipeline.isCurrent(target)) return;
      const conflict = error instanceof VimobAPIError && error.code === 'pipeline_changed';
      if (conflict) {
        // Retire the original intent too: previously rendered callbacks may
        // still hold the unblocked state after the conflict is displayed.
        deletePipeline.discard(target);
        setDeletePipelineBlocked(true);
      }
      const message = conflict ? 'A pipeline ou suas colunas mudaram. Feche esta confirmação, atualize a lista e confira antes de excluir.'
        : 'Erro ao excluir pipeline: ' + getPipelineErrorMessage(error);
      setDeletePipelineError(message);
      toast.error(message);
    } finally {
      deletePipelineInFlightRef.current = false;
    }
  };

  const onPipelineToDeleteOpenChange = (open: boolean) => {
    if (!open && !deletePipeline.isPending) closePipelineDeletion(pipelineToDelete);
  };

  return {
    resetCatalogDialogs,
    openNewPipeline: () => setNewPipelineDialogOpen(true),
    openNewStage: () => setNewStageDialogOpen(true),
    handleRequestDeletePipeline,
    inlineRename: {
      editingStageId,
      editingStageName,
      savingStageNameId,
      onEditingStageNameChange: setEditingStageName,
      onStartEditingStage: (stage: Pick<Stage, 'id' | 'name' | 'updated_at'>) => {
        editingStageBaseRef.current = { id: stage.id, name: stage.name, updatedAt: stage.updated_at };
        setEditingStageId(stage.id);
        setEditingStageName(stage.name);
      },
      onCommitStageName: (stageId: string) => void handleStageName(stageId),
      onCancelEditingStage: () => {
        editingStageBaseRef.current = null;
        setEditingStageId(null);
        setEditingStageName('');
      },
    },
    dialogProps: {
      newPipelineDialogOpen,
      newPipelineName,
      createPipelinePending: createPipeline.isPending,
      newStageDialogOpen,
      newStageName,
      newStageColor,
      newStageColorIsValid: newStageColorValidation.success,
      normalizedNewStageColor: newStageColorValidation.success ? newStageColorValidation.data : PIPELINE_STAGE_COLOR_FALLBACK,
      createStagePending: createStage.isPending,
      pipelineToDelete,
      deletePipelinePending: deletePipeline.isPending,
      deletePipelineBlocked,
      deletePipelineError,
      onNewPipelineDialogOpenChange: setNewPipelineDialogOpen,
      onNewPipelineNameChange: setNewPipelineName,
      onCreatePipeline: (event: FormEvent) => void handleCreatePipeline(event),
      onNewStageDialogOpenChange: setNewStageDialogOpen,
      onNewStageNameChange: setNewStageName,
      onNewStageColorChange: setNewStageColor,
      onCreateStage: (event: FormEvent) => void handleCreateStage(event),
      onPipelineToDeleteOpenChange,
      onDeletePipeline: () => void handleDeletePipeline(),
    },
  };
}
