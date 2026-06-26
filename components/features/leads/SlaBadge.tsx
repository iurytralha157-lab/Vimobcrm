import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Clock, AlertTriangle } from "lucide-react";
import { formatSlaTime } from "@/hooks/use-sla-reports";
import { cn } from "@/lib/utils";

interface SlaBadgeProps {
  slaStatus: string | null;
  slaSecondsElapsed: number | null;
  firstResponseAt: string | null;
  className?: string;
  showTime?: boolean;
}

export function SlaBadge({
  slaStatus,
  slaSecondsElapsed,
  firstResponseAt,
  className,
  showTime = true,
}: SlaBadgeProps) {
  // Don't show if already responded
  if (firstResponseAt) {
    return null;
  }

  // Don't show if status is OK or null
  if (!slaStatus || slaStatus === "ok") {
    return null;
  }

  const isWarning = slaStatus === "warning";
  const isOverdue = slaStatus === "overdue";

  if (!isWarning && !isOverdue) {
    return null;
  }

  const timeText = formatSlaTime(slaSecondsElapsed);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn(
              "gap-1 font-medium",
              isWarning && "border-yellow-500/50 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
              isOverdue && "border-destructive/50 bg-destructive/10 text-destructive animate-pulse",
              className
            )}
          >
            {isOverdue ? (
              <AlertTriangle className="h-3 w-3" />
            ) : (
              <Clock className="h-3 w-3" />
            )}
            {showTime && <span>{timeText}</span>}
            {!showTime && isOverdue && <span>SLA</span>}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top">
          <div className="text-sm">
            {isWarning && (
              <p className="text-yellow-600 dark:text-yellow-400">
                ⚠️ SLA em alerta: {timeText} sem resposta
              </p>
            )}
            {isOverdue && (
              <p className="text-destructive">
                🚨 SLA estourado: {timeText} sem resposta
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
