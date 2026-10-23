import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';
import { getAPIBaseURL, type VimobAPIRequestIntent } from '@/lib/api/vimob-client';
import {
  getLeadMoveStageContract, invalidateLeadMoveStageContract, isLeadMoveStageContractCurrent, LeadMoveContractError,
  LEAD_MOVE_CONTRACT_FRESH_MS, type LeadMoveStageContract,
} from '@/lib/api/lead-move-contract';

type MovePreparation = {
  organizationId: string;
  intent: VimobAPIRequestIntent;
  isCurrent: () => boolean;
};

/** Contract readiness is cached separately from access; every write still checks its own permission/revision. */
export function useLeadMoveContract(enabled: boolean) {
  const { activeOrganization, user, session } = useAuth();
  const queryClient = useQueryClient();
  const organizationId = activeOrganization.organizationId;
  const userId = user?.id;
  const sessionId = getGlobalSignOutSessionId(session);
  const apiBaseURL = getAPIBaseURL();
  const options = useMemo(() => ({
    queryKey: ['lead-move-contract', apiBaseURL, organizationId, userId, sessionId],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      try {
        return await getLeadMoveStageContract(organizationId || '', { signal, expectedUserId: userId, expectedSessionId: sessionId });
      } catch (error) {
        const previous = queryClient.getQueryData<LeadMoveStageContract>(['lead-move-contract', apiBaseURL, organizationId, userId, sessionId]);
        if (previous) invalidateLeadMoveStageContract(previous);
        throw error;
      }
    },
    staleTime: LEAD_MOVE_CONTRACT_FRESH_MS,
    gcTime: LEAD_MOVE_CONTRACT_FRESH_MS,
    structuralSharing: false as const,
    retry: false as const,
  }), [apiBaseURL, organizationId, userId, sessionId, queryClient]);
  const query = useQuery({ ...options, enabled: Boolean(enabled && organizationId && userId && sessionId), refetchOnMount: 'always' });
  const matches = useCallback((operation: MovePreparation) => operation.isCurrent()
    && operation.organizationId === organizationId && operation.intent.expectedUserId === userId
    && operation.intent.expectedSessionId === sessionId && apiBaseURL === getAPIBaseURL(),
  [organizationId, userId, sessionId, apiBaseURL]);
  const getCurrent = useCallback((operation: MovePreparation) => {
    if (!matches(operation)) return undefined;
    if (queryClient.getQueryState(options.queryKey)?.status === 'error') return undefined;
    const proof = queryClient.getQueryData<LeadMoveStageContract>(options.queryKey);
    return isLeadMoveStageContractCurrent(proof, operation.organizationId, operation.intent) ? proof : undefined;
  }, [matches, options, queryClient]);
  const ensureCompatible = useCallback(async (operation: MovePreparation) => {
    if (!matches(operation)) throw new LeadMoveContractError();
    const cached = getCurrent(operation);
    if (cached) return cached;
    // A rejected/expired proof must not be revived by Query's dataUpdatedAt.
    await queryClient.invalidateQueries({ queryKey: options.queryKey, exact: true, refetchType: 'none' });
    const proof = await queryClient.fetchQuery(options);
    if (!matches(operation) || !isLeadMoveStageContractCurrent(proof, operation.organizationId, operation.intent)) {
      throw new LeadMoveContractError();
    }
    return proof;
  }, [getCurrent, matches, options, queryClient]);
  return { query, getCurrent, ensureCompatible };
}
