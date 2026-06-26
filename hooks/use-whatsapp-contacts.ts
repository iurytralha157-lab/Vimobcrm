import { useMutation } from "@tanstack/react-query";
import { whatsappAPI } from "@/lib/api/whatsapp";
import { useAuth } from "@/contexts/AuthContext";

export function useCheckWhatsAppNumber() {
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (args: { sessionId: string; numbers: string[] }) =>
      whatsappAPI.checkNumbers(args.sessionId, args.numbers, profile?.organization_id),
  });
}

export function useFetchAvatar() {
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (args: { sessionId: string; jid: string }) =>
      whatsappAPI.fetchAvatar(args.sessionId, args.jid, profile?.organization_id),
  });
}

export function useSyncContactsAvatars() {
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (sessionId: string) =>
      whatsappAPI.syncContactsAvatars(sessionId, profile?.organization_id),
  });
}

export function useHistorySync() {
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (args: { sessionId: string; jid?: string }) =>
      whatsappAPI.historySync(args.sessionId, args.jid, profile?.organization_id),
  });
}
