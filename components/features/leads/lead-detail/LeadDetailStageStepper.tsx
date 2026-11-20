import type { CSSProperties } from 'react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { LeadDetailStage } from '@/components/features/leads/lead-detail/types';
import { getStageStepperStyle, stageTooltipClassName } from '@/components/features/leads/lead-detail/utils';
import { cn } from '@/lib/utils';

type LeadDetailStageStepperProps = {
  stages: LeadDetailStage[];
  activeStageId: string | null | undefined;
  mobile: boolean;
  pipeline: boolean;
  disabled: boolean;
  onMove: (stageId: string) => void;
};

export function LeadDetailStageStepper({ stages, activeStageId, mobile, pipeline, disabled, onMove }: LeadDetailStageStepperProps) {
  const currentStageIndex = stages.findIndex((stage) => stage.id === activeStageId);
  const stageStepperStyle = getStageStepperStyle(stages.length);
  const steps = stages.map((stage, index) => {
    const isActive = stage.id === activeStageId;
    const isPast = index < currentStageIndex;
    const step = (
      <button
        key={stage.id}
        type="button"
        disabled={disabled}
        aria-label={`Mover para ${stage.name}`}
        aria-current={isActive ? 'step' : undefined}
        data-lead-stage-step
        onClick={() => onMove(stage.id)}
        className={cn(
          mobile
            ? 'lead-stage-step relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] text-[11px] font-normal'
            : 'lead-stage-step group relative flex h-8 w-8 items-center justify-center rounded-[6px] text-xs font-normal transition-colors',
          (isActive || isPast) && pipeline ? 'bg-primary/50 text-white'
            : isActive ? 'bg-primary text-primary-foreground'
            : isPast ? 'bg-primary/10 text-primary'
            : cn('bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]',
              !mobile && (pipeline ? 'hover:bg-muted' : 'hover:bg-primary/10 hover:text-primary')),
        )}
      >
        {index + 1}
      </button>
    );
    return mobile ? step : (
      <Tooltip key={stage.id}>
        <TooltipTrigger asChild>{step}</TooltipTrigger>
        <TooltipContent side="top" align="center" sideOffset={8} className={stageTooltipClassName}>{stage.name}</TooltipContent>
      </Tooltip>
    );
  });

  if (mobile) return (
    <div
      data-lead-stage-stepper
      className="lead-detail-v2-scroll flex min-w-0 flex-1 items-center overflow-x-auto pb-0.5"
      style={{ ...stageStepperStyle, '--lead-stage-step-size': '2.5rem' } as CSSProperties}
    >
      {steps}
    </div>
  );

  return (
    <ScrollArea className="w-full" type="scroll">
      <TooltipProvider delayDuration={0}>
        <nav data-tour="lead-detail-stages" data-lead-stage-stepper className="lead-stage-rail flex min-w-max items-center pb-3" style={stageStepperStyle}>
          {steps}
        </nav>
      </TooltipProvider>
      <ScrollBar orientation="horizontal" className="h-1" />
    </ScrollArea>
  );
}
