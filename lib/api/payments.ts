import { vimobPublicAPIRequest } from './vimob-client'

export const paymentsAPI = {
  checkoutInfo<T>(query: { token?: string | null; organization_id?: string | null }) {
    return vimobPublicAPIRequest<T>('/v1/public/payments/checkout-info', {
      query,
    })
  },

  paymentStatus<T>(paymentId: string) {
    return vimobPublicAPIRequest<T>('/v1/public/payments/status', {
      query: {
        payment_id: paymentId,
      },
    })
  },

  createCharge<T>(body: Record<string, unknown>) {
    return vimobPublicAPIRequest<T>('/v1/public/payments/charge', {
      method: 'POST',
      body,
    })
  },

  cancelPayment<T>(body: Record<string, unknown>) {
    return vimobPublicAPIRequest<T>('/v1/public/payments/cancel', {
      method: 'POST',
      body,
    })
  },
}
