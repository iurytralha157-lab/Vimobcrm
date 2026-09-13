export const LEAD_DISTRIBUTION_OUTCOMES = [
  'assigned',
  'already_assigned',
  'no_matching_queue',
  'no_available_members',
  'skipped',
  'reentry_preserved',
] as const;

export type LeadDistributionOutcome = (typeof LEAD_DISTRIBUTION_OUTCOMES)[number];
export type ImportDistributionOutcome = LeadDistributionOutcome | 'unknown';

export type ImportDistributionSummary = Record<ImportDistributionOutcome, number>;

export function createEmptyImportDistributionSummary(): ImportDistributionSummary {
  return {
    assigned: 0,
    already_assigned: 0,
    no_matching_queue: 0,
    no_available_members: 0,
    skipped: 0,
    reentry_preserved: 0,
    unknown: 0,
  };
}

export function resolveImportDistributionOutcome(input: {
  serverOutcome?: LeadDistributionOutcome;
  reentry: boolean;
  autoDistribute?: boolean;
}): ImportDistributionOutcome {
  if (input.serverOutcome) return input.serverOutcome;
  if (input.reentry) return 'reentry_preserved';
  if (input.autoDistribute === false) return 'skipped';
  return 'unknown';
}

export function countImportDistributionOutcome(
  summary: ImportDistributionSummary,
  outcome: ImportDistributionOutcome,
): void {
  summary[outcome] += 1;
}

export function countPendingDistribution(summary: ImportDistributionSummary): number {
  return summary.no_matching_queue + summary.no_available_members + summary.unknown;
}
