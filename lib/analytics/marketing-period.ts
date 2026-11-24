import { format } from 'date-fns'
import { campaignInsightsQuerySchema } from '@/lib/validation/marketing'
import { DomainValidationError } from '@/lib/validation/common'

/** Marketing's bounded report period does not change the CRM's shared period. */
export function getMarketingPeriodValidation(range: { from: Date; to: Date }) {
  const dateFrom = Number.isFinite(range.from.getTime()) ? format(range.from, 'yyyy-MM-dd') : ''
  const dateTo = Number.isFinite(range.to.getTime()) ? format(range.to, 'yyyy-MM-dd') : ''
  const result = campaignInsightsQuerySchema.safeParse({ dateFrom, dateTo })
  return {
    dateFrom,
    dateTo,
    error: result.success ? null : new DomainValidationError('campaign-insights.period', 'input', result.error),
    message: result.success ? null : !dateFrom || !dateTo
      ? 'Selecione um período completo e válido.'
      : result.error.issues[0]?.message ?? 'Selecione um período válido.',
  }
}

export function splitMarketingSyncRange(dateStart: string, dateStop: string, connection: 'dedicated' | 'legacy') {
  const period = campaignInsightsQuerySchema.safeParse({ dateFrom: dateStart, dateTo: dateStop })
  if (!period.success) throw new Error(period.error.issues[0]?.message ?? 'Período de sincronização inválido')

  // Keep Ads reports and Instagram queries within the same request budget.
  const windowDays = connection === 'dedicated' ? 30 : 90
  const stop = new Date(`${dateStop}T00:00:00Z`)
  const windows: Array<{ dateStart: string; dateStop: string }> = []
  let cursor = new Date(`${dateStart}T00:00:00Z`)
  while (cursor <= stop) {
    const end = new Date(cursor)
    end.setUTCDate(end.getUTCDate() + windowDays - 1)
    if (end > stop) end.setTime(stop.getTime())
    windows.push({
      dateStart: cursor.toISOString().slice(0, 10),
      dateStop: end.toISOString().slice(0, 10),
    })
    cursor = end
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return windows
}
