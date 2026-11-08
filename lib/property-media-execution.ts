export type PropertyMediaExecutionOptions = {
  expectedUserId?: string;
  expectedSessionId?: string | null;
  canContinue?: () => boolean;
};

export class PropertyMediaScopeChangedError extends Error {
  constructor() {
    super('A sessão ou organização do formulário mudou. Confira o imóvel na organização original antes de reenviar as fotos.');
    this.name = 'PropertyMediaScopeChangedError';
  }
}

export function assertPropertyMediaExecution(options?: PropertyMediaExecutionOptions) {
  if (options?.canContinue && !options.canContinue()) throw new PropertyMediaScopeChangedError();
}

/**
 * Only failures that say nothing about the file are worth repeating. A new upload
 * attempt is safe because it uses a new reservation and a new Storage path.
 */
export function isTransientPropertyUploadFailure(error: unknown) {
  if (!error || typeof error !== 'object' || error instanceof PropertyMediaScopeChangedError) return false;
  const { status, code, transient } = error as { status?: unknown; code?: unknown; transient?: unknown };
  if (transient === true || code === 'api_timeout' || code === 'api_unavailable') return true;
  return typeof status === 'number' && (status === 408 || status === 429 || status >= 500);
}
