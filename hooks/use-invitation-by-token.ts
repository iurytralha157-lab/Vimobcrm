import { useQuery } from '@tanstack/react-query';
import { adminAPI } from '@/lib/api/admin';

interface InvitationByToken {
  id: string;
  email: string | null;
  role: 'admin' | 'manager' | 'user';
  organization_id: string;
  expires_at: string;
}

export function useInvitationByToken(token: string | null) {
  return useQuery({
    queryKey: ['invitation-by-token', token],
    queryFn: async (): Promise<InvitationByToken | null> => {
      if (!token) return null;

      return adminAPI.invitationByToken<InvitationByToken>(token);
    },
    enabled: !!token,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
}
