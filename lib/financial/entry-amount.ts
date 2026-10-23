type PaymentEntry = {
  amount: number
  value?: number | null
  paid_amount?: number | null
  paid_value?: number | null
  status?: string | null
}

const nonNegative = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0

/** The legacy payment fields mirror one amount; they must never be added together. */
export function getFinancialPaidAmount(entry: PaymentEntry) {
  const total = nonNegative(entry.value ?? entry.amount)
  const paid = Math.max(nonNegative(entry.paid_amount), nonNegative(entry.paid_value))
  const fullPayment = ['paid', 'paga'].includes(entry.status?.trim().toLowerCase() ?? '')
  return Math.min(total, paid > 0 ? paid : fullPayment ? total : 0)
}

export function getFinancialOutstandingAmount(entry: PaymentEntry) {
  return Math.max(0, nonNegative(entry.value ?? entry.amount) - getFinancialPaidAmount(entry))
}
