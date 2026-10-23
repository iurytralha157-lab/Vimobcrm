import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { enforceClientActionRateLimit, getClientRateLimitMessage } from '@/lib/client-action-rate-limit';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { leadAttachmentsAPI, type LeadAttachment } from '@/lib/api/lead-attachments';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';
import type { VimobAPIRequestIntent } from '@/lib/api/vimob-client';

export type { LeadAttachment } from '@/lib/api/lead-attachments';

function upsertAttachment(current: LeadAttachment[] | undefined, attachment: LeadAttachment) {
  const attachments = Array.isArray(current) ? current : [];
  return [attachment, ...attachments.filter((item) => item.id !== attachment.id)];
}

const attachmentQueryKey = (organizationId: string | null, leadId: string) =>
  ['lead-attachments', organizationId || 'none', leadId] as const;

function useAttachmentRequestScope() {
  const { activeOrganization, user, session } = useAuth();
  const organizationId = activeOrganization.organizationId || null;
  const userId = user?.id;
  const sessionId = getGlobalSignOutSessionId(session);
  const controllerRef = useRef<{ organizationId: string | null; userId: string | undefined; sessionId: string | null; controller: AbortController } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = { organizationId, userId, sessionId, controller };
    return () => controller.abort();
  }, [organizationId, userId, sessionId]);
  const intent = () => {
    const current = controllerRef.current;
    const controller = current?.controller;
    if (!organizationId || !userId || !sessionId || !controller || controller.signal.aborted || current?.organizationId !== organizationId || current?.userId !== userId || current?.sessionId !== sessionId) throw new Error('A sessão de envio foi encerrada. Reabra o contato.');
    return { expectedUserId: userId, expectedSessionId: sessionId, signal: controller.signal };
  };
  const isCurrent = (captured?: VimobAPIRequestIntent) => {
    const current = controllerRef.current;
    return Boolean(captured && current && !current.controller.signal.aborted &&
      captured.signal === current.controller.signal && current.organizationId === organizationId &&
      current.userId === userId && current.sessionId === sessionId);
  };
  return { organizationId, userId, sessionId, intent, isCurrent };
}

export function useLeadAttachments(leadId: string | null) {
  const { activeOrganization, user, session } = useAuth();
  const organizationId = activeOrganization.organizationId || null;

  return useQuery({
    queryKey: attachmentQueryKey(organizationId, leadId || 'none'),
    queryFn: async ({ signal }) => {
      if (!leadId) return [];
      return leadAttachmentsAPI.list(leadId, organizationId, { expectedUserId: user?.id, expectedSessionId: getGlobalSignOutSessionId(session), signal }, { metadataOnly: true });
    },
    enabled: !!leadId && !!organizationId && !!user?.id && !!getGlobalSignOutSessionId(session),
    refetchOnMount: 'always',
  });
}

/** Sign only the selected document, reauthorizing each viewer visit. */
export function useLeadAttachmentAccess(attachment: LeadAttachment | null, open: boolean) {
  const { activeOrganization, user, session } = useAuth();
  const client = useQueryClient();
  const organizationId = activeOrganization.organizationId || null;
  const actorId = user?.id || null;
  const sessionId = getGlobalSignOutSessionId(session);
  const leadId = attachment?.lead_id || null;
  const attachmentId = attachment?.id || null;
  const key = useMemo(() => ['lead-attachment-access', organizationId, actorId, sessionId, leadId, attachmentId] as const,
    [organizationId, actorId, sessionId, leadId, attachmentId]);
  const enabled = Boolean(open && organizationId && actorId && sessionId && leadId && attachmentId);
  const query = useQuery({
    queryKey: key, enabled, retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always',
    queryFn: ({ signal }) => {
      if (!enabled || !leadId || !attachmentId) throw new Error('Reabra o documento para confirmar seu acesso.');
      return leadAttachmentsAPI.access(leadId, attachmentId, organizationId,
        { expectedUserId: actorId || undefined, expectedSessionId: sessionId, signal });
    },
  });
  const cancel = () => { void client.cancelQueries({ queryKey: key, exact: true }); };
  useEffect(() => {
    if (!open) void client.cancelQueries({ queryKey: key, exact: true });
  }, [client, key, open]);
  useEffect(() => () => { void client.cancelQueries({ queryKey: key, exact: true }); }, [client, key]);
  return { ...query, cancel, authorizedAttachment: enabled && query.isSuccess && !query.isFetching ? query.data : null };
}

export function useCreateLeadAttachment() {
  const queryClient = useQueryClient();
  const { organizationId, userId, intent } = useAttachmentRequestScope();

  return useMutation({
    mutationFn: async (attachment: {
      lead_id: string;
      file_name: string;
      file_url: string;
      file_type?: string;
      file_size?: number;
      message_id?: string;
    }) => {
      const requestIntent = intent();
      enforceClientActionRateLimit(`lead:attachment:create:${userId}:${attachment.lead_id}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 20, windowMs: 60_000 },
      ]);

      if (!organizationId) throw new Error('Organização não selecionada');
      return leadAttachmentsAPI.create(attachment, organizationId, requestIntent);
    },
    onSuccess: (data: LeadAttachment, variables) => {
      queryClient.setQueryData<LeadAttachment[]>(attachmentQueryKey(organizationId, variables.lead_id), (current) =>
        upsertAttachment(current, data)
      );
      queryClient.invalidateQueries({ queryKey: attachmentQueryKey(organizationId, variables.lead_id) });
      queryClient.invalidateQueries({ queryKey: ['activities', variables.lead_id] });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['recent-activities'] });
      queryClient.invalidateQueries({ queryKey: ['lead-history-v2', variables.lead_id] });
      if (data?.lead_id && data.lead_id !== variables.lead_id) {
        queryClient.setQueryData<LeadAttachment[]>(attachmentQueryKey(organizationId, data.lead_id), (current) =>
          upsertAttachment(current, data)
        );
        queryClient.invalidateQueries({ queryKey: attachmentQueryKey(organizationId, data.lead_id) });
      }
      if (data.availability === 'signing_unavailable') toast.warning('Documento anexado. A prévia está temporariamente indisponível; atualize os documentos para tentar novamente.');
      else toast.success('Documento anexado com sucesso!');
    },
    onError: (error) => {
      console.error('Error creating attachment:', error);
      const rateLimitMessage = getClientRateLimitMessage(error);
      toast.error(rateLimitMessage || 'Erro ao anexar documento');
    }
  });
}

export function useUploadLeadAttachment({ notifyOnError = true }: { notifyOnError?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { organizationId, userId, intent, isCurrent } = useAttachmentRequestScope();

  return useMutation({
    onMutate: ({ leadId }: { leadId: string; file: File }) => ({
      operation: intent(), query: queryClient.getQueryCache().find({ queryKey: attachmentQueryKey(organizationId, leadId), exact: true }),
    }),
    mutationFn: async ({ leadId, file }: { leadId: string; file: File }) => {
      const requestIntent = intent();
      enforceClientActionRateLimit(`lead:attachment:upload:${userId}:${leadId}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 20, windowMs: 60_000 },
      ]);

      if (!organizationId) throw new Error('Organização não selecionada');
      return leadAttachmentsAPI.upload(leadId, file, organizationId, requestIntent);
    },
    onSuccess: (data: LeadAttachment, variables, context) => {
      const key = attachmentQueryKey(organizationId, variables.leadId);
      const queryExists = context?.query && queryClient.getQueryCache().find({ queryKey: key, exact: true }) === context.query;
      if (!isCurrent(context?.operation)) {
        if (queryExists) void queryClient.invalidateQueries({ queryKey: key, exact: true, refetchType: 'none' });
        return;
      }
      if (queryExists) queryClient.setQueryData<LeadAttachment[]>(key, (current) => upsertAttachment(current, data));
      queryClient.invalidateQueries({ queryKey: attachmentQueryKey(organizationId, variables.leadId) });
      queryClient.invalidateQueries({ queryKey: ['activities', variables.leadId] });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['recent-activities'] });
      queryClient.invalidateQueries({ queryKey: ['lead-history-v2', variables.leadId] });
      if (data?.lead_id && data.lead_id !== variables.leadId) {
        queryClient.setQueryData<LeadAttachment[]>(attachmentQueryKey(organizationId, data.lead_id), (current) =>
          upsertAttachment(current, data)
        );
        queryClient.invalidateQueries({ queryKey: attachmentQueryKey(organizationId, data.lead_id) });
      }
    },
    onError: (error, variables, context) => {
      const key = attachmentQueryKey(organizationId, variables.leadId);
      if (context?.query && queryClient.getQueryCache().find({ queryKey: key, exact: true }) === context.query) {
        void queryClient.invalidateQueries({ queryKey: key, exact: true, refetchType: isCurrent(context.operation) ? 'active' : 'none' })
          .catch(() => { /* Preserve the pending File/command when reconciliation also fails. */ });
      }
      if (!isCurrent(context?.operation)) return;
      if (!notifyOnError) return;
      console.error('Error uploading attachment:', error);
      const rateLimitMessage = getClientRateLimitMessage(error);
      toast.error(rateLimitMessage || 'Erro ao enviar documento');
    },
  });
}
