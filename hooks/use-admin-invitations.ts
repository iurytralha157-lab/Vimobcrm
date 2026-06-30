import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminAPI } from '@/lib/api/admin';
import { toast } from 'sonner';
import { getFriendlyErrorMessage } from '@/lib/error-handler';

export interface AdminInvitation {
  id: string;
  email: string | null;
  role: string | null;
  token: string;
  organization_id: string;
  organization_name?: string | null;
  expires_at: string;
  used_at: string | null;
  created_at: string | null;
  created_by: string | null;
  email_sent?: boolean;
}

function normalizeInvitation(invitation: AdminInvitation): AdminInvitation {
  return {
    ...invitation,
    role: invitation.role || 'user',
  };
}

export function useAdminInvitations(organizationId: string | undefined) {
  const queryClient = useQueryClient();

  // Fetch invitations for a specific organization
  const { data: invitations, isLoading } = useQuery({
    queryKey: ['admin-invitations', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const data = await adminAPI.listInvitations<AdminInvitation>(organizationId);
      return data.map(normalizeInvitation);
    },
    enabled: !!organizationId,
  });

  // Create invitation
  const createInvitation = useMutation({
    mutationFn: async (data: {
      email: string;
      role: 'admin' | 'user';
      organizationId: string;
    }) => {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiration
      const invitation = await adminAPI.createInvitation<AdminInvitation>({
        email: data.email,
        role: data.role,
        organizationId: data.organizationId,
        expires_at: expiresAt.toISOString(),
      });
      return invitation;
    },
    onSuccess: () => {
      toast.success('Convite criado com sucesso!');
      queryClient.invalidateQueries({ queryKey: ['admin-invitations', organizationId] });
    },
    onError: (error: unknown) => {
      toast.error('Erro ao criar convite: ' + getFriendlyErrorMessage(error));
    },
  });

  // Delete invitation
  const deleteInvitation = useMutation({
    mutationFn: async (invitationId: string) => {
      await adminAPI.deleteInvitation(invitationId);
    },
    onSuccess: () => {
      toast.success('Convite removido!');
      queryClient.invalidateQueries({ queryKey: ['admin-invitations', organizationId] });
    },
    onError: (error: unknown) => {
      toast.error('Erro ao remover convite: ' + getFriendlyErrorMessage(error));
    },
  });

  const getInviteLink = (token: string) => {
    return `${window.location.origin}/convite/${token}`;
  };

  return {
    invitations,
    isLoading,
    createInvitation,
    deleteInvitation,
    getInviteLink,
  };
}
