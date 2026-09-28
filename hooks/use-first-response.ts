import { useMutation, useQueryClient } from '@tanstack/react-query';
import { leadsAPI } from '@/lib/api/leads';

interface RecordFirstResponseParams {
  leadId: string;
  organizationId: string;
  channel: 'whatsapp' | 'phone' | 'email';
  actorUserId: string | null;
  isAutomation?: boolean;
}

/**
 * Hook para registrar a primeira resposta de um lead.
 * Chama a edge function calculate-first-response.
 */
export function useRecordFirstResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: RecordFirstResponseParams) => {
      return leadsAPI.recordFirstResponse(params.leadId, {
        organizationId: params.organizationId,
        channel: params.channel,
        actorUserId: params.actorUserId,
        isAutomation: params.isAutomation,
      });
    },
    onSuccess: (result, params) => {
      if (result.recorded !== true) return;
      void queryClient.invalidateQueries({ queryKey: ['lead-history-v2', params.leadId] });
      void queryClient.invalidateQueries({ queryKey: ['lead'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-first-contact'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-first-contact-leads'] });
    },
  });
}

interface CheckAndRecordParams {
  leadId: string;
  organizationId: string;
  channel: 'whatsapp' | 'phone' | 'email';
  actorUserId: string | null;
  firstResponseAt?: string | null;
  firstResponseIsAutomation?: boolean | null;
}

/**
 * A API decide de forma atômica se é a primeira resposta humana. Uma resposta
 * automática anterior não impede o primeiro contato feito pelo corretor.
 */
export function useRecordFirstResponseOnAction() {
  const recordMutation = useRecordFirstResponse();

  const recordFirstResponse = async (params: CheckAndRecordParams) => {
    if (params.firstResponseAt && !params.firstResponseIsAutomation) {
      return null;
    }

    if (!params.organizationId) {
      throw new Error('Organização indisponível para registrar o primeiro contato.');
    }

    return recordMutation.mutateAsync({
      leadId: params.leadId,
      organizationId: params.organizationId,
      channel: params.channel,
      actorUserId: params.actorUserId,
    });
  };

  return {
    recordFirstResponse,
    isRecording: recordMutation.isPending,
  };
}
