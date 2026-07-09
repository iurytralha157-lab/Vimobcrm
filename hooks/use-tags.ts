import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useAuth } from '@/contexts/AuthContext';
import { tagsAPI } from '@/lib/api/tags';

export interface Tag {
  id: string;
  name: string;
  color: string;
  description: string | null;
  organization_id: string;
  created_at: string;
  lead_count?: number;
}

export function useTags(options?: { enabled?: boolean }) {
  const { organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || null;

  return useQuery({
    queryKey: ['tags', organizationId],
    enabled: Boolean(organizationId) && (options?.enabled ?? true),
    queryFn: () => tagsAPI.list(organizationId),
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  const { organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || null;

  return useMutation({
    mutationFn: (tag: { name: string; color: string; description?: string }) => tagsAPI.create(tag, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      toast.success('Tag criada com sucesso!');
    },
    onError: (error) => {
      toast.error('Erro ao criar tag: ' + error.message);
    },
  });
}

export function useUpdateTag() {
  const queryClient = useQueryClient();
  const { organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || null;

  return useMutation({
    mutationFn: ({ id, ...updates }: { id: string; name?: string; color?: string; description?: string }) =>
      tagsAPI.update(id, updates, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      toast.success('Tag atualizada!');
    },
    onError: (error) => {
      toast.error('Erro ao atualizar tag: ' + error.message);
    },
  });
}

export function useDeleteTag() {
  const queryClient = useQueryClient();
  const { organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || null;

  return useMutation({
    mutationFn: (id: string) => tagsAPI.delete(id, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      toast.success('Tag excluida!');
    },
    onError: (error) => {
      toast.error('Erro ao excluir tag: ' + error.message);
    },
  });
}
