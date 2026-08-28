import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  UserRound,
  UsersRound,
} from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import type { HomeFocusItem } from '@/hooks/home/use-home-overview'
import type { HomeFocusScope } from '@/lib/api/home'
import { cn } from '@/lib/utils'

type HomeFocusListProps = {
  items: HomeFocusItem[]
  isLoading: boolean
  hasError: boolean
  isRetrying: boolean
  onRetry: () => Promise<void>
  hasAnyAccess: boolean
  billingBlocked: boolean
  scope: HomeFocusScope
  onScopeChange: (scope: HomeFocusScope) => void
  canViewTeam: boolean
  canViewOrganization: boolean
}

const FOCUS_SCOPE_OPTIONS: Array<{
  value: HomeFocusScope
  label: string
  icon: typeof UserRound
}> = [
  { value: 'mine', label: 'Meu foco', icon: UserRound },
  { value: 'team', label: 'Equipe', icon: UsersRound },
  { value: 'organization', label: 'Organização', icon: Building2 },
]

const FOCUS_KIND_LABELS: Record<HomeFocusItem['kind'], string> = {
  attention: 'Atenção',
  task: 'Tarefa',
  schedule: 'Agenda',
}

const ATTENTION_POLICY_LABELS: Record<NonNullable<HomeFocusItem['policyType']>, string> = {
  unassigned: 'Lead sem responsável',
  first_contact: 'Primeiro contato',
  first_effective_contact: 'Contato efetivo',
  stage_inactivity: 'Inatividade na etapa',
  stage_age: 'Tempo na etapa',
  cadence_task: 'Cadência',
}

const FOCUS_STATUS_LABELS: Record<NonNullable<HomeFocusItem['status']>, string> = {
  due: 'Prioridade',
  warning: 'Próximo do limite',
  breached: 'Tempo excedido',
}

function formatDueAt(value: string, tone: HomeFocusItem['tone']) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Prazo não informado'

  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const time = date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  if (date.toDateString() === now.toDateString()) {
    if (date.getTime() < now.getTime() && tone !== 'neutral') {
      return `Pendente desde ${time}`
    }
    return `Hoje, ${time}`
  }
  if (date.toDateString() === tomorrow.toDateString()) {
    return `Amanhã, ${time}`
  }

  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function FocusIcon({ kind }: { kind: HomeFocusItem['kind'] }) {
  if (kind === 'schedule') {
    return <CalendarDays className="h-4 w-4" />
  }
  if (kind === 'task') {
    return <ListChecks className="h-4 w-4" />
  }
  return <AlertCircle className="h-4 w-4" />
}

function FocusItem({ item }: { item: HomeFocusItem }) {
  const dueLabel = formatDueAt(item.dueAt, item.tone)
  const categoryLabel = item.kind === 'attention' && item.policyType
    ? ATTENTION_POLICY_LABELS[item.policyType]
    : FOCUS_KIND_LABELS[item.kind]

  return (
    <Link
      href={item.href}
      className="group grid grid-cols-[36px_minmax(0,1fr)_32px] items-center gap-2.5 rounded-[6px] px-2 py-2.5 transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:gap-3 sm:px-3 sm:py-3"
    >
      <div
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground transition-colors group-hover:bg-primary group-active:bg-primary group-focus-visible:bg-primary sm:h-10 sm:w-10"
      >
        <FocusIcon kind={item.kind} />
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <p className="text-[10px] font-light text-[var(--app-text-tertiary)] sm:text-[11px]">
            {categoryLabel}
          </p>
          {item.status ? (
            <span className="inline-flex h-5 items-center gap-1.5 rounded-[4px] bg-[var(--app-surface-soft)] px-1.5 text-[9px] font-light text-[var(--app-text-secondary)]">
              <span
                aria-hidden="true"
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  item.status === 'breached'
                    ? 'bg-primary'
                    : item.status === 'warning'
                      ? 'bg-amber-400'
                      : 'bg-[var(--app-text-tertiary)]',
                )}
              />
              {FOCUS_STATUS_LABELS[item.status]}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-[13px] font-medium leading-5 text-[var(--app-text-primary)] sm:text-sm">
          {item.title}
        </p>
        <p className="mt-0.5 text-[12px] font-light leading-5 text-[var(--app-text-tertiary)] sm:mt-1">
          {item.description}
        </p>
        <time
          dateTime={item.dueAt}
          className="mt-1 block text-[11px] text-[var(--app-text-secondary)] sm:hidden"
        >
          {dueLabel}
        </time>
      </div>

      <div className="flex items-center gap-2 pl-0.5 sm:gap-3 sm:pl-3">
        <time
          dateTime={item.dueAt}
          className="hidden whitespace-nowrap text-xs text-[var(--app-text-secondary)] sm:block"
        >
          {dueLabel}
        </time>
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground transition-colors group-hover:bg-primary group-active:bg-primary group-focus-visible:bg-primary sm:h-9 sm:w-9"
        >
          <ArrowRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </span>
      </div>
    </Link>
  )
}

function FocusSkeleton() {
  return (
    <div className="space-y-1">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="grid grid-cols-[36px_minmax(0,1fr)_32px] items-center gap-2.5 rounded-[6px] px-2 py-2.5 sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:gap-3 sm:px-3 sm:py-3"
        >
          <Skeleton className="h-9 w-9 rounded-[6px] sm:h-10 sm:w-10" />
          <div>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-4 w-1/2" />
            <Skeleton className="mt-2 h-3 w-2/3" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="hidden h-3 w-20 sm:block" />
            <Skeleton className="h-8 w-8 rounded-[6px] sm:h-9 sm:w-9" />
          </div>
        </div>
      ))}
    </div>
  )
}

function FocusEmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-[176px] flex-col items-center justify-center px-6 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
        {icon}
      </div>
      <p className="mt-3 text-sm font-medium text-[var(--app-text-primary)]">{title}</p>
      <p className="mt-1 max-w-md text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
        {description}
      </p>
      {action}
    </div>
  )
}

export function HomeFocusList({
  items,
  isLoading,
  hasError,
  isRetrying,
  onRetry,
  hasAnyAccess,
  billingBlocked,
  scope,
  onScopeChange,
  canViewTeam,
  canViewOrganization,
}: HomeFocusListProps) {
  const visibleScopes = FOCUS_SCOPE_OPTIONS.filter((option) => (
    option.value === 'mine'
    || (option.value === 'team' && canViewTeam)
    || (option.value === 'organization' && canViewOrganization)
  ))

  return (
    <section id="home-focus" aria-labelledby="home-focus-title" className="scroll-mt-20">
      <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="home-focus-title"
            className="app-section-title text-[var(--app-text-primary)]"
          >
            Seu foco agora
          </h2>
          <p className="mt-1 text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
            Prioridades e atenções que precisam da sua ação, ordenadas por urgência.
          </p>
        </div>

        {visibleScopes.length > 1 ? (
          <div className="flex w-fit items-center gap-1 rounded-[8px] bg-[var(--app-surface-solid)] p-1" aria-label="Escopo do foco">
            {visibleScopes.map((option) => {
              const Icon = option.icon
              const active = scope === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onScopeChange(option.value)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-[11px] font-light transition-colors',
                    active
                      ? 'bg-[var(--app-surface-hover)] text-[var(--app-text-primary)]'
                      : 'text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-soft)]',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {option.label}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <div className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1.5 shadow-none sm:p-2">
        {isLoading ? (
          <FocusSkeleton />
        ) : billingBlocked ? (
          <FocusEmptyState
            icon={<CreditCard className="h-4 w-4" aria-hidden="true" />}
            title="Sua assinatura precisa de atenção"
            description="Regularize o acesso para voltar a carregar leads, tarefas e compromissos."
            action={(
              <Link
                href="/settings?tab=subscription"
                className="mt-4 inline-flex h-9 items-center rounded-[6px] bg-primary px-4 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
              >
                Ver assinatura
              </Link>
            )}
          />
        ) : !hasAnyAccess ? (
          <FocusEmptyState
            icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
            title="Seu acesso está pronto"
            description="Quando sua função tiver acesso a leads, tarefas ou agenda, as prioridades aparecerão aqui."
          />
        ) : items.length === 0 ? (
          <FocusEmptyState
            icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            title="Tudo em dia por aqui"
            description="Nenhuma pendência urgente foi encontrada para você agora."
          />
        ) : (
          <div className="max-h-[440px] divide-y divide-border/30 overflow-y-auto overscroll-contain pr-0.5">
            {items.map((item) => <FocusItem key={item.id} item={item} />)}
          </div>
        )}

        {hasError && !isLoading ? (
          <div className="mt-1 flex flex-col gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2.5 text-[12px] font-light text-[var(--app-text-secondary)] sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Parte das informações não pôde ser atualizada. Os dados disponíveis continuam visíveis.
            </span>
            <button
              type="button"
              onClick={() => void onRetry()}
              disabled={isRetrying}
              className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[6px] bg-[var(--app-surface-solid)] px-3 text-[12px] font-light text-[var(--app-text-primary)] transition-colors hover:bg-[var(--app-surface-hover)] disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isRetrying && 'animate-spin')} aria-hidden="true" />
              Tentar novamente
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
