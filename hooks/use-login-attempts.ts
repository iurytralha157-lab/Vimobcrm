import { useEffect, useState } from 'react';

const MAX_ATTEMPTS = 5;
const ATTEMPT_RESET_TIME = 60 * 1000; // 1 minuto
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutos
const DELAYS = [0, 1000, 2000, 5000, 10000]; // Delay progressivo em ms

interface LoginAttempts {
  count: number;
  timestamp: number;
  isLocked: boolean;
  lockoutUntil?: number;
  lastDelay: number;
}

function createEmptyAttempts(timestamp: number): LoginAttempts {
  return {
    count: 0,
    timestamp,
    isLocked: false,
    lastDelay: 0,
  };
}

/**
 * Hook para gerenciar proteção contra brute force
 * Rastreia tentativas de login falhadas com:
 * - Limite de tentativas (5 por minuto)
 * - Delay progressivo entre tentativas
 * - Lockout temporário (15 minutos)
 */
export function useLoginAttempts() {
  const [now, setNow] = useState(() => Date.now());
  const [attempts, setAttempts] = useState<LoginAttempts>(() => {
    const stored = localStorage.getItem('login_attempts');
    return stored ? JSON.parse(stored) : createEmptyAttempts(Date.now());
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Sincronizar estado com localStorage
  useEffect(() => {
    localStorage.setItem('login_attempts', JSON.stringify(attempts));
  }, [attempts]);

  const lockoutExpired = Boolean(attempts.isLocked && attempts.lockoutUntil && now > attempts.lockoutUntil);
  const locked = attempts.isLocked && !lockoutExpired;
  const timeSinceFirstAttempt = now - attempts.timestamp;
  const effectiveAttemptCount = lockoutExpired || timeSinceFirstAttempt > ATTEMPT_RESET_TIME ? 0 : attempts.count;

  // Obter tempo restante de lockout
  const getRemainingLockoutTime = () => {
    if (!attempts.lockoutUntil) return 0;
    const remaining = attempts.lockoutUntil - now;
    return Math.max(0, remaining);
  };

  // Obter delay antes de permitir próxima tentativa
  const getNextAttemptDelay = () => {
    // Se passou o tempo de reset, zera
    if (timeSinceFirstAttempt > ATTEMPT_RESET_TIME) {
      return 0;
    }

    // Retorna o delay progressivo baseado no número de tentativas
    return DELAYS[Math.min(effectiveAttemptCount, DELAYS.length - 1)];
  };

  // Registrar tentativa falha
  const recordFailedAttempt = () => {
    const now = Date.now();
    const timeSinceFirstAttempt = now - attempts.timestamp;

    // Se passou time de reset, reinicia contador
    if (timeSinceFirstAttempt > ATTEMPT_RESET_TIME) {
      setAttempts({
        count: 1,
        timestamp: now,
        isLocked: false,
        lastDelay: DELAYS[0],
      });
      return;
    }

    const newCount = attempts.count + 1;
    const isNowLocked = newCount >= MAX_ATTEMPTS;

    setAttempts({
      count: newCount,
      timestamp: attempts.timestamp,
      isLocked: isNowLocked,
      lockoutUntil: isNowLocked ? now + LOCKOUT_DURATION : undefined,
      lastDelay: DELAYS[Math.min(newCount, DELAYS.length - 1)],
    });
  };

  // Registrar tentativa bem-sucedida (limpar)
  const resetOnSuccess = () => {
    const timestamp = Date.now();
    localStorage.removeItem('login_attempts');
    setNow(timestamp);
    setAttempts(createEmptyAttempts(timestamp));
  };

  // Reset manual
  const reset = () => {
    const timestamp = Date.now();
    localStorage.removeItem('login_attempts');
    setNow(timestamp);
    setAttempts(createEmptyAttempts(timestamp));
  };

  return {
    isLocked: locked,
    attemptCount: effectiveAttemptCount,
    isLockedOut: locked,
    remainingLockoutTime: getRemainingLockoutTime(),
    nextAttemptDelay: getNextAttemptDelay(),
    recordFailedAttempt,
    resetOnSuccess,
    reset,
    canAttempt: !locked && effectiveAttemptCount < MAX_ATTEMPTS,
  };
}
