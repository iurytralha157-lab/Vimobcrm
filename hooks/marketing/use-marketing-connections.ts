"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { marketingConnectionsAPI } from "@/lib/api/marketing-connections";
import { splitMarketingSyncRange } from "@/hooks/use-campaign-insights";

function useConnectionsKey() {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId;
  return { organizationId, queryKey: ["marketing-connections", organizationId] as const };
}

export function useMarketingConnections(options: { enabled?: boolean } = {}) {
  const { organizationId, queryKey } = useConnectionsKey();
  return useQuery({
    queryKey,
    queryFn: () => marketingConnectionsAPI.list(organizationId),
    enabled: Boolean(organizationId) && options.enabled !== false,
    staleTime: 60_000,
  });
}

export function useStartMarketingMetaLogin() {
  const { organizationId } = useConnectionsKey();
  return useMutation({
    mutationFn: (returnUrl: string) => marketingConnectionsAPI.startMeta(returnUrl, organizationId),
    onSuccess: ({ auth_url }) => {
      window.location.assign(auth_url);
    },
    onError: (error: Error) => {
      toast.error(`Não foi possível abrir o login: ${error.message}`);
    },
  });
}

export function useUpdateMarketingConnectionAssets() {
  const { organizationId, queryKey } = useConnectionsKey();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ connectionId, assetIds }: { connectionId: string; assetIds: string[] }) =>
      marketingConnectionsAPI.updateAssets(connectionId, assetIds, organizationId),
    onSuccess: () => {
      toast.success("Seleção salva");
    },
    onError: (error: Error) => {
      toast.error(`Não foi possível salvar: ${error.message}`);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });
}

export function useSyncMarketingConnection() {
  const { organizationId, queryKey } = useConnectionsKey();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ connectionId, dateStart, dateStop }: { connectionId: string; dateStart: string; dateStop: string }) => {
      const total = { synced: 0, media: 0, social: 0, errors: [] as string[] };
      for (const window of splitMarketingSyncRange(dateStart, dateStop)) {
        const result = await marketingConnectionsAPI.sync(connectionId, window.dateStart, window.dateStop, organizationId);
        total.synced += result.synced;
        total.media += result.media_synced;
        total.social += result.social_synced;
        total.errors.push(...(result.errors ?? []));
      }
      return total;
    },
    onSuccess: (total) => {
      const summary = `${total.synced} registros de mídia, ${total.media} criativos e ${total.social} dias de Instagram`;
      if (total.errors.length > 0) {
        toast.warning(`${summary}. ${total.errors.length} item(ns) com erro.`);
      } else {
        toast.success(`Sincronizado: ${summary}.`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Erro ao sincronizar: ${error.message}`);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["campaign-insights", organizationId] });
    },
  });
}

export function useDisconnectMarketingConnection() {
  const { organizationId, queryKey } = useConnectionsKey();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) => marketingConnectionsAPI.disconnect(connectionId, organizationId),
    onSuccess: () => {
      toast.success("Conexão removida do CRM");
    },
    onError: (error: Error) => {
      toast.error(`Não foi possível desconectar: ${error.message}`);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });
}
