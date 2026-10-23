/** Only a response to our own queued move may advance its successor's revision. */
export type PipelineMoveReceipt = {
  status: 'pending' | 'confirmed' | 'failed';
  stageId?: string | null;
  updatedAt?: string | null;
};

export type PipelineMoveRevision = {
  readonly leadId: string;
  readonly sourceStageId: string | null;
  readonly expectedUpdatedAt: string;
  readonly predecessor?: PipelineMoveReceipt;
};

export function capturePipelineMoveRevision(
  lead: { id: string; updated_at?: string | null },
  sourceStageId: string | null,
  predecessor?: PipelineMoveReceipt,
): PipelineMoveRevision | null {
  if (!lead.updated_at) return null;
  // Keep PostgreSQL microseconds: converting this value to Date weakens the CAS.
  return Object.freeze({ leadId: lead.id, sourceStageId, expectedUpdatedAt: lead.updated_at, predecessor });
}

export function resolvePipelineMoveRevision(revision: PipelineMoveRevision): string | null {
  const predecessor = revision.predecessor;
  if (!predecessor) return revision.expectedUpdatedAt;
  if (predecessor.status !== 'confirmed' || predecessor.stageId !== revision.sourceStageId) return null;
  return predecessor.updatedAt || null;
}

export class PipelineMoveRevisionConflict extends Error {
  constructor() {
    super('Uma movimentação anterior não foi confirmada. Atualize a Pipeline antes de tentar novamente.');
    this.name = 'PipelineMoveRevisionConflict';
  }
}
