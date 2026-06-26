import { Suspense } from 'react'

import CheckoutScreen from '@/components/features/auth/screens/CheckoutScreen'

export default function CheckoutPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutScreen />
    </Suspense>
  )
}
