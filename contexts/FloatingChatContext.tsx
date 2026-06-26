import { createContext, useContext, useState, ReactNode, useCallback } from "react";
import { WhatsAppConversation } from "@/hooks/use-whatsapp-conversations";

interface FloatingChatState {
  isOpen: boolean;
  isMinimized: boolean;
  activeConversation: WhatsAppConversation | null;
  pendingPhone: string | null; // Telefone para iniciar nova conversa
  pendingLeadName: string | null; // Nome do lead para nova conversa
  pendingMessage: string | null; // Mensagem pré-preenchida
  pendingLeadId: string | null; // ID do lead
}

interface FloatingChatContextType {
  state: FloatingChatState;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  minimizeChat: () => void;
  maximizeChat: () => void;
  openConversation: (conversation: WhatsAppConversation) => void;
  openNewChat: (phone: string, leadName?: string, leadId?: string) => void;
  openNewChatWithMessage: (phone: string, message: string, leadId?: string, leadName?: string) => void;
  clearActiveConversation: () => void;
  clearPendingMessage: () => void;
}

const FloatingChatContext = createContext<FloatingChatContextType | undefined>(undefined);

export function FloatingChatProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FloatingChatState>({
    isOpen: false,
    isMinimized: false,
    activeConversation: null,
    pendingPhone: null,
    pendingLeadName: null,
    pendingMessage: null,
    pendingLeadId: null,
  });

  const openChat = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: true, isMinimized: false }));
  }, []);

  const closeChat = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: false,
      isMinimized: false,
      activeConversation: null,
      pendingPhone: null,
      pendingLeadName: null,
      pendingMessage: null,
      pendingLeadId: null,
    }));
  }, []);

  const toggleChat = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: !prev.isOpen,
      isMinimized: false
    }));
  }, []);

  const minimizeChat = useCallback(() => {
    setState((prev) => ({ ...prev, isMinimized: true }));
  }, []);

  const maximizeChat = useCallback(() => {
    setState((prev) => ({ ...prev, isMinimized: false }));
  }, []);

  const openConversation = useCallback((conversation: WhatsAppConversation) => {
    setState((prev) => ({
      ...prev,
      isOpen: true,
      isMinimized: false,
      activeConversation: conversation,
      pendingPhone: null,
      pendingLeadName: null,
      pendingLeadId: null,
    }));
  }, []);

  const openNewChat = useCallback((phone: string, leadName?: string, leadId?: string) => {
    // Limpa o telefone para formato numérico
    const cleanPhone = phone.replace(/\D/g, "");
    setState((prev) => ({
      ...prev,
      isOpen: true,
      isMinimized: false,
      activeConversation: null,
      pendingPhone: cleanPhone,
      pendingLeadName: leadName || null,
      pendingMessage: null,
      pendingLeadId: leadId || null,
    }));
  }, []);

  const openNewChatWithMessage = useCallback((phone: string, message: string, leadId?: string, leadName?: string) => {
    const cleanPhone = phone.replace(/\D/g, "");
    setState((prev) => ({
      ...prev,
      isOpen: true,
      isMinimized: false,
      activeConversation: null,
      pendingPhone: cleanPhone,
      pendingLeadName: leadName || null,
      pendingMessage: message,
      pendingLeadId: leadId || null,
    }));
  }, []);

  const clearActiveConversation = useCallback(() => {
    setState((prev) => ({
      ...prev,
      activeConversation: null,
      pendingPhone: null,
      pendingLeadName: null,
      pendingMessage: null,
      pendingLeadId: null,
    }));
  }, []);

  const clearPendingMessage = useCallback(() => {
    setState((prev) => ({
      ...prev,
      pendingMessage: null,
    }));
  }, []);

  return (
    <FloatingChatContext.Provider
      value={{
        state,
        openChat,
        closeChat,
        toggleChat,
        minimizeChat,
        maximizeChat,
        openConversation,
        openNewChat,
        openNewChatWithMessage,
        clearActiveConversation,
        clearPendingMessage,
      }}
    >
      {children}
    </FloatingChatContext.Provider>
  );
}

export function useFloatingChat() {
  const context = useContext(FloatingChatContext);
  if (!context) {
    throw new Error("useFloatingChat must be used within FloatingChatProvider");
  }
  return context;
}
