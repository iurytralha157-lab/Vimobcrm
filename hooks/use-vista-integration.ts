import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { integrationsAPI } from '@/lib/api';
import { getErrorObjectMessage as getErrorMessage } from '@/lib/api/vimob-error';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export type VistaIntegration = {
  id?: string;
  organization_id?: string;
  api_url?: string | null;
  status?: string | null;
  last_sync_at?: string | null;
  total_synced?: number | null;
};

type VistaTestResult = {
  success: boolean;
  message?: string;
  error?: string;
};

type VistaSyncResult = {
  synced: number;
  skipped: number;
  errors: string[];
};

export function useVistaIntegration(options: { enabled?: boolean } = {}) {
  const { activeOrganization, profile } = useAuth();
  const orgId = activeOrganization.organizationId;

  return useQuery({
    queryKey: ['vista-integration', orgId],
    queryFn: () => integrationsAPI.getVista(orgId) as Promise<VistaIntegration | null>,
    enabled: options.enabled !== false && !!orgId,
  });
}

export function useSaveVistaIntegration() {
  const { activeOrganization, profile } = useAuth();
  const queryClient = useQueryClient();
  const orgId = activeOrganization.organizationId;

  return useMutation({
    mutationFn: ({ api_url, api_key }: { api_url: string; api_key: string }) => {
      if (!orgId) throw new Error('Organização não encontrada.');
      return integrationsAPI.saveVista({ api_url, api_key }, orgId) as Promise<VistaIntegration>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vista-integration'] });
      toast.success('Integração Vista salva!');
    },
    onError: (e: unknown) => toast.error(`Erro ao salvar: ${getErrorMessage(e)}`),
  });
}

export function useTestVistaConnection() {
  const { activeOrganization, profile } = useAuth();

  return useMutation({
    mutationFn: () =>
      integrationsAPI.invokeFunction<VistaTestResult>('vista-sync', {
        action: 'test',
        organization_id: activeOrganization.organizationId,
      }, activeOrganization.organizationId),
  });
}

export function useSyncVistaProperties() {
  const { activeOrganization, profile } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      integrationsAPI.invokeFunction<VistaSyncResult>('vista-sync', {
        action: 'sync',
        organization_id: activeOrganization.organizationId,
      }, activeOrganization.organizationId).then((result) => ({
        ...result,
        errors: result.errors || [],
        skipped: result.skipped || 0,
      })),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['vista-integration'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      toast.success(`Sincronização concluída! ${data.synced} imóveis importados.`);
    },
    onError: (e: unknown) => toast.error(`Erro na sincronizacao: ${getErrorMessage(e)}`),
  });
}

export function useDeleteVistaIntegration() {
  const { activeOrganization, profile } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!activeOrganization.organizationId) throw new Error('Organização não encontrada.');
      return integrationsAPI.deleteVista(activeOrganization.organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vista-integration'] });
      toast.success('Integração removida!');
    },
  });
}
