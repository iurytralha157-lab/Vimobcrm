'use client';

import { useQuery, useQueryClient, type Query } from '@tanstack/react-query';
import { createUUID } from '@/lib/client-id';
import { useLeadDetailOperationScope } from '@/hooks/leads/use-lead-detail-operation-scope';

export type LeadAttachmentUploadDraft = {
  file: File;
  phase: 'pending' | 'unconfirmed';
  operationId: string;
};
type Receipt = { query: Query; operationId: string };

/** File/command identity survives closing the popup, inside its access-scoped client. */
export function useLeadAttachmentUploadDraft(organizationId: string | null, leadId: string | null,
  actorId: string | null, sessionId: string | null) {
  const client = useQueryClient();
  const captureAction = useLeadDetailOperationScope(leadId, organizationId, actorId, client, true, sessionId);
  const key = ['lead-attachment-upload-draft', organizationId, actorId, sessionId, leadId] as const;
  const { data: draft } = useQuery<LeadAttachmentUploadDraft | null>({
    queryKey: key, queryFn: () => null, initialData: null, enabled: false, gcTime: 30 * 60_000,
  });
  const owns = (receipt: Receipt) => client.getQueryCache().find({ queryKey: receipt.query.queryKey, exact: true }) === receipt.query &&
    client.getQueryData<LeadAttachmentUploadDraft>(receipt.query.queryKey)?.operationId === receipt.operationId;
  const begin = (file: File): Receipt | null => {
    captureAction();
    if (!organizationId || !leadId || !actorId || !sessionId) throw new Error('Confirme seu acesso antes de enviar o documento.');
    const query = client.getQueryCache().find({ queryKey: key, exact: true });
    if (!query) throw new Error('Reabra o lead antes de enviar o documento.');
    const previous = client.getQueryData<LeadAttachmentUploadDraft | null>(key);
    if (previous?.phase === 'pending') return null;
    if (previous && previous.file !== file) throw new Error('Verifique ou encerre a tentativa anterior antes de selecionar outro documento.');
    const operationId = createUUID();
    client.setQueryData<LeadAttachmentUploadDraft>(key, { file, phase: 'pending', operationId });
    return { query, operationId };
  };
  const acknowledge = (receipt: Receipt) => {
    if (owns(receipt)) client.setQueryData(receipt.query.queryKey, null);
  };
  const retain = (receipt: Receipt) => {
    if (owns(receipt)) client.setQueryData<LeadAttachmentUploadDraft>(receipt.query.queryKey,
      current => current ? { ...current, phase: 'unconfirmed' } : current);
  };
  const clear = () => {
    try { captureAction(); } catch { return; }
    const current = client.getQueryData<LeadAttachmentUploadDraft | null>(key);
    if (current && current.phase !== 'pending') client.setQueryData(key, null);
  };
  return { draft, begin, acknowledge, retain, clear };
}
