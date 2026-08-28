import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { siteAPI, type SiteMenuItem } from '@/lib/api/site'
import { toast } from 'sonner'

export type { SiteMenuItem }

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Erro desconhecido'
}

function useOrganizationId() {
  const { profile, organization } = useAuth()
  return organization?.id || profile?.organization_id || undefined
}

export function useSiteMenuItems() {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: ['site-menu-items', organizationId],
    queryFn: async () => {
      if (!organizationId) return []
      return siteAPI.listMenuItems(organizationId)
    },
    enabled: !!organizationId,
  })
}

export function useCreateMenuItem() {
  const queryClient = useQueryClient()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (item: Omit<SiteMenuItem, 'id' | 'organization_id' | 'created_at'>) => {
      if (!organizationId) throw new Error('Organização não encontrada')
      return siteAPI.createMenuItem(item, organizationId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-menu-items', organizationId] })
      toast.success('Item de menu adicionado!')
    },
    onError: (error: unknown) => {
      toast.error('Erro ao adicionar item: ' + getErrorMessage(error))
    },
  })
}

export function useUpdateMenuItem() {
  const queryClient = useQueryClient()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (item: Partial<SiteMenuItem> & { id: string }) => {
      if (!organizationId) throw new Error('Organização não encontrada')
      return siteAPI.updateMenuItem(item, organizationId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-menu-items', organizationId] })
      toast.success('Item atualizado!')
    },
    onError: (error: unknown) => {
      toast.error('Erro ao atualizar item: ' + getErrorMessage(error))
    },
  })
}

export function useDeleteMenuItem() {
  const queryClient = useQueryClient()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (id: string) => {
      if (!organizationId) throw new Error('Organização não encontrada')
      await siteAPI.deleteMenuItem(id, organizationId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-menu-items', organizationId] })
      toast.success('Item removido!')
    },
    onError: (error: unknown) => {
      toast.error('Erro ao remover item: ' + getErrorMessage(error))
    },
  })
}

export function useReorderMenuItems() {
  const queryClient = useQueryClient()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (items: { id: string; position: number }[]) => {
      if (!organizationId) throw new Error('Organização não encontrada')
      await siteAPI.reorderMenuItems(items, organizationId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-menu-items', organizationId] })
    },
    onError: (error: unknown) => {
      toast.error('Erro ao reordenar: ' + getErrorMessage(error))
    },
  })
}
