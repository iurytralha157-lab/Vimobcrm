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
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-[6px] border-0 bg-[var(--app-surface-muted)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--app-surface-hover)] data-[state=open]:bg-primary/10">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-primary" />
          <span className="font-medium">Informações básicas</span>
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
              <SelectTrigger>
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
                className={!targetPipelineId ? "border-destructive" : ""}
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
              <SelectTrigger>
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
