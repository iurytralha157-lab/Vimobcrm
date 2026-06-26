import { sendEmail as sendEmailWithProvider } from '@/integrations/email/resend'
import type { SendEmailResult } from '@/integrations/email/provider'
import {
  emailSendRequestSchema,
  type EmailSendRequest,
  type LegalAcceptanceEmailRequest,
  type OrganizationInviteEmailRequest,
  type PaymentConfirmedEmailRequest,
  type WelcomeEmailRequest,
} from '@/lib/validation/email'

export type EmailAPIResponse = {
  ok: boolean
  message: string
  result?: SendEmailResult
  issues?: unknown
}

type TransactionalEmailInput<TRequest> = Omit<TRequest, 'subject' | 'template'> & {
  subject?: string
}

function getRouteStatus(result: SendEmailResult) {
  if (result.ok) return 200
  if (result.status === 'skipped') return 503
  return 502
}

export function createEmailAPIResponse(result: SendEmailResult): EmailAPIResponse {
  return {
    ok: result.ok,
    message: result.message,
    result,
  }
}

export function getEmailAPIStatus(result: SendEmailResult) {
  return getRouteStatus(result)
}

function assertServerRuntime() {
  if (typeof window !== 'undefined') {
    throw new Error('Email API must run on the server. Use an internal API route from client code.')
  }
}

export async function sendEmail(input: EmailSendRequest): Promise<SendEmailResult> {
  assertServerRuntime()

  const body = emailSendRequestSchema.parse(input)
  return sendEmailWithProvider(body)
}

export async function sendOrganizationInviteEmail(
  input: TransactionalEmailInput<OrganizationInviteEmailRequest>
) {
  return sendEmail({
    ...input,
    subject: input.subject ?? 'Convite para acessar o Vimob CRM',
    template: 'organization_invite',
  })
}

export async function sendWelcomeEmail(input: TransactionalEmailInput<WelcomeEmailRequest>) {
  return sendEmail({
    ...input,
    subject: input.subject ?? 'Bem-vindo ao Vimob CRM',
    template: 'welcome',
  })
}

export async function sendLegalAcceptanceEmail(
  input: TransactionalEmailInput<LegalAcceptanceEmailRequest>
) {
  return sendEmail({
    ...input,
    subject: input.subject ?? 'Aceite de termos registrado',
    template: 'legal_acceptance',
  })
}

export async function sendPaymentConfirmedEmail(
  input: TransactionalEmailInput<PaymentConfirmedEmailRequest>
) {
  return sendEmail({
    ...input,
    subject: input.subject ?? 'Pagamento confirmado',
    template: 'payment_confirmed',
  })
}

export const emailAPI = {
  sendEmail,
  sendOrganizationInviteEmail,
  sendWelcomeEmail,
  sendLegalAcceptanceEmail,
  sendPaymentConfirmedEmail,
}
