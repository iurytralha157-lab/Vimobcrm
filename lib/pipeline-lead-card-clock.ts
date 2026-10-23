type ClockLead = { stage_entered_at?: string | null; created_at?: string | null; assigned_user_id?: string | null };

/** The two outputs currently driven by LeadCard's nowMs: elapsed label and pending assignment. */
export function getPipelineLeadCardClockKey(lead: ClockLead, nowMs: number) {
  const entered = lead.stage_entered_at ? Date.parse(lead.stage_entered_at) : NaN;
  const elapsed = Number.isFinite(entered) ? Math.max(0, nowMs - entered) : NaN;
  const label = !lead.stage_entered_at ? '-' : !Number.isFinite(elapsed) ? '—'
    : elapsed < 3_600_000 ? `${Math.floor(elapsed / 60_000)}min` : `${Math.floor(elapsed / 3_600_000)}h`;
  const recent = Boolean(lead.created_at && !lead.assigned_user_id && nowMs - Date.parse(lead.created_at) < 10_000);
  return `${label}:${recent}`;
}

export function pipelineLeadCardPropsEqual<T extends { lead: ClockLead; nowMs?: number }>(previous: T, next: T) {
  const keys = Object.keys(previous) as (keyof T)[];
  if (keys.length !== Object.keys(next).length) return false;
  for (const key of keys) if (key !== 'nowMs' && previous[key] !== next[key]) return false;
  return previous.nowMs === next.nowMs || (previous.nowMs !== undefined && next.nowMs !== undefined
    && getPipelineLeadCardClockKey(previous.lead, previous.nowMs) === getPipelineLeadCardClockKey(next.lead, next.nowMs));
}
