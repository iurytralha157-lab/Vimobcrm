import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { integrationsAPI } from '@/lib/api';
import { stringifyErrorMessage as getErrorMessage } from '@/lib/api/vimob-error';
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

export function useImoviewIntegration(options: { enabled?: boolean } = {}) {
  const { activeOrganization, profile } = useAuth();
  const orgId = activeOrganization.organizationId;

  return useQuery({
    queryKey: ['imoview-integration', orgId],
    queryFn: () => integrationsAPI.getImoview(orgId) as Promise<ImoviewIntegration | null>,
    enabled: options.enabled !== false && !!orgId,
  });
}

export function useSaveImoviewIntegration() {
  const { activeOrganization, profile } = useAuth();
  const queryClient = useQueryClient();
  const orgId = activeOrganization.organizationId;

  return useMutation<ImoviewIntegration, Error, { api_key: string }>({
    mutationFn: ({ api_key }: { api_key: string }) => {
      if (!orgId) throw new Error('Organização não encontrada.');
      return integrationsAPI.saveImoview({ api_key }, orgId) as Promise<ImoviewIntegration>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['imoview-integration'] });
      toast.success('Integração Imoview salva!');
    },
    onError: (e: unknown) => toast.error(`Erro ao salvar: ${getErrorMessage(e)}`),
  });
}

export function useTestImoviewConnection() {
  const { activeOrganization, profile } = useAuth();

  return useMutation<ImoviewTestResult, Error>({
    mutationFn: async () => {
      const data = await integrationsAPI.invokeFunction<ImoviewTestResult>('imoview-sync', {
        action: 'test',
        organization_id: activeOrganization.organizationId,
      }, activeOrganization.organizationId);
      if (!data) throw new Error('Resposta vazia ao testar Imoview');
      return data;
    },
  });
}

export function useSyncImoviewProperties() {
  const { activeOrganization, profile } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<ImoviewSyncResult, Error>({
    mutationFn: async () => {
      const data = await integrationsAPI.invokeFunction<ImoviewSyncResult>('imoview-sync', {
        action: 'sync',
        organization_id: activeOrganization.organizationId,
      }, activeOrganization.organizationId);
      if (!data) throw new Error('Resposta vazia ao sincronizar Imoview');
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['imoview-integration'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      toast.success(`Sincronização concluída! ${data.synced} imóveis importados.`);
    },
    onError: (e: unknown) => toast.error(`Erro na sincronizacao: ${getErrorMessage(e)}`),
  });
}

export function useDeleteImoviewIntegration() {
  const { activeOrganization, profile } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!activeOrganization.organizationId) throw new Error('Organização não encontrada.');
      return integrationsAPI.deleteImoview(activeOrganization.organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['imoview-integration'] });
      toast.success('Integração removida!');
    },
  });
}
