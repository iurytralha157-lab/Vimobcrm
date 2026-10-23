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
