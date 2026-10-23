import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getPipelineStageColorStyle, normalizePipelineStageColor } from "@/config/pipeline-stage-colors";

export function ConversationLeadBadges({ pipelineName, stageName, stageColor }: {
  pipelineName?: string | null;
  stageName?: string | null;
  stageColor?: string | null;
}) {
  if (!pipelineName && !stageName) return null;
  const stageStyle = getPipelineStageColorStyle(stageColor);
  return (
    <div data-conversation-lead-badges className="flex min-w-0 flex-wrap items-center gap-1.5">
      {pipelineName && <Badge data-conversation-pipeline className="h-5 max-w-full truncate rounded-[4px] border-0 bg-[var(--lead-action-whatsapp-bg)] px-1.5 text-[10px] font-normal text-[var(--lead-action-whatsapp-fg)] hover:bg-[var(--lead-action-whatsapp-bg)]" title={pipelineName}>{pipelineName}</Badge>}
      {pipelineName && stageName && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
      {stageName && <Badge data-conversation-stage className="h-5 max-w-full truncate rounded-[4px] border-0 px-1.5 text-[10px] font-normal" style={{ ...stageStyle, ...(stageColor && normalizePipelineStageColor(stageColor) ? { color: "#ffffff" } : {}) }} title={stageName}>{stageName}</Badge>}
    </div>
  );
}
