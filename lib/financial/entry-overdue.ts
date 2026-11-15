import { financialCalendarDateSchema } from '@/lib/validation/financial'
import { getFinancialOutstandingAmount, type PaymentEntry } from '@/lib/financial/entry-amount'

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
})
const openStatuses = new Set(['pending', 'pendente', 'partial', 'parcial', 'overdue', 'vencido'])

export function getFinancialToday(now = new Date()) {
  return dateFormatter.format(now)
}

export function isFinancialEntryOverdue(
  entry: PaymentEntry & { type?: string | null; due_date?: string | null },
  today = getFinancialToday(),
) {
  const dueDate = financialCalendarDateSchema.safeParse(entry.due_date)
  return (entry.type === 'receivable' || entry.type === 'payable') &&
    dueDate.success && dueDate.data < today &&
    openStatuses.has(entry.status?.trim().toLowerCase() ?? '') &&
    getFinancialOutstandingAmount(entry) > 0
}
