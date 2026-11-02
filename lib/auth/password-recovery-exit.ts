import {
  signOutLocallyWithSessionGuard,
  signOutWithGlobalRevocation,
  type GlobalSignOutGuard,
  type GlobalSignOutOperations,
} from '@/lib/auth/global-sign-out'
import { runAuthOperationWithTimeout } from '@/lib/auth/frontend-auth-reliability'

export type PasswordRecoveryGuard = GlobalSignOutGuard & { isCurrent: () => boolean }
type ExitResult = 'finished' | 'cancelled' | 'incomplete'
type ExitEffects = {
  clear: () => void
  navigate: (destination: string) => void
  wait: (milliseconds: number) => PromiseLike<void>
}

/** All remote revocation uses the original JWT; SDK cleanup also rechecks storage. */
export async function exitPasswordRecovery({
  guard, operations, effects, destination, revokeGlobal = false, messageWaitMs = 0,
}: {
  guard: PasswordRecoveryGuard
  operations: GlobalSignOutOperations
  effects: ExitEffects
  destination: string
  revokeGlobal?: boolean
  messageWaitMs?: number
}): Promise<ExitResult> {
  if (!guard.isCurrent()) return 'cancelled'
  if (revokeGlobal) {
    const global = await runAuthOperationWithTimeout(
      () => signOutWithGlobalRevocation(operations, guard), 2_000,
    )
    if (!guard.isCurrent() || (global.status === 'completed' && global.value === 'cancelled')) return 'cancelled'
    // This is the explicitly unverified compatibility path. A failed global
    // operation must not stop a guarded attempt to leave only this session.
  }
  if (!guard.isCurrent()) return 'cancelled'
  const local = await runAuthOperationWithTimeout(
    () => signOutLocallyWithSessionGuard(operations, guard), 750,
  )
  if (!guard.isCurrent() || (local.status === 'completed' && local.value === 'cancelled')) return 'cancelled'
  // Do not navigate with a surviving recovery cookie: the proxy would send it
  // back to cancellation. Keep the current screen available for a retry.
  if (local.status !== 'completed') return 'incomplete'
  if (messageWaitMs > 0) await effects.wait(messageWaitMs)
  if (!guard.isCurrent()) return 'cancelled'
  effects.clear()
  if (!guard.isCurrent()) return 'cancelled'
  effects.navigate(destination)
  return 'finished'
}
