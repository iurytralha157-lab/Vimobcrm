import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { adminAPI } from '@/lib/api/admin';
import { useAuth } from '@/contexts/AuthContext';
import { createInvitationPath } from '@/lib/auth/invitation';
import { organizationInvitationBatchSchema } from '@/lib/validation';

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

export interface OrganizationInvitationInput {
  email: string;
  role: 'admin' | 'manager' | 'user';
}

export interface OrganizationInvitationBatchFailure {
  input: OrganizationInvitationInput;
  message: string;
}

export interface OrganizationInvitationBatchResult {
  invitations: Invitation[];
  failures: OrganizationInvitationBatchFailure[];
}

export function useInvitations({ enabled = true }: { enabled?: boolean } = {}) {
  const { activeOrganization, profile, organization } = useAuth();
  const organizationId = activeOrganization.organizationId;

  return useQuery({
    queryKey: ['invitations', organizationId],
    queryFn: () => adminAPI.listInvitations<Invitation>(organizationId),
    enabled: !!organizationId && enabled,
  });
}

export function useCreateInvitation() {
  const queryClient = useQueryClient();
  const { activeOrganization, profile, organization } = useAuth();
  const organizationId = activeOrganization.organizationId;

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
      toast.success(
        invitation.email_sent === false
          ? 'Convite criado; o envio por e-mail não foi confirmado.'
          : 'Convite enviado por e-mail.',
      );
    },
    onError: (error) => {
      toast.error('Erro ao criar convite: ' + error.message);
    },
  });
}

export function useCreateInvitations() {
  const queryClient = useQueryClient();
  const { activeOrganization, profile, organization } = useAuth();
  const organizationId = activeOrganization.organizationId;

  return useMutation({
    mutationFn: async (
      inputs: OrganizationInvitationInput[],
    ): Promise<OrganizationInvitationBatchResult> => {
      if (!organizationId) throw new Error('Organização não encontrada');
      const validatedInputs = organizationInvitationBatchSchema.parse(inputs);

      const invitations: Invitation[] = [];
      const failures: OrganizationInvitationBatchFailure[] = [];

      for (const input of validatedInputs) {
        try {
          const invitation = await adminAPI.createInvitation<Invitation>({
            email: input.email,
            role: input.role,
            organizationId,
          }, organizationId);
          invitations.push(invitation);
        } catch (error) {
          failures.push({
            input,
            message: error instanceof Error ? error.message : 'Não foi possível criar este convite.',
          });
        }
      }

      return { invitations, failures };
    },
    onSuccess: ({ invitations, failures }) => {
      const total = invitations.length + failures.length;
      const withoutConfirmedEmail = invitations.filter(
        (invitation) => invitation.email_sent === false,
      ).length;

      if (failures.length > 0) {
        let summary = invitations.length > 0
          ? `${invitations.length} de ${total} convites foram criados. Revise os ${failures.length} que falharam.`
          : 'Não foi possível criar os convites. Revise os campos e tente novamente.';
        if (withoutConfirmedEmail > 0) {
          summary += ` Em ${withoutConfirmedEmail}, o envio por e-mail não foi confirmado.`;
        }
        if (invitations.length > 0) toast.warning(summary);
        else toast.error(summary);
        return;
      }

      if (invitations.length === 1) {
        toast.success(
          withoutConfirmedEmail === 1
            ? 'Convite criado; o envio por e-mail não foi confirmado.'
            : 'Convite enviado por e-mail.',
        );
        return;
      }

      toast.success(
        withoutConfirmedEmail > 0
          ? `${invitations.length} convites criados. Em ${withoutConfirmedEmail}, o envio por e-mail não foi confirmado.`
          : `${invitations.length} convites enviados por e-mail.`,
      );
    },
    onError: (error) => {
      toast.error('Erro ao criar convites: ' + error.message);
    },
    onSettled: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['invitations', organizationId] }),
      queryClient.invalidateQueries({ queryKey: ['organization-users', organizationId] }),
    ]),
  });
}

export function useDeleteInvitation() {
  const queryClient = useQueryClient();
  const { activeOrganization, profile, organization } = useAuth();
  const organizationId = activeOrganization.organizationId;

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

export function useUpdateInvitation() {
  const queryClient = useQueryClient();
  const { activeOrganization, profile, organization } = useAuth();
  const organizationId = activeOrganization.organizationId;

  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: Invitation['role'] }) =>
      adminAPI.updateInvitation<Invitation>(id, { role }, organizationId),
    onSuccess: (invitation) => {
      queryClient.setQueryData<Invitation[]>(
        ['invitations', organizationId],
        (current = []) => current.map((item) => (
          item.id === invitation.id ? { ...item, ...invitation } : item
        )),
      );
      toast.success('Perfil do convite atualizado.');
    },
    onError: (error) => {
      toast.error('Erro ao atualizar convite: ' + error.message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['invitations', organizationId] }),
  });
}

export function useResendInvitation() {
  const queryClient = useQueryClient();
  const { activeOrganization, profile, organization } = useAuth();
  const organizationId = activeOrganization.organizationId;

  return useMutation({
    mutationFn: (id: string) => adminAPI.resendInvitation<Invitation>(id, organizationId),
    onSuccess: (invitation) => {
      queryClient.invalidateQueries({ queryKey: ['invitations', organizationId] });
      toast.success(
        invitation.email_sent === false
          ? 'Validade renovada por 7 dias; o envio por e-mail não foi confirmado.'
          : 'Convite reenviado. A validade foi renovada por 7 dias.',
      );
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
