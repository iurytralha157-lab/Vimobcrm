import type { FormEvent } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

import { LostReasonDialog } from '@/components/features/leads/LostReasonDialog';
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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PIPELINE_STAGE_COLOR_FALLBACK } from '@/config/pipeline-stage-colors';
import type { LeadDetailLead } from '@/components/features/leads/lead-detail';
import type { PipelineLead, StageWithLeads } from '@/hooks/use-stages';
import type { Tag } from '@/hooks/use-tags';
import type { User } from '@/hooks/use-users';

import { LeadDialogErrorBoundary } from './LeadDialogErrorBoundary';

const StageSettingsDialog = dynamic(
  () =>
    import('@/components/features/pipelines/StageSettingsDialog').then(
      (module) => module.StageSettingsDialog,
    ),
  { loading: () => null },
);
const PipelineAttentionSettings = dynamic(
  () =>
    import('@/components/features/pipelines/PipelineAttentionSettings').then(
      (module) => module.PipelineAttentionSettings,
    ),
  { loading: () => null },
);
const StagesEditorDialog = dynamic(
  () =>
    import('@/components/features/pipelines/StagesEditorDialog').then(
      (module) => module.StagesEditorDialog,
    ),
  { loading: () => null },
);
const LeadDetailDialog = dynamic(
  () =>
    import('@/components/features/leads/LeadDetailDialog').then(
      (module) => module.LeadDetailDialog,
    ),
  { loading: () => null },
);
const CreateLeadDialog = dynamic(
  () =>
    import('@/components/features/leads/CreateLeadDialog').then(
      (module) => module.CreateLeadDialog,
    ),
  { loading: () => null },
);

export type PipelineStageSettingsValue = {
  id: string;
  name: string;
  color: string;
  stage_key: string;
  pipeline_id?: string;
  is_qualified: boolean;
  is_won: boolean;
  is_lost: boolean;
  is_active: boolean;
};

type PipelineDialogsProps = {
  selectedLead: PipelineLead | null;
  editingLead: PipelineLead | null;
  lostReasonLead: PipelineLead | null;
  lostReasonPending: boolean;
  stages: StageWithLeads[];
  allTags: Tag[];
  users: User[];
  settingsStage: StageWithLeads | null;
  settingsStageForDialog: PipelineStageSettingsValue | null;
  newLeadDialogOpen: boolean;
  newLeadStageId: string | null;
  selectedPipelineId: string | null;
  newPipelineDialogOpen: boolean;
  newPipelineName: string;
  createPipelinePending: boolean;
  newStageDialogOpen: boolean;
  newStageName: string;
  newStageColor: string;
  newStageColorIsValid: boolean;
  normalizedNewStageColor: string;
  createStagePending: boolean;
  attentionSettingsOpen: boolean;
  stagesEditorOpen: boolean;
  currentPipelineName: string;
  pipelineToDelete: { id: string; name: string } | null;
  deletePipelinePending: boolean;
  onCloseSelectedLead: () => void;
  onEditSelectedLead: (lead: LeadDetailLead) => void;
  onCloseEditingLead: () => void;
  onEditingLeadSaved: (lead: LeadDetailLead) => void;
  onSettingsStageClose: () => void;
  onSettingsStageUpdate: () => void;
  onNewLeadDialogOpenChange: (open: boolean) => void;
  onLostReasonOpenChange: (open: boolean) => void;
  onLostReasonConfirm: (reason: string) => Promise<void>;
  onNewPipelineDialogOpenChange: (open: boolean) => void;
  onNewPipelineNameChange: (name: string) => void;
  onCreatePipeline: (event: FormEvent) => void;
  onNewStageDialogOpenChange: (open: boolean) => void;
  onNewStageNameChange: (name: string) => void;
  onNewStageColorChange: (color: string) => void;
  onCreateStage: (event: FormEvent) => void;
  onAttentionSettingsOpenChange: (open: boolean) => void;
  onStagesEditorOpenChange: (open: boolean) => void;
  onPipelineToDeleteOpenChange: (open: boolean) => void;
  onDeletePipeline: () => void;
};

export function PipelineDialogs({
  selectedLead,
  editingLead,
  lostReasonLead,
  lostReasonPending,
  stages,
  allTags,
  users,
  settingsStage,
  settingsStageForDialog,
  newLeadDialogOpen,
  newLeadStageId,
  selectedPipelineId,
  newPipelineDialogOpen,
  newPipelineName,
  createPipelinePending,
  newStageDialogOpen,
  newStageName,
  newStageColor,
  newStageColorIsValid,
  normalizedNewStageColor,
  createStagePending,
  attentionSettingsOpen,
  stagesEditorOpen,
  currentPipelineName,
  pipelineToDelete,
  deletePipelinePending,
  onCloseSelectedLead,
  onEditSelectedLead,
  onCloseEditingLead,
  onEditingLeadSaved,
  onSettingsStageClose,
  onSettingsStageUpdate,
  onNewLeadDialogOpenChange,
  onLostReasonOpenChange,
  onLostReasonConfirm,
  onNewPipelineDialogOpenChange,
  onNewPipelineNameChange,
  onCreatePipeline,
  onNewStageDialogOpenChange,
  onNewStageNameChange,
  onNewStageColorChange,
  onCreateStage,
  onAttentionSettingsOpenChange,
  onStagesEditorOpenChange,
  onPipelineToDeleteOpenChange,
  onDeletePipeline,
}: PipelineDialogsProps) {
  return (
    <>
      {selectedLead && (
        <LeadDialogErrorBoundary
          leadId={selectedLead.id}
          onClose={onCloseSelectedLead}
        >
          <LeadDetailDialog
            lead={selectedLead}
            stages={stages}
            onClose={onCloseSelectedLead}
            onEdit={onEditSelectedLead}
            allTags={allTags}
            allUsers={users}
          />
        </LeadDialogErrorBoundary>
      )}

      {settingsStageForDialog && (
        <StageSettingsDialog
          open={Boolean(settingsStage)}
          onOpenChange={(open) => {
            if (!open) onSettingsStageClose();
          }}
          stage={settingsStageForDialog}
          onStageUpdate={onSettingsStageUpdate}
        />
      )}

      {newLeadDialogOpen && (
        <CreateLeadDialog
          open={newLeadDialogOpen}
          onOpenChange={onNewLeadDialogOpenChange}
          defaultStageId={newLeadStageId}
          defaultPipelineId={selectedPipelineId}
        />
      )}

      {editingLead && (
        <CreateLeadDialog
          open={Boolean(editingLead)}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) onCloseEditingLead();
          }}
          lead={editingLead}
          onSaved={onEditingLeadSaved}
        />
      )}

      <LostReasonDialog
        open={Boolean(lostReasonLead)}
        onOpenChange={onLostReasonOpenChange}
        onConfirm={onLostReasonConfirm}
        leadName={lostReasonLead?.name}
        loading={lostReasonPending}
      />

      <Dialog
        open={newPipelineDialogOpen}
        onOpenChange={(open) => {
          if (!open && createPipelinePending) return;
          onNewPipelineDialogOpenChange(open);
        }}
      >
        <DialogContent className="w-[calc(100vw-32px)] max-w-sm rounded-[8px] border-0 !bg-[var(--app-surface-solid)] p-5 text-[var(--app-text-primary)] !shadow-none sm:w-full">
          <DialogHeader className="text-left">
            <DialogTitle className="text-[14px] font-normal leading-5">
              Nova pipeline
            </DialogTitle>
            <DialogDescription className="text-[11px] font-light leading-4 text-muted-foreground">
              Crie o primeiro fluxo ou um novo fluxo para organizar seus leads.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreatePipeline} className="mt-2 space-y-4">
            <div className="space-y-2">
              <Label className="text-[12px] font-light text-foreground">
                Nome da pipeline *
              </Label>
              <Input
                value={newPipelineName}
                onChange={(event) => onNewPipelineNameChange(event.target.value)}
                placeholder="Ex: Locação, Vendas..."
                required
                autoFocus
                disabled={createPipelinePending}
                className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-foreground shadow-none placeholder:text-muted-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/40"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="h-10 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-muted-foreground shadow-none hover:bg-[var(--app-surface-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/40"
                onClick={() => onNewPipelineDialogOpenChange(false)}
                disabled={createPipelinePending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="h-10 flex-1 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-white shadow-none outline-none transition-colors hover:bg-primary focus-visible:ring-1 focus-visible:ring-primary/40 disabled:opacity-50"
                disabled={createPipelinePending}
              >
                {createPipelinePending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Criar pipeline
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={newStageDialogOpen}
        onOpenChange={(open) => {
          if (!open && createStagePending) return;
          onNewStageDialogOpenChange(open);
        }}
      >
        <DialogContent className="w-[calc(100vw-32px)] max-w-sm rounded-[8px] border-0 !bg-[var(--app-surface-solid)] p-5 text-[var(--app-text-primary)] !shadow-none sm:w-full">
          <DialogHeader className="text-left">
            <DialogTitle className="text-[14px] font-normal leading-5">
              Nova coluna
            </DialogTitle>
            <DialogDescription className="text-[11px] font-light leading-4 text-muted-foreground">
              Adicione uma etapa à pipeline selecionada.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreateStage} className="mt-2 space-y-4">
            <div className="space-y-2">
              <Label className="text-[12px] font-light text-foreground">
                Nome da coluna *
              </Label>
              <Input
                value={newStageName}
                onChange={(event) => onNewStageNameChange(event.target.value)}
                placeholder="Ex: Qualificado, Em Negociação..."
                required
                autoFocus
                disabled={createStagePending}
                className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-foreground shadow-none placeholder:text-muted-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/40"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[12px] font-light text-foreground">Cor</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={normalizedNewStageColor}
                  onChange={(event) => onNewStageColorChange(event.target.value)}
                  aria-label="Selecionar cor da coluna"
                  disabled={createStagePending}
                  className="h-10 w-10 cursor-pointer rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-1 shadow-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                />
                <Input
                  value={newStageColor}
                  onChange={(event) =>
                    onNewStageColorChange(event.target.value.trim())
                  }
                  placeholder={PIPELINE_STAGE_COLOR_FALLBACK}
                  required
                  pattern="^#[0-9A-Fa-f]{6}$"
                  title="Use uma cor hexadecimal no formato #RRGGBB"
                  aria-invalid={!newStageColorIsValid}
                  aria-describedby={
                    !newStageColorIsValid ? 'new-stage-color-error' : undefined
                  }
                  autoComplete="off"
                  spellCheck={false}
                  disabled={createStagePending}
                  className="h-10 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-foreground shadow-none placeholder:text-muted-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/40"
                />
              </div>
              {!newStageColorIsValid && (
                <p
                  id="new-stage-color-error"
                  role="alert"
                  className="text-[11px] font-light text-destructive"
                >
                  Use uma cor hexadecimal no formato #RRGGBB.
                </p>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="h-10 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-muted-foreground shadow-none hover:bg-[var(--app-surface-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/40"
                onClick={() => onNewStageDialogOpenChange(false)}
                disabled={createStagePending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="h-10 flex-1 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-white shadow-none outline-none transition-colors hover:bg-primary focus-visible:ring-1 focus-visible:ring-primary/40 disabled:opacity-50"
                disabled={createStagePending || !newStageColorIsValid}
              >
                {createStagePending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Criar coluna
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {selectedPipelineId && attentionSettingsOpen && (
        <PipelineAttentionSettings
          open={attentionSettingsOpen}
          onOpenChange={onAttentionSettingsOpenChange}
          pipelineId={selectedPipelineId}
          pipelineName={currentPipelineName}
        />
      )}

      {selectedPipelineId && stagesEditorOpen && (
        <StagesEditorDialog
          open={stagesEditorOpen}
          onOpenChange={onStagesEditorOpenChange}
          pipelineId={selectedPipelineId}
          pipelineName={currentPipelineName}
          stages={stages.map((stage) => ({
            id: stage.id,
            name: stage.name,
            color: stage.color || PIPELINE_STAGE_COLOR_FALLBACK,
            position: stage.position,
            lead_count: stage.total_lead_count ?? stage.leads.length ?? 0,
            stage_key: stage.stage_key || undefined,
          }))}
        />
      )}

      <AlertDialog
        open={Boolean(pipelineToDelete)}
        onOpenChange={onPipelineToDeleteOpenChange}
      >
        <AlertDialogContent className="w-[calc(100vw-32px)] max-w-md rounded-[8px] border-0 !bg-[var(--app-surface-solid)] p-5 text-[var(--app-text-primary)] !shadow-none sm:w-full">
          <AlertDialogHeader className="space-y-1.5 text-left">
            <AlertDialogTitle className="text-[14px] font-normal leading-5">
              Excluir pipeline?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12px] font-light leading-[18px] text-muted-foreground">
              A pipeline &quot;{pipelineToDelete?.name}&quot; será removida. Se ela tiver
              leads, o sistema vai bloquear a exclusão para proteger os dados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel
              disabled={deletePipelinePending}
              className="h-10 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-muted-foreground shadow-none hover:bg-[var(--app-surface-hover)] hover:text-foreground"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-10 flex-1 rounded-[6px] bg-destructive/80 px-3 text-[12px] font-light text-destructive-foreground shadow-none hover:bg-destructive"
              onClick={(event) => {
                event.preventDefault();
                onDeletePipeline();
              }}
              disabled={deletePipelinePending}
            >
              {deletePipelinePending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  );
}
