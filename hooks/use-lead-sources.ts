import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useAuth } from '@/contexts/AuthContext';
import { leadSourcesAPI } from '@/lib/api/lead-sources';
import { shouldRetryPipelineQuery } from '@/lib/pipeline-reliability';

export interface LeadSourceEntry {
  id: string;
  name: string;
  organization_id: string;
  created_at: string;
}

export function useLeadSources(options?: { enabled?: boolean }) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;

  return useQuery({
    queryKey: ['lead-sources', organizationId],
    enabled: Boolean(organizationId) && (options?.enabled ?? true),
    queryFn: ({ signal }) => leadSourcesAPI.list(organizationId, { signal }),
    retry: shouldRetryPipelineQuery,
  });
}

export function useCreateLeadSource() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;

  return useMutation({
    mutationFn: (input: { name: string }) => leadSourcesAPI.create(input, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-sources'] });
    },
    onError: (error) => {
      toast.error('Erro ao criar origem: ' + error.message);
    },
  });
}
