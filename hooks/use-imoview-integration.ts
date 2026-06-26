import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { integrationsAPI } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export type ImoviewIntegration = {
  id?: string;
  organization_id?: string;
  status?: string | null;
  last_sync_at?: string | null;
  total_synced?: number | null;
};

type ImoviewTestResult = {
  success: boolean;
  message?: string;
  error?: string;
};

type ImoviewSyncResult = {
  synced: number;
  skipped: number;
  errors?: string[];
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

export function useImoviewIntegration() {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

  return useQuery({
    queryKey: ['imoview-integration', orgId],
    queryFn: () => integrationsAPI.getImoview(orgId) as Promise<ImoviewIntegration | null>,
    enabled: !!orgId,
  });
}

export function useSaveImoviewIntegration() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const orgId = profile?.organization_id;

  return useMutation<ImoviewIntegration, Error, { api_key: string }>({
    mutationFn: ({ api_key }: { api_key: string }) => {
      if (!orgId) throw new Error('No organization');
      return integrationsAPI.saveImoview({ api_key }, orgId) as Promise<ImoviewIntegration>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['imoview-integration'] });
      toast.success('Integracao Imoview salva!');
    },
    onError: (e: unknown) => toast.error(`Erro ao salvar: ${getErrorMessage(e)}`),
  });
}

export function useTestImoviewConnection() {
  const { profile } = useAuth();

  return useMutation<ImoviewTestResult, Error>({
    mutationFn: async () => {
      const data = await integrationsAPI.invokeFunction<ImoviewTestResult>('imoview-sync', {
        action: 'test',
        organization_id: profile?.organization_id,
      }, profile?.organization_id);
      if (!data) throw new Error('Resposta vazia ao testar Imoview');
      return data;
    },
  });
}

export function useSyncImoviewProperties() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<ImoviewSyncResult, Error>({
    mutationFn: async () => {
      const data = await integrationsAPI.invokeFunction<ImoviewSyncResult>('imoview-sync', {
        action: 'sync',
        organization_id: profile?.organization_id,
      }, profile?.organization_id);
      if (!data) throw new Error('Resposta vazia ao sincronizar Imoview');
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['imoview-integration'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      toast.success(`Sincronizacao concluida! ${data.synced} imoveis importados.`);
    },
    onError: (e: unknown) => toast.error(`Erro na sincronizacao: ${getErrorMessage(e)}`),
  });
}

export function useDeleteImoviewIntegration() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!profile?.organization_id) throw new Error('No org');
      return integrationsAPI.deleteImoview(profile.organization_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['imoview-integration'] });
      toast.success('Integracao removida!');
    },
  });
}
