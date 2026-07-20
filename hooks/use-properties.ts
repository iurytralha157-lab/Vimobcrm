import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import type { Tables, TablesUpdate } from '@/integrations/supabase/types'
import { propertiesAPI, type PropertyHistoryEvent } from '@/lib/api/properties'
import { enforceClientActionRateLimit, getClientRateLimitMessage } from '@/lib/client-action-rate-limit'

export type Property = Tables<'properties'>
type PropertyMutationInput = Omit<Partial<Property>, 'id' | 'code' | 'organization_id' | 'created_at' | 'updated_at'> & {
  metadata?: Record<string, unknown>
}
type PropertyUpdateInput = Partial<Property> & {
  id: string
  metadata?: Record<string, unknown>
}

export interface PropertyFilters {
  scope?: 'own'
  status?: string
  tipo_de_negocio?: string
  tipo_de_imovel?: string
  cidade?: string
  bairro?: string
  responsavel_id?: string
  quartos_min?: string
  suites_min?: string
  banheiros_min?: string
  valor_min?: string
  valor_max?: string
  aceita_permuta?: string
  aceita_financiamento?: string
  published_on_site?: string
  owner_id?: string
  condominium_id?: string
  mobilia?: string
  exclusividade?: string
  placa_no_local?: string
  destaque?: string
  vagas_min?: string
  area_util_min?: string
  area_util_max?: string
  area_total_min?: string
  area_total_max?: string
}

const sanitizeSearchTerm = (value?: string) => value?.trim() || undefined

function parseNumericFilter(value?: string) {
  if (!value) return undefined
  const parsed = Number(value.replace(/\D/g, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function normalizeFilters(filters: PropertyFilters = {}) {
  return {
    scope: filters.scope,
    status: filters.status || undefined,
    tipo_de_negocio: filters.tipo_de_negocio || undefined,
    tipo_de_imovel: filters.tipo_de_imovel || undefined,
    cidade: sanitizeSearchTerm(filters.cidade),
    bairro: sanitizeSearchTerm(filters.bairro),
    responsavel_id: filters.responsavel_id || undefined,
    quartos_min: parseNumericFilter(filters.quartos_min),
    suites_min: parseNumericFilter(filters.suites_min),
    banheiros_min: parseNumericFilter(filters.banheiros_min),
    valor_min: parseNumericFilter(filters.valor_min),
    valor_max: parseNumericFilter(filters.valor_max),
    aceita_permuta: filters.aceita_permuta === 'true' ? true : filters.aceita_permuta === 'false' ? false : undefined,
    aceita_financiamento: filters.aceita_financiamento === 'true' ? true : filters.aceita_financiamento === 'false' ? false : undefined,
    published_on_site: filters.published_on_site === 'true' ? true : filters.published_on_site === 'false' ? false : undefined,
    owner_id: filters.owner_id || undefined,
    condominium_id: filters.condominium_id || undefined,
    mobilia: filters.mobilia || undefined,
    exclusividade: filters.exclusividade === 'true' ? true : filters.exclusividade === 'false' ? false : undefined,
    placa_no_local: filters.placa_no_local === 'true' ? true : filters.placa_no_local === 'false' ? false : undefined,
    destaque: filters.destaque === 'true' ? true : filters.destaque === 'false' ? false : undefined,
    vagas_min: parseNumericFilter(filters.vagas_min),
    area_util_min: parseNumericFilter(filters.area_util_min),
    area_util_max: parseNumericFilter(filters.area_util_max),
    area_total_min: parseNumericFilter(filters.area_total_min),
    area_total_max: parseNumericFilter(filters.area_total_max),
  }
}

function useOrganizationId() {
  const { profile, organization, organizationsLoaded, isInitializingOrg } = useAuth()
  if (organization?.id) return organization.id
  if (!organizationsLoaded || isInitializingOrg) return undefined
  return profile?.organization_id || undefined
}

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  return String(error)
}

export function useProperties(
  search?: string,
  filters: Pick<PropertyFilters, 'scope'> = {},
  options: { enabled?: boolean; limit?: number } = {},
) {
  const { user } = useAuth()
  const organizationId = useOrganizationId()
  const normalizedSearch = sanitizeSearchTerm(search)
  const normalizedFilters = normalizeFilters(filters)
  const limit = options.limit ?? 1000

  return useQuery({
    queryKey: ['properties', organizationId, normalizedSearch, normalizedFilters, limit],
    queryFn: async () => {
      if (!organizationId) return [] as Property[]

      const { data, error } = await propertiesAPI.getProperties(organizationId, {
        search: normalizedSearch,
        limit,
        ...normalizedFilters,
      })

      if (error) throw error
      return data as Property[]
    },
    enabled: !!user?.id && !!organizationId && options.enabled !== false,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  })
}

export function useInfiniteProperties(search?: string, pageSize: number = 24, filters: PropertyFilters = {}) {
  const { user } = useAuth()
  const organizationId = useOrganizationId()
  const normalizedSearch = sanitizeSearchTerm(search)
  const normalizedFilters = normalizeFilters(filters)

  return useInfiniteQuery({
    queryKey: ['properties-infinite', organizationId, normalizedSearch, pageSize, normalizedFilters],
    queryFn: async ({ pageParam = 0 }) => {
      if (!organizationId) {
        return { properties: [] as Property[], nextPage: undefined, totalCount: 0 }
      }

      const { data, count, error } = await propertiesAPI.getProperties(organizationId, {
        limit: pageSize,
        offset: pageParam * pageSize,
        search: normalizedSearch,
        ...normalizedFilters,
      })

      if (error) throw error

      return {
        properties: data as Property[],
        nextPage: data.length === pageSize ? pageParam + 1 : undefined,
        totalCount: count || 0,
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 30,
    enabled: !!user?.id && !!organizationId,
  })
}

export function useProperty(id: string | null) {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: ['property', organizationId, id],
    queryFn: async () => {
      if (!id || !organizationId) return null

      const { data, error } = await propertiesAPI.getProperty(id, organizationId)
      if (error) throw error

      return data as Property
    },
    enabled: !!id && !!organizationId,
    staleTime: 0,
  })
}

export function usePropertyHistory(id: string | null) {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: ['property-history', organizationId, id],
    queryFn: async () => {
      if (!id || !organizationId) return [] as PropertyHistoryEvent[]

      const { data, error } = await propertiesAPI.getPropertyHistory(id, organizationId)
      if (error) throw error

      return data
    },
    enabled: !!id && !!organizationId,
    staleTime: 1000 * 30,
  })
}

export function useCreateProperty() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (propertyInput: PropertyMutationInput) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      enforceClientActionRateLimit(`property:create:${user.id}`, [
        { limit: 1, windowMs: 1000 },
        { limit: 10, windowMs: 60_000 },
      ])

      const { data, error } = await propertiesAPI.createProperty(organizationId, {
        ...propertyInput,
        cadastrado_por: propertyInput.cadastrado_por || user.id,
      })

      if (error) throw error
      if (!data) throw new Error('API não retornou o imóvel criado')

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['properties'] })
      queryClient.invalidateQueries({ queryKey: ['properties-infinite'] })
      toast.success('Imóvel cadastrado com sucesso!')
    },
    onError: (error) => {
      const rateLimitMessage = getClientRateLimitMessage(error)
      if (rateLimitMessage) {
        toast.error(rateLimitMessage)
        return
      }
      toast.error('Erro ao cadastrar imóvel: ' + getErrorMessage(error))
    },
  })
}

export function useUpdateProperty() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async ({ id, ...updates }: PropertyUpdateInput) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      enforceClientActionRateLimit(`property:update:${user.id}:${id}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 30, windowMs: 60_000 },
      ])

      const { data, error } = await propertiesAPI.updateProperty(id, updates as TablesUpdate<'properties'> & { metadata?: Record<string, unknown> }, organizationId)

      if (error) throw error
      if (!data) throw new Error('Nenhuma alteração foi gravada. Verifique sua permissão para editar este imóvel.')

      return data
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['properties'] })
      queryClient.invalidateQueries({ queryKey: ['properties-infinite'] })
      queryClient.invalidateQueries({ queryKey: ['property', organizationId, variables.id] })
      if (data?.id) {
        queryClient.invalidateQueries({ queryKey: ['property', organizationId, data.id] })
      }
      toast.success('Imóvel atualizado!')
    },
    onError: (error) => {
      const rateLimitMessage = getClientRateLimitMessage(error)
      if (rateLimitMessage) {
        toast.error(rateLimitMessage)
        return
      }
      toast.error('Erro ao atualizar imóvel: ' + getErrorMessage(error))
    },
  })
}

export function useDeleteProperty() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      enforceClientActionRateLimit(`property:delete:${user.id}:${id}`, [
        { limit: 1, windowMs: 1000 },
        { limit: 10, windowMs: 60_000 },
      ])

      const { error } = await propertiesAPI.deleteProperty(id, organizationId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['properties'] })
      queryClient.invalidateQueries({ queryKey: ['properties-infinite'] })
      toast.success('Imóvel excluído!')
    },
    onError: (error) => {
      const rateLimitMessage = getClientRateLimitMessage(error)
      if (rateLimitMessage) {
        toast.error(rateLimitMessage)
        return
      }
      toast.error('Erro ao excluir imóvel: ' + getErrorMessage(error))
    },
  })
}
