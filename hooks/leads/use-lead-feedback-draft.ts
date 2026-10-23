'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createUUID } from '@/lib/client-id';
import type { LeadFeedbackCommand } from '@/lib/validation/lead-feedback';

// Lives in the existing access-scoped QueryClient, never in browser storage.
export function useLeadFeedbackDraft(organizationId: string | null, leadId: string | null, actorId?: string | null) {
  const client = useQueryClient();
  const { data: draft } = useQuery({
    queryKey: ['lead-feedback-draft', organizationId, leadId],
    queryFn: () => '',
    initialData: '',
    enabled: false,
    gcTime: 30 * 60 * 1000,
  });
  const commandKey = ['lead-feedback-command', organizationId, actorId, leadId] as const;
  useQuery<LeadFeedbackCommand | null>({ queryKey: commandKey, queryFn: () => null,
    initialData: null, enabled: false, gcTime: 30 * 60 * 1000 });

  const getSubmission = (submitted: string): LeadFeedbackCommand => {
    if (!organizationId || !leadId || !actorId) throw new Error('Confirme seu acesso antes de registrar o feedback.');
    const content = submitted.trim();
    const pending = client.getQueryData<LeadFeedbackCommand | null>(commandKey);
    if (pending?.content === content) return pending;
    const next = { commandId: createUUID(), content };
    client.setQueryData(commandKey, next);
    return next;
  };

  const updateDraft = useCallback((value: string) => {
    if (!organizationId || !leadId) return;
    client.setQueryData(['lead-feedback-draft', organizationId, leadId], value);
  }, [client, organizationId, leadId]);

  const acknowledgeSavedDraft = useCallback((submitted: string, commandId?: string) => {
    const key = ['lead-feedback-draft', organizationId, leadId];
    // A completed request must not erase text typed after submission.
    if (client.getQueryData<string>(key) === submitted) {
      client.setQueryData(key, '');
    }
    const receiptKey = ['lead-feedback-command', organizationId, actorId, leadId];
    if (commandId && client.getQueryData<LeadFeedbackCommand | null>(receiptKey)?.commandId === commandId) {
      client.setQueryData(receiptKey, null);
    }
  }, [client, organizationId, leadId, actorId]);

  return { draft, updateDraft, acknowledgeSavedDraft, getSubmission };
}
