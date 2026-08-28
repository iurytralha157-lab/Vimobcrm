export type CheckoutPaymentMethod = 'PIX' | 'BOLETO' | 'CREDIT_CARD'

export type CardRecurrenceState = 'unknown' | 'processing' | 'saved' | 'failed'

export type CardRecurrenceSignal = {
  recurrence_saved?: boolean
  recurrence_processing?: boolean
  recurrence_save_failed?: boolean
  requires_payment_method_update?: boolean
}

export type BillingPaymentSemanticState =
  | 'paid'
  | 'processing'
  | 'overdue'
  | 'refused'
  | 'refund_processing'
  | 'refunded'
  | 'chargeback'
  | 'bank_slip_cancelled'
  | 'cancelled'
  | 'pending'
  | 'unknown'

export type BillingPaymentStatusPresentation = {
  state: BillingPaymentSemanticState
  label: string
  tone: 'success' | 'danger' | 'muted'
}

const paidPaymentStatuses = new Set([
  'RECEIVED',
  'CONFIRMED',
  'RECEIVED_IN_CASH',
  // A denied refund leaves the original payment financially settled.
  'REFUND_DENIED',
])

const processingPaymentStatuses = new Set([
  'AWAITING_RISK_ANALYSIS',
  'AUTHORIZED',
  'PROCESSING',
])

const actionablePaymentStatuses = new Set([
  'CREATED',
  'PENDING',
  'OVERDUE',
  'DUNNING_REQUESTED',
  'DUNNING_RECEIVED',
  'CREDIT_CARD_CAPTURE_REFUSED',
  'REPROVED_BY_RISK_ANALYSIS',
])

function normalizeBillingPaymentStatus(value: string | null | undefined) {
  return value?.trim().toUpperCase() || ''
}

export function resolveBillingPaymentStatus(
  value: string | null | undefined,
  bankSlipRegistrationCancelled = false,
): BillingPaymentStatusPresentation {
  const normalized = normalizeBillingPaymentStatus(value)

  if (bankSlipRegistrationCancelled || normalized === 'BANK_SLIP_CANCELLED') {
    return { state: 'bank_slip_cancelled', label: 'Boleto expirado', tone: 'muted' }
  }
  if (paidPaymentStatuses.has(normalized)) {
    return { state: 'paid', label: 'Pago', tone: 'success' }
  }
  if (processingPaymentStatuses.has(normalized)) {
    return { state: 'processing', label: 'Processando', tone: 'muted' }
  }
  if (['OVERDUE', 'DUNNING_REQUESTED', 'DUNNING_RECEIVED'].includes(normalized)) {
    return { state: 'overdue', label: 'Em atraso', tone: 'danger' }
  }
  if (['CREDIT_CARD_CAPTURE_REFUSED', 'REPROVED_BY_RISK_ANALYSIS'].includes(normalized)) {
    return { state: 'refused', label: 'Recusado', tone: 'danger' }
  }
  if (['REFUND_IN_PROGRESS', 'REFUND_REQUESTED'].includes(normalized)) {
    return { state: 'refund_processing', label: 'Estorno em andamento', tone: 'muted' }
  }
  if (['REFUNDED', 'PARTIALLY_REFUNDED', 'RECEIVED_IN_CASH_UNDONE'].includes(normalized)) {
    return { state: 'refunded', label: 'Estornado', tone: 'muted' }
  }
  if (
    [
      'CHARGEBACK',
      'CHARGEBACK_REQUESTED',
      'CHARGEBACK_DISPUTE',
      'AWAITING_CHARGEBACK_REVERSAL',
    ].includes(normalized)
  ) {
    return { state: 'chargeback', label: 'Em contestação', tone: 'danger' }
  }
  if (['CANCELED', 'CANCELLED', 'DELETED'].includes(normalized)) {
    return { state: 'cancelled', label: 'Cancelado', tone: 'muted' }
  }
  if (['CREATED', 'PENDING'].includes(normalized)) {
    return { state: 'pending', label: 'Pendente', tone: 'muted' }
  }

  return { state: 'unknown', label: 'Em verificação', tone: 'muted' }
}

export function isBillingPaymentCheckoutActionable(
  value: string | null | undefined,
  bankSlipRegistrationCancelled = false,
) {
  return (
    bankSlipRegistrationCancelled ||
    normalizeBillingPaymentStatus(value) === 'BANK_SLIP_CANCELLED' ||
    actionablePaymentStatuses.has(normalizeBillingPaymentStatus(value))
  )
}

export function parseCheckoutPaymentMethod(
  value: string | null | undefined,
): CheckoutPaymentMethod | null {
  const normalized = value?.trim().toUpperCase()
  if (
    normalized === 'PIX' ||
    normalized === 'BOLETO' ||
    normalized === 'CREDIT_CARD'
  ) {
    return normalized
  }

  return null
}

export function buildCheckoutPaymentPath(
  checkoutToken: string,
  method: CheckoutPaymentMethod,
) {
  const normalizedToken = checkoutToken.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalizedToken)) return null

  const query = new URLSearchParams({ method })
  return `/checkout/${normalizedToken}?${query.toString()}`
}

export function resolveCardRecurrenceState(
  signal: CardRecurrenceSignal,
): CardRecurrenceState {
  if (signal.recurrence_saved === true) return 'saved'
  if (signal.recurrence_processing === true) return 'processing'
  if (
    signal.recurrence_save_failed === true ||
    signal.requires_payment_method_update === true ||
    signal.recurrence_saved === false
  ) {
    return 'failed'
  }

  return 'unknown'
}

export function shouldTreatHistoryStatusAsCurrent(input: {
  syncState: 'cached' | 'current' | 'provider_unavailable'
  refreshFailed?: boolean
}) {
  return input.syncState === 'current' && input.refreshFailed !== true
}
