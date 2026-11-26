'use client';

import { useState } from 'react';
import { authAPI } from '@/lib/api/auth';
import {
  EMAIL_CONFIRMATION_RESEND_WAIT_MS,
  runAuthOperationWithTimeout,
} from '@/lib/auth/frontend-auth-reliability';

export function useEmailConfirmationResend() {
  const [isResending, setIsResending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function clearFeedback() {
    setMessage(null);
    setError(null);
  }

  async function resend(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    clearFeedback();

    if (!normalizedEmail) {
      setError('Informe o e-mail do cadastro para receber um novo link.');
      return;
    }

    setIsResending(true);
    try {
      const resendResult = await runAuthOperationWithTimeout(
        () => authAPI.resendSignupEmailConfirmation(normalizedEmail),
        EMAIL_CONFIRMATION_RESEND_WAIT_MS,
      );

      if (resendResult.status === 'timed_out') {
        setError('O reenvio demorou mais que o esperado. Verifique sua conexão e tente novamente.');
        return;
      }

      if (resendResult.status === 'failed') throw resendResult.error;

      const result = resendResult.value;
      if (result.status < 200 || result.status >= 300 || !result.ok) {
        setError(result.message);
        return;
      }

      setMessage(result.message);
    } catch {
      setError('Não foi possível solicitar outro e-mail agora.');
    } finally {
      setIsResending(false);
    }
  }

  return { isResending, message, error, clearFeedback, resend };
}
