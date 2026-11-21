import type { StageWithLeads } from '@/hooks/use-stages';
import {
  findPipelineLeadLocation,
  pipelineBoardMatchesMove,
} from '@/lib/pipeline-board-cache';
import { parsePipelineOrderMicros } from '@/lib/pipeline-board-order';

import type { VisualPendingPipelineMove } from './model';

export function shouldApplyVisualPendingMove(
  board: StageWithLeads[],
  entry: VisualPendingPipelineMove,
) {
  if (!entry.release) return true;
  const lead = findPipelineLeadLocation(board, entry.move.leadId)?.lead;
  if (!lead) return false;
  const revision = parsePipelineOrderMicros(lead.updated_at);
  const confirmed = parsePipelineOrderMicros(entry.move.optimisticPatch.updated_at);
  if (confirmed !== null && revision !== null && revision > confirmed) return false;
  return !pipelineBoardMatchesMove(board, entry.move);
}
