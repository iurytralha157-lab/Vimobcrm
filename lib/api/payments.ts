import { vimobPublicAPIRequest } from './vimob-client'
import { paymentCheckoutQuerySchema, paymentMutationInputSchema, paymentStatusQuerySchema, parseDomainInput } from '@/lib/validation'

export const paymentsAPI = {
  checkoutInfo<T>(query: { token?: string | null; organization_id?: string | null }) {
    const validatedQuery = parseDomainInput(paymentCheckoutQuerySchema, query, 'payments.checkout-info')
    return vimobPublicAPIRequest<T>('/v1/public/payments/checkout-info', {
      query: validatedQuery,
    })
  },

  paymentStatus<T>(paymentId: string, checkoutToken: string) {
    const query = parseDomainInput(paymentStatusQuerySchema, { payment_id: paymentId, checkout_token: checkoutToken }, 'payments.status')
    return vimobPublicAPIRequest<T>('/v1/public/payments/status', {
      query,
    })
  },

  createCharge<T>(body: Record<string, unknown>) {
    const input = parseDomainInput(paymentMutationInputSchema, body, 'payments.charge')
    return vimobPublicAPIRequest<T>('/v1/public/payments/charge', {
      method: 'POST',
      body: input,
    })
  },

  cancelPayment<T>(body: Record<string, unknown>) {
    const input = parseDomainInput(paymentMutationInputSchema, body, 'payments.cancel')
    return vimobPublicAPIRequest<T>('/v1/public/payments/cancel', {
      method: 'POST',
      body: input,
    })
  },
}
