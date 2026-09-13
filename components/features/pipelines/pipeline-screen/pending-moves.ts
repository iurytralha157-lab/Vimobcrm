import type { StageWithLeads } from '@/hooks/use-stages';
import {
  findPipelineLeadLocation,
  pipelineBoardMatchesMove,
} from '@/lib/pipeline-board-cache';

import type { VisualPendingPipelineMove } from './model';

export function shouldApplyVisualPendingMove(
  board: StageWithLeads[],
  entry: VisualPendingPipelineMove,
) {
  if (!entry.release) return true;
  if (entry.release.kind === 'confirmed') {
    return !pipelineBoardMatchesMove(board, entry.move);
  }

  return (
    findPipelineLeadLocation(board, entry.move.leadId)?.stageId !==
    entry.release.stageId
  );
}
