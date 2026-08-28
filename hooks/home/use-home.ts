'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useAuth } from '@/contexts/AuthContext'
import {
  homeAPI,
  type CreateHomePublicationInput,
  type ReorderHomePublicationsInput,
  type UpdateHomePublicationInput,
} from '@/lib/api/home'

const HOME_PUBLICATIONS_STALE_TIME_MS = 5 * 60_000
const HOME_PUBLICATIONS_GC_TIME_MS = 30 * 60_000
const ADMIN_HOME_PUBLICATIONS_STALE_TIME_MS = 30_000

export const homeQueryKeys = {
  publications: (organizationId?: string) => (
    ['home', 'publications', organizationId || 'none'] as const
  ),
  allPublications: () => ['home', 'publications'] as const,
  adminPublications: () => ['home', 'admin-publications'] as const,
}

function useOrganizationId() {
  const { organization, profile } = useAuth()
  return organization?.id ?? profile?.organization_id ?? undefined
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function useInvalidateHomePublications() {
  const queryClient = useQueryClient()

  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: homeQueryKeys.allPublications() }),
    queryClient.invalidateQueries({ queryKey: homeQueryKeys.adminPublications() }),
  ])
}

export function useHomePublications(enabled = true) {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: homeQueryKeys.publications(organizationId),
    enabled: Boolean(organizationId && enabled),
    queryFn: ({ signal }) => homeAPI.listPublications(organizationId, signal),
    staleTime: HOME_PUBLICATIONS_STALE_TIME_MS,
    gcTime: HOME_PUBLICATIONS_GC_TIME_MS,
    refetchOnWindowFocus: false,
  })
}

export function useHomeAssistant() {
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: (question: string) => {
      if (!organizationId) {
        throw new Error('Selecione uma organização para consultar o assistente.')
      }
      return homeAPI.askAssistant(question, organizationId)
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(
        error,
        'Não foi possível consultar o assistente agora.',
      ))
    },
  })
}

export function useAdminHomePublications() {
  return useQuery({
    queryKey: homeQueryKeys.adminPublications(),
    queryFn: ({ signal }) => homeAPI.listAdminPublications(signal),
    staleTime: ADMIN_HOME_PUBLICATIONS_STALE_TIME_MS,
    gcTime: HOME_PUBLICATIONS_GC_TIME_MS,
    placeholderData: (previous) => previous ?? [],
    refetchOnWindowFocus: false,
  })
}

export function useCreateHomePublication() {
  const invalidate = useInvalidateHomePublications()

  return useMutation({
    mutationFn: (input: CreateHomePublicationInput) => homeAPI.createPublication(input),
    onSuccess: async () => {
      await invalidate()
      toast.success('Publicação criada.')
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Não foi possível criar a publicação.'))
    },
  })
}

export function useUpdateHomePublication() {
  const invalidate = useInvalidateHomePublications()

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateHomePublicationInput }) => (
      homeAPI.updatePublication(id, input)
    ),
    onSuccess: async () => {
      await invalidate()
      toast.success('Publicação atualizada.')
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Não foi possível atualizar a publicação.'))
    },
  })
}

export function useDeleteHomePublication() {
  const invalidate = useInvalidateHomePublications()

  return useMutation({
    mutationFn: (id: string) => homeAPI.deletePublication(id),
    onSuccess: async (result) => {
      await invalidate()
      if (result.cleanupWarning) {
        toast.warning(`Publicação removida. ${result.cleanupWarning}`)
        return
      }
      toast.success('Publicação removida.')
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Não foi possível remover a publicação.'))
    },
  })
}

export function useReorderHomePublications() {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateHomePublications()

  return useMutation({
    mutationFn: (input: ReorderHomePublicationsInput) => homeAPI.reorderPublications(input),
    onSuccess: async (publications) => {
      queryClient.setQueryData(homeQueryKeys.adminPublications(), publications)
      await invalidate()
      toast.success('Ordem das publicações atualizada.')
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Não foi possível reordenar as publicações.'))
    },
  })
}

export function useUploadHomePublicationImage() {
  const invalidate = useInvalidateHomePublications()

  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => (
      homeAPI.uploadPublicationImage(id, file)
    ),
    onSuccess: async () => {
      await invalidate()
      toast.success('Imagem enviada.')
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Não foi possível enviar a imagem.'))
    },
  })
}

export function useDeleteHomePublicationImage() {
  const invalidate = useInvalidateHomePublications()

  return useMutation({
    mutationFn: (id: string) => homeAPI.deletePublicationImage(id),
    onSuccess: async (result) => {
      await invalidate()
      if (result.cleanupWarning) {
        toast.warning(`Imagem desvinculada. ${result.cleanupWarning}`)
        return
      }
      toast.success('Imagem removida.')
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Não foi possível remover a imagem.'))
    },
  })
}
