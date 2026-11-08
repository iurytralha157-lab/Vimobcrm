import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { AlertCircle, Archive, Lock, Target, Trophy } from 'lucide-react';
import { useCanEditCadences } from '@/hooks/use-can-edit-cadences';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { useOrganizationModules } from '@/hooks/use-organization-modules';
import { useRoundRobins } from '@/hooks/use-round-robins';
import {
  canManagePipeline,
  canManageStageAutomations,
  canViewStageAutomations,
} from '@/lib/access/pipeline-settings-access';
import { useStages, useUpdateStage } from '@/hooks/use-stages';
import { usePipelineEditorVisit, type PipelineEditorOperation } from '@/hooks/pipelines/use-pipeline-editor-visit';
import { toast } from 'sonner';
import { AutomationForm } from '@/components/features/automations/AutomationForm';
import { AutomationsList } from '@/components/features/automations/AutomationsList';
import { StageOperationalRules } from '@/components/features/cadences';
import { StageSettingsActions, StageSettingsFooterProvider } from './stage-settings-footer';
import { useStageInactivityAlertEditor } from './stage-inactivity-alert';
import { StageAutomation } from '@/hooks/use-stage-automations';
import { getStructuredErrorMessage } from '@/lib/api/vimob-error';
import { StageColorPicker } from './StageColorPicker';
import { stageGeneralChanges, stageSettingsRevision } from './stage-settings-draft';
import { PIPELINE_STAGE_COLOR_FALLBACK } from '@/config/pipeline-stage-colors';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export type StageSettingsTab = 'general' | 'cadence' | 'automations';

interface StageSettingsDialogProps {
  open: boolean;
  initialTab?: StageSettingsTab;
  returnFocusElement?: HTMLButtonElement | null;
  onOpenChange: (open: boolean) => void;
  stage: {
    id: string;
    name: string;
    color: string;
    stage_key: string;
    pipeline_id?: string;
    is_qualified?: boolean;
    is_won?: boolean;
    is_lost?: boolean;
    is_active?: boolean;
    updated_at?: string | null;
  } | null;
  onStageUpdate: () => void;
}

export function StageSettingsDialog({
  open,
  onOpenChange,
  stage,
  onStageUpdate,
  initialTab = 'general',
  returnFocusElement,
}: StageSettingsDialogProps) {
  const updateStage = useUpdateStage();
  const editorVisit = usePipelineEditorVisit(updateStage.scopeKey, JSON.stringify([open, stage?.id]), updateStage.captureScopeGuard);
  const [name, setName] = useState(stage?.name || '');
  const [color, setColor] = useState(stage?.color || PIPELINE_STAGE_COLOR_FALLBACK);
  const [isQualified, setIsQualified] = useState(stage?.is_qualified || false);
  const [generalBase, setGeneralBase] = useState(stage);
  const openedStageRef = useRef<string | null>(null);
  const [savingOperation, setSavingOperation] = useState<PipelineEditorOperation | null>(null);
  const isSaving = savingOperation?.visit === editorVisit.key;
  const [generalError, setGeneralError] = useState<string | null>(null);
  const saveInFlightRef = useRef<PipelineEditorOperation | null>(null);
  const { hasPermission } = useUserPermissions();
  const { hasModule } = useOrganizationModules();
  const canEditPipeline = canManagePipeline(hasPermission);
  const canEditRules = useCanEditCadences();
  const hasAutomationsModule = hasModule('automations');
  const canViewAutomations = canViewStageAutomations(hasPermission, hasAutomationsModule);
  const canEditAutomations = canManageStageAutomations(hasPermission, hasAutomationsModule);
  const canManageDistribution = hasPermission('distribution_manage');

  // Automation state
  const [automationFormOpen, setAutomationFormOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<StageAutomation | null>(null);
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const showDistributionNames = open && activeTab === 'automations' && canViewAutomations && canManageDistribution && !automationFormOpen && !editingAutomation;
  const { data: distributions } = useRoundRobins({ enabled: showDistributionNames });
  const distributionNames = useMemo(() => Object.fromEntries((distributions ?? []).map((item) => [item.id, item.name])), [distributions]);
  const [rulesState, setRulesState] = useState({ isDirty: false, isSaving: false });
  const [automationState, setAutomationState] = useState({ isDirty: false, isSaving: false });
  const [listSaving, setListSaving] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [pendingDiscardAction, setPendingDiscardAction] = useState<(() => void) | null>(null);
  const [footerNode, setFooterNode] = useState<HTMLDivElement | null>(null);
  const stagesQuery = useStages(open ? stage?.pipeline_id : undefined);
  const pipelineStages = stagesQuery.data;
  const stageNames = useMemo(() => Object.fromEntries((pipelineStages ?? []).map((item) => [item.id, item.name])), [pipelineStages]);
  // Move rules never send leads to this column, to Won/Lost or to archived columns.
  const moveTargets = useMemo(() => pipelineStages
    ?.filter((item) => item.id !== stage?.id && !item.is_won && !item.is_lost && item.is_active !== false)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((item) => ({ id: item.id, name: item.name })), [pipelineStages, stage?.id]);
  const handleRulesState = useCallback((state: { isDirty: boolean; isSaving: boolean }) => setRulesState(state), []);
  const handleAutomationState = useCallback((state: { isDirty: boolean; isSaving: boolean }) => setAutomationState(state), []);
  const isBusy = isSaving || rulesState.isSaving || automationState.isSaving || listSaving;
  const generalDirty = Boolean(generalBase && Object.keys(stageGeneralChanges(generalBase, { name, color, isQualified })).length);
  const hasUnsavedChanges = generalDirty || rulesState.isDirty || automationState.isDirty;
  const requestAction = (action: () => void) => {
    if (isBusy) return;
    if (hasUnsavedChanges) { setPendingDiscardAction(() => action); return; }
    action();
  };
  const closeAutomationForm = () => {
    setAutomationFormOpen(false);
    setEditingAutomation(null);
    setAutomationState({ isDirty: false, isSaving: false });
  };

  const qualificationRestriction = stage?.is_won
    ? 'Colunas de Ganho já representam a conversão final do lead.'
    : stage?.is_lost
      ? 'Colunas de Perdido não podem ser usadas como etapa de qualificação.'
      : stage?.is_active === false
        ? 'Ative esta coluna antes de usá-la como etapa de qualificação.'
        : null;
  const canToggleQualification = canEditPipeline && (!qualificationRestriction || isQualified);

  // Initialize once per opening/selected stage. A refetch never replaces the draft.
  /* eslint-disable react-hooks/set-state-in-effect -- Initializes a new editor session, preserving its base revision until explicitly closed. */
  useEffect(() => {
    const nextId = open && stage ? stage.id : null;
    if (openedStageRef.current === nextId) return;
    openedStageRef.current = nextId;
    if (stage && nextId) {
      setGeneralBase({ ...stage });
      setName(stage.name);
      setColor(stage.color || PIPELINE_STAGE_COLOR_FALLBACK);
      setIsQualified(stage.is_qualified || false);
      setGeneralError(null);
    }
  }, [open, stage]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSaveGeneral = async () => {
    const operation = editorVisit.capture();
    if (!open || !operation.isCurrent() || !stage || generalBase?.id !== stage.id || !canEditPipeline || isSaving || saveInFlightRef.current?.visit === operation.visit) return;
    const normalizedName = name.trim();
    if (normalizedName.length < 2) {
      toast.error('O nome da coluna deve ter pelo menos 2 caracteres.');
      return;
    }
    saveInFlightRef.current = operation;
    setSavingOperation(operation);
    setGeneralError(null);

    try {
      const changes = stageGeneralChanges(generalBase, { name: normalizedName, color, isQualified });
      if (!Object.keys(changes).length) return;
      const saved = await updateStage.mutateAsync({ id: stage.id, expectedUpdatedAt: stageSettingsRevision(generalBase), ...changes });
      if (!operation.isCurrent()) return;
      setGeneralBase({ ...generalBase, ...saved, color: saved.color || PIPELINE_STAGE_COLOR_FALLBACK });
      toast.success('Configurações salvas!');
      onStageUpdate();
    } catch (error: unknown) {
      if (!operation.isCurrent()) return;
      const message = 'Erro ao salvar: ' + getStructuredErrorMessage(error, {
        fields: ['message', 'details', 'hint', 'code'],
        includeArrays: true,
      }) + ' Seu rascunho foi mantido.';
      setGeneralError(message);
      toast.error(message);
    } finally {
      if (saveInFlightRef.current === operation) saveInFlightRef.current = null;
      if (operation.isCurrent()) setSavingOperation(current => current === operation ? null : current);
    }
  };

  const handleQualifiedChange = (checked: boolean) => {
    if (checked && qualificationRestriction) return;
    setIsQualified(checked);
  };

  const handleArchive = async () => {
    const operation = editorVisit.capture();
    if (!open || !operation.isCurrent() || !stage || generalBase?.id !== stage.id || !canEditPipeline || isBusy || saveInFlightRef.current?.visit === operation.visit) return;
    saveInFlightRef.current = operation;
    setSavingOperation(operation);
    setArchiveError(null);
    try {
      await updateStage.mutateAsync({ id: stage.id, expectedUpdatedAt: stageSettingsRevision(generalBase), isActive: false });
      if (!operation.isCurrent()) return;
      toast.success('Coluna arquivada. O histórico foi preservado.');
      setArchiveOpen(false);
      onStageUpdate();
    } catch (error) {
      if (!operation.isCurrent()) return;
      setArchiveError(getStructuredErrorMessage(error) || 'Não foi possível arquivar esta coluna. Nenhum histórico foi removido.');
    } finally {
      if (saveInFlightRef.current === operation) saveInFlightRef.current = null;
      if (operation.isCurrent()) setSavingOperation(current => current === operation ? null : current);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) onOpenChange(true);
    else requestAction(() => onOpenChange(false));
  };

  if (!stage) return null;

  return (
    <>
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="flex w-[calc(100vw-16px)] flex-col gap-0 overflow-hidden border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)] shadow-none sm:w-[650px] sm:max-w-[650px] [&>button]:grid [&>button]:size-7 [&>button]:place-items-center [&>button]:bg-[var(--app-surface-soft)] [&>button]:opacity-100 [&>button:hover]:bg-[var(--app-surface-hover)]"
        onCloseAutoFocus={(event) => {
          if (!returnFocusElement?.isConnected) return;
          event.preventDefault();
          returnFocusElement.focus();
        }}
      >
        <SheetHeader className="shrink-0 px-4 pb-0.5 pt-5 text-left sm:px-6">
          <SheetTitle className="pr-10 text-[17px] font-normal">Configurações da coluna</SheetTitle>
        </SheetHeader>

        <StageSettingsFooterProvider value={{ node: footerNode, close: () => handleOpenChange(false) }}>
        <Tabs value={activeTab} onValueChange={(value) => requestAction(() => setActiveTab(value))} className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-4 pt-4 sm:px-6">
            <TabsList className="grid w-full grid-cols-3 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-1">
              <TabsTrigger value="general" className="rounded-[6px] text-xs data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[var(--app-text-primary)]">Geral</TabsTrigger>
              <TabsTrigger value="cadence" className="rounded-[6px] text-xs data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[var(--app-text-primary)]"><span className="sm:hidden">Regras</span><span className="hidden sm:inline">Regras da etapa</span></TabsTrigger>
              <TabsTrigger value="automations" className="rounded-[6px] text-xs data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[var(--app-text-primary)]">Automações</TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4 sm:px-6">
          {/* General Settings Tab */}
          <TabsContent value="general" className="mt-0 space-y-4">
            {!canEditPipeline && (
              <Badge variant="secondary" className="gap-1">
                <Lock className="h-3 w-3" />
                Somente visualização
              </Badge>
            )}
            <section className="space-y-4 rounded-[8px] bg-[var(--app-surface-soft)] p-4">
            <div className="space-y-2">
              <Label htmlFor="stage-settings-name">Nome da coluna</Label>
              <Input
                id="stage-settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome do estágio"
                disabled={!canEditPipeline || isBusy}
                className="h-10 rounded-[6px] border-0 bg-[var(--app-surface-solid)]"
              />
            </div>

            <div className="space-y-2">
              <Label>Cor da coluna</Label>
              {canEditPipeline ? (
                <fieldset disabled={isBusy}><StageColorPicker value={color} onChange={setColor} /></fieldset>
              ) : (
                <div className="flex items-center gap-3 rounded-[6px] border-0 bg-[var(--app-surface-solid)] p-2">
                  <div
                    className="w-6 h-6 rounded-[6px] border-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="font-mono text-sm text-muted-foreground">{color}</span>
                </div>
              )}
            </div>
            </section>
            <section
              aria-labelledby="marketing-results-title"
              className="space-y-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-hover)] text-primary">
                  <Target className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 id="marketing-results-title" className="text-sm font-medium text-[var(--app-text-primary)]">
                      Resultados de Marketing
                    </h3>
                    <Badge
                      variant="secondary"
                      className="h-5 rounded-[4px] border-0 bg-[var(--app-surface-hover)] px-2 text-[12px] font-light text-[var(--app-text-secondary)] shadow-none"
                    >
                      Por pipeline
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="rounded-[6px] bg-[var(--app-surface-solid)] p-3">
                <div className="flex items-center justify-between gap-4">
                  <Label
                    htmlFor="stage-is-qualified"
                    className="text-[12px] font-medium leading-5 text-[var(--app-text-primary)]"
                  >
                    Qualificar leads ao entrar nesta coluna
                  </Label>
                  <Switch
                    id="stage-is-qualified"
                    checked={isQualified}
                    onCheckedChange={handleQualifiedChange}
                    disabled={!canToggleQualification || isBusy}
                    aria-describedby={
                      qualificationRestriction
                        ? 'stage-is-qualified-description stage-is-qualified-restriction'
                        : 'stage-is-qualified-description'
                    }
                    aria-label="Definir esta coluna como etapa de lead qualificado"
                  />
                </div>
                <p
                  id="stage-is-qualified-description"
                  className="mt-1.5 text-[12px] font-light leading-4 text-[var(--app-text-tertiary)]"
                >
                  A entrada nesta coluna conta como qualificação nos relatórios. Leads elegíveis da Meta também podem enviar esse evento pela integração ativa. Cada pipeline tem uma etapa de qualificação.
                </p>

                {qualificationRestriction ? (
                  <div
                    id="stage-is-qualified-restriction"
                    className="mt-3 flex items-start gap-2 rounded-[6px] bg-[var(--app-surface-hover)] px-3 py-2.5 text-[12px] font-light leading-4 text-[var(--app-text-secondary)]"
                  >
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                    <span>{qualificationRestriction}</span>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-3 rounded-[6px] bg-[var(--app-surface-solid)] p-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-emerald-500/10 text-emerald-500">
                  <Trophy className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-[var(--app-text-primary)]">Convertido</p>
                  <p className="mt-0.5 text-[12px] font-light leading-4 text-[var(--app-text-tertiary)]">
                    O lead conta como convertido quando é marcado como Ganho.
                  </p>
                </div>
              </div>
            </section>

            {canEditPipeline && stage.is_active !== false && (
              <section aria-labelledby="stage-archive-title" className="flex flex-col gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-hover)] text-[var(--app-text-secondary)]">
                    <Archive className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h3 id="stage-archive-title" className="text-sm font-medium text-[var(--app-text-primary)]">Arquivar coluna</h3>
                    <p className="mt-1 text-[12px] font-light leading-4 text-[var(--app-text-tertiary)]">Oculta a coluna no board e preserva o histórico. Só colunas vazias, sem entradas ou regras de mudança apontando para ela, podem ser arquivadas.</p>
                  </div>
                </div>
                <Button type="button" variant="ghost" className="h-9 shrink-0 rounded-[6px] bg-[var(--app-surface-solid)] px-4 text-xs font-light shadow-none hover:bg-[var(--app-surface-hover)]" disabled={isBusy} onClick={() => requestAction(() => { setArchiveError(null); setArchiveOpen(true); })}>Arquivar coluna</Button>
              </section>
            )}
            {generalError && <p role="alert" className="rounded-[6px] bg-destructive/10 p-3 text-xs text-destructive">{generalError}</p>}
            <StageSettingsActions
              status={canEditPipeline ? (generalDirty ? 'Alterações ainda não salvas' : 'Tudo salvo') : null}
              cancelLabel={canEditPipeline ? 'Cancelar' : 'Fechar'}
              cancelDisabled={isBusy}
              primary={canEditPipeline ? { label: 'Salvar', onClick: () => void handleSaveGeneral(), loading: isSaving, disabled: isBusy || !generalDirty } : undefined}
            />
          </TabsContent>

          {/* Rules Tab */}
          <TabsContent value="cadence" className="mt-0 space-y-4">
            <StageRulesTab
              stageId={stage.id}
              stageName={stage.name}
              canEditRules={canEditRules}
              alertEnabled={canViewAutomations}
              canEditAlert={canEditAutomations}
              onEditorStateChange={handleRulesState}
            />
          </TabsContent>

          {/* Automations Tab */}
          <TabsContent value="automations" className="mt-0 space-y-4">
            {!canViewAutomations ? (
              <>
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <Lock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Você não tem acesso às automações desta organização</p>
                </div>
                <StageSettingsActions cancelLabel="Fechar" />
              </>
            ) : canEditAutomations && (automationFormOpen || editingAutomation) ? (
              <div className="rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-4">
                <h4 className="mb-4 text-sm font-normal">
                  {editingAutomation ? 'Editar automação' : 'Nova automação'}
                </h4>
                <AutomationForm
                  key={`${stage.id}:${editingAutomation?.id || 'new'}`}
                  stageId={stage.id}
                  pipelineId={stage.pipeline_id || ''}
                  automation={editingAutomation}
                  terminalStatus={stage.is_won ? 'won' : stage.is_lost ? 'lost' : null}
                  moveTargets={moveTargets}
                  moveTargetsLoading={stagesQuery.isPending}
                  canManageDistribution={canManageDistribution}
                  onEditorStateChange={handleAutomationState}
                  onSuccess={() => {
                    closeAutomationForm();
                  }}
                  onCancel={() => {
                    requestAction(closeAutomationForm);
                  }}
                />
              </div>
            ) : (
              <>
                <div>
                  <h3 className="text-sm font-normal text-[var(--app-text-primary)]">Automações da coluna</h3>
                  <p className="mt-1 text-xs font-light leading-[18px] text-[var(--app-text-tertiary)]">
                    Escolha o que acontece na entrada do lead ou após um prazo sem atividade.
                  </p>
                </div>
                <AutomationsList
                  stageId={stage.id}
                  pipelineId={stage.pipeline_id || ''}
                  canEdit={canEditAutomations}
                  stageNames={stageNames}
                  canManageDistribution={canManageDistribution}
                  distributionNames={distributionNames}
                  hideManagedAlert
                  onSavingChange={setListSaving}
                  onEdit={canEditAutomations ? (automation) => setEditingAutomation(automation) : undefined}
                />
                <StageSettingsActions
                  cancelLabel="Fechar"
                  cancelDisabled={isBusy}
                  primary={canEditAutomations ? { label: 'Nova automação', onClick: () => setAutomationFormOpen(true), disabled: isBusy } : undefined}
                />
              </>
            )}
          </TabsContent>
          </div>
        </Tabs>
        </StageSettingsFooterProvider>
        <div ref={setFooterNode} className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--app-border)] bg-[var(--app-surface-solid)] px-4 py-3 sm:px-6" />
      </SheetContent>
    </Sheet>
    <AlertDialog open={archiveOpen} onOpenChange={(nextOpen) => { if (!isBusy) setArchiveOpen(nextOpen); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Arquivar a coluna {stage.name}?</AlertDialogTitle>
          <AlertDialogDescription>A coluna ficará oculta no board. Nenhum lead ou histórico será excluído. O servidor verifica se ela está vazia e se há entradas ativas vinculadas; redirecione ou desative essas entradas antes de arquivar. Você poderá reativá-la em Gerenciar colunas.</AlertDialogDescription>
          {archiveError && <p role="alert" className="text-xs text-destructive">{archiveError}</p>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction disabled={isBusy} onClick={(event) => { event.preventDefault(); void handleArchive(); }}>{isSaving ? 'Arquivando...' : 'Arquivar coluna'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={pendingDiscardAction !== null} onOpenChange={(nextOpen) => { if (!nextOpen) setPendingDiscardAction(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Descartar alterações não salvas?</AlertDialogTitle>
          <AlertDialogDescription>As alterações desta coluna ainda não foram salvas. Você pode continuar editando ou descartá-las para sair desta tela.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Continuar editando</AlertDialogCancel>
          <AlertDialogAction disabled={isBusy} onClick={() => {
            const action = pendingDiscardAction;
            setPendingDiscardAction(null);
            setGeneralBase({ ...stage });
            setName(stage.name);
            setColor(stage.color || PIPELINE_STAGE_COLOR_FALLBACK);
            setIsQualified(Boolean(stage.is_qualified));
            setRulesState({ isDirty: false, isSaving: false });
            closeAutomationForm();
            action?.();
          }}>Descartar alterações</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function StageRulesTab({
  stageId,
  stageName,
  canEditRules,
  alertEnabled,
  canEditAlert,
  onEditorStateChange,
}: {
  stageId: string;
  stageName: string;
  canEditRules: boolean;
  alertEnabled: boolean;
  canEditAlert: boolean;
  onEditorStateChange: (state: { isDirty: boolean; isSaving: boolean }) => void;
}) {
  const alertEditor = useStageInactivityAlertEditor({ stageId, enabled: alertEnabled, canEdit: canEditAlert });
  return (
    <StageOperationalRules
      stageId={stageId}
      stageName={stageName}
      canEdit={canEditRules}
      onEditorStateChange={onEditorStateChange}
      extraEditor={alertEditor}
    />
  );
}
