import { useWhatsAppIntentMutation } from "@/hooks/integrations/whatsapp/use-whatsapp-mutation-intent";
import { whatsappAPI } from "@/lib/api/whatsapp";

export function useCheckWhatsAppNumber() {
  return useWhatsAppIntentMutation({
    mutationFn: async (args: { sessionId: string; numbers: string[] }, intent) =>
      whatsappAPI.checkNumbers(args.sessionId, args.numbers, intent.scope.organizationId, intent),
  });
}

export function useFetchAvatar() {
  return useWhatsAppIntentMutation({
    mutationFn: async (args: { sessionId: string; jid: string }, intent) =>
      whatsappAPI.fetchAvatar(args.sessionId, args.jid, intent.scope.organizationId, intent),
  });
}

export function useSyncContactsAvatars() {
  return useWhatsAppIntentMutation({
    mutationFn: async (sessionId: string, intent) =>
      whatsappAPI.syncContactsAvatars(sessionId, intent.scope.organizationId, intent),
  });
}

export function useHistorySync() {
  return useWhatsAppIntentMutation({
    mutationFn: async (args: { sessionId: string; jid?: string }, intent) =>
      whatsappAPI.historySync(args.sessionId, args.jid, intent.scope.organizationId, intent),
  });
}
