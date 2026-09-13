import { format, formatDistance } from 'date-fns'
import { ptBR } from 'date-fns/locale'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  getInitials,
  getOrganizationMemberBadgeLabel,
  getOrganizationMemberDisplayLabel,
} from '@/lib/user-display'
import { cn } from '@/lib/utils'
import type {
  OrganizationPresenceStatus,
  OrganizationPresenceUser,
} from '@/lib/validation'

const STATUS_CONFIG: Record<OrganizationPresenceStatus, {
  dotClassName: string
  pillClassName: string
  label: string
}> = {
  online: {
    dotClassName: 'bg-success',
    pillClassName: 'bg-emerald-700 text-white',
    label: 'Online',
  },
  idle: {
    dotClassName: 'bg-warning',
    pillClassName: 'bg-amber-700/50 text-white',
    label: 'Ausente',
  },
  offline: {
    dotClassName: 'bg-destructive',
    pillClassName: 'bg-red-700/50 text-white',
    label: 'Offline',
  },
}

const PRESENCE_NAME_MAX_CHARACTERS = 28

type PresenceMemberBadge = {
  label: string
  className: string
}

export function formatPresenceMemberRole(
  role: string,
  isTeamLeader = false,
) {
  return getOrganizationMemberDisplayLabel(role, isTeamLeader)
}

export function formatPresenceMemberBadge(
  role: string,
  isTeamLeader = false,
): PresenceMemberBadge['label'] {
  const label = getOrganizationMemberBadgeLabel(role, isTeamLeader)
  if (label === 'USER') return 'USUÁRIO'
  if (label === 'ADM') return 'ADMIN'
  return label
}

function getPresenceMemberBadge(
  role: string,
  isTeamLeader: boolean,
): PresenceMemberBadge {
  const label = formatPresenceMemberBadge(role, isTeamLeader)

  return {
    label,
    className:
      'bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]',
  }
}

function getPresenceTime(timestamp: string | null, referenceTime: string) {
  if (!timestamp) return null

  const date = new Date(timestamp)
  const referenceDate = new Date(referenceTime)
  if (Number.isNaN(date.getTime()) || Number.isNaN(referenceDate.getTime())) {
    return null
  }

  const relative = formatDistance(date, referenceDate, {
    addSuffix: true,
    locale: ptBR,
  })

  return {
    relative: relative.charAt(0).toLocaleUpperCase('pt-BR') + relative.slice(1),
    absolute: format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }),
  }
}

function getPresenceDisplayName(name: string) {
  const normalizedName = name.trim()
  const characters = Array.from(normalizedName)

  if (characters.length <= PRESENCE_NAME_MAX_CHARACTERS) return normalizedName

  return `${characters
    .slice(0, PRESENCE_NAME_MAX_CHARACTERS - 1)
    .join('')
    .trimEnd()}…`
}

function getPresenceDetailTimestamp(user: OrganizationPresenceUser) {
  if (user.presence_status === 'idle') return user.idle_since_at
  if (user.presence_status === 'offline') return user.last_seen_at
  return null
}

export type OnlineUserRowProps = {
  referenceTime: string
  user: OrganizationPresenceUser
}

export function OnlineUserRow({ referenceTime, user }: OnlineUserRowProps) {
  const status = STATUS_CONFIG[user.presence_status]
  const detailTimestamp = getPresenceDetailTimestamp(user)
  const detailTime = getPresenceTime(detailTimestamp, referenceTime)
  const memberRoleLabel = formatPresenceMemberRole(
    user.member_role,
    user.is_team_leader,
  )
  const memberBadge = getPresenceMemberBadge(
    user.member_role,
    user.is_team_leader,
  )
  const timeAriaLabel = detailTime
    ? user.presence_status === 'idle'
      ? `Ausente desde ${detailTime.absolute}`
      : `Último sinal da sessão em ${detailTime.absolute}`
    : undefined
  const displayName = getPresenceDisplayName(user.name)

  return (
    <li
      data-presence-user-row
      data-presence-status={user.presence_status}
      className="group w-full min-w-0 max-w-full overflow-hidden border-b border-[var(--app-border)] py-0.5 last:border-b-0"
    >
      <div
        data-presence-row-surface
        className="flex w-full min-w-0 max-w-full items-start gap-3 rounded-[8px] px-2.5 py-2 transition-colors duration-150 group-hover:bg-[var(--app-surface-hover)]"
      >
        <div className="relative mt-0.5 shrink-0" aria-hidden="true">
          <Avatar className="h-9 w-9">
            {user.avatar_url ? (
              <AvatarImage src={user.avatar_url} alt="" className="object-cover" />
            ) : null}
            <AvatarFallback className="bg-[var(--app-surface-soft)] text-[11px] font-medium text-[var(--app-text-secondary)]">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <span
            className={cn(
              'absolute -bottom-px -right-px h-3 w-3 rounded-full border-2 border-[var(--app-surface-solid)]',
              status.dotClassName,
            )}
          />
        </div>

        <div className="min-w-0 flex-1 py-px">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
            <p
              data-presence-user-name
              title={user.name}
              aria-label={user.name}
              className="min-w-0 truncate text-[13px] font-medium leading-[17px] text-[var(--app-text-primary)]"
            >
              {displayName}
            </p>
            <span
              data-presence-member-badge
              aria-label={memberRoleLabel}
              title={memberRoleLabel}
              className={cn(
                'inline-flex min-h-5 min-w-12 max-w-24 shrink-0 items-center justify-center whitespace-nowrap rounded-[5px] border-0 px-2 py-1 text-center text-[8px] font-semibold leading-none tracking-[0.01em]',
                memberBadge.className,
              )}
            >
              {memberBadge.label}
            </span>
          </div>

          <div
            data-presence-detail
            className="mt-1 flex min-w-0 flex-nowrap items-center gap-x-1.5 overflow-hidden whitespace-nowrap text-[11px] font-normal leading-4 text-[var(--app-text-secondary)]"
          >
            <span
              data-presence-label
              className={cn(
                'inline-flex h-[18px] shrink-0 items-center rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                status.pillClassName,
              )}
            >
              {status.label}
            </span>
            {detailTime && detailTimestamp ? (
              <>
                <span aria-hidden="true"> · </span>
                <time
                  dateTime={detailTimestamp}
                  title={detailTime.absolute}
                  aria-label={timeAriaLabel}
                  className="shrink-0 whitespace-nowrap"
                >
                  {detailTime.relative}
                </time>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  )
}
