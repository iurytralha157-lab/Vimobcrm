import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  Loader2,
  RotateCcw,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import type { PropertyPublicationJob } from '@/lib/validation'

type PropertyPublicationHistoryProps = {
  jobs: PropertyPublicationJob[]
}

const ACTION_LABELS: Record<PropertyPublicationJob['action'], string> = {
  publish: 'Publicação solicitada',
  update: 'Atualização solicitada',
  unpublish: 'Remoção solicitada',
  revalidate: 'Revalidação solicitada',
}

const STATUS_LABELS: Record<PropertyPublicationJob['status'], string> = {
  pending: 'Na fila',
  processing: 'Processando',
  retry: 'Nova tentativa agendada',
  succeeded: 'Concluído',
  superseded: 'Substituído',
  dead: 'Falhou',
}

function formatDate(value?: string | null) {
  if (!value) return 'Data não informada'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function JobIcon({ status }: { status: PropertyPublicationJob['status'] }) {
  if (status === 'succeeded') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (status === 'dead') return <CircleAlert className="h-4 w-4 text-destructive" />
  if (status === 'processing') return <Loader2 className="h-4 w-4 animate-spin text-primary" />
  if (status === 'retry') return <RotateCcw className="h-4 w-4 text-amber-600" />
  return <Clock3 className="h-4 w-4 text-muted-foreground" />
}

export function PropertyPublicationHistory({ jobs }: PropertyPublicationHistoryProps) {
  if (jobs.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
        Nenhum processamento registrado para este canal.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {jobs.map((job) => (
        <div key={job.id} className="flex gap-3 rounded-lg border bg-muted/20 p-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background">
            <JobIcon status={job.status} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{ACTION_LABELS[job.action]}</p>
              <Badge variant={job.status === 'dead' ? 'destructive' : 'secondary'}>
                {STATUS_LABELS[job.status]}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDate(job.created_at)} · {job.attempts === 0
                ? 'aguardando processamento'
                : `tentativa ${Math.min(job.attempts, job.max_attempts)} de ${job.max_attempts}`}
              {job.version ? ` · versão ${job.version}` : ''}
            </p>
            {job.next_attempt_at && job.status === 'retry' && (
              <p className="mt-1 text-xs text-amber-700">
                Próxima tentativa: {formatDate(job.next_attempt_at)}
              </p>
            )}
            {job.last_error?.message && (
              <p className="mt-2 text-xs text-destructive">{job.last_error.message}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
