import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/contexts/AuthContext';
import { getLeadVisibility } from '@/lib/api/lead-visibility';

export interface LeadVisibility {
  canViewAll: boolean;
  teamMemberIds?: string[];
  userId?: string;
}

async function fetchLeadVisibility(userId: string, organizationId?: string | null): Promise<LeadVisibility> {
  const visibility = await getLeadVisibility({ organizationId });
  if (!visibility.canViewAll && !visibility.teamMemberIds?.length && !visibility.userId) {
    return { canViewAll: false, userId };
  }
  return visibility;
}

export function useLeadVisibility(userId: string | undefined) {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['lead-visibility', userId, organization?.id],
    queryFn: () => fetchLeadVisibility(userId!, organization?.id),
    enabled: !!userId && !!organization?.id,
    staleTime: 1000 * 60 * 15,
  });
}

export async function checkLeadVisibility(userId: string): Promise<LeadVisibility> {
  return fetchLeadVisibility(userId);
}

interface VisibilityFilterQuery {
  eq(column: string, value: string): unknown;
  in(column: string, values: string[]): unknown;
}

export function applyVisibilityFilter<TQuery>(
  query: TQuery,
  visibility: LeadVisibility,
  userIdColumn: string = 'assigned_user_id',
  explicitUserId?: string | null,
): TQuery {
  const filterQuery = query as VisibilityFilterQuery;

  if (explicitUserId) {
    if (visibility.canViewAll) {
      return filterQuery.eq(userIdColumn, explicitUserId) as TQuery;
    }

    if (visibility.teamMemberIds && visibility.teamMemberIds.length > 0) {
      return visibility.teamMemberIds.includes(explicitUserId)
        ? filterQuery.eq(userIdColumn, explicitUserId) as TQuery
        : filterQuery.eq(userIdColumn, '00000000-0000-0000-0000-000000000000') as TQuery;
    }

    if (visibility.userId) {
      return visibility.userId === explicitUserId
        ? filterQuery.eq(userIdColumn, explicitUserId) as TQuery
        : filterQuery.eq(userIdColumn, '00000000-0000-0000-0000-000000000000') as TQuery;
    }

    return filterQuery.eq(userIdColumn, '00000000-0000-0000-0000-000000000000') as TQuery;
  }

  if (visibility.canViewAll) {
    return query;
  }

  if (visibility.teamMemberIds && visibility.teamMemberIds.length > 0) {
    return filterQuery.in(userIdColumn, visibility.teamMemberIds) as TQuery;
  }

  if (visibility.userId) {
    return filterQuery.eq(userIdColumn, visibility.userId) as TQuery;
  }

  return filterQuery.eq(userIdColumn, '00000000-0000-0000-0000-000000000000') as TQuery;
}
