import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { WhatsAppConversation } from "@/hooks/use-whatsapp-conversations";
import { isValidWhatsAppPhone } from "@/lib/phone-utils";
import { whatsappAPI } from "@/lib/api/whatsapp";
import { useAuth } from "@/contexts/AuthContext";

interface StartConversationParams {
  phone: string;
  sessionId: string;
  leadId?: string;
  leadName?: string;
}

export class WhatsAppStartError extends Error {
  constructor(message: string, public readonly userMessage = message) {
    super(message);
    this.name = "WhatsAppStartError";
  }
}

export function getWhatsAppStartErrorMessage(error: unknown) {
  if (error instanceof WhatsAppStartError) return error.userMessage;

  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();

  if (normalized.includes("statement timeout") || normalized.includes("timeout")) {
    return "Nao foi possivel abrir a conversa agora. Tente novamente em alguns instantes.";
  }

  if (normalized.includes("invalid") || normalized.includes("jid") || normalized.includes("phone") || normalized.includes("telefone")) {
    return "Este lead nao tem um WhatsApp valido cadastrado.";
  }

  return message || "Ocorreu um erro inesperado ao tentar abrir o chat.";
}

export function useStartConversation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({ phone, sessionId, leadId, leadName }: StartConversationParams): Promise<WhatsAppConversation> => {
      if (!isValidWhatsAppPhone(phone)) {
        throw new WhatsAppStartError("Telefone invalido para WhatsApp", "Este lead nao tem um WhatsApp valido cadastrado.");
      }

      return whatsappAPI.startConversation({
        phone,
        sessionId,
        leadId,
        leadName,
      }, profile?.organization_id) as Promise<WhatsAppConversation>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao iniciar conversa",
        description: getWhatsAppStartErrorMessage(error),
        variant: "destructive",
      });
    },
  });
}

export function useFindConversationByPhone() {
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({ phone, leadId, sessionId }: { phone: string; leadId?: string; sessionId?: string }): Promise<WhatsAppConversation | null> => {
      const canSearchByPhone = isValidWhatsAppPhone(phone);
      if (!canSearchByPhone) {
        if (leadId) return null;
        throw new WhatsAppStartError("Telefone invalido para WhatsApp", "Este lead nao tem um WhatsApp valido cadastrado.");
      }

      return whatsappAPI.findConversation({
        phone,
        leadId,
        sessionId,
        organizationId: profile?.organization_id,
      }) as Promise<WhatsAppConversation | null>;
    },
  });
}
