import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { adminAPI } from '@/lib/api/admin';
import { useAuth } from '@/contexts/AuthContext';

export interface Invitation {
  id: string;
  organization_id: string;
  organization_name?: string | null;
  email: string | null;
  token: string;
  role: 'admin' | 'manager' | 'user';
  created_by: string | null;
  expires_at: string;
  used_at: string | null;
  created_at: string;
  email_sent?: boolean;
}

export function useInvitations() {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id;

  return useQuery({
    queryKey: ['invitations', organizationId],
    queryFn: () => adminAPI.listInvitations<Invitation>(organizationId),
    enabled: !!organizationId,
  });
}

export function useCreateInvitation() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id;

  return useMutation({
    mutationFn: ({ email, role }: { email?: string; role: 'admin' | 'user' }) => {
      if (!organizationId) throw new Error('Organização não encontrada');
      return adminAPI.createInvitation<Invitation>({
        email: email || '',
        role,
        organizationId,
      });
    },
    onSuccess: (invitation) => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      queryClient.invalidateQueries({ queryKey: ['organization-users'] });
      toast.success(invitation.email_sent === false ? 'Convite criado sem envio de e-mail.' : 'Convite enviado por e-mail.');
    },
    onError: (error) => {
      toast.error('Erro ao criar convite: ' + error.message);
    },
  });
}

export function useDeleteInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => adminAPI.deleteInvitation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      queryClient.invalidateQueries({ queryKey: ['organization-users'] });
      toast.success('Convite cancelado!');
    },
    onError: (error) => {
      toast.error('Erro ao cancelar convite: ' + error.message);
    },
  });
}

export function getInviteLink(token: string) {
  return `${window.location.origin}/convite/${token}`;
}
