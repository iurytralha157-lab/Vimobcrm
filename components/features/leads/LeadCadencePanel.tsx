import {
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  ListTodo,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
  XCircle,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type {
  LeadCadenceState,
  LeadCadenceTaskState,
  LeadCadenceTaskType,
} from '@/lib/validation'

type LeadCadencePanelVariant = 'compact' | 'mobile' | 'full'

type LeadCadencePanelProps = {
  state?: LeadCadenceState
  isLoading: boolean
  error?: Error | null
  isCompleting?: boolean
  canOperate: boolean
  variant?: LeadCadencePanelVariant
  className?: string
  onRetry?: () => void
  onTaskClick: (task: LeadCadenceTaskState) => void
}

const taskIcons: Record<LeadCadenceTaskType, typeof Phone> = {
  call: Phone,
  message: MessageCircle,
  email: Mail,
  note: ListTodo,
}

const taskLabels: Record<LeadCadenceTaskType, string> = {
  call: 'Ligação',
  message: 'Mensagem',
  email: 'E-mail',
  note: 'Tarefa',
}

const dueDateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

function formatDueAt(value?: string | null) {
  if (!value) return 'Sem prazo'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Prazo indisponível'

  return `Até ${dueDateFormatter.format(date).replace(',', ' às')}`
}

function getTaskStatusLabel(task: LeadCadenceTaskState) {
  if (task.is_done || task.status === 'completed') return 'Concluída'
  if (task.status === 'skipped') return 'Não realizada na etapa'
  if (task.status === 'cancelled') return 'Encerrada'
  return null
}

function getClosedStateLabel(dealStatus: string) {
  if (dealStatus === 'won') return 'Cadência encerrada: lead ganho'
  if (dealStatus === 'lost') return 'Cadência encerrada: lead perdido'
  return 'Cadência encerrada'
}

export function LeadCadencePanel({
  state,
  isLoading,
  error,
  isCompleting = false,
  canOperate,
  variant = 'compact',
  className,
  onRetry,
  onTaskClick,
}: LeadCadencePanelProps) {
  const isFull = variant === 'full'
  const isMobile = variant === 'mobile'
  const isClosed = Boolean(state && state.deal_status !== 'open')
  const title = state?.stage_name
    ? `Cadência / ${state.stage_name}`
    : 'Cadência de atividades'

  return (
    <section
      data-tour="lead-detail-cadence"
      className={cn(
        isFull
          ? 'space-y-4'
          : isMobile
            ? 'rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none'
            : 'rounded-[8px] bg-[var(--app-surface-soft)] p-3',
        className,
      )}
    >
      <div className={cn('flex items-center justify-between', isFull ? 'mb-2 gap-2' : 'mb-2')}>
        <div className="flex min-w-0 items-center gap-2">
          {(isFull || isMobile) && (
            <span
              className={cn(
                'flex shrink-0 items-center justify-center bg-primary text-primary-foreground',
                isFull ? 'h-8 w-8 rounded-[7px]' : 'h-7 w-7 rounded-[6px]',
              )}
            >
              <ListTodo className={isFull ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
            </span>
          )}
          <div className="min-w-0">
            <h3 className={cn('truncate font-normal', isFull ? 'text-sm' : 'text-xs')}>
              {title}
            </h3>
            {state?.enrollment && isFull && (
              <p className="truncate text-[10px] font-light text-[var(--app-text-tertiary)]">
                Ciclo atual iniciado em {formatDueAt(state.enrollment.started_at).replace('Até ', '')}
              </p>
            )}
          </div>
        </div>

        {state && state.summary.total > 0 && (
          <Badge
            variant="outline"
            className={cn(
              'shrink-0 rounded-[5px] border-0 bg-[var(--app-surface-solid)] font-light',
              isFull ? 'text-xs' : 'text-[10px]',
            )}
          >
            {state.summary.completed}/{state.summary.total}
          </Badge>
        )}
      </div>

      {isLoading ? (
        <div className={cn('flex items-center justify-center', isFull ? 'py-12' : 'py-5')}>
          <Loader2 className="h-4 w-4 animate-spin text-[var(--app-text-tertiary)]" />
        </div>
      ) : error ? (
        <div className="rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-3 text-xs text-[var(--app-text-tertiary)]">
          <p>Não foi possível carregar as tarefas desta etapa.</p>
          {onRetry && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 h-7 rounded-[6px] px-2 text-xs font-light"
              onClick={onRetry}
            >
              <RefreshCw className="h-3 w-3" />
              Tentar novamente
            </Button>
          )}
        </div>
      ) : !state ? (
        <p className="rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2 text-xs text-[var(--app-text-tertiary)]">
          Cadência indisponível para este lead.
        </p>
      ) : !state.cadence_enabled && !isClosed ? (
        <p className="rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2 text-xs font-light text-[var(--app-text-tertiary)]">
          Esta etapa não exige cadência.
        </p>
      ) : !state.enrollment || state.tasks.length === 0 ? (
        isClosed ? (
          <div className="rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-3">
            <p className="text-xs font-normal text-[var(--app-text-secondary)]">
              {getClosedStateLabel(state.deal_status)}
            </p>
            <p className="mt-1 text-[10px] font-light text-[var(--app-text-tertiary)]">
              Este ciclo não possui tarefas para consultar.
            </p>
          </div>
        ) : (
          <p className="rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2 text-xs font-light text-[var(--app-text-tertiary)]">
            Nenhuma tarefa operacional nesta etapa.
          </p>
        )
      ) : (
        <>
          {isClosed ? (
            <div className="mb-2 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 py-2">
              <p className="text-xs font-normal text-[var(--app-text-secondary)]">
                {getClosedStateLabel(state.deal_status)}
              </p>
              <p className="mt-0.5 text-[10px] font-light text-[var(--app-text-tertiary)]">
                O ciclo permanece disponível somente para consulta.
              </p>
            </div>
          ) : state.summary.overdue > 0 && (
            <div className="mb-2 flex items-center gap-1.5 rounded-[6px] bg-primary/10 px-2.5 py-1.5 text-[10px] font-light text-primary">
              <CalendarClock className="h-3 w-3" />
              {state.summary.overdue === 1
                ? '1 tarefa está fora do prazo'
                : `${state.summary.overdue} tarefas estão fora do prazo`}
            </div>
          )}

          <div
            className={cn(
              'space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
              isFull ? 'max-h-[420px]' : 'max-h-[320px]',
            )}
          >
            {state.tasks.map((task) => {
              const taskType = task.type
              const TaskIcon = taskIcons[taskType] || Clock
              const isDone = task.is_done || task.status === 'completed'
              const isPending = task.status === 'pending' && !isDone
              const isNext = state.summary.next_task_id === task.id
              const isInactive = !isPending
              const statusLabel = getTaskStatusLabel(task)
              const disabled = isClosed || !canOperate || !isPending || isCompleting

              return (
                <button
                  key={task.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onTaskClick(task)}
                  className={cn(
                    'group flex w-full items-center gap-2.5 rounded-[6px] bg-[var(--app-surface-solid)] text-left transition-colors',
                    isFull ? 'px-3 py-3' : 'px-2.5 py-2',
                    !disabled && 'cursor-pointer hover:bg-primary/10',
                    isInactive && 'opacity-65',
                    isNext && isPending && 'bg-primary/[0.07]',
                  )}
                >
                  <span
                    className={cn(
                      'flex shrink-0 items-center justify-center rounded-[6px]',
                      isFull ? 'h-8 w-8' : 'h-7 w-7',
                      isDone
                        ? 'bg-emerald-500 text-white'
                        : isPending
                          ? 'bg-primary/20 text-primary group-hover:bg-primary group-hover:text-primary-foreground'
                          : 'bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)]',
                    )}
                  >
                    {isDone ? (
                      <Check className="h-3 w-3" />
                    ) : isPending ? (
                      <TaskIcon className="h-3 w-3" />
                    ) : (
                      <XCircle className="h-3 w-3" />
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate font-normal',
                        isFull ? 'text-sm' : 'text-xs',
                        isDone && 'line-through text-[var(--app-text-tertiary)]',
                      )}
                    >
                      {task.title}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] font-light text-[var(--app-text-tertiary)]">
                      <span>{taskLabels[taskType]}</span>
                      <span aria-hidden>·</span>
                      <span>{formatDueAt(task.due_at)}</span>
                      {task.is_required && isPending && (
                        <>
                          <span aria-hidden>·</span>
                          <span>Obrigatória</span>
                        </>
                      )}
                      {task.outcome_required && isPending && (
                        <>
                          <span aria-hidden>·</span>
                          <span>Informe o resultado</span>
                        </>
                      )}
                      {statusLabel && (
                        <>
                          <span aria-hidden>·</span>
                          <span>{statusLabel}</span>
                        </>
                      )}
                    </span>
                  </span>

                  {isPending && (
                    <ChevronRight
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)] transition-colors',
                        !disabled && 'group-hover:text-primary',
                      )}
                    />
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
