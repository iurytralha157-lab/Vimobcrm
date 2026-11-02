export const PASSWORD_RECOVERY_REQUEST_COOLDOWN_MS = 60_000;

export const PASSWORD_RECOVERY_REQUEST_NOTICE =
  'Se existir uma conta com esse e-mail, você poderá receber um link de recuperação. Não é possível confirmar o envio por aqui. Aguarde antes de tentar novamente.';
export const PASSWORD_RECOVERY_REQUEST_UNCONFIRMED_NOTICE =
  'Não foi possível confirmar a solicitação a tempo. O envio ainda pode estar em andamento. Aguarde antes de tentar novamente.';
export const PASSWORD_RECOVERY_REQUEST_PENDING_NOTICE =
  'Uma solicitação de recuperação ainda está em andamento. Aguarde sua conclusão antes de tentar novamente.';

type RecoveryRequestSnapshot = Readonly<{
  pending: boolean;
  cooldownUntil: number;
  remainingSeconds: number;
}>;

const INITIAL_SNAPSHOT: RecoveryRequestSnapshot = Object.freeze({
  pending: false,
  cooldownUntil: 0,
  remainingSeconds: 0,
});

/** Tab-local coordination only: no email, credential, provider error or storage. */
export function createPasswordRecoveryRequestCoordinator({ now = Date.now }: { now?: () => number } = {}) {
  let current: symbol | null = null;
  let cooldownUntil = 0;
  let snapshot = INITIAL_SNAPSHOT;
  const listeners = new Set<() => void>();

  function publish() {
    if (cooldownUntil && now() >= cooldownUntil) cooldownUntil = 0;
    const pending = current !== null;
    const remainingSeconds = Math.max(0, Math.ceil((cooldownUntil - now()) / 1000));
    if (snapshot.pending === pending && snapshot.cooldownUntil === cooldownUntil &&
      snapshot.remainingSeconds === remainingSeconds) return;
    snapshot = { pending, cooldownUntil, remainingSeconds };
    listeners.forEach(listener => listener());
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => INITIAL_SNAPSHOT,
    tick: publish,
    start(operation: () => PromiseLike<unknown>) {
      if (current !== null || now() < cooldownUntil) return null;
      const attempt = Symbol('password-recovery-request');
      current = attempt;
      cooldownUntil = now() + PASSWORD_RECOVERY_REQUEST_COOLDOWN_MS;
      publish();

      // An AuthError can depend on account existence. Keep every completed
      // attempt indistinguishable publicly; neither a 2xx nor an error proves
      // mailbox delivery. The real promise owns the lock, not the UI timeout.
      const settled = Promise.resolve().then(operation).then(
        () => undefined,
        () => undefined,
      ).finally(() => {
        if (current !== attempt) return;
        current = null;
        publish();
      });
      return { attempt, settled };
    },
  };
}

// Survives a LoginForm unmount/remount in this tab while an SDK request remains
// pending. Server-side rate limits remain the actual abuse protection.
export const passwordRecoveryRequests = createPasswordRecoveryRequestCoordinator();
export type PasswordRecoveryRequestCoordinator = ReturnType<typeof createPasswordRecoveryRequestCoordinator>;
