'use client'

import Link from 'next/link'
import {
  AlertCircle,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ExternalLink,
  Globe2,
  Loader2,
  RadioTower,
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { formatPropertyDate } from '@/lib/property-display-utils'
import { cn } from '@/lib/utils'
import type { PropertyChannelPublication } from '@/lib/validation'

import { PropertyPublicationHistory } from './PropertyPublicationHistory'
import { PropertyPublicationPreview } from './PropertyPublicationPreview'
import { publicationIsBusy, publicationPublishBlockReason, publicationUnavailableReason } from './publication-action'

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

const DESIRED_STATE_LABELS: Record<PropertyChannelPublication['desired_state'], string> = {
  published: 'Manter publicado',
  paused: 'Manter pausado',
  unpublished: 'Manter fora do ar',
}

function observedStateLabel(publication: PropertyChannelPublication) {
  if (publication.channel === 'grupo_olx' && publication.observed_state === 'published') {
    return 'Disponível no XML'
  }
  return OBSERVED_STATE_LABELS[publication.observed_state]
}

function desiredStateLabel(publication: PropertyChannelPublication) {
  if (publication.channel !== 'grupo_olx') {
    return DESIRED_STATE_LABELS[publication.desired_state]
  }
  if (publication.desired_state === 'published') return 'Manter no XML'
  if (publication.desired_state === 'paused') return 'Manter pausado no XML'
  return 'Manter fora do XML'
}

function versionLabel(publication: PropertyChannelPublication) {
  const isGrupoOLXChannel = publication.channel === 'grupo_olx'

  if (publication.published_version) {
    return isGrupoOLXChannel
      ? `${publication.published_version} disponível no XML de ${publication.current_version}`
      : `${publication.published_version} publicada de ${publication.current_version}`
  }
  if (publication.current_version) {
    return isGrupoOLXChannel
      ? `${publication.current_version} ainda não disponibilizada no XML`
      : `${publication.current_version} ainda não publicada`
  }
  return 'Nenhuma versão criada'
}

function statusClassName(state: PropertyChannelPublication['observed_state']) {
  if (state === 'error') return 'bg-destructive/10 text-destructive hover:bg-destructive/10'
  if (state === 'published') return 'bg-primary/15 text-primary hover:bg-primary/15'
  return 'bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-soft)]'
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
  const isTransient = publicationIsBusy(publication)
  const unresolvedChecks = publication.checks.filter((check) => !check.resolved)
  const blockingChecks = unresolvedChecks.filter((check) => (check.severity ?? 'error') === 'error')
  const warningChecks = unresolvedChecks.filter((check) => check.severity === 'warning')
  const resolvedChecks = publication.checks.filter((check) => check.resolved)
  const publishDisabled = Boolean(pendingAction || !publication.capabilities.can_publish || !publication.available || isTransient)
  const publishBlockReason = publicationPublishBlockReason(publication)
  // A retirada que falhou deve continuar recuperável mesmo se o canal ficar
  // indisponível; o backend expõe can_retry exatamente para essa drenagem.
  const retryDisabled = Boolean(pendingAction || isTransient)
  const unpublishDisabled = Boolean(pendingAction || isTransient)
  const ChannelIcon = isSiteChannel ? Globe2 : RadioTower
  const readinessHeadingId = `readiness-${publication.channel}-${publication.channel_account_key}`

  return (
    <Card className="app-card overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
      <CardHeader className="border-0 bg-[var(--app-surface-soft)] px-3 py-3 sm:px-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <ChannelIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-[14px] font-normal text-[var(--app-text-primary)]">{publication.label}</CardTitle>
              <p className="mt-0.5 text-[11px] font-light text-[var(--app-text-tertiary)]">
                {desiredStateLabel(publication)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {!publication.available && (
              <Badge className="rounded-[5px] border-0 bg-warning/10 px-2 py-1 text-[10px] font-light text-warning shadow-none hover:bg-warning/10">Canal indisponível</Badge>
            )}
            {publication.is_outdated && (
              <Badge className="rounded-[5px] border-0 bg-warning/10 px-2 py-1 text-[10px] font-light text-warning shadow-none hover:bg-warning/10">Atualização pendente</Badge>
            )}
            <Badge className={cn('rounded-[5px] border-0 px-2 py-1 text-[10px] font-light shadow-none', statusClassName(publication.observed_state))}>
              {isTransient && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden="true" />}
              {observedStateLabel(publication)}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 p-3 sm:p-4">
        {!publication.available && (
          <div role="status" className="flex flex-col gap-2 rounded-[7px] bg-warning/10 px-3 py-2.5 text-[11px] font-light text-warning sm:flex-row sm:items-center">
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

        {isGrupoOLXChannel && (
          <details className="group rounded-[7px] bg-[var(--app-surface-soft)] px-3 py-2 text-[11px] font-light text-[var(--app-text-secondary)]">
            <summary className="cursor-pointer select-none text-[var(--app-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30">
              Disponível no XML não confirma publicação nos portais
            </summary>
            <p className="mt-2 leading-[17px]">
              Um único feed XML distribui o imóvel para OLX, ZAP e Viva Real conforme o contrato da conta. O estado Disponível no XML confirma a geração pelo Vimob; a importação e a aceitação dependem do portal.
            </p>
          </details>
        )}

        {isGrupoOLXChannel && publication.provider_feedback && (
          <details
            open={publication.provider_feedback.severity === 'error'}
            className={cn('rounded-[7px] px-3 py-2.5 text-[11px] font-light', publication.provider_feedback.severity === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]')}
          >
            <summary className="cursor-pointer select-none font-normal focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30">
              Último retorno do portal · ListingID {publication.provider_feedback.listing_id}
            </summary>
            <div className="mt-2 space-y-2">
              <ul className="list-disc space-y-1 pl-5">
                {publication.provider_feedback.messages.slice(0, 5).map((message, index) => (
                  <li key={`${index}-${message}`}>{message}</li>
                ))}
              </ul>
              {publication.provider_feedback.messages.length > 5 && (
                <p>Mais {publication.provider_feedback.messages.length - 5} apontamento(s) no relatório.</p>
              )}
              <p className="leading-[17px]">
                Este retorno é vinculado ao ListingID, não a uma versão específica. Ele não altera a prontidão nem confirma rejeição da versão {publication.published_version ?? publication.current_version}.
              </p>
            </div>
          </details>
        )}

        {publication.last_error && (
          <div role="alert" className="flex items-start gap-2 rounded-[7px] bg-destructive/10 px-3 py-2.5 text-[11px] font-light text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <p><span className="font-normal">Falha no último processamento.</span> {publication.last_error.message}</p>
          </div>
        )}

        {actionError && (
          <div role="alert" className="flex items-start gap-2 rounded-[7px] bg-destructive/10 px-3 py-2.5 text-[11px] font-light text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <p><span className="font-normal">Ação não enviada.</span> {actionError}</p>
          </div>
        )}

        <section className="space-y-2.5" aria-labelledby={readinessHeadingId}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 id={readinessHeadingId} className="text-[12px] font-normal text-[var(--app-text-primary)]">
                Prontidão do canal
              </h3>
              <p className="mt-0.5 text-[11px] font-light text-[var(--app-text-tertiary)]">
                {publication.readiness_state === 'ready'
                  ? 'Sem pendências obrigatórias.'
                  : publication.readiness_state === 'blocked'
                    ? blockingChecks.length > 0
                      ? `${blockingChecks.length} pendência(s) obrigatória(s) impedem a publicação${warningChecks.length ? `; há também ${warningChecks.length} aviso(s)` : ''}.`
                      : 'Há pendências que precisam ser revisadas antes da publicação.'
                    : 'A prontidão ainda está sendo avaliada.'}
              </p>
            </div>
            <span className="shrink-0 text-[12px] font-normal text-[var(--app-text-primary)]">{publication.readiness_score}%</span>
          </div>
          <Progress value={publication.readiness_score} className="h-1.5" />

          {unresolvedChecks.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {unresolvedChecks.map((check) => (
                <div key={check.code} className="flex items-start gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2.5">
                  {check.severity === 'error' ? (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
                  ) : (
                    <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <p className="text-[11px] font-normal text-[var(--app-text-primary)]">{check.label}</p>
                    {check.message && <p className="mt-0.5 text-[11px] font-light leading-[17px] text-[var(--app-text-secondary)]">{check.message}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {resolvedChecks.length > 0 && (
            <details className="rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2.5">
              <summary className="cursor-pointer select-none text-[11px] font-light text-[var(--app-text-secondary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30">
                {resolvedChecks.length} verificação(ões) atendida(s)
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {resolvedChecks.map((check) => (
                  <div key={check.code} className="flex items-start gap-2 text-[11px] font-light text-[var(--app-text-secondary)]">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="font-normal text-[var(--app-text-primary)]">{check.label}</p>
                      {check.message && <p className="mt-0.5 leading-[17px]">{check.message}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
          {publication.checks.length === 0 && (
            <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">Nenhuma verificação foi retornada para este canal.</p>
          )}
        </section>

        <div className="grid gap-2 rounded-[7px] bg-[var(--app-surface-soft)] p-3 text-[11px] font-light text-[var(--app-text-secondary)] sm:grid-cols-3">
          <div>
            <span className="block text-[10px] text-[var(--app-text-tertiary)]">Versão</span>
            {versionLabel(publication)}
          </div>
          <div>
            <span className="block text-[10px] text-[var(--app-text-tertiary)]">Última solicitação</span>
            {formatPropertyDate(publication.last_requested_at, true, 'Ainda não processado')}
          </div>
          <div>
            <span className="block text-[10px] text-[var(--app-text-tertiary)]">
              {isGrupoOLXChannel ? 'Último processamento no Vimob' : 'Último sucesso'}
            </span>
            {formatPropertyDate(publication.last_succeeded_at, true, 'Ainda não processado')}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {canManage && (
            <Button
              type="button"
              size="sm"
              disabled={publishDisabled}
              onClick={() => onPublish(publication)}
              className="h-8 rounded-[6px] bg-primary/50 px-3 text-[11px] font-light text-primary-foreground shadow-none hover:bg-primary"
            >
              {pendingAction === 'publish'
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                : <Send className="mr-1.5 h-3.5 w-3.5" />}
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
          {!isGrupoOLXChannel && publication.public_url && publication.observed_state === 'published' && (
            <Button asChild type="button" variant="ghost" size="sm" className="h-8 gap-1.5 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)]">
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
              size="sm"
              disabled={retryDisabled}
              onClick={() => onRetry(publication)}
              className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[11px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)]"
            >
              {pendingAction === 'retry'
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Tentar novamente
            </Button>
          )}

          {canManage && publication.capabilities.can_unpublish && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" size="sm" disabled={unpublishDisabled} className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[11px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)]">
                  {pendingAction === 'unpublish'
                    ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
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

        <details className="rounded-[7px] bg-[var(--app-surface-soft)] px-3 py-2.5">
          <summary className="cursor-pointer select-none text-[11px] font-normal text-[var(--app-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30">
            Processamentos recentes · {publication.recent_jobs.length}
          </summary>
          <div className="mt-3">
            <PropertyPublicationHistory jobs={publication.recent_jobs} />
          </div>
        </details>
      </CardContent>
    </Card>
  )
}
