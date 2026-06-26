import { useMutation } from '@tanstack/react-query';
import { leadsAPI } from '@/lib/api/leads';

interface RecordFirstResponseParams {
  leadId: string;
  organizationId: string;
  channel: 'whatsapp' | 'phone';
  actorUserId: string | null;
  isAutomation?: boolean;
}

/**
 * Hook para registrar a primeira resposta de um lead.
 * Chama a edge function calculate-first-response.
 */
export function useRecordFirstResponse() {
  return useMutation({
    mutationFn: async (params: RecordFirstResponseParams) => {
      return leadsAPI.recordFirstResponse(params.leadId, {
        organizationId: params.organizationId,
        channel: params.channel,
        actorUserId: params.actorUserId,
        isAutomation: params.isAutomation,
      });
    },
  });
}

interface CheckAndRecordParams {
  leadId: string;
  organizationId: string;
  channel: 'whatsapp' | 'phone';
  actorUserId: string | null;
  firstResponseAt?: string | null; // Se já existe, não faz nada
}

/**
 * Hook que verifica se já existe first_response_at antes de registrar.
 * Garante idempotência - não sobrescreve registro existente.
 */
export function useRecordFirstResponseOnAction() {
  const recordMutation = useRecordFirstResponse();

  const recordFirstResponse = async (params: CheckAndRecordParams) => {
    // Se já tem first_response_at, não faz nada
    if (params.firstResponseAt) {
      console.log('Lead já tem first_response_at, pulando registro');
      return null;
    }

    // Se não tem organizationId, não pode registrar
    if (!params.organizationId) {
      console.warn('organizationId não fornecido, pulando registro de first response');
      return null;
    }

    try {
      const result = await recordMutation.mutateAsync({
        leadId: params.leadId,
        organizationId: params.organizationId,
        channel: params.channel,
        actorUserId: params.actorUserId,
      });

      console.log('First response registrado:', result);
      return result;
    } catch (error) {
      // Não bloqueia a ação do usuário se der erro
      console.error('Erro ao registrar first response (não bloqueante):', error);
      return null;
    }
  };

  return {
    recordFirstResponse,
    isRecording: recordMutation.isPending,
  };
}
