'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { webhooksAPI } from '@/lib/api';
import type { CreateWebhookInput, UpdateWebhookInput, WebhookIntegration } from '@/lib/api';

export type { WebhookIntegration };

function useActiveOrganizationId() {
  const { profile, organization } = useAuth();
  return organization?.id || profile?.organization_id || null;
}

export function useWebhooks() {
  const organizationId = useActiveOrganizationId();

  return useQuery({
    queryKey: ['webhooks', organizationId],
    queryFn: () => webhooksAPI.list(organizationId),
    enabled: !!organizationId,
  });
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: (webhook: CreateWebhookInput) => webhooksAPI.create(webhook, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', organizationId] });
      toast.success('Webhook criado com sucesso!');
    },
    onError: (error) => {
      toast.error(`Erro ao criar webhook: ${error.message}`);
    },
  });
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: (updates: UpdateWebhookInput) => webhooksAPI.update(updates, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', organizationId] });
      toast.success('Webhook atualizado!');
    },
    onError: (error) => {
      toast.error(`Erro ao atualizar webhook: ${error.message}`);
    },
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: (id: string) => webhooksAPI.delete(id, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', organizationId] });
      toast.success('Webhook removido!');
    },
    onError: (error) => {
      toast.error(`Erro ao remover webhook: ${error.message}`);
    },
  });
}

export function useToggleWebhook() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      webhooksAPI.update({ id, is_active }, organizationId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', organizationId] });
      toast.success(variables.is_active ? 'Webhook ativado!' : 'Webhook desativado!');
    },
    onError: (error) => {
      toast.error(`Erro ao alterar webhook: ${error.message}`);
    },
  });
}

export function useRegenerateToken() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  return useMutation({
    mutationFn: (id: string) => webhooksAPI.regenerateToken(id, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', organizationId] });
      toast.success('Token regenerado!');
    },
    onError: (error) => {
      toast.error(`Erro ao regenerar token: ${error.message}`);
    },
  });
}
