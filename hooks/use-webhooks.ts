'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { webhooksAPI } from '@/lib/api';
import type { CreateWebhookInput, UpdateWebhookInput, WebhookIntegration } from '@/lib/api';

export type { WebhookIntegration };

export function useWebhooks() {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ['webhooks', profile?.organization_id],
    queryFn: () => webhooksAPI.list(profile?.organization_id),
    enabled: !!profile?.organization_id,
  });
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: (webhook: CreateWebhookInput) => webhooksAPI.create(webhook, profile?.organization_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      toast.success('Webhook criado com sucesso!');
    },
    onError: (error) => {
      toast.error(`Erro ao criar webhook: ${error.message}`);
    },
  });
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: (updates: UpdateWebhookInput) => webhooksAPI.update(updates, profile?.organization_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      toast.success('Webhook atualizado!');
    },
    onError: (error) => {
      toast.error(`Erro ao atualizar webhook: ${error.message}`);
    },
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: (id: string) => webhooksAPI.delete(id, profile?.organization_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      toast.success('Webhook removido!');
    },
    onError: (error) => {
      toast.error(`Erro ao remover webhook: ${error.message}`);
    },
  });
}

export function useToggleWebhook() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      webhooksAPI.update({ id, is_active }, profile?.organization_id),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      toast.success(variables.is_active ? 'Webhook ativado!' : 'Webhook desativado!');
    },
    onError: (error) => {
      toast.error(`Erro ao alterar webhook: ${error.message}`);
    },
  });
}

export function useRegenerateToken() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: (id: string) => webhooksAPI.regenerateToken(id, profile?.organization_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      toast.success('Token regenerado!');
    },
    onError: (error) => {
      toast.error(`Erro ao regenerar token: ${error.message}`);
    },
  });
}
