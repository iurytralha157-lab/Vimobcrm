export type LeadScopedRow = {
  lead_id?: unknown;
};

export function requireCurrentLeadId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Current lead identity is required");
  }
  return value.trim();
}

export function rowsForCurrentLead<T extends LeadScopedRow>(
  rows: readonly T[] | null | undefined,
  currentLeadId: unknown,
): T[] {
  const leadId = requireCurrentLeadId(currentLeadId);
  return (rows || []).filter((row) => row.lead_id === leadId);
}
