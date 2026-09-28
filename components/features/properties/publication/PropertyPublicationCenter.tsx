'use client'

import {
  AlertTriangle,
  CircleAlert,
  Globe2,
  RefreshCw,
  Send,
} from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  isPropertyPublicationConflict,
  usePropertyPublications,
  usePublishPropertyOnChannel,
  useRetryPropertyPublication,
  useUnpublishPropertyFromChannel,
} from '@/hooks/properties'
import { getPublicErrorMessage } from '@/lib/api/vimob-error'
import type {
  PropertyChannelPublication,
  PropertyPublicationCommandChannel,
  PropertyWorkspaceAsset,
} from '@/lib/validation'

import { PropertyPublicationChannelCard } from './PropertyPublicationChannelCard'
import { firstPublicationPreviewImages } from './preview-images'

type PropertyPublicationCenterProps = {
  propertyId: string
  assets: PropertyWorkspaceAsset[]
  hasAssetPhotos: boolean
}

const COMMAND_CHANNELS: PropertyPublicationCommandChannel[] = ['site', 'grupo_olx']

function isCommandChannel(channel: string): channel is PropertyPublicationCommandChannel {
  return COMMAND_CHANNELS.includes(channel as PropertyPublicationCommandChannel)
}

function commandChannelLabel(channel: PropertyPublicationCommandChannel) {
  return channel === 'grupo_olx' ? 'Grupo OLX · ZAP · Viva Real' : 'Site'
}

function PublicationCenterLoading() {
  return (
    <div className="space-y-3" aria-label="Carregando central de publicação">
      <Skeleton className="h-16 rounded-[8px]" />
      <Skeleton className="h-72 rounded-[8px]" />
    </div>
  )
}

export function PropertyPublicationCenter({ propertyId, assets, hasAssetPhotos }: PropertyPublicationCenterProps) {
  const publicationsQuery = usePropertyPublications(propertyId)
  const sitePublishMutation = usePublishPropertyOnChannel(propertyId, 'site')
  const siteUnpublishMutation = useUnpublishPropertyFromChannel(propertyId, 'site')
  const siteRetryMutation = useRetryPropertyPublication(propertyId, 'site')
  const grupoOLXPublishMutation = usePublishPropertyOnChannel(propertyId, 'grupo_olx')
  const grupoOLXUnpublishMutation = useUnpublishPropertyFromChannel(propertyId, 'grupo_olx')
  const grupoOLXRetryMutation = useRetryPropertyPublication(propertyId, 'grupo_olx')

  if (publicationsQuery.isLoading) return <PublicationCenterLoading />

  if (!publicationsQuery.data) {
    return (
      <Alert variant="destructive">
        <CircleAlert className="h-4 w-4" />
        <AlertTitle>Não foi possível carregar a Central de Publicação</AlertTitle>
        <AlertDescription className="mt-2">
          {getPublicErrorMessage(
            publicationsQuery.error,
            'A publicação está temporariamente indisponível. Tente novamente em instantes.',
          )}
          <div className="mt-4">
            <Button type="button" variant="outline" size="sm" onClick={() => publicationsQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Tentar novamente
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }

  const overview = publicationsQuery.data
  const publications = overview.data.publications
  const activeDistributionCount = publications.filter((item) => (
    item.desired_state === 'published' && item.published_version != null
  )).length
  const readyCount = publications.filter((item) => item.readiness_state === 'ready').length

  const channelMutations = (channel: PropertyPublicationCommandChannel) => channel === 'grupo_olx'
    ? {
        publish: grupoOLXPublishMutation,
        unpublish: grupoOLXUnpublishMutation,
        retry: grupoOLXRetryMutation,
      }
    : {
        publish: sitePublishMutation,
        unpublish: siteUnpublishMutation,
        retry: siteRetryMutation,
      }

  const pendingActionFor = (channel: string) => {
    if (!isCommandChannel(channel)) return null
    const mutations = channelMutations(channel)
    if (mutations.publish.isPending) return 'publish' as const
    if (mutations.unpublish.isPending) return 'unpublish' as const
    if (mutations.retry.isPending) return 'retry' as const
    return null
  }

  const commandErrorFor = (channel: string) => {
    if (!isCommandChannel(channel)) return null
    const mutations = channelMutations(channel)
    const error = [mutations.publish.error, mutations.unpublish.error, mutations.retry.error]
      .find((item) => item && !isPropertyPublicationConflict(item))
    if (!error) return null
    return getPublicErrorMessage(
      error,
      `Não foi possível atualizar a publicação em ${commandChannelLabel(channel)}.`,
    )
  }

  const conflictedChannels = COMMAND_CHANNELS.filter((channel) => {
    const mutations = channelMutations(channel)
    return [mutations.publish.error, mutations.unpublish.error, mutations.retry.error]
      .some(isPropertyPublicationConflict)
  })

  const resetChannelMutations = (channel: PropertyPublicationCommandChannel) => {
    const mutations = channelMutations(channel)
    mutations.publish.reset()
    mutations.unpublish.reset()
    mutations.retry.reset()
  }

  const getPublicationTimestamp = (publication: PropertyChannelPublication) => {
    if (publication.updated_at) return publication.updated_at
    throw new Error('A publicação ainda não possui uma revisão válida. Atualize a Central e tente novamente.')
  }

  const handlePublish = (publication: PropertyChannelPublication) => {
    if (!isCommandChannel(publication.channel)) return
    resetChannelMutations(publication.channel)
    channelMutations(publication.channel).publish.mutate({
      expected_property_updated_at: overview.data.property_updated_at,
      expected_publication_updated_at: publication.id === null
        ? null
        : getPublicationTimestamp(publication),
    })
  }

  const handleUnpublish = (publication: PropertyChannelPublication) => {
    if (!isCommandChannel(publication.channel) || !publication.updated_at) return
    resetChannelMutations(publication.channel)
    channelMutations(publication.channel).unpublish.mutate({
      expected_publication_updated_at: getPublicationTimestamp(publication),
    })
  }

  const handleRetry = (publication: PropertyChannelPublication) => {
    if (!isCommandChannel(publication.channel) || !publication.updated_at) return
    resetChannelMutations(publication.channel)
    channelMutations(publication.channel).retry.mutate({
      expected_publication_updated_at: getPublicationTimestamp(publication),
    })
  }

  const refreshAfterConflict = async (channel: PropertyPublicationCommandChannel) => {
    resetChannelMutations(channel)
    await publicationsQuery.refetch()
  }

  return (
    <div className="space-y-3">
      <div className="app-toolbar flex flex-col gap-3 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-primary/50 text-primary-foreground">
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14px] font-normal text-[var(--app-text-primary)]">Central de Publicação</h2>
            <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">
              Confira pendências e gerencie cada canal.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <span className="rounded-[5px] bg-[var(--app-surface-soft)] px-2 py-1 text-[11px] font-light text-[var(--app-text-secondary)]">
            {readyCount} de {publications.length} prontos
          </span>
          <span className="rounded-[5px] bg-[var(--app-surface-soft)] px-2 py-1 text-[11px] font-light text-[var(--app-text-secondary)]">
            {activeDistributionCount} disponibilizações ativas
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={publicationsQuery.isFetching}
            onClick={() => publicationsQuery.refetch()}
            className="h-8 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[11px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${publicationsQuery.isFetching ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {conflictedChannels.map((channel) => (
        <div key={channel} role="alert" className="flex flex-col gap-2 rounded-[8px] bg-destructive/10 px-3 py-2.5 text-[11px] font-light text-destructive sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>A publicação em {commandChannelLabel(channel)} mudou em outra sessão. Recarregue antes de agir.</span>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => void refreshAfterConflict(channel)} className="h-8 shrink-0 gap-1.5 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 text-[11px] font-light text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]">
            <RefreshCw className="h-3.5 w-3.5" />
            Recarregar canal
          </Button>
        </div>
      ))}

      {publicationsQuery.isError && (
        <div role="status" className="flex flex-col gap-2 rounded-[8px] bg-warning/10 px-3 py-2.5 text-[11px] font-light text-warning sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Os dados podem estar desatualizados. Mantivemos o último estado carregado.</span>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => publicationsQuery.refetch()} className="h-8 shrink-0 gap-1.5 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 text-[11px] font-light text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]">
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar novamente
          </Button>
        </div>
      )}

      {publications.length === 0 ? (
        <div className="app-card flex flex-col items-center px-4 py-10 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
            <Globe2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="mt-3 text-[14px] font-normal text-[var(--app-text-primary)]">Nenhum canal disponível</h3>
          <p className="mt-1 max-w-lg text-[12px] font-light text-[var(--app-text-secondary)]">
            A organização ainda não possui canais de publicação habilitados para este imóvel.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {publications.map((publication) => (
            <PropertyPublicationChannelCard
              key={`${publication.channel}:${publication.channel_account_key}`}
              publication={publication}
              previewImageUrls={firstPublicationPreviewImages(assets, hasAssetPhotos, publication.published_version)}
              canManage={overview.meta.can_manage}
              pendingAction={pendingActionFor(publication.channel)}
              actionError={commandErrorFor(publication.channel)}
              onPublish={handlePublish}
              onUnpublish={handleUnpublish}
              onRetry={handleRetry}
            />
          ))}
        </div>
      )}
    </div>
  )
}
