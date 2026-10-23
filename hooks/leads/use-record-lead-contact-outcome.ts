import { useMutation, useQueryClient } from '@tanstack/react-query';
import { leadContactOutcomesAPI } from '@/lib/api/lead-contact-outcomes';
import type { LeadContactOutcomeCommand } from '@/lib/validation/lead-contact-outcomes';
import { useLeadRequestScope } from '@/hooks/leads/use-lead-request-scope';
import { notifyLeadRealtimeChange } from '@/contexts/LeadRealtimeBus';

type Submission = LeadContactOutcomeCommand & { leadId: string };

export function useRecordLeadContactOutcome() {
  const client = useQueryClient();
  const scope = useLeadRequestScope();
  return useMutation({
    retry: false,
    onMutate: (input: Submission) => scope.bind(input),
    mutationFn: (input: Submission) => {
      const operation = scope.require(input);
      const { leadId, ...command } = input;
      return leadContactOutcomesAPI.record(leadId, command, operation.organizationId, {
        ...operation.intent, signal: undefined,
        onRequestStart: () => { if (!operation.isCurrent()) throw new DOMException('O acesso foi encerrado.', 'AbortError'); },
      });
    },
    onSuccess: (_receipt, input, operation) => {
      if (!operation?.canReconcileCapturedAccess()) return;
      const refetchType = operation.isCurrent() ? 'active' as const : 'none' as const;
      void Promise.all([
        client.invalidateQueries({ queryKey: ['activities'], refetchType }),
        client.invalidateQueries({ queryKey: ['recent-activities'], refetchType }),
        client.invalidateQueries({ queryKey: ['lead-history-v2', input.leadId], refetchType }),
      ]).catch(() => { /* A refresh never changes a confirmed command. */ });
      if (operation.isCurrent()) notifyLeadRealtimeChange({ organizationId: operation.organizationId,
        leadId: input.leadId, reason: 'lead.updated' });
    },
    // The owning card/dialog publishes the scoped error and retains its command.
    onSettled: (_receipt, _error, input) => scope.release(input),
  });
}
