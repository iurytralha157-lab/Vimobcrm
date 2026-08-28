import { useState, useEffect, useRef } from 'react';
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
import { AlertCircle, Loader2, Lock, Plus, Target, Trophy } from 'lucide-react';
import { useCanEditCadences } from '@/hooks/use-can-edit-cadences';
import { useUpdateStage } from '@/hooks/use-stages';
import { toast } from 'sonner';
import { AutomationForm } from '@/components/features/automations/AutomationForm';
import { AutomationsList } from '@/components/features/automations/AutomationsList';
import { StageOperationalRules } from '@/components/features/cadences';
import { StageAutomation } from '@/hooks/use-stage-automations';
import { StageColorPicker } from './StageColorPicker';
import { PIPELINE_STAGE_COLOR_FALLBACK } from '@/config/pipeline-stage-colors';

interface StageSettingsDialogProps {
  open: boolean;
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
  } | null;
  onStageUpdate: () => void;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const payload = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    return [payload.message, payload.details, payload.hint, payload.code]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' ') || JSON.stringify(error);
  }
  return String(error);
}

export function StageSettingsDialog({
  open,
  onOpenChange,
  stage,
  onStageUpdate
}: StageSettingsDialogProps) {
  const [name, setName] = useState(stage?.name || '');
  const [color, setColor] = useState(stage?.color || PIPELINE_STAGE_COLOR_FALLBACK);
  const [isQualified, setIsQualified] = useState(stage?.is_qualified || false);
  const [isSaving, setIsSaving] = useState(false);
  const saveInFlightRef = useRef(false);
  const canEdit = useCanEditCadences();

  // Automation state
  const [automationFormOpen, setAutomationFormOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<StageAutomation | null>(null);

  const updateStage = useUpdateStage();
  const qualificationRestriction = stage?.is_won
    ? 'Colunas de Ganho já representam a conversão final do lead.'
    : stage?.is_lost
      ? 'Colunas de Perdido não podem ser usadas como etapa de qualificação.'
      : stage?.is_active === false
        ? 'Ative esta coluna antes de usá-la como etapa de qualificação.'
        : null;
  const canToggleQualification = canEdit && (!qualificationRestriction || isQualified);

  // Update local state when stage changes
  /* eslint-disable react-hooks/set-state-in-effect -- Keeps editable draft fields in sync with the selected stage. */
  useEffect(() => {
    if (stage) {
      setName(stage.name);
      setColor(stage.color || PIPELINE_STAGE_COLOR_FALLBACK);
      setIsQualified(stage.is_qualified || false);
    }
  }, [stage]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSaveGeneral = async () => {
    if (!stage || !canEdit || isSaving || saveInFlightRef.current) return;
    const normalizedName = name.trim();
    if (normalizedName.length < 2) {
      toast.error('O nome da coluna deve ter pelo menos 2 caracteres.');
      return;
    }
    saveInFlightRef.current = true;
    setIsSaving(true);

    try {
      await updateStage.mutateAsync({ id: stage.id, name: normalizedName, color, isQualified });
      toast.success('Configurações salvas!');
      onStageUpdate();
    } catch (error: unknown) {
      toast.error('Erro ao salvar: ' + getErrorMessage(error));
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  };

  const handleQualifiedChange = (checked: boolean) => {
    if (checked && qualificationRestriction) return;
    setIsQualified(checked);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isSaving) return;
    onOpenChange(nextOpen);
  };

  if (!stage) return null;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-[90%] sm:w-[650px] sm:max-w-[650px] border-0 bg-[var(--app-surface-solid)] p-6 text-[var(--app-text-primary)] shadow-none flex flex-col overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Configurações da Coluna</SheetTitle>
        </SheetHeader>

        <Tabs defaultValue="general" className="mt-4">
          <TabsList className="mb-4 grid w-full grid-cols-3 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-1">
            <TabsTrigger value="general" className="rounded-[6px] text-xs data-[state=active]:bg-[var(--app-surface-hover)] data-[state=active]:text-[var(--app-text-primary)]"><span className="sm:hidden">Gerais</span><span className="hidden sm:inline">Configurações Gerais</span></TabsTrigger>
            <TabsTrigger value="cadence" className="rounded-[6px] text-xs data-[state=active]:bg-[var(--app-surface-hover)] data-[state=active]:text-[var(--app-text-primary)]"><span className="sm:hidden">Regras</span><span className="hidden sm:inline">Regras da etapa</span></TabsTrigger>
            <TabsTrigger value="automations" className="rounded-[6px] text-xs data-[state=active]:bg-[var(--app-surface-hover)] data-[state=active]:text-[var(--app-text-primary)]"><span className="sm:hidden">Automações</span><span className="hidden sm:inline">Automações</span></TabsTrigger>
          </TabsList>

          {/* General Settings Tab */}
          <TabsContent value="general" className="space-y-4">
            {!canEdit && (
              <Badge variant="secondary" className="gap-1 mb-4">
                <Lock className="h-3 w-3" />
                Somente visualização
              </Badge>
            )}
            <div className="space-y-2">
              <Label htmlFor="stage-settings-name">Nome da coluna</Label>
              <Input
                id="stage-settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome do estágio"
                disabled={!canEdit}
                className="h-10 rounded-[6px] border-0 bg-[var(--app-surface-soft)]"
              />
            </div>

            <div className="space-y-2">
              <Label>Cor da coluna</Label>
              {canEdit ? (
                <StageColorPicker value={color} onChange={setColor} />
              ) : (
                <div className="flex items-center gap-3 rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-2">
                  <div
                    className="w-6 h-6 rounded-[6px] border-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="font-mono text-sm text-muted-foreground">{color}</span>
                </div>
              )}
            </div>

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
                      className="h-5 rounded-[4px] border-0 bg-[var(--app-surface-hover)] px-2 text-[9px] font-light text-[var(--app-text-secondary)] shadow-none"
                    >
                      Por pipeline
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] font-light leading-4 text-[var(--app-text-tertiary)]">
                    Defina como o avanço do lead será interpretado nos relatórios e nas integrações de Marketing.
                  </p>
                </div>
              </div>

              <div className="rounded-[6px] bg-[var(--app-surface-solid)] p-3">
                <div className="flex items-center justify-between gap-4">
                  <Label
                    htmlFor="stage-is-qualified"
                    className="text-[12px] font-medium leading-5 text-[var(--app-text-primary)]"
                  >
                    Esta é a etapa de lead qualificado
                  </Label>
                  <Switch
                    id="stage-is-qualified"
                    checked={isQualified}
                    onCheckedChange={handleQualifiedChange}
                    disabled={!canToggleQualification}
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
                  className="mt-1.5 text-[11px] font-light leading-4 text-[var(--app-text-tertiary)]"
                >
                  Ao ativar, esta coluna substitui a outra etapa qualificada desta pipeline. O lead passa a contar como qualificado quando entrar aqui.
                </p>

                {qualificationRestriction ? (
                  <div
                    id="stage-is-qualified-restriction"
                    className="mt-3 flex items-start gap-2 rounded-[6px] bg-[var(--app-surface-hover)] px-3 py-2.5 text-[11px] font-light leading-4 text-[var(--app-text-secondary)]"
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
                  <p className="mt-0.5 text-[11px] font-light leading-4 text-[var(--app-text-tertiary)]">
                    Automático ao marcar o lead como Ganho.
                  </p>
                </div>
              </div>
            </section>

            {canEdit && (
              <div className="flex gap-2 pt-4">
                <Button variant="outline" className="w-[40%] rounded-[6px] border-0 bg-transparent hover:bg-[var(--app-surface-hover)]" onClick={() => handleOpenChange(false)} disabled={isSaving}>
                  Cancelar
                </Button>
                <Button className="w-[60%] rounded-[6px]" onClick={handleSaveGeneral} disabled={isSaving}>
                  {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Salvar
                </Button>
              </div>
            )}
          </TabsContent>

          {/* Cadence Tab */}
          <TabsContent
            value="cadence"
            forceMount
            className="space-y-4 data-[state=inactive]:hidden"
          >
            <StageOperationalRules
              stageId={stage.id}
              stageName={stage.name}
              canEdit={canEdit}
            />
          </TabsContent>

          {/* Automations Tab */}
          <TabsContent value="automations" className="space-y-4">
            {!canEdit ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <Lock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Você não tem permissão para editar automações</p>
              </div>
            ) : automationFormOpen || editingAutomation ? (
              <div className="rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-4">
                <h4 className="font-medium mb-4">
                  {editingAutomation ? 'Editar Automação' : 'Nova Automação'}
                </h4>
                <AutomationForm
                  stageId={stage.id}
                  pipelineId={stage.pipeline_id || ''}
                  automation={editingAutomation}
                  onSuccess={() => {
                    setAutomationFormOpen(false);
                    setEditingAutomation(null);
                  }}
                  onCancel={() => {
                    setAutomationFormOpen(false);
                    setEditingAutomation(null);
                  }}
                />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <Label className="text-base">Automações do Estágio</Label>
                  <Button
                    size="sm"
                    onClick={() => setAutomationFormOpen(true)}
                    className="bg-primary hover:bg-primary/90"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Adicionar
                  </Button>
                </div>
                <AutomationsList
                  stageId={stage.id}
                  pipelineId={stage.pipeline_id || ''}
                  onEdit={(automation) => setEditingAutomation(automation)}
                />
              </>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
