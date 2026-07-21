'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { format, formatDistanceToNowStrict, isValid } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  AlertCircle,
  AlertTriangle,
  BellRing,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  ExternalLink,
  Eye,
  Loader2,
  RefreshCw,
  Settings2,
  ShieldAlert,
  TimerOff,
  UserRound,
  UsersRound,
} from 'lucide-react'

import { AttentionPolicySettings } from './AttentionPolicySettings'
import { AppLayout } from '@/components/shared/layout/AppLayout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  useAcknowledgeAttentionItem,
  useAttentionItems,
  useAttentionSummary,
  useResolveAttentionItem,
  useSnoozeAttentionItem,
} from '@/hooks/attention'
import { useUserAccessScope } from '@/hooks/use-user-access-scope'
import type {
  AttentionItem,
  AttentionItemStatus,
  AttentionPolicyStatus,
  AttentionPolicyType,
  AttentionScope,
  AttentionSummary,
} from '@/lib/api/attention'
import { cn } from '@/lib/utils'

type AttentionView = 'queue' | 'policies'
type StatusFilter = 'all' | AttentionItemStatus

const STATUS_LABELS: Record<AttentionItemStatus, string> = {
  monitoring: 'Monitorando',
  warning: 'Próximo do limite',
  breached: 'Tempo excedido',
  escalated: 'Escalado',
  acknowledged: 'Assumido',
  resolved: 'Resolvido',
  redistributed: 'Redistribuido',
  cancelled: 'Cancelado',
  exception: 'Excecao',
}

const POLICY_TYPE_LABELS: Record<AttentionPolicyType, string> = {
  unassigned: 'Sem responsavel',
  first_contact: 'Primeiro contato',
  stage_inactivity: 'Inatividade na etapa',
  stage_age: 'Tempo na etapa',
  cadence_task: 'Tarefa de cadencia',
}

const POLICY_MODE_LABELS: Record<AttentionPolicyStatus, string> = {
  shadow: 'Observacao',
  enabled: 'Ativa',
  paused: 'Pausada',
  archived: 'Arquivada',
}

const CLOSED_ITEM_STATUSES = new Set<AttentionItemStatus>(['resolved', 'redistributed', 'cancelled'])

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Todos os alertas' },
  { value: 'warning', label: 'Próximos do limite' },
  { value: 'breached', label: 'Tempo excedido' },
  { value: 'escalated', label: 'Escalados' },
  { value: 'acknowledged', label: 'Assumidos' },
  { value: 'exception', label: 'Com excecao' },
  { value: 'monitoring', label: 'Em monitoramento' },
]

const SNOOZE_OPTIONS = [
  { minutes: 60, label: 'Adiar por 1 hora' },
  { minutes: 240, label: 'Adiar por 4 horas' },
  { minutes: 1_440, label: 'Adiar por 24 horas' },
  { minutes: 4_320, label: 'Adiar por 3 dias' },
]

function getSeverity(status: AttentionItemStatus) {
  if (status === 'exception' || status === 'escalated') {
    return {
      labelClass: 'border-red-500/30 bg-red-500/10 text-red-500',
      cardClass: 'border-red-500/25',
      icon: ShieldAlert,
    }
  }
  if (status === 'breached') {
    return {
      labelClass: 'border-orange-500/30 bg-orange-500/10 text-orange-500',
      cardClass: 'border-orange-500/25',
      icon: AlertCircle,
    }
  }
  if (status === 'warning') {
    return {
      labelClass: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
      cardClass: 'border-amber-500/20',
      icon: AlertTriangle,
    }
  }
  if (status === 'acknowledged') {
    return {
      labelClass: 'border-blue-500/30 bg-blue-500/10 text-blue-500',
      cardClass: 'border-blue-500/20',
      icon: Check,
    }
  }
  if (CLOSED_ITEM_STATUSES.has(status)) {
    return {
      labelClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
      cardClass: 'border-white/[0.07]',
      icon: CheckCircle2,
    }
  }
  return {
    labelClass: 'border-white/[0.12] bg-white/[0.05] text-muted-foreground',
    cardClass: 'border-white/[0.07]',
    icon: CircleDot,
  }
}

function getDeadline(item: AttentionItem) {
  const due = new Date(item.dueAt)
  if (!isValid(due)) return { label: 'Prazo indisponível', overdue: false, detail: null }

  if (CLOSED_ITEM_STATUSES.has(item.status)) {
    return {
      label: item.resolvedAt ? `Encerrado ${formatDistance(item.resolvedAt)}` : 'Ciclo encerrado',
      overdue: false,
      detail: format(due, "dd/MM/yyyy 'as' HH:mm", { locale: ptBR }),
    }
  }

  const overdue = due.getTime() < Date.now()
  return {
    label: overdue
      ? `Atrasado ha ${formatDistanceToNowStrict(due, { locale: ptBR })}`
      : `Vence em ${formatDistanceToNowStrict(due, { locale: ptBR })}`,
    overdue,
    detail: format(due, "dd/MM/yyyy 'as' HH:mm", { locale: ptBR }),
  }
}

function formatDistance(value: string) {
  const date = new Date(value)
  if (!isValid(date)) return ''
  return formatDistanceToNowStrict(date, { addSuffix: true, locale: ptBR })
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
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const Icon = option.icon
        return (
          <Button
            key={option.value}
            variant={value === option.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => onChange(option.value)}
          >
            <Icon className="mr-2 h-4 w-4" />
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}

function SummaryCards({ summary, loading }: { summary?: AttentionSummary; loading: boolean }) {
  const values = [
    {
      label: 'Precisam de acao',
      value: (summary?.warning || 0) + (summary?.breached || 0) + (summary?.escalated || 0),
      caption: 'aviso, violacao ou escalamento',
      icon: BellRing,
      color: 'text-amber-500',
    },
    {
      label: 'Atrasados',
      value: summary?.overdue || 0,
      caption: 'passaram do prazo configurado',
      icon: TimerOff,
      color: 'text-orange-500',
    },
    {
      label: 'Escalados',
      value: summary?.escalated || 0,
      caption: 'visiveis para lideranca',
      icon: ShieldAlert,
      color: 'text-red-500',
    },
    {
      label: 'Cadencias vencidas',
      value: summary?.cadenceTasks || 0,
      caption: 'tarefas que precisam de acao',
      icon: UserRound,
      color: 'text-blue-500',
    },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {values.map(({ label, value, caption, icon: Icon, color }) => (
        <Card key={label} className="app-card">
          <CardContent className="flex items-start justify-between gap-3 p-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
              {loading ? <Skeleton className="mt-2 h-8 w-14" /> : <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>}
              <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
            </div>
            <div className="rounded-lg bg-white/[0.05] p-2.5"><Icon className={cn('h-5 w-5', color)} /></div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function AttentionItemCard({ item }: { item: AttentionItem }) {
  const acknowledge = useAcknowledgeAttentionItem()
  const snooze = useSnoozeAttentionItem()
  const resolve = useResolveAttentionItem()
  const severity = getSeverity(item.status)
  const SeverityIcon = severity.icon
  const deadline = getDeadline(item)
  const isClosed = CLOSED_ITEM_STATUSES.has(item.status)
  const isShadow = item.policyStatus === 'shadow'
  const isMutating = acknowledge.isPending || snooze.isPending || resolve.isPending
  const snoozedUntil = item.snoozedUntil ? new Date(item.snoozedUntil) : null
  const isSnoozed = Boolean(snoozedUntil && isValid(snoozedUntil) && !isClosed)

  return (
    <Card className={cn('app-card transition-colors', severity.cardClass, isClosed && 'opacity-70')}>
      <CardContent className="p-4 md:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={severity.labelClass}>
                <SeverityIcon className="mr-1.5 h-3.5 w-3.5" />
                {STATUS_LABELS[item.status]}
              </Badge>
              <Badge variant={item.policyStatus === 'enabled' ? 'default' : 'secondary'}>
                {item.policyStatus === 'shadow' && <Eye className="mr-1.5 h-3.5 w-3.5" />}
                {POLICY_MODE_LABELS[item.policyStatus]}
              </Badge>
              <Badge variant="outline">{POLICY_TYPE_LABELS[item.policyType]}</Badge>
              {isSnoozed && <Badge variant="secondary"><Clock3 className="mr-1.5 h-3.5 w-3.5" />Adiado {formatDistance(item.snoozedUntil!)}</Badge>}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link
                  href={`/crm/pipelines?lead=${encodeURIComponent(item.leadId)}`}
                  className="group inline-flex items-center gap-1.5 font-semibold hover:text-primary"
                >
                  {item.leadName}
                  <ExternalLink className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
                <span className={cn('text-sm font-medium', deadline.overdue ? 'text-orange-500' : 'text-muted-foreground')}>
                  {deadline.label}
                </span>
              </div>
              {deadline.detail && <p className="mt-1 text-xs text-muted-foreground">Prazo: {deadline.detail}</p>}
            </div>

            <div className="grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
              <Detail label="Corretor" value={item.assignedUserName || 'Sem responsavel'} />
              <Detail label="Pipeline" value={item.pipelineName || 'Não informada'} />
              <Detail label="Etapa" value={item.stageName || 'Não informada'} />
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span>{item.policyName} · versao {item.policyVersion}</span>
              {item.reminderCount > 0 && <span>{item.reminderCount} lembrete{item.reminderCount === 1 ? '' : 's'} enviado{item.reminderCount === 1 ? '' : 's'}</span>}
              {item.lastValidActionAt && <span>Ultima acao valida {formatDistance(item.lastValidActionAt)}</span>}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 xl:max-w-[390px] xl:justify-end">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/crm/pipelines?lead=${encodeURIComponent(item.leadId)}`}>
                Abrir lead
              </Link>
            </Button>
            {!isClosed && !isShadow && (
              <>
                {item.status !== 'acknowledged' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => acknowledge.mutate({ id: item.id })}
                    disabled={isMutating}
                  >
                    {acknowledge.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                    Assumir
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={isMutating}>
                      <Clock3 className="mr-2 h-4 w-4" />
                      Adiar
                      <ChevronDown className="ml-2 h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {SNOOZE_OPTIONS.map((option) => (
                      <DropdownMenuItem
                        key={option.minutes}
                        onClick={() => snooze.mutate({ id: item.id, minutes: option.minutes })}
                      >
                        {option.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  size="sm"
                  onClick={() => resolve.mutate({ id: item.id, reason: 'manual' })}
                  disabled={isMutating}
                >
                  {resolve.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Resolver
                </Button>
              </>
            )}
          </div>
        </div>

        {isShadow && !isClosed && (
          <div className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/[0.06] px-3 py-2 text-xs text-blue-400">
            Simulação em modo de observação: este item mede o SLA, mas não exige ação do corretor nem dispara redistribuição.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <p className="truncate font-medium">{value}</p>
    </div>
  )
}

function AttentionQueue() {
  const access = useUserAccessScope()
  const [scope, setScope] = useState<AttentionScope>('mine')
  const [status, setStatus] = useState<StatusFilter>('all')
  const itemsQuery = useAttentionItems(scope, status === 'all' ? undefined : status)
  const summaryQuery = useAttentionSummary(scope)
  const items = useMemo(
    () => itemsQuery.data?.pages.flatMap((page) => page.items) || [],
    [itemsQuery.data],
  )
  const canViewTeam = access.isAdmin || access.isTeamLeader
  const canViewOrganization = access.isAdmin

  const refresh = () => {
    itemsQuery.refetch()
    summaryQuery.refetch()
  }

  return (
    <div className="space-y-5">
      <SummaryCards summary={summaryQuery.data} loading={summaryQuery.isLoading} />

      <Alert className="border-blue-500/20 bg-blue-500/[0.06]">
        <Eye className="h-4 w-4 text-blue-500" />
        <AlertTitle>Elegibilidade protegida</AlertTitle>
        <AlertDescription>
          Esta fila acompanha somente leads nao manuais criados depois da implantacao do motor. Leads antigos e leads criados manualmente nao sao inscritos, mesmo se forem movidos ou atribuidos depois.
        </AlertDescription>
      </Alert>

      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <ScopeFilter
          value={scope}
          onChange={setScope}
          canViewTeam={canViewTeam}
          canViewOrganization={canViewOrganization}
        />
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={refresh} disabled={itemsQuery.isFetching || summaryQuery.isFetching} aria-label="Atualizar fila">
            <RefreshCw className={cn('h-4 w-4', (itemsQuery.isFetching || summaryQuery.isFetching) && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {itemsQuery.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-52 rounded-xl" />)}
        </div>
      ) : itemsQuery.isError ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Não foi possível carregar o Centro de Atenção</AlertTitle>
          <AlertDescription className="mt-2 flex flex-wrap items-center gap-3">
            <span>Confira se a API local está rodando e se sua sessão tem acesso a esta organização.</span>
            <Button variant="outline" size="sm" onClick={() => itemsQuery.refetch()}>Tentar novamente</Button>
          </AlertDescription>
        </Alert>
      ) : items.length === 0 ? (
        <Card className="app-card">
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <div className="max-w-lg">
              <h3 className="font-semibold">Fila em dia</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Não há alertas elegíveis para este escopo e filtro. O sistema continua observando apenas leads não manuais criados depois da implantação.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => <AttentionItemCard key={item.id} item={item} />)}
          {itemsQuery.hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={() => itemsQuery.fetchNextPage()} disabled={itemsQuery.isFetchingNextPage}>
                {itemsQuery.isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Carregar mais
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function AttentionCenterScreen() {
  const [view, setView] = useState<AttentionView>('queue')
  const access = useUserAccessScope()

  return (
    <AppLayout title="Centro de Atencao">
      <div className="space-y-5">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-primary">
              <BellRing className="h-4 w-4" />
              Gerente operacional do CRM
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Centro de Atencao</h1>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Uma fila persistente para leads sem responsavel, primeiro contato, inatividade e tempo maximo por etapa.
            </p>
          </div>

          <Tabs value={view} onValueChange={(value) => setView(value as AttentionView)}>
            <TabsList>
              <TabsTrigger value="queue"><BellRing className="mr-2 h-4 w-4" />Fila de atencao</TabsTrigger>
              {access.isAdmin && (
                <TabsTrigger value="policies"><Settings2 className="mr-2 h-4 w-4" />Políticas</TabsTrigger>
              )}
            </TabsList>
          </Tabs>
        </div>

        {view === 'policies' && access.isAdmin ? <AttentionPolicySettings /> : <AttentionQueue />}
      </div>
    </AppLayout>
  )
}

export default AttentionCenterScreen
