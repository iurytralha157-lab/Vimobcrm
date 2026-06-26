import { auditAPI } from "@/lib/api/audit";
/**
 * Hook para logging de eventos de segurança
 * Registra:
 * - Tentativas de login falhadas
 * - Tentativas bem-sucedidas
 * - Bloqueios por brute force
 * - Resets de senha
 * - Acessos à página
 */

export type SecurityEventType =
  | 'login_attempt_failed'
  | 'login_attempt_success'
  | 'login_brute_force_lockout'
  | 'password_reset_requested'
  | 'password_reset_success'
  | 'page_access'
  | 'invalid_credentials'
  | 'validation_error';

export interface SecurityEvent {
  type: SecurityEventType;
  timestamp: string;
  email?: string;
  userAgent: string;
  ipHint?: string; // Aproximado do browser
  details?: Record<string, unknown>;
}

export function useSecurityLogger() {
  // Log em localStorage para análise posterior
  const logEvent = (event: Omit<SecurityEvent, 'timestamp' | 'userAgent'>) => {
    const securityEvent: SecurityEvent = {
      ...event,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
    };

    // Armazenar em localStorage (máximo 50 eventos)
    const logs = localStorage.getItem('security_logs');
    const logArray: SecurityEvent[] = logs ? JSON.parse(logs) : [];

    logArray.push(securityEvent);

    // Manter apenas os últimos 50 eventos
    if (logArray.length > 50) {
      logArray.shift();
    }

    localStorage.setItem('security_logs', JSON.stringify(logArray));

    // Log no console em desenvolvimento
    if (process.env.NODE_ENV === 'development') {
      console.log('[Security]', event.type, securityEvent);
    }

    // Em produção ou se quisermos persistência, enviar para tabela audit_logs
    const syncWithServer = async () => {
      try {
        const isAuthPage = window.location.pathname === '/login' || window.location.pathname === '/cadastro';
        if (isAuthPage) {
          return;
        }

        await auditAPI.create({
          action: event.type,
          entity_type: 'security_event',
          new_data: {
            email: event.email,
            details: event.details,
            ipHint: event.ipHint
          },
          user_agent: navigator.userAgent,
        });
      } catch (err) {
        console.error('[Security] Failed to sync log with server:', err);
      }
    };

    syncWithServer();
  };

  // Funções de conveniência
  const logLoginAttempt = (email: string, success: boolean, error?: string) => {
    logEvent({
      type: success ? 'login_attempt_success' : 'login_attempt_failed',
      email,
      details: { error },
    });
  };

  const logBruteForce = (email: string, attempts: number) => {
    logEvent({
      type: 'login_brute_force_lockout',
      email,
      details: { attempts, lockoutDuration: '15 minutos' },
    });
  };

  const logPasswordResetRequest = (email: string) => {
    logEvent({
      type: 'password_reset_requested',
      email,
    });
  };

  const logValidationError = (field: string, error: string) => {
    logEvent({
      type: 'validation_error',
      details: { field, error },
    });
  };

  const logPageAccess = () => {
    logEvent({
      type: 'page_access',
      details: { page: 'login' },
    });
  };

  // Obter todos os logs
  const getLogs = (): SecurityEvent[] => {
    const logs = localStorage.getItem('security_logs');
    return logs ? JSON.parse(logs) : [];
  };

  // Obter logs de um email específico
  const getLogsForEmail = (email: string): SecurityEvent[] => {
    return getLogs().filter(log => log.email === email);
  };

  // Limpar logs
  const clearLogs = () => {
    localStorage.removeItem('security_logs');
  };

  return {
    logEvent,
    logLoginAttempt,
    logBruteForce,
    logPasswordResetRequest,
    logValidationError,
    logPageAccess,
    getLogs,
    getLogsForEmail,
    clearLogs,
  };
}
