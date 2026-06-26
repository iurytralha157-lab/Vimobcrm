import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { enforceClientActionRateLimit, getClientRateLimitMessage } from '@/lib/client-action-rate-limit';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { leadAttachmentsAPI, type LeadAttachment } from '@/lib/api/lead-attachments';

export type { LeadAttachment } from '@/lib/api/lead-attachments';

export function useLeadAttachments(leadId: string | null) {
  return useQuery({
    queryKey: ['lead-attachments', leadId],
    queryFn: async () => {
      if (!leadId) return [];
      return leadAttachmentsAPI.list(leadId);
    },
    enabled: !!leadId,
  });
}

export function useCreateLeadAttachment() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (attachment: {
      lead_id: string;
      file_name: string;
      file_url: string;
      file_type?: string;
      file_size?: number;
      message_id?: string;
    }) => {
      enforceClientActionRateLimit(`lead:attachment:create:${user?.id || 'anonymous'}:${attachment.lead_id}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 20, windowMs: 60_000 },
      ]);

      return leadAttachmentsAPI.create(attachment);
    },
    onSuccess: (data: LeadAttachment, variables) => {
      queryClient.invalidateQueries({ queryKey: ['lead-attachments', variables.lead_id] });
      queryClient.invalidateQueries({ queryKey: ['activities', variables.lead_id] });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['recent-activities'] });
      queryClient.invalidateQueries({ queryKey: ['lead-history-v2', variables.lead_id] });
      if (data?.lead_id && data.lead_id !== variables.lead_id) {
        queryClient.invalidateQueries({ queryKey: ['lead-attachments', data.lead_id] });
      }
      toast.success('Documento anexado com sucesso!');
    },
    onError: (error) => {
      console.error('Error creating attachment:', error);
      const rateLimitMessage = getClientRateLimitMessage(error);
      toast.error(rateLimitMessage || 'Erro ao anexar documento');
    }
  });
}

export function useUploadLeadAttachment() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ leadId, file }: { leadId: string; file: File }) => {
      enforceClientActionRateLimit(`lead:attachment:upload:${user?.id || 'anonymous'}:${leadId}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 20, windowMs: 60_000 },
      ]);

      return leadAttachmentsAPI.upload(leadId, file);
    },
    onSuccess: (data: LeadAttachment, variables) => {
      queryClient.invalidateQueries({ queryKey: ['lead-attachments', variables.leadId] });
      queryClient.invalidateQueries({ queryKey: ['activities', variables.leadId] });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['recent-activities'] });
      queryClient.invalidateQueries({ queryKey: ['lead-history-v2', variables.leadId] });
      if (data?.lead_id && data.lead_id !== variables.leadId) {
        queryClient.invalidateQueries({ queryKey: ['lead-attachments', data.lead_id] });
      }
    },
    onError: (error) => {
      console.error('Error uploading attachment:', error);
      const rateLimitMessage = getClientRateLimitMessage(error);
      toast.error(rateLimitMessage || 'Erro ao enviar documento');
    },
  });
}
