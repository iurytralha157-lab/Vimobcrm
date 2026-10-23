import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { leadFeedbackAPI } from '@/lib/api/lead-feedback';
import type { LeadFeedbackCommand } from '@/lib/validation/lead-feedback';
import { useLeadRequestScope } from '@/hooks/leads/use-lead-request-scope';
import { invalidateLeadHistorySoon } from '@/hooks/use-optimistic-lead-history';
import { notifyLeadRealtimeChange } from '@/contexts/LeadRealtimeBus';
import { enforceClientActionRateLimit, getClientRateLimitMessage } from '@/lib/client-action-rate-limit';

type Submission = LeadFeedbackCommand & { leadId: string };

export function useRecordLeadFeedback() {
  const client = useQueryClient();
  const scope = useLeadRequestScope();
  return useMutation({
    retry: false,
    onMutate: (input: Submission) => scope.bind(input),
    mutationFn: (input: Submission) => {
      const operation = scope.require(input);
      enforceClientActionRateLimit(`lead:feedback:${operation.userId}:${input.leadId}`, [
        { limit: 2, windowMs: 1000 }, { limit: 30, windowMs: 60_000 },
      ]);
      return leadFeedbackAPI.record(input.leadId, { commandId: input.commandId, content: input.content },
        operation.organizationId, operation.intent);
    },
    onSuccess: (_receipt, input, operation) => {
      if (!operation) return;
      const refetchType = operation.isCurrent() ? 'active' as const : 'none' as const;
      void Promise.all([
        client.invalidateQueries({ queryKey: ['lead', operation.organizationId, input.leadId], refetchType }),
        ...['leads', 'contacts-list', 'stages-with-leads'].map(family =>
          client.invalidateQueries({ queryKey: [family, operation.organizationId], refetchType })),
        client.invalidateQueries({ queryKey: ['activities'], refetchType }),
      ]).catch(() => { /* A failed refresh does not undo an acknowledged command. */ });
      invalidateLeadHistorySoon(client, input.leadId);
      if (operation.isCurrent()) notifyLeadRealtimeChange({ organizationId: operation.organizationId,
        leadId: input.leadId, reason: 'lead.updated' });
    },
    onError: (error, input, operation) => {
      if (!scope.isCurrent(operation || scope.contextFor(input))) return;
      const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
      const rateLimit = getClientRateLimitMessage(error);
      toast.error(rateLimit || (status === 404 || status === 503
        ? 'O registro seguro de feedback está indisponível neste ambiente. Seu rascunho foi mantido.'
        : `Não foi possível registrar o feedback: ${error.message}`));
    },
    onSettled: (_receipt, _error, input) => scope.release(input),
  });
}
