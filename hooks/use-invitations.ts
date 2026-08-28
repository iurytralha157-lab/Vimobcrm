import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { adminAPI } from '@/lib/api/admin';
import { useAuth } from '@/contexts/AuthContext';
import { createInvitationPath } from '@/lib/auth/invitation';

export interface Invitation {
  id: string;
  organization_id: string;
  organization_name?: string | null;
  email: string | null;
  token?: string;
  role: 'admin' | 'manager' | 'user';
  created_by: string | null;
  expires_at: string;
  used_at: string | null;
  created_at: string;
  updated_at?: string;
  is_expired?: boolean;
  email_sent?: boolean;
  email_status?: string | null;
  email_provider_message_id?: string | null;
  email_accepted_at?: string | null;
  email_delivered_at?: string | null;
  email_last_event_at?: string | null;
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
    mutationFn: ({ email, role }: { email?: string; role: 'admin' | 'manager' | 'user' }) => {
      if (!organizationId) throw new Error('Organização não encontrada');
      return adminAPI.createInvitation<Invitation>({
        email: email || '',
        role,
        organizationId,
      }, organizationId);
    },
    onSuccess: (invitation) => {
      queryClient.invalidateQueries({ queryKey: ['invitations', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['organization-users', organizationId] });
      toast.success(invitation.email_sent === false ? 'Convite criado sem envio de e-mail.' : 'Convite enviado por e-mail.');
    },
    onError: (error) => {
      toast.error('Erro ao criar convite: ' + error.message);
    },
  });
}

export function useDeleteInvitation() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id;

  return useMutation({
    mutationFn: (id: string) => adminAPI.deleteInvitation(id, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['organization-users', organizationId] });
      toast.success('Convite cancelado!');
    },
    onError: (error) => {
      toast.error('Erro ao cancelar convite: ' + error.message);
    },
  });
}

export function useResendInvitation() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id;

  return useMutation({
    mutationFn: (id: string) => adminAPI.resendInvitation<Invitation>(id, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations', organizationId] });
      toast.success('Convite reenviado. A validade foi renovada por 7 dias.');
    },
    onError: (error) => {
      toast.error('Erro ao reenviar convite: ' + error.message);
    },
  });
}

export function getInviteLink(token: string) {
  const path = createInvitationPath(token);
  if (!path) throw new Error('Token de convite inválido');
  return `${window.location.origin}${path}`;
}
