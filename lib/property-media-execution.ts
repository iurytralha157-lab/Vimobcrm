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
