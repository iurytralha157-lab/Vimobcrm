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

interface PipelineOption {
  id: string;
  name: string;
}

interface StageOption {
  id: string;
  name: string;
  color?: string | null;
}

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
            <Label>Nome da fila *</Label>
            <Input
              placeholder="Ex: Leads Facebook"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              className="h-10 border-0 bg-[var(--app-surface-soft)] text-[12px] shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
            />
          </div>
          <div className="space-y-2">
            <Label>Estrategia</Label>
            <Select
              value={strategy}
              onValueChange={(value) => {
                if (isDistributionQueueStrategy(value)) {
                  onStrategyChange(value);
                }
              }}
            >
              <SelectTrigger className="h-10 border-0 bg-[var(--app-surface-soft)] text-[12px] shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="simple">Sequencial</SelectItem>
                <SelectItem value="weighted">Ponderada</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Pipeline de destino *</Label>
            <Select
              value={targetPipelineId || ""}
              onValueChange={onPipelineChange}
            >
              <SelectTrigger
                className={cn(
                  "h-10 border-0 bg-[var(--app-surface-soft)] text-[12px] shadow-none",
                  !targetPipelineId && "ring-1 ring-destructive/50",
                )}
              >
                <SelectValue placeholder="Selecione um pipeline..." />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((pipeline) => (
                  <SelectItem key={pipeline.id} value={pipeline.id}>
                    {pipeline.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Estagio inicial *</Label>
            <Select
              value={targetStageId || ""}
              onValueChange={onStageChange}
              disabled={!targetPipelineId}
            >
              <SelectTrigger className="h-10 border-0 bg-[var(--app-surface-soft)] text-[12px] shadow-none">
                <SelectValue placeholder="Selecione um estágio..." />
              </SelectTrigger>
              <SelectContent>
                {stages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: stage.color ?? undefined }}
                      />
                      {stage.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
