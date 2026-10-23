import { DEFAULT_SCHEDULE_TIME_ZONE } from '@/lib/schedule-outcome'
import type { LeadCadenceTaskState } from '@/lib/validation/lead-cadence-state'

type DeadlineTask = Pick<LeadCadenceTaskState, 'status' | 'is_done' | 'due_at'>

export function getPendingCadenceDeadlines(tasks: readonly DeadlineTask[]) {
  return tasks.flatMap(task => {
    if (task.status !== 'pending' || task.is_done || !task.due_at) return []
    const deadline = Date.parse(task.due_at)
    return Number.isFinite(deadline) ? [deadline] : []
  })
}

export function countOverdueCadenceTasks(deadlines: readonly number[], now: number) {
  return deadlines.filter(deadline => deadline < now).length
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function getFormatter(timeZone?: string, detailed = false) {
  const zone = timeZone?.trim() || DEFAULT_SCHEDULE_TIME_ZONE
  const key = `${zone}:${detailed}`
  const cached = formatters.get(key)
  if (cached) return cached
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone: zone, day: '2-digit', month: detailed ? '2-digit' : 'short',
      year: detailed ? 'numeric' : undefined, second: detailed ? '2-digit' : undefined,
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return getFormatter(DEFAULT_SCHEDULE_TIME_ZONE, detailed)
  }
  if (formatters.size >= 16) formatters.delete(formatters.keys().next().value!)
  formatters.set(key, formatter)
  return formatter
}

/** The API supplies the same organization time zone used by Agenda. */
export function formatLeadCadenceDate(value?: string | null, timeZone?: string, detailed = false) {
  if (!value) return 'Sem prazo'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Prazo indisponível'
  return getFormatter(timeZone, detailed).format(date).replace(',', ' às')
}
