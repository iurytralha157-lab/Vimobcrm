'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useAuth } from '@/contexts/AuthContext'
import { useOrganizationModules } from '@/hooks/use-organization-modules'
import { useUserPermissions } from '@/hooks/use-user-permissions'
import {
  getDashboardUpcomingTasks,
  homeAPI,
  scheduleAPI,
  type DashboardUpcomingTask,
  type HomeFocusScope,
  type HomeFocusFeedItem,
  type ScheduleEvent,
} from '@/lib/api'
import { isBillingAccessBlocked } from '@/lib/billing-access'

const HOME_OVERVIEW_STALE_TIME_MS = 60_000
const HOME_OVERVIEW_GC_TIME_MS = 10 * 60_000
const HOME_TASK_LIMIT = 5
const HOME_FOCUS_LIMIT = 8

export type HomeFocusKind = 'attention' | 'task' | 'schedule'
export type HomeFocusTone = 'critical' | 'warning' | 'neutral'

export type HomeFocusItem = {
  id: string
  kind: HomeFocusKind
  tone: HomeFocusTone
  status?: HomeFocusFeedItem['status']
  policyType?: HomeFocusFeedItem['policy_type']
  taskType?: HomeFocusFeedItem['task_type']
  obligationKey?: string
  leadId?: string
  stageName?: string | null
  title: string
  description: string
  href: string
  dueAt: string
  leadName?: string | null
}

function getTodayRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  return { start, end, key: start.toISOString().slice(0, 10) }
}

function useTodayRange() {
  const [today, setToday] = useState(getTodayRange)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>

    const scheduleNextDay = () => {
      const now = new Date()
      const nextDay = new Date(now)
      nextDay.setHours(24, 0, 1, 0)

      timer = setTimeout(() => {
        setToday(getTodayRange())
        scheduleNextDay()
      }, Math.max(1_000, nextDay.getTime() - now.getTime()))
    }

    scheduleNextDay()
    return () => clearTimeout(timer)
  }, [])

  return today
}

function mapServerFocusItem(item: HomeFocusFeedItem): HomeFocusItem {
  return {
    id: item.id,
    kind: item.kind,
    tone: item.tone,
    status: item.status,
    policyType: item.policy_type,
    taskType: item.task_type,
    obligationKey: item.obligation_key,
    leadId: item.lead_id,
    stageName: item.stage_name,
    title: item.title,
    description: item.description,
    href: item.target_url,
    dueAt: item.due_at,
    leadName: item.lead_name,
  }
}

function mapUpcomingTask(task: DashboardUpcomingTask): HomeFocusItem {
  return {
    id: `task:${task.id}`,
    kind: 'task',
    tone: new Date(task.due_date).getTime() < Date.now() ? 'critical' : 'neutral',
    title: task.title,
    description: task.lead_name ? `Lead: ${task.lead_name}` : 'Tarefa comercial',
    href: `/crm/pipelines?lead=${encodeURIComponent(task.lead_id)}`,
    dueAt: task.due_date,
    leadName: task.lead_name,
  }
}

function mapScheduleEvent(event: ScheduleEvent): HomeFocusItem {
  const privateEvent = event.is_masked === true
  const leadName = privateEvent ? null : event.lead?.name

  return {
    id: `schedule:${event.id}`,
    kind: 'schedule',
    tone: new Date(event.start_time).getTime() < Date.now() ? 'warning' : 'neutral',
    title: privateEvent ? 'Compromisso privado' : event.title,
    description: leadName ? `Com ${leadName}` : 'Agenda de hoje',
    href: `/agenda?event=${encodeURIComponent(event.id)}`,
    dueAt: event.start_time,
    leadName,
  }
}

function sortFocusItems(left: HomeFocusItem, right: HomeFocusItem) {
  const toneWeight: Record<HomeFocusTone, number> = {
    critical: 0,
    warning: 1,
    neutral: 2,
  }
  const toneDifference = toneWeight[left.tone] - toneWeight[right.tone]
  if (toneDifference !== 0) return toneDifference
  return new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime()
}

function visibleScheduleEvents(events: ScheduleEvent[]) {
  return events.filter((event) => event.status !== 'cancelled' && event.status !== 'completed')
}

export function useHomeOverview(
  scope: HomeFocusScope = 'mine',
  enabled = true,
) {
  const { organization, profile, user, isSuperAdmin } = useAuth()
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions()
  const { hasModule, isLoading: modulesLoading } = useOrganizationModules()
  const organizationId = organization?.id ?? profile?.organization_id
  const today = useTodayRange()
  const billingBlocked = !isSuperAdmin && isBillingAccessBlocked(organization)

  const canViewAttention =
    enabled &&
    !billingBlocked &&
    !permissionsLoading &&
    !modulesLoading &&
    hasModule('crm') &&
    hasPermission('attention_view')
  const canViewUpcomingTasks =
    enabled &&
    !billingBlocked &&
    !permissionsLoading &&
    hasPermission('dashboard_view')
  const canViewSchedule =
    enabled &&
    !billingBlocked &&
    !permissionsLoading &&
    !modulesLoading &&
    hasModule('agenda') &&
    hasPermission('schedule_view')

  const serverFocusQuery = useQuery({
    queryKey: ['home', 'focus', organizationId, user?.id, scope],
    enabled: Boolean(organizationId && user?.id && canViewAttention),
    queryFn: ({ signal }) => homeAPI.listFocus(
      organizationId,
      signal,
      HOME_FOCUS_LIMIT,
      scope,
    ),
    staleTime: HOME_OVERVIEW_STALE_TIME_MS,
    gcTime: HOME_OVERVIEW_GC_TIME_MS,
    refetchInterval: HOME_OVERVIEW_STALE_TIME_MS,
    refetchIntervalInBackground: false,
  })

  const upcomingTasksQuery = useQuery({
    queryKey: ['home', 'upcoming-tasks', organizationId, user?.id],
    enabled: Boolean(
      organizationId &&
      user?.id &&
      canViewUpcomingTasks &&
      !canViewAttention
    ),
    queryFn: () => getDashboardUpcomingTasks({
      organizationId,
      limit: HOME_TASK_LIMIT,
    }),
    staleTime: HOME_OVERVIEW_STALE_TIME_MS,
    gcTime: HOME_OVERVIEW_GC_TIME_MS,
  })

  const scheduleQuery = useQuery({
    queryKey: ['home', 'schedule', organizationId, user?.id, today.key],
    enabled: Boolean(organizationId && user?.id && canViewSchedule),
    queryFn: () => scheduleAPI.getScheduleEvents({
      organizationId,
      userId: user?.id,
      startDate: today.start,
      endDate: today.end,
    }),
    staleTime: HOME_OVERVIEW_STALE_TIME_MS,
    gcTime: HOME_OVERVIEW_GC_TIME_MS,
  })

  const scheduleEvents = visibleScheduleEvents(scheduleQuery.data || [])
  const focusItems = [
    ...(serverFocusQuery.data || []).map(mapServerFocusItem),
    ...(upcomingTasksQuery.data || []).map(mapUpcomingTask),
    ...scheduleEvents.map(mapScheduleEvent),
  ]
    .sort(sortFocusItems)
    .slice(0, HOME_FOCUS_LIMIT)

  const access = {
    attention: canViewAttention,
    upcomingTasks: canViewUpcomingTasks,
    schedule: canViewSchedule,
  }
  const isLoading = enabled && (
    permissionsLoading ||
    modulesLoading ||
    serverFocusQuery.isLoading ||
    upcomingTasksQuery.isLoading ||
    scheduleQuery.isLoading
  )
  const hasError = [
    serverFocusQuery.error,
    upcomingTasksQuery.error,
    scheduleQuery.error,
  ].some(Boolean)
  const isRetrying = [
    serverFocusQuery.isFetching,
    upcomingTasksQuery.isFetching,
    scheduleQuery.isFetching,
  ].some(Boolean) && !isLoading

  const retry = async () => {
    const retries: Array<Promise<unknown>> = []
    if (canViewAttention) retries.push(serverFocusQuery.refetch())
    if (canViewUpcomingTasks && !canViewAttention) retries.push(upcomingTasksQuery.refetch())
    if (canViewSchedule) retries.push(scheduleQuery.refetch())
    await Promise.allSettled(retries)
  }

  return {
    focusItems,
    isLoading,
    hasError,
    isRetrying,
    retry,
    hasAnyAccess: Object.values(access).some(Boolean),
    billingBlocked,
  }
}
