import type { z } from 'zod'

import { supabase } from '@/lib/supabase/client'
import type { Json } from '@/lib/supabase/types'
import {
  auditFeedEventPayloadSchema,
  parseDomainInput,
  userActivitySessionMutationInputSchema,
  type userActivitySessionStatusSchema,
  uuidSchema,
} from '@/lib/validation'

type SupabaseError = {
  message: string
}

export type UserActivitySessionStatus = z.infer<
  typeof userActivitySessionStatusSchema
>
export type AuditFeedEvent = z.infer<typeof auditFeedEventPayloadSchema>

type SessionMutationInput = z.infer<
  typeof userActivitySessionMutationInputSchema
>

type ConnectAuditFeedOptions = {
  organizationId: string
  onEvent: (event: AuditFeedEvent) => void
  onSubscribed?: () => void
  onError?: (error: unknown) => void
}

function userActivitySessionsTable() {
  return supabase.from('user_activity_sessions')
}

function throwIfSupabaseError(error: SupabaseError | null) {
  if (error) throw new Error(error.message)
}

function toJson(value: Record<string, unknown>): Json {
  try {
    return JSON.parse(JSON.stringify(value)) as Json
  } catch {
    return {}
  }
}

function sessionInputToRow(
  input: SessionMutationInput,
  status: UserActivitySessionStatus,
) {
  return {
    organization_id: input.organizationId,
    user_id: input.userId,
    session_id: input.sessionId,
    status,
    current_path: input.currentPath ?? null,
    current_page_title: input.currentPageTitle ?? null,
    user_agent: input.userAgent ?? null,
    metadata: toJson(input.metadata ?? {}),
  }
}

async function upsertUserActivitySession(
  input: SessionMutationInput,
  operation: 'start' | 'touch',
) {
  const parsed = parseDomainInput(
    userActivitySessionMutationInputSchema,
    input,
    `user-activity.${operation}`,
  )
  const row = sessionInputToRow(parsed, parsed.status ?? 'online')
  const { error } = await userActivitySessionsTable().upsert(row, {
    onConflict: 'organization_id,user_id,session_id',
  })

  throwIfSupabaseError(error)
}

export function startUserActivitySession(input: SessionMutationInput) {
  return upsertUserActivitySession(input, 'start')
}

export function touchUserActivitySession(input: SessionMutationInput) {
  // Upsert repairs a missing row if the one-shot start request was interrupted.
  return upsertUserActivitySession(input, 'touch')
}

export async function endUserActivitySession(input: SessionMutationInput) {
  const parsed = parseDomainInput(
    userActivitySessionMutationInputSchema,
    input,
    'user-activity.end',
  )
  const row = sessionInputToRow({ ...parsed, status: 'offline' }, 'offline')
  const { error } = await userActivitySessionsTable()
    .update(row)
    .eq('organization_id', parsed.organizationId)
    .eq('user_id', parsed.userId)
    .eq('session_id', parsed.sessionId)

  throwIfSupabaseError(error)
}

export function connectAuditFeed(options: ConnectAuditFeedOptions) {
  const organizationId = parseDomainInput(
    uuidSchema,
    options.organizationId,
    'user-activity.audit-feed.organization',
  )
  let active = true
  let channel: ReturnType<typeof supabase.channel> | null = null

  void supabase.realtime
    .setAuth()
    .then(() => {
      if (!active) return

      channel = supabase
        .channel(`audit:${organizationId}:feed`, { config: { private: true } })
        .on('broadcast', { event: 'audit.log.created' }, ({ payload }) => {
          const parsed = auditFeedEventPayloadSchema.safeParse(payload)
          if (parsed.success) options.onEvent(parsed.data)
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            options.onSubscribed?.()
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            options.onError?.(
              new Error(`Audit feed subscription failed: ${status}`),
            )
          }
        })
    })
    .catch((error) => {
      options.onError?.(error)
    })

  return () => {
    active = false
    if (channel) void supabase.removeChannel(channel)
  }
}

export const userActivityAPI = {
  startSession: startUserActivitySession,
  touchSession: touchUserActivitySession,
  endSession: endUserActivitySession,
  connectAuditFeed,
}
