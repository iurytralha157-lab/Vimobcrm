import { getDashboardTeamLeadIds } from '@/lib/api/dashboard';

interface LeadIdFilterQuery<TQuery> {
  eq(column: string, value: string): TQuery;
  in(column: string, values: string[]): TQuery;
}

export async function fetchDashboardTeamLeadIds(
  teamId: string | null | undefined,
  dateRange?: { from: Date; to: Date } | null,
): Promise<string[] | null> {
  if (!teamId) return null;
  return getDashboardTeamLeadIds({ teamId, dateRange });
}

export function applyLeadIdFilter<TQuery extends LeadIdFilterQuery<TQuery>>(query: TQuery, leadIds: string[] | null): TQuery {
  if (leadIds === null) return query;
  if (leadIds.length === 0) {
    return query.eq('id', '00000000-0000-0000-0000-000000000000');
  }
  return query.in('id', leadIds);
}
