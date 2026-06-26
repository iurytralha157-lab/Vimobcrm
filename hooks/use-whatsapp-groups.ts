import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { whatsappAPI, type WhatsAppGroup } from "@/lib/api/whatsapp";
import { useAuth } from "@/contexts/AuthContext";

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
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["whatsapp-groups", sessionId],
    enabled: !!sessionId && !!profile?.organization_id,
    queryFn: async () => whatsappAPI.getGroups(sessionId!, profile?.organization_id),
  });
}

export function useSyncGroups() {
  const qc = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const result = await whatsappAPI.syncGroups(sessionId, profile?.organization_id);
      return result.data;
    },
    onSuccess: (_d, sessionId) => qc.invalidateQueries({ queryKey: ["whatsapp-groups", sessionId] }),
  });
}

export function useGroupInfo() {
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (args: { sessionId: string; jid: string }) => {
      const result = await whatsappAPI.groupInfo(args.sessionId, args.jid, profile?.organization_id);
      return result.data;
    },
  });
}

export function useGroupInviteLink() {
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (args: { sessionId: string; jid: string }) =>
      whatsappAPI.groupInviteLink(args.sessionId, args.jid, profile?.organization_id) as Promise<GroupInviteLinkResult>,
  });
}

export function useUpdateGroup() {
  const qc = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (args: {
      sessionId: string;
      jid: string;
      field: "name" | "description" | "photo";
      value: string;
    }) => {
      const result = await whatsappAPI.updateGroup(args.sessionId, {
        jid: args.jid,
        field: args.field,
        value: args.value,
      }, profile?.organization_id);
      return result.data;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["whatsapp-groups", vars.sessionId] }),
  });
}
