import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { whatsappAPI, type WhatsAppLabel } from "@/lib/api/whatsapp";
import { useAuth } from "@/contexts/AuthContext";

export type { WhatsAppLabel };

export function useWhatsAppLabels(sessionId?: string) {
  const { activeOrganization, profile } = useAuth();

  return useQuery({
    queryKey: ["whatsapp-labels", sessionId],
    enabled: !!sessionId && !!activeOrganization.organizationId,
    queryFn: async () => whatsappAPI.getLabels(sessionId!, activeOrganization.organizationId),
  });
}

export function useChatLabels(conversationId?: string) {
  const { activeOrganization, profile } = useAuth();

  return useQuery({
    queryKey: ["whatsapp-chat-labels", conversationId],
    enabled: !!conversationId && !!activeOrganization.organizationId,
    queryFn: async () => whatsappAPI.getChatLabels(conversationId!, activeOrganization.organizationId),
  });
}

export function useSyncLabels() {
  const qc = useQueryClient();
  const { activeOrganization, profile } = useAuth();

  return useMutation({
    mutationFn: async (sessionId: string) => whatsappAPI.syncLabels(sessionId, activeOrganization.organizationId),
    onSuccess: (_d, sessionId) => qc.invalidateQueries({ queryKey: ["whatsapp-labels", sessionId] }),
  });
}

export function useAssignLabel() {
  const qc = useQueryClient();
  const { activeOrganization, profile } = useAuth();

  return useMutation({
    mutationFn: async (args: {
      sessionId: string;
      remoteJid: string;
      labelId: string;
      conversationId: string;
      add: boolean;
    }) => {
      const result = await whatsappAPI.assignLabel(args.sessionId, {
        remoteJid: args.remoteJid,
        labelId: args.labelId,
        conversationId: args.conversationId,
        add: args.add,
      }, activeOrganization.organizationId);
      return result.data;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["whatsapp-chat-labels", vars.conversationId] }),
  });
}
