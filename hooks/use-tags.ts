import { useQueryWithDataTrust, type QueryDataTrustScope, type QueryWithDataTrust } from '@/hooks/shared/use-query-data-trust';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { useAuth } from '@/contexts/AuthContext';
import { tagsAPI } from '@/lib/api/tags';
import { shouldRetryPipelineQuery } from '@/lib/pipeline-reliability';
import { invalidateTagConsumers, isCurrentManagementMutation } from '@/lib/tags/management';
import { getPublicErrorMessage } from '@/lib/api/vimob-error';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';
import type { TagCatalog } from '@/lib/validation/tag-catalog';

function useTagNotificationScope(organizationId: string | null) {
  const scope = useRef(organizationId);
  useEffect(() => {
    scope.current = organizationId;
    return () => { scope.current = null; };
  }, [organizationId]);
  return scope;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  description: string | null;
  organization_id: string;
  created_at: string;
  updated_at: string;
  lead_count?: number;
}

export function useTagUsage(tagId?: string) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;
  return useQuery({
    queryKey: ['tag-usage', organizationId, tagId],
    queryFn: ({ signal }) => tagsAPI.usage(tagId!, organizationId, signal),
    enabled: Boolean(organizationId && tagId),
    staleTime: 0,
    retry: shouldRetryPipelineQuery,
  });
}

type TagQueryOptions = { cacheTrustScope?: QueryDataTrustScope; enabled?: boolean; reconcileCounts?: boolean; catalog?: boolean };
export function useTags(options: TagQueryOptions & { catalog: true }): QueryWithDataTrust<TagCatalog[], Error>;
export function useTags(options?: TagQueryOptions & { catalog?: false }): QueryWithDataTrust<Tag[], Error>;
export function useTags(options?: TagQueryOptions) {
  const { activeOrganization, user, session } = useAuth();
  const organizationId = activeOrganization.organizationId || null;
  const userId = user?.id || null;
  const sessionId = getGlobalSignOutSessionId(session);
  const catalog = options?.catalog === true;

  return useQueryWithDataTrust<Tag[] | TagCatalog[], Error>({
    queryKey: catalog ? ['tags', organizationId, 'catalog', userId, sessionId] : ['tags', organizationId],
    enabled: Boolean(organizationId) && (!catalog || Boolean(userId && sessionId)) && (options?.enabled ?? true),
    queryFn: ({ signal }) => catalog
      ? tagsAPI.catalog(organizationId!, { signal, expectedUserId: userId, expectedSessionId: sessionId })
      : tagsAPI.list(organizationId, { signal }),
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 5,
    retry: shouldRetryPipelineQuery,
    // A mounted management catalog reconciles counters even if an association
    // hint is lost. Ordinary pickers keep their existing event/focus refresh.
    refetchInterval: options?.reconcileCounts
      ? (query) => query.state.status === 'error' ? false : 1000 * 60
      : false,
    refetchIntervalInBackground: false,
  }, options?.cacheTrustScope);
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;
  const notificationScope = useTagNotificationScope(organizationId);

  return useMutation({
    onMutate: () => ({ organizationId }),
    mutationFn: async (tag: { name: string; color: string; description?: string }) => {
      if (!organizationId) throw new Error('A organização ainda não está disponível.');
      return tagsAPI.create(tag, organizationId);
    },
    onSuccess: ({ organization_id: mutationOrganizationId }) => {
      void invalidateTagConsumers(queryClient, mutationOrganizationId);
      if (isCurrentManagementMutation(notificationScope.current, mutationOrganizationId)) toast.success('Tag criada com sucesso!');
    },
    onError: (error, _variables, context) => {
      if (isCurrentManagementMutation(notificationScope.current, context?.organizationId)) toast.error('Erro ao criar tag: ' + getPublicErrorMessage(error));
    },
  });
}

export function useUpdateTag() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;
  const notificationScope = useTagNotificationScope(organizationId);

  return useMutation({
    onMutate: () => ({ organizationId }),
    mutationFn: async ({ id, ...updates }: { id: string; name: string; color: string; description?: string; expected_updated_at: string }) => {
      if (!organizationId) throw new Error('A organização ainda não está disponível.');
      return tagsAPI.update(id, updates, organizationId);
    },
    onSuccess: ({ organization_id: mutationOrganizationId }) => {
      void invalidateTagConsumers(queryClient, mutationOrganizationId);
      if (isCurrentManagementMutation(notificationScope.current, mutationOrganizationId)) toast.success('Tag atualizada!');
    },
    onError: (error, _variables, context) => {
      if (isCurrentManagementMutation(notificationScope.current, context?.organizationId)) toast.error('Erro ao atualizar tag: ' + getPublicErrorMessage(error));
    },
  });
}

export function useDeleteTag() {
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;
  const notificationScope = useTagNotificationScope(organizationId);

  return useMutation({
    onMutate: () => ({ organizationId }),
    mutationFn: async ({ id, expectedUpdatedAt }: { id: string; expectedUpdatedAt: string }) => {
      if (!organizationId) throw new Error('A organização ainda não está disponível.');
      await tagsAPI.delete(id, expectedUpdatedAt, organizationId);
      return { organizationId };
    },
    onSuccess: ({ organizationId: mutationOrganizationId }) => {
      void invalidateTagConsumers(queryClient, mutationOrganizationId);
      if (isCurrentManagementMutation(notificationScope.current, mutationOrganizationId)) toast.success('Tag excluída!');
    },
    onError: (error, _variables, context) => {
      if (isCurrentManagementMutation(notificationScope.current, context?.organizationId)) toast.error('Erro ao excluir tag: ' + getPublicErrorMessage(error));
    },
  });
}
