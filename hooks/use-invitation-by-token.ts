import { useQuery } from '@tanstack/react-query';
import { adminAPI } from '@/lib/api/admin';
import {
  getInvitationLookupState,
  isInvitationLookupRetryable,
  normalizeInvitationToken,
} from '@/lib/auth/invitation';

interface InvitationByToken {
  id: string;
  email: string | null;
  role: 'admin' | 'manager' | 'user';
  organization_id: string;
  organization_name?: string;
  expires_at: string;
  existing_account?: boolean;
}

export function useInvitationByToken(token: string | null | undefined) {
  const canonicalToken = normalizeInvitationToken(token);
  const query = useQuery({
    queryKey: ['invitation-by-token', canonicalToken],
    queryFn: async (): Promise<InvitationByToken | null> => {
      if (!canonicalToken) return null;

      return adminAPI.invitationByToken<InvitationByToken>(canonicalToken);
    },
    enabled: canonicalToken !== null,
    staleTime: 1000 * 60 * 5,
    retry: (failureCount, error) => failureCount < 2 && isInvitationLookupRetryable(error),
    retryDelay: (attempt) => Math.min(500 * (2 ** attempt), 1_500),
  });

  return {
    ...query,
    canonicalToken,
    invitationState: getInvitationLookupState({
      token,
      hasInvitation: Boolean(query.data),
      isPending: query.isPending,
      error: query.error,
    }),
    retryLookup: query.refetch,
  };
}
