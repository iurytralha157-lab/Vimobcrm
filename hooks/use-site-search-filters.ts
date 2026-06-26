import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { siteAPI, type SiteSearchFilter } from '@/lib/api/site'
import { toast } from 'sonner'

export type { SiteSearchFilter }

export const AVAILABLE_FILTERS = [
  { key: 'search', label: 'Busca por texto', defaultLabel: 'Buscar' },
  { key: 'tipo', label: 'Tipo de imovel', defaultLabel: 'Tipo de Imovel' },
  { key: 'finalidade', label: 'Finalidade (Venda/Aluguel)', defaultLabel: 'Finalidade' },
  { key: 'cidade', label: 'Cidade', defaultLabel: 'Cidade' },
  { key: 'bairro', label: 'Bairro', defaultLabel: 'Bairro' },
  { key: 'quartos', label: 'Quartos', defaultLabel: 'Quartos' },
  { key: 'suites', label: 'Suites', defaultLabel: 'Suites' },
  { key: 'banheiros', label: 'Banheiros', defaultLabel: 'Banheiros' },
  { key: 'vagas', label: 'Vagas de garagem', defaultLabel: 'Vagas' },
  { key: 'mobilia', label: 'Mobilia', defaultLabel: 'Mobilia' },
  { key: 'preco', label: 'Faixa de preco', defaultLabel: 'Faixa de Preco' },
] as const

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Erro desconhecido'
}

export function useSiteSearchFilters() {
  const { profile } = useAuth()

  return useQuery({
    queryKey: ['site-search-filters', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return []
      return siteAPI.listSearchFilters(profile.organization_id)
    },
    enabled: !!profile?.organization_id,
  })
}

export function useCreateSearchFilter() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  return useMutation({
    mutationFn: async (item: Pick<SiteSearchFilter, 'filter_key' | 'label' | 'position' | 'is_active'>) => {
      if (!profile?.organization_id) throw new Error('Organizacao nao encontrada')
      return siteAPI.createSearchFilter(item, profile.organization_id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-search-filters'] })
      toast.success('Filtro adicionado!')
    },
    onError: (error: unknown) => {
      toast.error('Erro ao adicionar filtro: ' + getErrorMessage(error))
    },
  })
}

export function useUpdateSearchFilter() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  return useMutation({
    mutationFn: async (item: Partial<SiteSearchFilter> & { id: string }) => {
      return siteAPI.updateSearchFilter(item, profile?.organization_id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-search-filters'] })
      toast.success('Filtro atualizado!')
    },
    onError: (error: unknown) => {
      toast.error('Erro ao atualizar filtro: ' + getErrorMessage(error))
    },
  })
}

export function useDeleteSearchFilter() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  return useMutation({
    mutationFn: async (id: string) => {
      await siteAPI.deleteSearchFilter(id, profile?.organization_id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-search-filters'] })
      toast.success('Filtro removido!')
    },
    onError: (error: unknown) => {
      toast.error('Erro ao remover filtro: ' + getErrorMessage(error))
    },
  })
}

export function useReorderSearchFilters() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  return useMutation({
    mutationFn: async (items: { id: string; position: number }[]) => {
      await siteAPI.reorderSearchFilters(items, profile?.organization_id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-search-filters'] })
    },
    onError: (error: unknown) => {
      toast.error('Erro ao reordenar: ' + getErrorMessage(error))
    },
  })
}
