const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/i

export type BillingPaymentReceiptState =
  | 'confirmed'
  | 'refunded'
  | 'chargeback'
  | 'cancelled'
  | 'invalidated'

export type PublicBillingPaymentReceipt = {
  found: true
  valid: boolean
  payment_state: BillingPaymentReceiptState
  current_payment_status: string
  state_changed_at: string
  receipt_number: string
  version: number
  issuer_name: string
  organization_name: string
  plan_name: string
  billing_period_months: number
  billing_type: string
  amount: number
  currency: string
  paid_at: string
  issued_at: string
  snapshot_hash: string
}

export type CheckoutPaymentReceiptReference = {
  number: string
  verification_path: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredText(value: unknown, maxLength = 255) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : null
}

function validDateText(value: unknown) {
  const normalized = requiredText(value, 80)
  return normalized && !Number.isNaN(Date.parse(normalized)) ? normalized : null
}

export function normalizeReceiptVerificationToken(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return UUID_PATTERN.test(normalized) ? normalized : null
}

export function parseCheckoutPaymentReceiptReference(
  value: unknown,
): CheckoutPaymentReceiptReference | null {
  if (!isObject(value)) return null

  const number = requiredText(value.number, 100)
  const path = requiredText(value.verification_path, 80)
  const pathMatch = path?.match(/^\/comprovantes\/([^/?#]+)$/)
  const token = normalizeReceiptVerificationToken(pathMatch?.[1])

  if (!number || !token) return null

  return {
    number,
    verification_path: `/comprovantes/${token}`,
  }
}

export function parsePublicBillingPaymentReceipt(
  value: unknown,
): PublicBillingPaymentReceipt | null {
  if (!isObject(value) || value.found !== true || typeof value.valid !== 'boolean') return null

  const receiptNumber = requiredText(value.receipt_number, 100)
  const issuerName = requiredText(value.issuer_name, 180)
  const organizationName = requiredText(value.organization_name, 180)
  const planName = requiredText(value.plan_name, 180)
  const billingType = requiredText(value.billing_type, 80)
  const currency = requiredText(value.currency, 3)?.toUpperCase() ?? null
  const paidAt = validDateText(value.paid_at)
  const issuedAt = validDateText(value.issued_at)
  const snapshotHash = requiredText(value.snapshot_hash, 64)?.toLowerCase() ?? null
  const currentPaymentStatus = requiredText(value.current_payment_status, 80)?.toUpperCase() ?? null
  const stateChangedAt = validDateText(value.state_changed_at)
  const paymentState = requiredText(value.payment_state, 40) as BillingPaymentReceiptState | null
  const allowedPaymentStates: BillingPaymentReceiptState[] = [
    'confirmed',
    'refunded',
    'chargeback',
    'cancelled',
    'invalidated',
  ]

  if (
    !receiptNumber ||
    !issuerName ||
    !organizationName ||
    !planName ||
    !billingType ||
    !currency ||
    !/^[A-Z]{3}$/.test(currency) ||
    !paidAt ||
    !issuedAt ||
    !snapshotHash ||
    !SHA256_PATTERN.test(snapshotHash) ||
    !currentPaymentStatus ||
    !stateChangedAt ||
    !paymentState ||
    !allowedPaymentStates.includes(paymentState) ||
    value.valid !== (paymentState === 'confirmed') ||
    typeof value.version !== 'number' ||
    !Number.isInteger(value.version) ||
    value.version < 1 ||
    typeof value.billing_period_months !== 'number' ||
    !Number.isInteger(value.billing_period_months) ||
    ![1, 6, 12].includes(value.billing_period_months) ||
    typeof value.amount !== 'number' ||
    !Number.isFinite(value.amount) ||
    value.amount < 0
  ) {
    return null
  }

  return {
    found: true,
    valid: value.valid,
    payment_state: paymentState,
    current_payment_status: currentPaymentStatus,
    state_changed_at: stateChangedAt,
    receipt_number: receiptNumber,
    version: value.version,
    issuer_name: issuerName,
    organization_name: organizationName,
    plan_name: planName,
    billing_period_months: value.billing_period_months,
    billing_type: billingType,
    amount: value.amount,
    currency,
    paid_at: paidAt,
    issued_at: issuedAt,
    snapshot_hash: snapshotHash,
  }
}

export function getBillingPeriodLabel(months: number) {
  if (months === 1) return 'Mensal'
  if (months === 6) return 'Semestral'
  if (months === 12) return 'Anual'
  return `${months} meses`
}

export function getBillingTypeLabel(value: string) {
  const normalized = value.trim().toUpperCase()
  if (normalized === 'PIX') return 'Pix'
  if (normalized === 'BOLETO') return 'Boleto'
  if (normalized === 'CREDIT_CARD') return 'Cartão de crédito'
  if (normalized === 'DEBIT_CARD') return 'Cartão de débito'
  if (normalized === 'CASH') return 'Dinheiro'
  return 'Outro meio de pagamento'
}
