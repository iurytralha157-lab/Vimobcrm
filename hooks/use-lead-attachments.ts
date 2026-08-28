import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { enforceClientActionRateLimit, getClientRateLimitMessage } from '@/lib/client-action-rate-limit';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { leadAttachmentsAPI, type LeadAttachment } from '@/lib/api/lead-attachments';

export type { LeadAttachment } from '@/lib/api/lead-attachments';

function upsertAttachment(current: LeadAttachment[] | undefined, attachment: LeadAttachment) {
  const attachments = Array.isArray(current) ? current : [];
  return [attachment, ...attachments.filter((item) => item.id !== attachment.id)];
}

const attachmentQueryKey = (organizationId: string | null, leadId: string) =>
  ['lead-attachments', organizationId || 'none', leadId] as const;

export function useLeadAttachments(leadId: string | null) {
  const { organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || null;

  return useQuery({
    queryKey: attachmentQueryKey(organizationId, leadId || 'none'),
    queryFn: async () => {
      if (!leadId) return [];
      return leadAttachmentsAPI.list(leadId, organizationId);
    },
    enabled: !!leadId && !!organizationId,
  });
}

export function useCreateLeadAttachment() {
  const queryClient = useQueryClient();
  const { user, organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || null;

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

      if (!organizationId) throw new Error('Organização não selecionada');
      return leadAttachmentsAPI.create(attachment, organizationId);
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
  const { user, organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || null;

  return useMutation({
    mutationFn: async ({ leadId, file }: { leadId: string; file: File }) => {
      enforceClientActionRateLimit(`lead:attachment:upload:${user?.id || 'anonymous'}:${leadId}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 20, windowMs: 60_000 },
      ]);

      if (!organizationId) throw new Error('Organização não selecionada');
      return leadAttachmentsAPI.upload(leadId, file, organizationId);
    },
    onSuccess: (data: LeadAttachment, variables) => {
      queryClient.setQueryData<LeadAttachment[]>(attachmentQueryKey(organizationId, variables.leadId), (current) =>
        upsertAttachment(current, data)
      );
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
    onError: (error) => {
      console.error('Error uploading attachment:', error);
      const rateLimitMessage = getClientRateLimitMessage(error);
      toast.error(rateLimitMessage || 'Erro ao enviar documento');
    },
  });
}
