import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { siteAPI, type SiteMenuItem } from '@/lib/api/site'
import { toast } from 'sonner'

export type { SiteMenuItem }

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Erro desconhecido'
}

export function useSiteMenuItems() {
  const { profile } = useAuth()

  return useQuery({
    queryKey: ['site-menu-items', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return []
      return siteAPI.listMenuItems(profile.organization_id)
    },
    enabled: !!profile?.organization_id,
  })
}

export function useCreateMenuItem() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  return useMutation({
    mutationFn: async (item: Omit<SiteMenuItem, 'id' | 'organization_id' | 'created_at'>) => {
      if (!profile?.organization_id) throw new Error('Organizacao nao encontrada')
      return siteAPI.createMenuItem(item, profile.organization_id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-menu-items'] })
      toast.success('Item de menu adicionado!')
    },
    onError: (error: unknown) => {
      toast.error('Erro ao adicionar item: ' + getErrorMessage(error))
    },
  })
}

export function useUpdateMenuItem() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  return useMutation({
    mutationFn: async (item: Partial<SiteMenuItem> & { id: string }) => {
      return siteAPI.updateMenuItem(item, profile?.organization_id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-menu-items'] })
      toast.success('Item atualizado!')
    },
    onError: (error: unknown) => {
      toast.error('Erro ao atualizar item: ' + getErrorMessage(error))
    },
  })
}

export function useDeleteMenuItem() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  return useMutation({
    mutationFn: async (id: string) => {
      await siteAPI.deleteMenuItem(id, profile?.organization_id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-menu-items'] })
      toast.success('Item removido!')
    },
    onError: (error: unknown) => {
      toast.error('Erro ao remover item: ' + getErrorMessage(error))
    },
  })
}

export function useReorderMenuItems() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  return useMutation({
    mutationFn: async (items: { id: string; position: number }[]) => {
      await siteAPI.reorderMenuItems(items, profile?.organization_id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-menu-items'] })
    },
    onError: (error: unknown) => {
      toast.error('Erro ao reordenar: ' + getErrorMessage(error))
    },
  })
}
