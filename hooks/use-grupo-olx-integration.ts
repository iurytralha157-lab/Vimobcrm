import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  integrationsAPI,
  type GrupoOLXIntegrationInput,
  type GrupoOLXPublicationInput,
  type IntegrationJSON,
} from '@/lib/api'
import { getAPIBaseURL } from '@/lib/api/vimob-client'
import type {
  GrupoOLXImportReport,
  PropertyPublicationDesiredState,
  PropertyPublicationObservedState,
} from '@/lib/validation'
import { useAuth } from '@/contexts/AuthContext'

export type GrupoOLXIntegration = IntegrationJSON & {
  id?: string
  organization_id?: string
  portal?: string
  status?: string | null
  is_active?: boolean | null
  feed_token?: string | null
  webhook_token?: string | null
  default_pipeline_id?: string | null
  default_stage_id?: string | null
  default_assigned_user_id?: string | null
  default_round_robin_id?: string | null
  settings?: Record<string, unknown> | null
  last_feed_accessed_at?: string | null
  last_lead_received_at?: string | null
  last_import_report_at?: string | null
  last_sync_status?: string | null
  last_error?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type GrupoOLXPublication = IntegrationJSON & {
  id?: string
  integration_id?: string
  property_id?: string
  client_listing_id?: string
  publication_type?: string
  is_enabled?: boolean
  status?: string | null
  validation_errors?: unknown[]
  last_exported_at?: string | null
  last_seen_in_feed_at?: string | null
  last_error?: string | null
  canonical_managed?: boolean
  canonical_desired_state?: PropertyPublicationDesiredState | null
  canonical_observed_state?: PropertyPublicationObservedState | null
  canonical_published_version?: number | null
  canonical_updated_at?: string | null
  property?: Record<string, unknown> | null
}

export type GrupoOLXPublicURLs = {
  feedURL: string
  leadWebhookURL: string
  importReportURL: string
}

function useOrganizationId() {
  const { profile, organization, organizationsLoaded, isInitializingOrg } = useAuth()
  if (organization?.id) return organization.id
  if (!organizationsLoaded || isInitializingOrg) return undefined
  return profile?.organization_id || undefined
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function invalidateGrupoOLX(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['grupo-olx-integration'] })
  queryClient.invalidateQueries({ queryKey: ['grupo-olx-publications'] })
  queryClient.invalidateQueries({ queryKey: ['grupo-olx-import-reports'] })
}

export function useGrupoOLXIntegration(options: { enabled?: boolean } = {}) {
  const organizationId = useOrganizationId()
  const enabled = options.enabled ?? true

  return useQuery({
    queryKey: ['grupo-olx-integration', organizationId],
    queryFn: () => integrationsAPI.getGrupoOLX(organizationId) as Promise<GrupoOLXIntegration | null>,
    enabled: !!organizationId && enabled,
  })
}

export function useGrupoOLXPublications(options: { enabled?: boolean } = {}) {
  const organizationId = useOrganizationId()
  const enabled = options.enabled ?? true

  return useQuery({
    queryKey: ['grupo-olx-publications', organizationId],
    queryFn: () => integrationsAPI.listGrupoOLXPublications(organizationId) as Promise<GrupoOLXPublication[]>,
    enabled: !!organizationId && enabled,
  })
}

export function useGrupoOLXImportReports(options: { enabled?: boolean } = {}) {
  const organizationId = useOrganizationId()
  const enabled = options.enabled ?? true

  return useQuery({
    queryKey: ['grupo-olx-import-reports', organizationId],
    queryFn: () => integrationsAPI.listGrupoOLXImportReports(organizationId),
    enabled: !!organizationId && enabled,
    refetchInterval: (query) => query.state.data?.some((report) => (
      report.annotation_status === 'pending' || report.annotation_status === 'retry'
    )) ? 5_000 : 60_000,
    refetchIntervalInBackground: false,
  })
}

export function useReplayGrupoOLXImportReport() {
  const organizationId = useOrganizationId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (reportId: string) => {
      if (!organizationId) throw new Error('Organização não encontrada')
      return integrationsAPI.replayGrupoOLXImportReport(reportId, organizationId)
    },
    onSuccess: () => {
      invalidateGrupoOLX(queryClient)
      toast.success('Relatório reenviado para processamento.')
    },
    onError: (error) => toast.error(`Erro ao reprocessar relatório: ${getErrorMessage(error)}`),
  })
}

export function useSaveGrupoOLXIntegration() {
  const organizationId = useOrganizationId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: GrupoOLXIntegrationInput) => {
      if (!organizationId) throw new Error('Organização não encontrada')
      return integrationsAPI.saveGrupoOLX(input, organizationId) as Promise<GrupoOLXIntegration>
    },
    onSuccess: () => {
      invalidateGrupoOLX(queryClient)
      toast.success('Integração Grupo OLX salva.')
    },
    onError: (error) => toast.error(`Erro ao salvar Grupo OLX: ${getErrorMessage(error)}`),
  })
}

export function useActivateGrupoOLXIntegration() {
  const organizationId = useOrganizationId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => {
      if (!organizationId) throw new Error('Organização não encontrada')
      return integrationsAPI.activateGrupoOLX(organizationId) as Promise<GrupoOLXIntegration>
    },
    onSuccess: () => {
      invalidateGrupoOLX(queryClient)
      toast.success('Integração Grupo OLX ativada.')
    },
    onError: (error) => toast.error(`Erro ao ativar Grupo OLX: ${getErrorMessage(error)}`),
  })
}

export function usePauseGrupoOLXIntegration() {
  const organizationId = useOrganizationId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => {
      if (!organizationId) throw new Error('Organização não encontrada')
      return integrationsAPI.pauseGrupoOLX(organizationId) as Promise<GrupoOLXIntegration>
    },
    onSuccess: () => {
      invalidateGrupoOLX(queryClient)
      toast.success('Integração Grupo OLX pausada. O XML foi colocado em drenagem.')
    },
    onError: (error) => toast.error(`Erro ao pausar Grupo OLX: ${getErrorMessage(error)}`),
  })
}

export function useRegenerateGrupoOLXFeedToken() {
  const organizationId = useOrganizationId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => {
      if (!organizationId) throw new Error('Organização não encontrada')
      return integrationsAPI.regenerateGrupoOLXFeedToken(organizationId) as Promise<GrupoOLXIntegration>
    },
    onSuccess: () => {
      invalidateGrupoOLX(queryClient)
      toast.success('URL XML regenerada.')
    },
    onError: (error) => toast.error(`Erro ao regenerar URL XML: ${getErrorMessage(error)}`),
  })
}

export function useRegenerateGrupoOLXWebhookToken() {
  const organizationId = useOrganizationId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => {
      if (!organizationId) throw new Error('Organizacao nao encontrada')
      return integrationsAPI.regenerateGrupoOLXWebhookToken(organizationId) as Promise<GrupoOLXIntegration>
    },
    onSuccess: () => {
      invalidateGrupoOLX(queryClient)
      toast.success('URLs dos webhooks regeneradas.')
    },
    onError: (error) => toast.error(`Erro ao regenerar URLs dos webhooks: ${getErrorMessage(error)}`),
  })
}

export function useSaveGrupoOLXPublications() {
  const organizationId = useOrganizationId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (publications: GrupoOLXPublicationInput[]) => {
      if (!organizationId) throw new Error('Organização não encontrada')
      return integrationsAPI.saveGrupoOLXPublications({ publications }, organizationId) as Promise<GrupoOLXPublication[]>
    },
    onSuccess: () => {
      invalidateGrupoOLX(queryClient)
      toast.success('Imóveis do Grupo OLX atualizados.')
    },
    onError: (error) => toast.error(`Erro ao salvar imóveis: ${getErrorMessage(error)}`),
  })
}

export function getGrupoOLXPublicURLs(integration?: GrupoOLXIntegration | null): GrupoOLXPublicURLs | null {
  if (!integration?.feed_token || !integration.webhook_token || integration.status === 'draft') return null
  const baseURL = getAPIBaseURL()

  return {
    feedURL: `${baseURL}/v1/public/integrations/portals/grupo-olx/feed/${integration.feed_token}.xml`,
    leadWebhookURL: `${baseURL}/v1/public/integrations/portals/grupo-olx/leads/${integration.webhook_token}`,
    importReportURL: `${baseURL}/v1/public/integrations/portals/grupo-olx/import-reports/${integration.webhook_token}`,
  }
}

export type { GrupoOLXImportReport }
