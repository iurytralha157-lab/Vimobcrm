import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import { AuthSplitLayout } from '@/components/features/auth/AuthSplitLayout'
import ResetPasswordScreen from '@/components/features/auth/screens/ResetPasswordScreen'

export const metadata: Metadata = {
  title: {
    absolute: 'Redefinir senha | Vimob crm',
  },
  description: 'Defina uma nova senha de acesso ao Vimob crm',
}

export default function ResetPasswordPage() {
  return (
    <AuthSplitLayout
      contentLabel="Redefinição de senha do Vimob crm"
      heroMedia="video"
      footer={(
        <p className="auth-login-legal w-full px-2 text-center text-[12px] leading-[1.5] text-[var(--app-text-tertiary)] lg:px-4 lg:text-[11px]">
          Ao continuar, você concorda com os{' '}
          <Link
            href="/termos-de-uso"
            className="text-primary outline-none transition-opacity hover:opacity-80"
          >
            Termos de Uso
          </Link>{' '}
          e a{' '}
          <Link
            href="/politica-de-privacidade"
            className="text-primary outline-none transition-opacity hover:opacity-80"
          >
            Política de Privacidade
          </Link>
          .
        </p>
      )}
    >
      <Suspense fallback={null}>
        <ResetPasswordScreen />
      </Suspense>
    </AuthSplitLayout>
  )
}
