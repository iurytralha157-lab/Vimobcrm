import type { Metadata } from 'next'
import { Suspense } from 'react'

import ResetPasswordScreen from '@/components/features/auth/screens/ResetPasswordScreen'

export const metadata: Metadata = {
  title: 'Redefinir senha | Vimob',
  description: 'Defina uma nova senha de acesso ao Vimob CRM',
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordScreen />
    </Suspense>
  )
}
