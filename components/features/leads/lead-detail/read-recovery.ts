import { hasVerifiedLeadReadInCache, type VerifiedLeadRead } from '@/lib/lead-read-snapshot';

type ReadLead = { id?: string; organization_id?: string | null; can_operate?: boolean };
type ReadQuery = {
  data?: ReadLead | null;
  dataUpdatedAt?: number;
  isSuccess: boolean;
  isFetching: boolean;
  isFetchedAfterMount: boolean;
  isError: boolean;
  error?: unknown;
};

export type LeadDetailReadState = {
  kind: 'ready' | 'refreshing' | 'error' | 'unavailable';
  hideDetails: boolean;
  message: string;
  blockedReason: string | undefined;
  canRetry: boolean;
  retrying: boolean;
};

export function getLeadDetailReadState({ leadId, organizationId, leadOrganizationId, query, verifiedRead }: {
  leadId: string | null;
  organizationId?: string | null;
  leadOrganizationId?: string | null;
  query: ReadQuery;
  verifiedRead?: VerifiedLeadRead;
}): LeadDetailReadState {
  const expectedScope = Boolean(leadId && organizationId && leadOrganizationId === organizationId);
  const wrongSnapshot = Boolean(query.data && (
    query.data.id !== leadId || query.data.organization_id !== organizationId
  ));
  const status = typeof query.error === 'object' && query.error !== null && 'status' in query.error
    ? query.error.status : undefined;
  const denied = status === 401 || status === 403 || status === 404;
  const missingLead = query.isSuccess && query.data === null;
  if (!expectedScope || wrongSnapshot || denied || missingLead) {
    const message = 'Não foi possível confirmar o acesso a este lead. Os dados e as ações estão ocultos.';
    return { kind: 'unavailable', hideDetails: true, message, blockedReason: message,
      canRetry: expectedScope, retrying: query.isFetching };
  }
  if (query.isError) {
    const message = 'Não foi possível atualizar o lead. As ações estão pausadas; seus rascunhos continuam nesta janela.';
    return { kind: 'error', hideDetails: false, message, blockedReason: message,
      canRetry: true, retrying: query.isFetching };
  }
  const confirmed = query.isFetchedAfterMount || hasVerifiedLeadReadInCache(verifiedRead, {
    data: query.data, dataUpdatedAt: query.dataUpdatedAt, organizationId, leadId,
  });
  if (query.isFetching || !query.isSuccess || !confirmed) {
    const message = 'Atualizando o lead. Aguarde a confirmação do acesso para registrar alterações.';
    return { kind: 'refreshing', hideDetails: false, message, blockedReason: message,
      canRetry: false, retrying: query.isFetching };
  }
  if (typeof query.data?.can_operate !== 'boolean') {
    const message = 'Não foi possível confirmar as ações disponíveis. Tente atualizar o lead.';
    return { kind: 'error', hideDetails: false, message, blockedReason: message,
      canRetry: true, retrying: false };
  }
  return { kind: 'ready', hideDetails: false, message: '', canRetry: false, retrying: false,
    blockedReason: query.data.can_operate ? undefined : 'Seu acesso a este lead permite apenas visualização.' };
}
