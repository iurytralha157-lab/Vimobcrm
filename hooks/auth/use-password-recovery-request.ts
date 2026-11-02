'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { resetPasswordSchema } from '@/lib/validation';
import { PASSWORD_RECOVERY_REQUEST_WAIT_MS, runAuthOperationWithTimeout } from '@/lib/auth/frontend-auth-reliability';
import {
  PASSWORD_RECOVERY_REQUEST_NOTICE,
  PASSWORD_RECOVERY_REQUEST_PENDING_NOTICE,
  PASSWORD_RECOVERY_REQUEST_UNCONFIRMED_NOTICE,
  passwordRecoveryRequests,
  type PasswordRecoveryRequestCoordinator,
} from '@/lib/auth/password-recovery-request';

type Options = {
  active: boolean;
  email: string;
  request: (email: string) => PromiseLike<unknown>;
  coordinator?: PasswordRecoveryRequestCoordinator;
};

type Feedback = {
  context: object;
  status: 'sending' | 'requested' | 'unconfirmed' | 'invalid';
  error?: string;
};

export function usePasswordRecoveryRequest({ active, email, request, coordinator = passwordRecoveryRequests }: Options) {
  const normalizedEmail = email.trim().toLowerCase();
  // Identity changes even for A -> B -> A; an old completion cannot become
  // current again merely because the same address or form mode reappeared.
  const context = useMemo(() => ({ active, normalizedEmail }), [active, normalizedEmail]);
  const lifecycle = useRef<{ context: object } | null>(null);
  const latestAttempt = useRef<symbol | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const snapshot = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getServerSnapshot);

  useLayoutEffect(() => {
    const visit = { context };
    lifecycle.current = visit;
    coordinator.tick();
    return () => { if (lifecycle.current === visit) lifecycle.current = null; };
  }, [context, coordinator]);

  useEffect(() => {
    if (!active || !snapshot.cooldownUntil) return;
    const timer = window.setInterval(coordinator.tick, 1000);
    return () => window.clearInterval(timer);
  }, [active, coordinator, snapshot.cooldownUntil]);

  async function submit() {
    const visit = lifecycle.current;
    if (!active || !visit || visit.context !== context) return;
    const validated = resetPasswordSchema.safeParse({ email: normalizedEmail });
    if (!validated.success) {
      setFeedback({ context, status: 'invalid', error: 'Informe um e-mail válido para solicitar a recuperação.' });
      return;
    }

    const ticket = coordinator.start(() => request(validated.data.email));
    if (!ticket) return;
    latestAttempt.current = ticket.attempt;
    setFeedback({ context, status: 'sending' });
    const isCurrent = () => lifecycle.current === visit && latestAttempt.current === ticket.attempt;
    const result = await runAuthOperationWithTimeout(() => ticket.settled, PASSWORD_RECOVERY_REQUEST_WAIT_MS);
    if (!isCurrent()) return;
    setFeedback({ context, status: result.status === 'completed' ? 'requested' : 'unconfirmed' });
  }

  function invalidate() {
    // Event handlers invalidate before React commits the new mode/email.
    latestAttempt.current = null;
    setFeedback(null);
  }

  const currentFeedback = feedback?.context === context ? feedback : null;
  const isSubmitting = currentFeedback?.status === 'sending';
  const message = currentFeedback?.status === 'requested'
    ? PASSWORD_RECOVERY_REQUEST_NOTICE
    : currentFeedback?.status === 'unconfirmed'
      ? PASSWORD_RECOVERY_REQUEST_UNCONFIRMED_NOTICE
      : snapshot.pending && !isSubmitting ? PASSWORD_RECOVERY_REQUEST_PENDING_NOTICE : null;

  return {
    submit,
    invalidate,
    isSubmitting,
    pending: snapshot.pending,
    blocked: snapshot.pending || snapshot.remainingSeconds > 0,
    remainingSeconds: snapshot.remainingSeconds,
    message,
    error: currentFeedback?.error ?? null,
  };
}
