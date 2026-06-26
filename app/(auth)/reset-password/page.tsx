import { Suspense } from 'react'

import ResetPasswordScreen from '@/components/features/auth/screens/ResetPasswordScreen'

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordScreen />
    </Suspense>
  )
}
