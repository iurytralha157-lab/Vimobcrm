'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { formatDistanceStrict, isValid } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BellRing,
  Check,
  CheckCircle2,
  Clock3,
  Eye,
  Filter,
  Hourglass,
  ListChecks,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  PhoneCall,
  RefreshCw,
  Settings2,
  ShieldAlert,
  UserRound,
  UsersRound,
} from 'lucide-react'

import { AttentionPolicySettings } from './AttentionPolicySettings'
import { AppLayout } from '@/components/shared/layout/AppLayout'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  useAcknowledgeAttentionItem,
  useAttentionItems,
  useAttentionSummary,
  useResolveAttentionItem,
  useSnoozeAttentionItem,
} from '@/hooks/attention'
import { useUserAccessScope } from '@/hooks/use-user-access-scope'
import { useUserPermissions } from '@/hooks/use-user-permissions'
import type {
  AttentionItem,
  AttentionItemStatus,
  AttentionPolicyType,
  AttentionScope,
  AttentionSummary,
} from '@/lib/api/attention'
import { cn } from '@/lib/utils'

type AttentionView = 'queue' | 'policies'
type StatusFilter = 'open' | AttentionItemStatus

const CLOSED_ITEM_STATUSES = new Set<AttentionItemStatus>(['resolved', 'redistributed', 'cancelled'])

const STATUS_META: Record<AttentionItemStatus, { label: string; dotClass: string }> = {
  monitoring: { label: 'Monitorando', dotClass: 'bg-[var(--app-text-tertiary)]' },
  warning: { label: 'Próximo do limite', dotClass: 'bg-amber-400' },
  breached: { label: 'Tempo excedido', dotClass: 'bg-orange-500' },
  escalated: { label: 'Escalado', dotClass: 'bg-red-500' },
  acknowledged: { label: 'Assumido', dotClass: 'bg-sky-500' },
  resolved: { label: 'Resolvido', dotClass: 'bg-emerald-500' },
  redistributed: { label: 'Redistribuído', dotClass: 'bg-violet-500' },
  cancelled: { label: 'Cancelado', dotClass: 'bg-[var(--app-text-tertiary)]' },
  exception: { label: 'Com exceção', dotClass: 'bg-red-500' },
}

const POLICY_TYPE_META: Record<AttentionPolicyType, { label: string; icon: typeof BellRing }> = {
  unassigned: { label: 'Sem responsável', icon: UserRound },
  first_contact: { label: 'Primeiro contato', icon: PhoneCall },
  first_effective_contact: { label: 'Contato efetivo', icon: MessageCircle },
  stage_inactivity: { label: 'Inatividade na etapa', icon: Activity },
  stage_age: { label: 'Tempo na etapa', icon: Hourglass },
  cadence_task: { label: 'Tarefa de cadência', icon: ListChecks },
}

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'open', label: 'Em aberto' },
  { value: 'warning', label: 'Próximos do limite' },
  { value: 'breached', label: 'Tempo excedido' },
  { value: 'escalated', label: 'Escalados' },
  { value: 'acknowledged', label: 'Assumidos' },
  { value: 'exception', label: 'Com exceção' },
  { value: 'monitoring', label: 'Em monitoramento' },
  { value: 'resolved', label: 'Resolvidos' },
  { value: 'redistributed', label: 'Redistribuídos' },
  { value: 'cancelled', label: 'Cancelados' },
]

const SNOOZE_OPTIONS = [
  { minutes: 60, label: 'Adiar por 1 hora' },
  { minutes: 240, label: 'Adiar por 4 horas' },
  { minutes: 1_440, label: 'Adiar por 24 horas' },
  { minutes: 4_320, label: 'Adiar por 3 dias' },
]

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

function formatAbsoluteDate(value: string) {
  const date = new Date(value)
  if (!isValid(date)) return 'Prazo não informado'
  return DATE_TIME_FORMATTER.format(date).replace(',', ' ·')
}

function useAttentionClock() {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    const refresh = () => setNow(new Date())
    refresh()
    const timer = window.setInterval(refresh, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  return now
}

function getDeadline(item: AttentionItem, now: Date | null) {
  const due = new Date(item.dueAt)
  const absolute = formatAbsoluteDate(item.dueAt)
  if (!isValid(due)) return { label: absolute, overdue: false, absolute }

  if (CLOSED_ITEM_STATUSES.has(item.status)) {
    const resolved = item.resolvedAt ? new Date(item.resolvedAt) : null
    const label = now && resolved && isValid(resolved)
      ? `Encerrado ${formatDistanceStrict(resolved, now, { addSuffix: true, locale: ptBR })}`
      : 'Ciclo encerrado'
    return { label, overdue: false, absolute }
  }

  if (!now) return { label: absolute, overdue: false, absolute }

  const overdue = due.getTime() < now.getTime()
  const distance = formatDistanceStrict(due, now, { locale: ptBR })
  return {
    label: overdue ? `Atrasado há ${distance}` : `Vence em ${distance}`,
    overdue,
    absolute,
  }
}

function formatLastAction(value: string, now: Date | null) {
  const date = new Date(value)
  if (!isValid(date)) return null
  if (!now) return formatAbsoluteDate(value)
  return formatDistanceStrict(date, now, { addSuffix: true, locale: ptBR })
}

function ScopeFilter({
  value,
  onChange,
  canViewTeam,
  canViewOrganization,
}: {
  value: AttentionScope
  onChange: (scope: AttentionScope) => void
  canViewTeam: boolean
  canViewOrganization: boolean
}) {
  const options: Array<{ value: AttentionScope; label: string; icon: typeof UserRound }> = [
    { value: 'mine', label: 'Minha fila', icon: UserRound },
  ]
  if (canViewTeam) options.push({ value: 'team', label: 'Minha equipe', icon: UsersRound })
  if (canViewOrganization) options.push({ value: 'organization', label: 'Organização', icon: ShieldAlert })

  return (
    <div className="flex min-w-0 gap-1 overflow-x-auto rounded-[8px] bg-[var(--app-surface-solid)] p-1" aria-label="Escopo da fila">
      {options.map((option) => {
        const Icon = option.icon
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 text-[11px] font-light text-[var(--app-text-secondary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:text-xs',
              selected
                ? 'bg-[var(--app-surface-hover)] text-[var(--app-text-primary)]'
                : 'hover:bg-[var(--app-surface-soft)]',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function SummaryStrip({
  summary,
  loading,
  error,
}: {
  summary?: AttentionSummary
  loading: boolean
  error: boolean
}) {
  const values = [
    {
      label: 'Precisam de ação',
      value: (summary?.warning || 0) + (summary?.breached || 0) + (summary?.escalated || 0),
      icon: BellRing,
    },
    { label: 'Atrasados', value: summary?.overdue || 0, icon: Clock3 },
    { label: 'Escalados', value: summary?.escalated || 0, icon: ShieldAlert },
    { label: 'Cadências', value: summary?.cadenceTasks || 0, icon: ListChecks },
  ]

  return (
    <section
      aria-label="Resumo da fila"
      className="grid grid-cols-2 overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] p-1 sm:grid-cols-4"
    >
      {values.map(({ label, value, icon: Icon }, index) => (
        <div
          key={label}
          className={cn(
            'flex min-w-0 items-center gap-2.5 rounded-[6px] px-2.5 py-2.5 sm:px-3',
            index % 2 === 1 && 'max-sm:border-l max-sm:border-border/30',
            index >= 2 && 'max-sm:border-t max-sm:border-border/30',
            index > 0 && 'sm:border-l sm:border-border/30',
          )}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            {loading ? (
              <Skeleton className="h-5 w-8 rounded-[4px]" />
            ) : (
              <span className="block text-base font-light tabular-nums text-[var(--app-text-primary)]">
                {error ? '—' : value}
              </span>
            )}
            <span className="block truncate text-[10px] font-light text-[var(--app-text-tertiary)] sm:text-[11px]">
              {label}
            </span>
          </span>
        </div>
      ))}
    </section>
  )
}

function ResolveAttentionDialog({
  item,
  open,
  onOpenChange,
}: {
  item: AttentionItem
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const resolve = useResolveAttentionItem()
  const [reason, setReason] = useState('manager_exception')
  const [note, setNote] = useState('')

  const submit = () => {
    resolve.mutate(
      {
        id: item.id,
        reason,
        note: note.trim(),
        administrativeOverride: true,
      },
      {
        onSuccess: () => {
          onOpenChange(false)
          setNote('')
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-[8px] border-0 shadow-none">
        <DialogHeader>
          <DialogTitle className="text-base font-normal">Resolver administrativamente</DialogTitle>
          <DialogDescription className="text-[12px] font-light leading-5">
            Use apenas para uma exceção real. A justificativa ficará registrada na auditoria.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[12px] font-light text-[var(--app-text-secondary)]">Motivo</label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manager_exception">Exceção aprovada pelo gestor</SelectItem>
                <SelectItem value="duplicate_alert">Alerta duplicado</SelectItem>
                <SelectItem value="data_correction">Correção de dados</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor={`attention-resolution-note-${item.id}`}
              className="text-[12px] font-light text-[var(--app-text-secondary)]"
            >
              Justificativa
            </label>
            <Textarea
              id={`attention-resolution-note-${item.id}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={1_000}
              rows={4}
              placeholder="Explique por que este alerta pode ser encerrado sem a ação operacional."
              className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light shadow-none"
            />
            <p className="text-[10px] font-light text-[var(--app-text-tertiary)]">Mínimo de 10 caracteres.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={resolve.isPending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={resolve.isPending || note.trim().length < 10}>
            {resolve.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar exceção
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AttentionItemRow({
  item,
  now,
  canOperate,
  canAdministrativeOverride,
}: {
  item: AttentionItem
  now: Date | null
  canOperate: boolean
  canAdministrativeOverride: boolean
}) {
  const acknowledge = useAcknowledgeAttentionItem()
  const snooze = useSnoozeAttentionItem()
  const [resolveOpen, setResolveOpen] = useState(false)
  const status = STATUS_META[item.status]
  const policy = POLICY_TYPE_META[item.policyType]
  const PolicyIcon = policy.icon
  const deadline = getDeadline(item, now)
  const isClosed = CLOSED_ITEM_STATUSES.has(item.status)
  const isShadow = item.shadow || item.policyStatus === 'shadow'
  const snoozedUntil = item.snoozedUntil ? new Date(item.snoozedUntil) : null
  const isSnoozed = Boolean(now && snoozedUntil && isValid(snoozedUntil) && snoozedUntil.getTime() > now.getTime() && !isClosed)
  const isMutating = acknowledge.isPending || snooze.isPending
  const canUseActions = canOperate && !isClosed && !isShadow
  const lastAction = item.lastValidActionAt ? formatLastAction(item.lastValidActionAt, now) : null
  const leadHref = `/crm/pipelines?lead=${encodeURIComponent(item.leadId)}`

  return (
    <div
      data-testid="attention-item"
      className={cn(
        'group grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[6px] px-2 py-2.5 transition-colors hover:bg-[var(--app-surface-hover)] sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:gap-3 sm:px-3 sm:py-3',
        isClosed && 'opacity-65',
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground transition-colors group-hover:bg-primary sm:h-10 sm:w-10"
      >
        <PolicyIcon className="h-4 w-4" />
      </span>

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-light text-[var(--app-text-tertiary)] sm:text-[11px]">
            {policy.label}
          </span>
          <span className="inline-flex h-5 items-center gap-1.5 rounded-[4px] bg-[var(--app-surface-soft)] px-1.5 text-[9px] font-light text-[var(--app-text-secondary)]">
            <span className={cn('h-1.5 w-1.5 rounded-full', status.dotClass)} aria-hidden="true" />
            {status.label}
          </span>
          {isShadow && (
            <span className="inline-flex h-5 items-center gap-1 rounded-[4px] bg-[var(--app-surface-soft)] px-1.5 text-[9px] font-light text-[var(--app-text-secondary)]">
              <Eye className="h-3 w-3" aria-hidden="true" />
              Observação
            </span>
          )}
          {isSnoozed && (
            <span className="inline-flex h-5 items-center gap-1 rounded-[4px] bg-[var(--app-surface-soft)] px-1.5 text-[9px] font-light text-[var(--app-text-secondary)]">
              <Clock3 className="h-3 w-3" aria-hidden="true" />
              Adiado até {formatAbsoluteDate(item.snoozedUntil!)}
            </span>
          )}
        </div>

        <Link
          href={leadHref}
          className="mt-0.5 block truncate text-[13px] font-normal leading-5 text-[var(--app-text-primary)] hover:text-primary sm:text-sm"
        >
          {item.leadName}
        </Link>
        <p className="mt-0.5 truncate text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
          {item.assignedUserName || 'Sem responsável'}
          {item.pipelineName ? ` · ${item.pipelineName}` : ''}
          {item.stageName ? ` · ${item.stageName}` : ''}
        </p>
        <p className="truncate text-[11px] font-light leading-4 text-[var(--app-text-tertiary)]">
          {item.policyName}
          {lastAction ? ` · Última ação ${lastAction}` : ''}
        </p>
        <time
          dateTime={item.dueAt}
          title={deadline.absolute}
          className={cn(
            'mt-1 block text-[11px] font-light sm:hidden',
            deadline.overdue ? 'text-orange-600' : 'text-[var(--app-text-secondary)]',
          )}
        >
          {deadline.label}
        </time>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 pl-0.5 sm:gap-2 sm:pl-3">
        <time
          dateTime={item.dueAt}
          title={deadline.absolute}
          className={cn(
            'hidden max-w-[150px] whitespace-nowrap text-right text-[11px] font-light sm:block lg:text-xs',
            deadline.overdue ? 'text-orange-600' : 'text-[var(--app-text-secondary)]',
          )}
        >
          {deadline.label}
        </time>

        {canUseActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                aria-label={`Ações para ${item.leadName}`}
                disabled={isMutating}
              >
                {isMutating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 rounded-[8px] p-1.5">
              <DropdownMenuLabel className="px-2 py-1 text-[10px] font-light text-[var(--app-text-tertiary)]">
                Ações do alerta
              </DropdownMenuLabel>
              {item.status !== 'acknowledged' && (
                <DropdownMenuItem
                  className="rounded-[6px] text-xs font-light"
                  onClick={() => acknowledge.mutate({ id: item.id })}
                >
                  <Check className="mr-2 h-3.5 w-3.5" />
                  Assumir alerta
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {SNOOZE_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.minutes}
                  className="rounded-[6px] text-xs font-light"
                  onClick={() => snooze.mutate({ id: item.id, minutes: option.minutes })}
                >
                  <Clock3 className="mr-2 h-3.5 w-3.5" />
                  {option.label}
                </DropdownMenuItem>
              ))}
              {canAdministrativeOverride && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="rounded-[6px] text-xs font-light"
                    onSelect={() => setResolveOpen(true)}
                  >
                    <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                    Resolver exceção
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Link
          href={leadHref}
          aria-label={`Abrir ${item.leadName}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground transition-colors group-hover:bg-primary focus-visible:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {canAdministrativeOverride && (
        <ResolveAttentionDialog item={item} open={resolveOpen} onOpenChange={setResolveOpen} />
      )}
    </div>
  )
}

function QueueState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
        {icon}
      </span>
      <p className="mt-3 text-sm font-normal text-[var(--app-text-primary)]">{title}</p>
      <p className="mt-1 max-w-md text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">{description}</p>
      {action}
    </div>
  )
}

function QueueSkeleton() {
  return (
    <div className="space-y-1 p-1.5 sm:p-2">
      {[0, 1, 2, 3, 4].map((item) => (
        <div
          key={item}
          className="grid grid-cols-[36px_minmax(0,1fr)_32px] items-center gap-2.5 rounded-[6px] px-2 py-2.5 sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:gap-3 sm:px-3 sm:py-3"
        >
          <Skeleton className="h-9 w-9 rounded-[6px] sm:h-10 sm:w-10" />
          <div>
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-2 h-4 w-1/2" />
            <Skeleton className="mt-2 h-3 w-2/3" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="hidden h-3 w-20 sm:block" />
            <Skeleton className="h-8 w-8 rounded-[6px]" />
          </div>
        </div>
      ))}
    </div>
  )
}

function AttentionQueue() {
  const access = useUserAccessScope()
  const { hasPermission } = useUserPermissions()
  const [selectedScope, setSelectedScope] = useState<AttentionScope | null>(null)
  const [status, setStatus] = useState<StatusFilter>('open')
  const now = useAttentionClock()
  const canViewOrganization = access.canViewAllLeads
  const canViewTeam = access.isAdmin || access.isTeamLeader
  const scope = selectedScope || (canViewOrganization ? 'organization' : 'mine')
  const itemsQuery = useAttentionItems(scope, status === 'open' ? undefined : status)
  const summaryQuery = useAttentionSummary(scope)
  const items = useMemo(
    () => itemsQuery.data?.pages.flatMap((page) => page.items) || [],
    [itemsQuery.data],
  )
  const canOperate = hasPermission('lead_operate')

  const refresh = () => {
    itemsQuery.refetch()
    summaryQuery.refetch()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="attention-queue">
      <SummaryStrip
        summary={summaryQuery.data}
        loading={summaryQuery.isLoading}
        error={summaryQuery.isError}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ScopeFilter
          value={scope}
          onChange={setSelectedScope}
          canViewTeam={canViewTeam}
          canViewOrganization={canViewOrganization}
        />

        <div className="flex shrink-0 items-center justify-end gap-1.5">
          <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
            <SelectTrigger
              aria-label="Filtrar por status"
              className="h-9 w-[164px] rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2.5 text-[11px] font-light shadow-none sm:w-[190px] sm:text-xs"
            >
              <Filter className="mr-1.5 h-3.5 w-3.5 text-[var(--app-text-secondary)]" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-[8px]">
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-xs font-light">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={refresh}
            disabled={itemsQuery.isFetching || summaryQuery.isFetching}
            aria-label="Atualizar fila"
            className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-[var(--app-surface-solid)] text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', (itemsQuery.isFetching || summaryQuery.isFetching) && 'animate-spin')} />
          </button>
        </div>
      </div>

      <section className="min-h-0 flex-1 overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)]" aria-label="Alertas da Central de atenção">
        {itemsQuery.isLoading ? (
          <QueueSkeleton />
        ) : itemsQuery.isError ? (
          <QueueState
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Não foi possível carregar a fila"
            description="Tente novamente. As outras áreas do sistema continuam disponíveis."
            action={(
              <button
                type="button"
                onClick={() => itemsQuery.refetch()}
                className="mt-4 inline-flex h-8 items-center rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-[11px] font-light text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]"
              >
                Tentar novamente
              </button>
            )}
          />
        ) : items.length === 0 ? (
          <QueueState
            icon={<CheckCircle2 className="h-4 w-4" />}
            title="Tudo em dia por aqui"
            description="Nenhum alerta foi encontrado para este escopo e filtro."
          />
        ) : (
          <div className="h-full overflow-y-auto overscroll-contain p-1.5 sm:p-2">
            <div className="divide-y divide-border/30">
              {items.map((item) => (
                <AttentionItemRow
                  key={item.id}
                  item={item}
                  now={now}
                  canOperate={canOperate}
                  canAdministrativeOverride={access.isAdmin}
                />
              ))}
            </div>
            {itemsQuery.hasNextPage && (
              <div className="flex justify-center border-t border-border/30 px-3 py-3">
                <button
                  type="button"
                  onClick={() => itemsQuery.fetchNextPage()}
                  disabled={itemsQuery.isFetchingNextPage}
                  className="inline-flex h-8 items-center rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-[11px] font-light text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] disabled:opacity-50"
                >
                  {itemsQuery.isFetchingNextPage && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  Carregar mais
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

export function AttentionCenterScreen() {
  const [view, setView] = useState<AttentionView>('queue')
  const access = useUserAccessScope()
  const { hasPermission } = useUserPermissions()
  const canManagePolicies = access.isAdmin
    || hasPermission('pipeline_manage')
    || hasPermission('automations_manage')

  return (
    <AppLayout title="Central de atenção" disableMainScroll borderless>
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1120px] flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="app-section-title text-[var(--app-text-primary)]">Fila operacional</h1>
            <p className="mt-1 text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
              Acompanhe os leads que precisam de ação e organize o trabalho por prazo.
            </p>
          </div>

          {canManagePolicies && (
            <div className="flex w-fit items-center gap-1 rounded-[8px] bg-[var(--app-surface-solid)] p-1" role="tablist" aria-label="Visualização da Central de atenção">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'queue'}
                onClick={() => setView('queue')}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-[11px] font-light transition-colors sm:text-xs',
                  view === 'queue'
                    ? 'bg-[var(--app-surface-hover)] text-[var(--app-text-primary)]'
                    : 'text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-soft)]',
                )}
              >
                <BellRing className="h-3.5 w-3.5" />
                Fila
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'policies'}
                onClick={() => setView('policies')}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-[11px] font-light transition-colors sm:text-xs',
                  view === 'policies'
                    ? 'bg-[var(--app-surface-hover)] text-[var(--app-text-primary)]'
                    : 'text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-soft)]',
                )}
              >
                <Settings2 className="h-3.5 w-3.5" />
                Configurações
              </button>
            </div>
          )}
        </div>

        {view === 'policies' && canManagePolicies ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
            <AttentionPolicySettings />
          </div>
        ) : (
          <AttentionQueue />
        )}
      </div>
    </AppLayout>
  )
}

export default AttentionCenterScreen
