import { useId } from "react";
import { ChevronDown, Settings2 } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  isDistributionQueueStrategy,
  type DistributionQueueStrategy,
} from "@/lib/round-robin/distribution-queue-form";
import { cn } from "@/lib/utils";
import { DISTRIBUTION_QUEUE_NAME_ERROR, isValidDistributionQueueName } from "@/lib/round-robin/queue-name";

interface PipelineOption {
  id: string;
  name: string;
  is_active?: boolean | null;
  deleted_at?: string | null;
}

interface StageOption {
  id: string;
  name: string;
  color?: string | null;
  is_active?: boolean | null;
  deleted_at?: string | null;
  pipeline_id?: string | null;
}

const selectViewportClassName =
  "max-h-[min(24rem,var(--radix-select-content-available-height))] max-w-[var(--radix-select-content-available-width)] [&_[role=option]>span:last-child]:min-w-0 [&_[role=option]>span:last-child]:break-words";

interface DistributionQueueBasicSectionProps {
  open: boolean;
  name: string;
  strategy: DistributionQueueStrategy;
  targetPipelineId: string;
  targetStageId: string;
  pipelines: PipelineOption[];
  stages: StageOption[];
  onToggle: () => void;
  onNameChange: (name: string) => void;
  onStrategyChange: (strategy: DistributionQueueStrategy) => void;
  onPipelineChange: (pipelineId: string) => void;
  onStageChange: (stageId: string) => void;
}

export function DistributionQueueBasicSection({
  open,
  name,
  strategy,
  targetPipelineId,
  targetStageId,
  pipelines,
  stages,
  onToggle,
  onNameChange,
  onStrategyChange,
  onPipelineChange,
  onStageChange,
}: DistributionQueueBasicSectionProps) {
  const fieldId = useId();
  const nameInvalid = name.length > 0 && !isValidDistributionQueueName(name);
  const activePipelines = pipelines.filter((pipeline) => pipeline.is_active !== false && !pipeline.deleted_at);
  const activeStages = stages.filter((stage) => stage.is_active !== false && !stage.deleted_at && (!stage.pipeline_id || stage.pipeline_id === targetPipelineId));
  const currentPipeline = pipelines.find((pipeline) => pipeline.id === targetPipelineId);
  const currentStage = stages.find((stage) => stage.id === targetStageId);
  const pipelineUnavailable = Boolean(targetPipelineId) && !activePipelines.some((pipeline) => pipeline.id === targetPipelineId);
  const stageUnavailable = Boolean(targetStageId) && !activeStages.some((stage) => stage.id === targetStageId);
  return (
    <Collapsible
      data-tour="distribution-queue-basic"
      open={open}
      onOpenChange={onToggle}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-[6px] border-0 bg-[var(--app-surface-muted)] px-3 py-2 text-left transition-colors hover:bg-[var(--app-surface-hover)] data-[state=open]:bg-primary/10">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-primary/50 text-white">
            <Settings2 className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">
              Informações básicas
            </span>
            <span className="block truncate text-[10px] font-light text-[var(--app-text-tertiary)]">
              Nome, estratégia e destino
            </span>
          </span>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-0.5 pt-2.5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-name`}>Nome da fila *</Label>
            <Input
              id={`${fieldId}-name`}
              placeholder="Ex: Leads Facebook"
              value={name}
              aria-invalid={nameInvalid || undefined}
              aria-describedby={nameInvalid ? `${fieldId}-name-error` : undefined}
              onChange={(event) => onNameChange(event.target.value)}
              className="h-10 border-0 bg-[var(--app-surface-soft)] text-[12px] shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
            />
            {nameInvalid && <p id={`${fieldId}-name-error`} role="alert" className="text-xs text-destructive">{DISTRIBUTION_QUEUE_NAME_ERROR}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-strategy`}>Estrategia</Label>
            <Select
              value={strategy}
              onValueChange={(value) => {
                if (isDistributionQueueStrategy(value)) {
                  onStrategyChange(value);
                }
              }}
            >
              <SelectTrigger id={`${fieldId}-strategy`} className="h-10 border-0 bg-[var(--app-surface-soft)] text-[12px] shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={selectViewportClassName}>
                <SelectItem value="simple">Sequencial</SelectItem>
                <SelectItem value="weighted">Ponderada</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-pipeline`}>Pipeline de destino *</Label>
            <Select
              value={targetPipelineId || ""}
              onValueChange={onPipelineChange}
            >
              <SelectTrigger
                id={`${fieldId}-pipeline`}
                aria-invalid={pipelineUnavailable || !targetPipelineId}
                aria-describedby={pipelineUnavailable ? `${fieldId}-pipeline-status` : undefined}
                className={cn(
                  "h-10 border-0 bg-[var(--app-surface-soft)] text-[12px] shadow-none",
                  !targetPipelineId && "ring-1 ring-destructive/50",
                )}
              >
                <SelectValue placeholder="Selecione um pipeline..." />
              </SelectTrigger>
              <SelectContent className={selectViewportClassName}>
                {pipelineUnavailable && (
                  <SelectItem value={targetPipelineId} disabled>
                    {currentPipeline?.name || "Pipeline selecionado"} (indisponível)
                  </SelectItem>
                )}
                {activePipelines.map((pipeline) => (
                  <SelectItem key={pipeline.id} value={pipeline.id}>
                    {pipeline.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {pipelineUnavailable && <p id={`${fieldId}-pipeline-status`} role="status" className="text-[11px] text-[var(--app-text-secondary)]">O pipeline selecionado está inativo ou indisponível nos dados carregados. O destino atual foi preservado; escolha um pipeline ativo para alterá-lo.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-stage`}>Estagio inicial *</Label>
            <Select
              value={targetStageId || ""}
              onValueChange={onStageChange}
              disabled={!targetPipelineId || pipelineUnavailable}
            >
              <SelectTrigger id={`${fieldId}-stage`} aria-invalid={stageUnavailable} aria-describedby={stageUnavailable ? `${fieldId}-stage-status` : undefined} className="h-10 border-0 bg-[var(--app-surface-soft)] text-[12px] shadow-none">
                <SelectValue placeholder="Selecione um estágio..." />
              </SelectTrigger>
              <SelectContent className={selectViewportClassName}>
                {stageUnavailable && (
                  <SelectItem value={targetStageId} disabled>
                    {currentStage?.name || "Estágio selecionado"} (indisponível)
                  </SelectItem>
                )}
                {activeStages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    <div className="flex min-w-0 items-center gap-2">
                      <div
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: stage.color ?? undefined }}
                      />
                      {stage.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {stageUnavailable && <p id={`${fieldId}-stage-status`} role="status" className="text-[11px] text-[var(--app-text-secondary)]">O estágio selecionado está inativo ou indisponível nos dados carregados. A referência atual foi preservada; escolha um estágio ativo para alterá-la.</p>}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
