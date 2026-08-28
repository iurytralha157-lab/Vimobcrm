'use client'

import {
  AlertTriangle,
  CircleAlert,
  Globe2,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
} from '@/lib/validation'

import { PropertyPublicationChannelCard } from './PropertyPublicationChannelCard'

type PropertyPublicationCenterProps = {
  propertyId: string
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
    <div className="space-y-4" aria-label="Carregando central de publicação">
      <Skeleton className="h-32 rounded-[8px]" />
      <Skeleton className="h-96 rounded-[8px]" />
    </div>
  )
}

export function PropertyPublicationCenter({ propertyId }: PropertyPublicationCenterProps) {
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
    <div className="space-y-5">
      <Card className="app-card overflow-hidden border-0 bg-[var(--app-surface-solid)] shadow-none">
        <CardContent className="flex flex-col justify-between gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-primary/50 text-primary-foreground shadow-none">
              <Send className="h-5 w-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[14px] font-normal">Central de Publicação</h2>
                {publicationsQuery.isFetching && !publicationsQuery.isLoading && (
                  <Badge variant="outline">
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    Atualizando
                  </Badge>
                )}
              </div>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Valide cada canal, confira a prévia pública e acompanhe todo o processamento sem expor dados internos do imóvel.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Badge variant="secondary" className="gap-1.5 py-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              {readyCount} de {publications.length} prontos
            </Badge>
            <Badge variant="secondary" className="gap-1.5 py-1">
              <Globe2 className="h-3.5 w-3.5" />
              {activeDistributionCount} disponibilizações ativas
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={publicationsQuery.isFetching}
              onClick={() => publicationsQuery.refetch()}
            >
              <RefreshCw className={publicationsQuery.isFetching ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} />
              Atualizar
            </Button>
          </div>
        </CardContent>
      </Card>

      {conflictedChannels.map((channel) => (
        <Alert key={channel} variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            A publicação em {commandChannelLabel(channel)} foi alterada em outra sessão
          </AlertTitle>
          <AlertDescription className="mt-2">
            Recarregue o estado mais recente deste canal antes de repetir a ação. Assim nenhuma alteração de outro usuário será sobrescrita.
            <div className="mt-3">
              <Button type="button" variant="outline" size="sm" onClick={() => void refreshAfterConflict(channel)}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Recarregar canal
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ))}

      {publicationsQuery.isError && (
        <Alert>
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>Os dados podem estar desatualizados</AlertTitle>
          <AlertDescription className="mt-2">
            Mantivemos o último estado carregado porque a atualização mais recente falhou.
            <div className="mt-3">
              <Button type="button" variant="outline" size="sm" onClick={() => publicationsQuery.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Atualizar novamente
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {publications.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="p-10 text-center">
            <Globe2 className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <h3 className="mt-4 text-[14px] font-normal">Nenhum canal disponível</h3>
            <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
              A organização ainda não possui canais de publicação habilitados para este imóvel.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5">
          {publications.map((publication) => (
            <PropertyPublicationChannelCard
              key={`${publication.channel}:${publication.channel_account_key}`}
              publication={publication}
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
