import { useEffect, useMemo, useState } from 'react'
import { countOverdueCadenceTasks, getPendingCadenceDeadlines } from '@/lib/lead-cadence-presentation'
import type { LeadCadenceState } from '@/lib/validation/lead-cadence-state'

/** Update the visible deadline count without polling or mutating server state. */
export function useCadenceOverdueCount(state?: LeadCadenceState) {
  const [now, setNow] = useState(() => Date.now())
  const tasks = state?.tasks
  const enabled = state?.deal_status === 'open'
  const deadlines = useMemo(() => getPendingCadenceDeadlines(tasks ?? []), [tasks])

  useEffect(() => {
    if (!enabled || deadlines.length === 0) return
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const current = Date.now()
      setNow(current)
      const next = deadlines.filter(deadline => deadline >= current)
      if (next.length) {
        // Bound the delay so a changed system clock is noticed while visible.
        timer = setTimeout(tick, Math.min(60_000, Math.min(...next) - current + 1))
      }
    }
    const refresh = () => { clearTimeout(timer); timer = setTimeout(tick, 0) }
    refresh()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [enabled, deadlines])

  return enabled ? countOverdueCadenceTasks(deadlines, now) : 0
}
