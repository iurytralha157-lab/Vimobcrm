'use client'

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useAuth } from '@/contexts/AuthContext'
import {
  attentionAPI,
  type AttentionItemStatus,
  type AttentionScope,
  type CreateAttentionPolicyInput,
  type UpdateAttentionPolicyInput,
  type UpdateAttentionSettingsInput,
} from '@/lib/api/attention'

const ATTENTION_PAGE_SIZE = 20
const ATTENTION_REFETCH_INTERVAL_MS = 60_000

function useOrganizationId() {
  const { organization, profile } = useAuth()
  return organization?.id || profile?.organization_id || undefined
}

export function useAttentionItems(scope: AttentionScope, status?: AttentionItemStatus) {
  const organizationId = useOrganizationId()

  return useInfiniteQuery({
    queryKey: ['attention', 'items', organizationId, scope, status || 'all'],
    enabled: Boolean(organizationId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => attentionAPI.listItems({
      scope,
      status,
      limit: ATTENTION_PAGE_SIZE,
      cursor: pageParam,
      organizationId,
    }),
    getNextPageParam: (page) => page.nextCursor || undefined,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchInterval: ATTENTION_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  })
}

export function useAttentionSummary(scope: AttentionScope) {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: ['attention', 'summary', organizationId, scope],
    enabled: Boolean(organizationId),
    queryFn: () => attentionAPI.getSummary(scope, organizationId),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchInterval: ATTENTION_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  })
}

export function useAttentionPolicies() {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: ['attention', 'policies', organizationId],
    enabled: Boolean(organizationId),
    queryFn: () => attentionAPI.listPolicies(organizationId),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  })
}

export function useAttentionSettings() {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: ['attention', 'settings', organizationId],
    enabled: Boolean(organizationId),
    queryFn: () => attentionAPI.getSettings(organizationId),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  })
}

function useAttentionMutationInvalidation() {
  const queryClient = useQueryClient()

  return () => {
    queryClient.invalidateQueries({ queryKey: ['attention', 'items'] })
    queryClient.invalidateQueries({ queryKey: ['attention', 'summary'] })
    queryClient.invalidateQueries({ queryKey: ['home'] })
  }
}

export function useAcknowledgeAttentionItem() {
  const organizationId = useOrganizationId()
  const invalidate = useAttentionMutationInvalidation()

  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => attentionAPI.acknowledgeItem(id, note, organizationId),
    onSuccess: () => {
      invalidate()
      toast.success('Alerta assumido. A equipe agora sabe que você está cuidando dele.')
    },
    onError: (error: Error) => toast.error(error.message || 'Não foi possível assumir o alerta.'),
  })
}

export function useSnoozeAttentionItem() {
  const organizationId = useOrganizationId()
  const invalidate = useAttentionMutationInvalidation()

  return useMutation({
    mutationFn: ({ id, minutes, note }: { id: string; minutes: number; note?: string }) => (
      attentionAPI.snoozeItem(id, minutes, note, organizationId)
    ),
    onSuccess: () => {
      invalidate()
      toast.success('Alerta adiado pelo período selecionado.')
    },
    onError: (error: Error) => toast.error(error.message || 'Não foi possível adiar o alerta.'),
  })
}

export function useResolveAttentionItem() {
  const organizationId = useOrganizationId()
  const invalidate = useAttentionMutationInvalidation()

  return useMutation({
    mutationFn: ({
      id,
      reason,
      note,
      administrativeOverride = false,
    }: {
      id: string
      reason: string
      note?: string
      administrativeOverride?: boolean
    }) => (
      attentionAPI.resolveItem(
        id,
        reason,
        note,
        organizationId,
        administrativeOverride,
      )
    ),
    onSuccess: () => {
      invalidate()
      toast.success('Alerta resolvido.')
    },
    onError: (error: Error) => toast.error(error.message || 'Não foi possível resolver o alerta.'),
  })
}

export function useCreateAttentionPolicy() {
  const organizationId = useOrganizationId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateAttentionPolicyInput) => attentionAPI.createPolicy(input, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention', 'policies'] })
      toast.success('Regra criada em modo de observação.')
    },
    onError: (error: Error) => toast.error(error.message || 'Não foi possível criar a regra.'),
  })
}

export function useUpdateAttentionPolicy() {
  const organizationId = useOrganizationId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAttentionPolicyInput }) => (
      attentionAPI.updatePolicy(id, input, organizationId)
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention', 'policies'] })
      queryClient.invalidateQueries({ queryKey: ['attention', 'items'] })
      queryClient.invalidateQueries({ queryKey: ['attention', 'summary'] })
      queryClient.invalidateQueries({ queryKey: ['home'] })
      toast.success('Regra atualizada. Ciclos existentes mantêm a versão original.')
    },
    onError: (error: Error) => toast.error(error.message || 'Não foi possível atualizar a regra.'),
  })
}

export function useUpdateAttentionSettings() {
  const organizationId = useOrganizationId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateAttentionSettingsInput) => attentionAPI.updateSettings(input, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention', 'settings'] })
      queryClient.invalidateQueries({ queryKey: ['attention', 'items'] })
      queryClient.invalidateQueries({ queryKey: ['attention', 'summary'] })
      queryClient.invalidateQueries({ queryKey: ['home'] })
      toast.success('Configurações globais do motor atualizadas.')
    },
    onError: (error: Error) => toast.error(error.message || 'Não foi possível atualizar a segurança global.'),
  })
}
