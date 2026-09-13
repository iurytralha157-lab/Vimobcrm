import { useMutation } from "@tanstack/react-query";
import { whatsappAPI } from "@/lib/api/whatsapp";
import { useAuth } from "@/contexts/AuthContext";

export function useCheckWhatsAppNumber() {
  const { activeOrganization, profile } = useAuth();

  return useMutation({
    mutationFn: async (args: { sessionId: string; numbers: string[] }) =>
      whatsappAPI.checkNumbers(args.sessionId, args.numbers, activeOrganization.organizationId),
  });
}

export function useFetchAvatar() {
  const { activeOrganization, profile } = useAuth();

  return useMutation({
    mutationFn: async (args: { sessionId: string; jid: string }) =>
      whatsappAPI.fetchAvatar(args.sessionId, args.jid, activeOrganization.organizationId),
  });
}

export function useSyncContactsAvatars() {
  const { activeOrganization, profile } = useAuth();

  return useMutation({
    mutationFn: async (sessionId: string) =>
      whatsappAPI.syncContactsAvatars(sessionId, activeOrganization.organizationId),
  });
}

export function useHistorySync() {
  const { activeOrganization, profile } = useAuth();

  return useMutation({
    mutationFn: async (args: { sessionId: string; jid?: string }) =>
      whatsappAPI.historySync(args.sessionId, args.jid, activeOrganization.organizationId),
  });
}
