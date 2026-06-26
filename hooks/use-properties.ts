import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import type { Tables, TablesUpdate } from '@/integrations/supabase/types'
import { propertiesAPI } from '@/lib/api/properties'
import { enforceClientActionRateLimit, getClientRateLimitMessage } from '@/lib/client-action-rate-limit'

export type Property = Tables<'properties'>

export interface PropertyFilters {
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
}

const sanitizeSearchTerm = (value?: string) => value?.trim() || undefined

function parseNumericFilter(value?: string) {
  if (!value) return undefined
  const parsed = Number(value.replace(/\D/g, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function normalizeFilters(filters: PropertyFilters = {}) {
  return {
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
  }
}

function useOrganizationId() {
  const { profile, organization } = useAuth()
  return organization?.id || profile?.organization_id || undefined
}

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  return String(error)
}

export function useProperties(search?: string) {
  const { user } = useAuth()
  const organizationId = useOrganizationId()
  const normalizedSearch = sanitizeSearchTerm(search)

  return useQuery({
    queryKey: ['properties', organizationId, normalizedSearch],
    queryFn: async () => {
      if (!organizationId) return [] as Property[]

      const { data, error } = await propertiesAPI.getProperties(organizationId, {
        search: normalizedSearch,
        limit: 1000,
      })

      if (error) throw error
      return data as Property[]
    },
    enabled: !!user?.id && !!organizationId,
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

export function useCreateProperty() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (propertyInput: Omit<Partial<Property>, 'id' | 'code' | 'organization_id' | 'created_at' | 'updated_at'>) => {
      if (!user?.id) throw new Error('Usuario nao autenticado')
      if (!organizationId) throw new Error('Usuario nao possui organizacao')

      enforceClientActionRateLimit(`property:create:${user.id}`, [
        { limit: 1, windowMs: 1000 },
        { limit: 10, windowMs: 60_000 },
      ])

      const { data, error } = await propertiesAPI.createProperty(organizationId, {
        ...propertyInput,
        cadastrado_por: propertyInput.cadastrado_por || user.id,
      })

      if (error) throw error
      if (!data) throw new Error('API nao retornou o imovel criado')

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
    mutationFn: async ({ id, ...updates }: Partial<Property> & { id: string }) => {
      if (!user?.id) throw new Error('Usuario nao autenticado')
      if (!organizationId) throw new Error('Usuario nao possui organizacao')

      enforceClientActionRateLimit(`property:update:${user.id}:${id}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 30, windowMs: 60_000 },
      ])

      const { data, error } = await propertiesAPI.updateProperty(id, updates as TablesUpdate<'properties'>, organizationId)

      if (error) throw error
      if (!data) throw new Error('Nenhuma alteracao foi gravada. Verifique sua permissao para editar este imovel.')

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
      if (!user?.id) throw new Error('Usuario nao autenticado')
      if (!organizationId) throw new Error('Usuario nao possui organizacao')

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
