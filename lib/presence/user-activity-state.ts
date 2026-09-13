export const DEFAULT_ACTIVITY_HEARTBEAT_MS = 60_000
export const DEFAULT_ACTIVITY_IDLE_AFTER_MS = 5 * 60_000
export const USER_ACTIVITY_INPUT_EVENTS = [
  'keydown',
  'pointerdown',
  'touchstart',
  'wheel',
] as const

export function isTrustedUserActivityEvent(
  event: Pick<Event, 'isTrusted'>,
) {
  return event.isTrusted
}

export function getUserActivityAttentionStatus(
  visibilityState: DocumentVisibilityState,
  hasFocus: boolean,
) {
  return visibilityState === 'visible' && hasFocus ? 'online' : 'idle'
}

export function shouldMarkUserActivityOnline({
  isTrusted,
  visibilityState,
  hasFocus,
}: {
  isTrusted: boolean
  visibilityState: DocumentVisibilityState
  hasFocus: boolean
}) {
  return (
    isTrusted &&
    getUserActivityAttentionStatus(visibilityState, hasFocus) === 'online'
  )
}

export function getIdleCheckDelay(
  lastActivityAt: number,
  now: number,
  idleAfterMs = DEFAULT_ACTIVITY_IDLE_AFTER_MS,
) {
  return Math.max(0, idleAfterMs - Math.max(0, now - lastActivityAt))
}

export function isActivityIdle(
  lastActivityAt: number,
  now: number,
  idleAfterMs = DEFAULT_ACTIVITY_IDLE_AFTER_MS,
) {
  return getIdleCheckDelay(lastActivityAt, now, idleAfterMs) === 0
}
