import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { adminAPI } from '@/lib/api/admin';

export interface FeatureRequest {
  id: string;
  organization_id: string;
  user_id: string | null;
  category: string;
  title: string;
  description: string;
  status: 'pending' | 'analyzing' | 'approved' | 'rejected';
  admin_response: string | null;
  responded_at: string | null;
  responded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateFeatureRequestInput {
  category: string;
  title: string;
  description: string;
}

export interface UpdateFeatureRequestInput {
  id: string;
  status: FeatureRequest['status'];
  admin_response?: string;
}

export function useMyFeatureRequests() {
  const { profile } = useAuth();
  const profileId = profile?.id;

  return useQuery({
    queryKey: ['my-feature-requests', profileId],
    queryFn: () => adminAPI.listMyFeatureRequests<FeatureRequest>(),
    enabled: !!profileId,
  });
}

export function useAllFeatureRequests() {
  const { isSuperAdmin } = useAuth();

  return useQuery({
    queryKey: ['all-feature-requests'],
    queryFn: () => adminAPI.listFeatureRequestsAdmin<FeatureRequest & {
      user: { id: string; name: string; email: string } | null;
      organization: { id: string; name: string } | null;
    }>(),
    enabled: isSuperAdmin,
  });
}

export function useCreateFeatureRequest() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CreateFeatureRequestInput) => {
      if (!profile?.id || !organization?.id) {
        throw new Error('Usuário não autenticado');
      }

      return adminAPI.createFeatureRequest<FeatureRequest>(input as unknown as Record<string, unknown>, organization.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-feature-requests'] });
      toast({
        title: 'Solicitação enviada!',
        description: 'Sua sugestão foi recebida e será analisada em até 15-30 dias.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Erro ao enviar',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

export function useRespondFeatureRequest() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (input: UpdateFeatureRequestInput) =>
      adminAPI.respondFeatureRequestAdmin<FeatureRequest>(input.id, {
        status: input.status,
        admin_response: input.admin_response,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-feature-requests'] });
      toast({
        title: 'Resposta enviada!',
        description: 'O usuário será notificado sobre o status da solicitação.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Erro ao responder',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
