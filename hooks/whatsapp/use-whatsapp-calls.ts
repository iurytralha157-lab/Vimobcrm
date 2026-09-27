"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { whatsappCallsAPI } from "@/lib/api/whatsapp-calls";

export function useSessionWhatsAppCalls(sessionId: string | null, enabled = true) {
  const { activeOrganization, user } = useAuth();
  const organizationId = activeOrganization.organizationId;
  return useQuery({
    queryKey: ["whatsapp-calls", organizationId, user?.id, sessionId],
    queryFn: () => whatsappCallsAPI.listForSession(sessionId!, organizationId!),
    enabled: enabled && Boolean(sessionId && organizationId && user?.id),
    staleTime: 1500,
    refetchInterval: enabled ? 3000 : false,
  });
}

export function useWhatsAppCallActions() {
  const { activeOrganization } = useAuth();
  const queryClient = useQueryClient();
  const organizationId = activeOrganization.organizationId!;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["whatsapp-calls", organizationId] });

  const start = useMutation({
    mutationFn: (conversationId: string) => whatsappCallsAPI.start(conversationId, organizationId),
    onSuccess: refresh,
  });
  const command = useMutation({
    mutationFn: ({ callId, action }: { callId: string; action: "accept" | "reject" | "end" }) =>
      whatsappCallsAPI.command(callId, action, organizationId),
    onSuccess: refresh,
  });
  const saveContact = useMutation({
    mutationFn: (args: { conversationId: string; fullName: string } | { sessionId: string; leadId: string }) =>
      "conversationId" in args
        ? whatsappCallsAPI.saveConversationContact(args.conversationId, args.fullName, organizationId)
        : whatsappCallsAPI.saveLeadContact(args.sessionId, args.leadId, organizationId),
  });

  return { start, command, saveContact };
}
