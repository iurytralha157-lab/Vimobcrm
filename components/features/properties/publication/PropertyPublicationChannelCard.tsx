'use client'

import Link from 'next/link'
import {
  AlertCircle,
  CircleAlert,
  Clock3,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PropertyChannelPublication } from '@/lib/validation'

import { PROPERTY_PRIMARY_BUTTON_CLASS, PROPERTY_SECONDARY_BUTTON_CLASS, PropertyChip, type PropertyChipTone } from '../property-ui'
import { PropertyPublicationChannelDetails } from './PropertyPublicationChannelDetails'
import { PropertyPublicationPreview } from './PropertyPublicationPreview'
import { publicationIsBusy, publicationPublishBlockReason, publicationUnavailableReason } from './publication-action'
import { getSitePublicationState } from './site-publication-state'

type PublicationAction = 'publish' | 'unpublish' | 'retry'

type PropertyPublicationChannelCardProps = {
  publication: PropertyChannelPublication
  previewImageUrls?: string[]
  canManage: boolean
  pendingAction: PublicationAction | null
  actionError?: string | null
  onPublish: (publication: PropertyChannelPublication) => void
  onUnpublish: (publication: PropertyChannelPublication) => void
  onRetry: (publication: PropertyChannelPublication) => void
}

const OBSERVED_STATE_LABELS: Record<PropertyChannelPublication['observed_state'], string> = {
  draft: 'Rascunho',
  queued: 'Na fila',
  publishing: 'Publicando',
  published: 'Publicado',
  pausing: 'Pausando',
  paused: 'Pausado',
  unpublishing: 'Removendo do ar',
  unpublished: 'Não publicado',
  error: 'Com erro',
}

function observedStateLabel(publication: PropertyChannelPublication) {
  if (publication.channel === 'site') {
    return getSitePublicationState(publication, false, true).label
  }
  if (publication.channel === 'grupo_olx' && publication.observed_state === 'published') {
    if (publication.checks.some((check) => check.code === 'grupo_olx_status' && !check.resolved)) {
      return 'Fora do XML pelo status'
    }
    return publication.last_error ? 'XML disponível; atualização falhou' : 'Disponível no XML'
  }
  return OBSERVED_STATE_LABELS[publication.observed_state]
}

function statusTone(state: PropertyChannelPublication['observed_state']): PropertyChipTone {
  if (state === 'error') return 'danger'
  if (state === 'published') return 'success'
  return 'neutral'
}

export function PropertyPublicationChannelCard({
  publication,
  previewImageUrls,
  canManage,
  pendingAction,
  actionError,
  onPublish,
  onUnpublish,
  onRetry,
}: PropertyPublicationChannelCardProps) {
  const isSiteChannel = publication.channel === 'site'
  const isGrupoOLXChannel = publication.channel === 'grupo_olx'
  const siteState = isSiteChannel ? getSitePublicationState(publication, false, true) : null
  const isTransient = publicationIsBusy(publication)
  const unresolvedChecks = publication.checks.filter((check) => !check.resolved)
  const blockingChecks = unresolvedChecks.filter((check) => (check.severity ?? 'error') === 'error')
  const warningChecks = unresolvedChecks.filter((check) => check.severity === 'warning')
  const publishDisabled = Boolean(pendingAction || !publication.capabilities.can_publish || !publication.available || isTransient)
  const publishBlockReason = publicationPublishBlockReason(publication)
  // A retirada que falhou deve continuar recuperável mesmo se o canal ficar
  // indisponível; o backend expõe can_retry exatamente para essa drenagem.
  const retryDisabled = Boolean(pendingAction || isTransient)
  const unpublishDisabled = Boolean(pendingAction || isTransient)
  const readinessHeadingId = `readiness-${publication.channel}-${publication.channel_account_key}`

  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-[12px] bg-[var(--app-surface-solid)] p-4" aria-label={publication.label}>
      <header className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-[14px] font-normal text-[var(--app-text-primary)]">{publication.label}</h2>
        <div className="flex flex-wrap justify-end gap-1">
          {!publication.available && <PropertyChip tone="warning">Canal indisponível</PropertyChip>}
          {publication.is_outdated && <PropertyChip tone="warning">Atualização pendente</PropertyChip>}
          <PropertyChip tone={statusTone(publication.last_error ? 'error' : siteState?.tone === 'success' ? 'published' : siteState?.tone === 'neutral' ? 'unpublished' : publication.observed_state)}>
            {isTransient && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />}
            {observedStateLabel(publication)}
          </PropertyChip>
        </div>
      </header>

        {!publication.available && (
          <div role="status" className="flex flex-col gap-2 rounded-[7px] bg-warning/10 px-3 py-2.5 text-[12px] font-light text-warning sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{publicationUnavailableReason(publication)}</span>
            </div>
            {isGrupoOLXChannel && (
              <Button asChild type="button" variant="ghost" size="sm" className="h-8 shrink-0 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 text-[11px] font-light text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]">
                <Link href="/settings?tab=grupo-olx">Configurar Grupo OLX</Link>
              </Button>
            )}
          </div>
        )}

        {publication.last_error && (
          <div role="alert" className="flex items-start gap-2 rounded-[7px] bg-destructive/10 px-3 py-2.5 text-[12px] font-light text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <p><span className="font-normal">Falha no último processamento.</span> {publication.last_error.message}</p>
          </div>
        )}

        {actionError && (
          <div role="alert" className="flex items-start gap-2 rounded-[7px] bg-destructive/10 px-3 py-2.5 text-[12px] font-light text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <p><span className="font-normal">Ação não enviada.</span> {actionError}</p>
          </div>
        )}

        <div aria-labelledby={readinessHeadingId}>
          <p id={readinessHeadingId} className="text-[12px] font-light text-[var(--app-text-secondary)]">
            {publication.readiness_state === 'ready'
              ? 'Sem pendências obrigatórias.'
              : publication.readiness_state === 'blocked'
                ? blockingChecks.length > 0
                  ? `${blockingChecks.length} pendência(s) obrigatória(s) impedem a publicação${warningChecks.length ? `; há também ${warningChecks.length} aviso(s)` : ''}.`
                  : 'Há pendências que precisam ser revisadas antes da publicação.'
                : 'A prontidão ainda está sendo avaliada.'}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-[color-mix(in_srgb,var(--app-text-primary)_11%,transparent)]">
              <span
                className={cn('block h-full rounded-[3px]', publication.readiness_score >= 100 ? 'bg-primary' : 'bg-warning')}
                style={{ width: `${publication.readiness_score}%` }}
              />
            </span>
            <span className="shrink-0 text-[11px] font-light tabular-nums text-[var(--app-text-tertiary)]">{publication.readiness_score}%</span>
          </div>
          {unresolvedChecks.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {unresolvedChecks.map((check) => (
                <li key={check.code} className="flex items-start gap-2">
                  {check.severity === 'error' ? (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
                  ) : (
                    <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                  )}
                  <div className="min-w-0 text-[13px] font-light text-[var(--app-text-primary)]">
                    {check.label}
                    {check.message && <p className="text-[12px] leading-[18px] text-[var(--app-text-secondary)]">{check.message}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {publication.checks.length === 0 && (
            <p className="mt-2 text-[12px] font-light text-[var(--app-text-tertiary)]">Nenhuma verificação foi retornada para este canal.</p>
          )}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          {canManage && (
            <Button
              type="button"
              disabled={publishDisabled}
              onClick={() => onPublish(publication)}
              className={PROPERTY_PRIMARY_BUTTON_CLASS}
            >
              {pendingAction === 'publish'
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
              {isGrupoOLXChannel
                ? publication.observed_state === 'published' ? 'Atualizar no XML' : 'Disponibilizar no XML'
                : publication.observed_state === 'published'
                  ? publication.is_outdated ? 'Publicar atualização' : 'Publicado e atualizado'
                  : 'Publicar'}
            </Button>
          )}

          {publication.capabilities.can_preview && (
            <PropertyPublicationPreview publication={publication} imageUrls={previewImageUrls} />
          )}
          {!isGrupoOLXChannel && publication.public_url && siteState?.canOpenPublicSite && (
            <Button asChild type="button" variant="ghost" className={PROPERTY_SECONDARY_BUTTON_CLASS}>
              <a href={publication.public_url} target="_blank" rel="noopener noreferrer">
                Abrir no canal
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}

          {canManage && publication.capabilities.can_retry && (
            <Button
              type="button"
              variant="ghost"
              disabled={retryDisabled}
              onClick={() => onRetry(publication)}
              className={PROPERTY_SECONDARY_BUTTON_CLASS}
            >
              {pendingAction === 'retry'
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
              Tentar novamente
            </Button>
          )}

          {canManage && publication.capabilities.can_unpublish && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" disabled={unpublishDisabled} className={PROPERTY_SECONDARY_BUTTON_CLASS}>
                  {pendingAction === 'unpublish'
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    : <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                  {isGrupoOLXChannel ? 'Retirar do XML' : 'Retirar do ar'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-[8px] border-0 bg-[var(--app-surface-solid)]">
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {isGrupoOLXChannel ? 'Retirar este imóvel do XML do Grupo OLX?' : 'Retirar este imóvel do site?'}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {isGrupoOLXChannel
                      ? 'O Vimob deixará de disponibilizar o imóvel no feed. A retirada nos portais dependerá do próximo processamento do Grupo OLX e ficará registrada no histórico.'
                      : 'A remoção será processada de forma segura e ficará registrada no histórico. Você poderá publicar novamente quando quiser.'}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none">Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    className="rounded-[6px] bg-destructive text-[12px] font-light text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => onUnpublish(publication)}
                  >
                    {isGrupoOLXChannel ? 'Retirar do XML' : 'Retirar do ar'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {!canManage && (
            <p className="flex items-center gap-1.5 text-[11px] font-light text-[var(--app-text-tertiary)]">
              <Clock3 className="h-3.5 w-3.5" />
              Seu perfil possui acesso somente para consulta.
            </p>
          )}
        </div>

        {canManage && publishBlockReason && (
          <p role="status" className="flex items-start gap-1.5 text-[11px] font-light text-[var(--app-text-secondary)]">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {publishBlockReason}
          </p>
        )}

        <PropertyPublicationChannelDetails publication={publication} />
    </section>
  )
}
