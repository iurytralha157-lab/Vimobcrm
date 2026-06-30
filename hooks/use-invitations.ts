import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { adminAPI } from '@/lib/api/admin';

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
  return useQuery({
    queryKey: ['invitations'],
    queryFn: () => adminAPI.listInvitations<Invitation>(),
  });
}

export function useCreateInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ email, role }: { email?: string; role: 'admin' | 'user' }) =>
      adminAPI.createInvitation<Invitation>({
        email: email || null,
        role,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      toast.success('Convite criado!');
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
