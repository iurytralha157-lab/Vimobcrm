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

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Separator } from '@/components/ui/separator'
import type { PropertyChannelPublication } from '@/lib/validation'

import { PropertyPublicationHistory } from './PropertyPublicationHistory'
import { PropertyPublicationPreview } from './PropertyPublicationPreview'

type PublicationAction = 'publish' | 'unpublish' | 'retry'

type PropertyPublicationChannelCardProps = {
  publication: PropertyChannelPublication
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

const TRANSIENT_STATES = new Set(['queued', 'publishing', 'pausing', 'unpublishing'])

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

function formatDate(value?: string | null) {
  if (!value) return 'Ainda não processado'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function statusVariant(state: PropertyChannelPublication['observed_state']) {
  if (state === 'error') return 'destructive' as const
  if (state === 'published') return 'default' as const
  if (TRANSIENT_STATES.has(state)) return 'outline' as const
  return 'secondary' as const
}

export function PropertyPublicationChannelCard({
  publication,
  canManage,
  pendingAction,
  actionError,
  onPublish,
  onUnpublish,
  onRetry,
}: PropertyPublicationChannelCardProps) {
  const isSiteChannel = publication.channel === 'site'
  const isGrupoOLXChannel = publication.channel === 'grupo_olx'
  const isTransient = TRANSIENT_STATES.has(publication.observed_state)
    || publication.recent_jobs.some((job) => ['pending', 'processing', 'retry'].includes(job.status))
  const unresolvedChecks = publication.checks.filter((check) => !check.resolved)
  const blockingChecks = unresolvedChecks.filter((check) => (check.severity ?? 'error') === 'error')
  const warningChecks = unresolvedChecks.filter((check) => check.severity === 'warning')
  const orderedChecks = [
    ...unresolvedChecks,
    ...publication.checks.filter((check) => check.resolved),
  ]
  const publishDisabled = Boolean(pendingAction || isTransient || !publication.available)
  // A retirada que falhou deve continuar recuperável mesmo se o canal ficar
  // indisponível; o backend expõe can_retry exatamente para essa drenagem.
  const retryDisabled = Boolean(pendingAction || isTransient)
  const unpublishDisabled = Boolean(pendingAction || isTransient)
  const ChannelIcon = isSiteChannel ? Globe2 : RadioTower
  const readinessHeadingId = `readiness-${publication.channel}-${publication.channel_account_key}`

  return (
    <Card className="overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
      <CardHeader className="border-b border-[var(--app-border)] bg-[var(--app-surface-soft)]">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <ChannelIcon className="h-5 w-5" />
            </span>
            <div>
              <CardTitle className="text-[14px] font-normal">{publication.label}</CardTitle>
              <p className="mt-1 text-[12px] font-light text-muted-foreground">
                Estado desejado: {desiredStateLabel(publication)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!publication.available && <Badge variant="outline">Canal indisponível</Badge>}
            {publication.is_outdated && <Badge variant="outline">Atualização pendente</Badge>}
            <Badge variant={statusVariant(publication.observed_state)}>
              {isTransient && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              {observedStateLabel(publication)}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 p-5">
        {!publication.available && (
          <Alert>
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>Canal ainda não disponível</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>Conclua a configuração deste canal antes de solicitar uma publicação.</p>
              {isGrupoOLXChannel && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button asChild type="button" variant="outline" size="sm">
                    <Link href="/settings?tab=grupo-olx">Configurar Grupo OLX</Link>
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Credenciais e endpoints ficam restritos aos administradores da integração.
                  </span>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {isGrupoOLXChannel && (
          <div className="flex items-start gap-3 rounded-lg border border-primary/15 bg-primary/5 p-4 text-sm">
            <RadioTower className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-muted-foreground">
              Um único feed XML distribui o imóvel para OLX, ZAP e Viva Real conforme o contrato da conta.
              O estado <span className="font-medium text-foreground">Disponível no XML</span> confirma a geração pelo Vimob,
              mas não significa que o portal já importou ou aceitou o anúncio.
            </p>
          </div>
        )}

        {isGrupoOLXChannel && publication.provider_feedback && (
          <Alert variant={publication.provider_feedback.severity === 'error' ? 'destructive' : 'default'}>
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>Último retorno do portal para o ListingID {publication.provider_feedback.listing_id}</AlertTitle>
            <AlertDescription className="space-y-2">
              <ul className="list-disc space-y-1 pl-5">
                {publication.provider_feedback.messages.slice(0, 5).map((message, index) => (
                  <li key={`${index}-${message}`}>{message}</li>
                ))}
              </ul>
              {publication.provider_feedback.messages.length > 5 && (
                <p>Mais {publication.provider_feedback.messages.length - 5} apontamento(s) no relatório.</p>
              )}
              <p className="text-xs">
                Este retorno é vinculado ao ListingID, não a uma versão específica. Ele não altera a prontidão nem confirma rejeição da versão {publication.published_version ?? publication.current_version}.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {publication.last_error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Falha no último processamento</AlertTitle>
            <AlertDescription>{publication.last_error.message}</AlertDescription>
          </Alert>
        )}

        {actionError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Não foi possível enviar a ação deste canal</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        )}

        <section className="space-y-4" aria-labelledby={readinessHeadingId}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 id={readinessHeadingId} className="text-[14px] font-normal">
                Prontidão do canal
              </h3>
              <p className="text-xs text-muted-foreground">
                {publication.readiness_state === 'ready'
                  ? 'Todos os requisitos obrigatórios foram atendidos.'
                  : publication.readiness_state === 'blocked'
                    ? blockingChecks.length > 0
                      ? `${blockingChecks.length} pendência(s) obrigatória(s) impedem a publicação${warningChecks.length ? `; há também ${warningChecks.length} aviso(s)` : ''}.`
                      : 'Há pendências que precisam ser revisadas antes da publicação.'
                    : 'A prontidão ainda está sendo avaliada.'}
              </p>
            </div>
            <span className="text-[14px] font-normal">{publication.readiness_score}%</span>
          </div>
          <Progress value={publication.readiness_score} className="h-2" />

          {orderedChecks.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {orderedChecks.map((check) => (
                <div key={check.code} className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3">
                  {check.resolved ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : check.severity === 'error' ? (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  ) : (
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{check.label}</p>
                    {check.message && <p className="mt-1 text-xs text-muted-foreground">{check.message}</p>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
              Nenhuma verificação foi retornada para este canal.
            </p>
          )}
        </section>

        <Separator />

        <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-3">
          <div>
            <span className="block font-medium text-foreground">Versão</span>
            {versionLabel(publication)}
          </div>
          <div>
            <span className="block font-medium text-foreground">Última solicitação</span>
            {formatDate(publication.last_requested_at)}
          </div>
          <div>
            <span className="block font-medium text-foreground">
              {isGrupoOLXChannel ? 'Último processamento no Vimob' : 'Último sucesso'}
            </span>
            {formatDate(publication.last_succeeded_at)}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {publication.capabilities.can_preview && (
            <PropertyPublicationPreview publication={publication} />
          )}
          {!isGrupoOLXChannel && publication.public_url && publication.observed_state === 'published' && (
            <Button asChild type="button" variant="ghost" size="sm">
              <a href={publication.public_url} target="_blank" rel="noopener noreferrer">
                Abrir no canal
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          )}

          {canManage && publication.capabilities.can_publish && (
            <Button
              type="button"
              size="sm"
              disabled={publishDisabled}
              onClick={() => onPublish(publication)}
            >
              {pendingAction === 'publish'
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Send className="mr-2 h-4 w-4" />}
              {isGrupoOLXChannel
                ? publication.observed_state === 'published' ? 'Atualizar no XML' : 'Disponibilizar no XML'
                : publication.observed_state === 'published' ? 'Publicar atualização' : 'Publicar'}
            </Button>
          )}

          {canManage && publication.capabilities.can_retry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={retryDisabled}
              onClick={() => onRetry(publication)}
            >
              {pendingAction === 'retry'
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <RefreshCw className="mr-2 h-4 w-4" />}
              Tentar novamente
            </Button>
          )}

          {canManage && publication.capabilities.can_unpublish && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={unpublishDisabled}>
                  {pendingAction === 'unpublish'
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <ShieldCheck className="mr-2 h-4 w-4" />}
                  {isGrupoOLXChannel ? 'Retirar do XML' : 'Retirar do ar'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
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
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => onUnpublish(publication)}
                  >
                    {isGrupoOLXChannel ? 'Retirar do XML' : 'Retirar do ar'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {!canManage && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" />
              Seu perfil possui acesso somente para consulta.
            </p>
          )}
        </div>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-[14px] font-normal">Processamentos recentes</h3>
          <PropertyPublicationHistory jobs={publication.recent_jobs} />
        </section>
      </CardContent>
    </Card>
  )
}
