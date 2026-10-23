import { useWhatsAppIntentMutation } from "@/hooks/integrations/whatsapp/use-whatsapp-mutation-intent";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { whatsappAPI, type WhatsAppLabel } from "@/lib/api/whatsapp";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";

export type { WhatsAppLabel };

export function useWhatsAppLabels(sessionId?: string) {
  const scope = useWhatsAppQueryScope();

  return useQuery({
    queryKey: ["whatsapp-labels", sessionId, scope.organizationId, scope.userId, scope.accessScope],
    enabled: !!sessionId && !!scope.organizationId && !!scope.userId,
    queryFn: async ({ signal }) => whatsappAPI.getLabels(sessionId!, scope.organizationId, { expectedUserId: scope.userId, signal }),
  });
}

export function useChatLabels(conversationId?: string) {
  const scope = useWhatsAppQueryScope();

  return useQuery({
    queryKey: ["whatsapp-chat-labels", conversationId, scope.organizationId, scope.userId, scope.accessScope],
    enabled: !!conversationId && !!scope.organizationId && !!scope.userId,
    queryFn: async ({ signal }) => whatsappAPI.getChatLabels(conversationId!, scope.organizationId, { expectedUserId: scope.userId, signal }),
  });
}

export function useSyncLabels() {
  const qc = useQueryClient();

  return useWhatsAppIntentMutation({
    mutationFn: async (sessionId: string, intent) => whatsappAPI.syncLabels(sessionId, intent.scope.organizationId, intent),
    onSuccess: (_d, sessionId) => qc.invalidateQueries({ queryKey: ["whatsapp-labels", sessionId] }),
  });
}

export function useAssignLabel() {
  const qc = useQueryClient();

  return useWhatsAppIntentMutation({
    mutationFn: async (args: {
      sessionId: string;
      remoteJid: string;
      labelId: string;
      conversationId: string;
      add: boolean;
    }, intent) => {
      const result = await whatsappAPI.assignLabel(args.sessionId, {
        remoteJid: args.remoteJid,
        labelId: args.labelId,
        conversationId: args.conversationId,
        add: args.add,
      }, intent.scope.organizationId, intent);
      return result.data;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["whatsapp-chat-labels", vars.conversationId] }),
  });
}
