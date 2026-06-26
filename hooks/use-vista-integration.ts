import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { integrationsAPI } from '@/lib/api';
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

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Erro desconhecido';
}

export function useVistaIntegration() {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

  return useQuery({
    queryKey: ['vista-integration', orgId],
    queryFn: () => integrationsAPI.getVista(orgId) as Promise<VistaIntegration | null>,
    enabled: !!orgId,
  });
}

export function useSaveVistaIntegration() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const orgId = profile?.organization_id;

  return useMutation({
    mutationFn: ({ api_url, api_key }: { api_url: string; api_key: string }) => {
      if (!orgId) throw new Error('No organization');
      return integrationsAPI.saveVista({ api_url, api_key }, orgId) as Promise<VistaIntegration>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vista-integration'] });
      toast.success('Integracao Vista salva!');
    },
    onError: (e: unknown) => toast.error(`Erro ao salvar: ${getErrorMessage(e)}`),
  });
}

export function useTestVistaConnection() {
  const { profile } = useAuth();

  return useMutation({
    mutationFn: () =>
      integrationsAPI.invokeFunction<VistaTestResult>('vista-sync', {
        action: 'test',
        organization_id: profile?.organization_id,
      }, profile?.organization_id),
  });
}

export function useSyncVistaProperties() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      integrationsAPI.invokeFunction<VistaSyncResult>('vista-sync', {
        action: 'sync',
        organization_id: profile?.organization_id,
      }, profile?.organization_id).then((result) => ({
        ...result,
        errors: result.errors || [],
        skipped: result.skipped || 0,
      })),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['vista-integration'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      toast.success(`Sincronizacao concluida! ${data.synced} imoveis importados.`);
    },
    onError: (e: unknown) => toast.error(`Erro na sincronizacao: ${getErrorMessage(e)}`),
  });
}

export function useDeleteVistaIntegration() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!profile?.organization_id) throw new Error('No org');
      return integrationsAPI.deleteVista(profile.organization_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vista-integration'] });
      toast.success('Integracao removida!');
    },
  });
}
