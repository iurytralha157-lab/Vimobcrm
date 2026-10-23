import { useWhatsAppIntentMutation } from "@/hooks/integrations/whatsapp/use-whatsapp-mutation-intent";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { whatsappAPI, type WhatsAppGroup } from "@/lib/api/whatsapp";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";

export type WhatsAppGroupParticipant = string | {
  id?: string;
  jid?: string;
  admin?: string | null;
};

export type GroupInviteLinkResult = {
  inviteUrl?: string | null;
  url?: string | null;
  inviteCode?: string | null;
} | null;

export type { WhatsAppGroup };

export function useWhatsAppGroups(sessionId?: string) {
  const scope = useWhatsAppQueryScope();

  return useQuery({
    queryKey: ["whatsapp-groups", sessionId, scope.organizationId, scope.userId, scope.accessScope],
    enabled: !!sessionId && !!scope.organizationId && !!scope.userId,
    queryFn: async ({ signal }) => whatsappAPI.getGroups(sessionId!, scope.organizationId, { expectedUserId: scope.userId, signal }),
  });
}

export function useSyncGroups() {
  const qc = useQueryClient();

  return useWhatsAppIntentMutation({
    mutationFn: async (sessionId: string, intent) => {
      const result = await whatsappAPI.syncGroups(sessionId, intent.scope.organizationId, intent);
      return result.data;
    },
    onSuccess: (_d, sessionId) => qc.invalidateQueries({ queryKey: ["whatsapp-groups", sessionId] }),
  });
}

export function useGroupInfo() {
  return useWhatsAppIntentMutation({
    mutationFn: async (args: { sessionId: string; jid: string }, intent) => {
      const result = await whatsappAPI.groupInfo(args.sessionId, args.jid, intent.scope.organizationId, intent);
      return result.data;
    },
  });
}

export function useGroupInviteLink() {
  return useWhatsAppIntentMutation({
    mutationFn: async (args: { sessionId: string; jid: string }, intent) =>
      whatsappAPI.groupInviteLink(args.sessionId, args.jid, intent.scope.organizationId, intent) as Promise<GroupInviteLinkResult>,
  });
}

export function useUpdateGroup() {
  const qc = useQueryClient();

  return useWhatsAppIntentMutation({
    mutationFn: async (args: {
      sessionId: string;
      jid: string;
      field: "name" | "description" | "photo";
      value: string;
    }, intent) => {
      const result = await whatsappAPI.updateGroup(args.sessionId, {
        jid: args.jid,
        field: args.field,
        value: args.value,
      }, intent.scope.organizationId, intent);
      return result.data;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["whatsapp-groups", vars.sessionId] }),
  });
}
