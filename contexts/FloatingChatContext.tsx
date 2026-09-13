import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from "react";
import { WhatsAppConversation } from "@/hooks/use-whatsapp-conversations";
import { useAuth } from "@/contexts/AuthContext";
import { normalizePhoneToE164 } from "@/lib/phone-utils";

interface FloatingChatState {
  isOpen: boolean;
  isPresenceOpen: boolean;
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
  setPresenceOpen: (open: boolean) => void;
  openConversation: (conversation: WhatsAppConversation) => void;
  openNewChat: (phone: string, leadName?: string, leadId?: string) => void;
  openNewChatWithMessage: (phone: string, message: string, leadId?: string, leadName?: string) => void;
  clearActiveConversation: () => void;
  clearPendingMessage: () => void;
}

const FloatingChatContext = createContext<FloatingChatContextType | undefined>(undefined);

const initialFloatingChatState = (): FloatingChatState => ({
  isOpen: false,
  isPresenceOpen: false,
  activeConversation: null,
  pendingPhone: null,
  pendingLeadName: null,
  pendingMessage: null,
  pendingLeadId: null,
});

export function FloatingChatProvider({ children }: { children: ReactNode }) {
  const { activeOrganization, user, profile } = useAuth();
  const activeTenantKey = `${user?.id || profile?.id || "anonymous"}:${activeOrganization.organizationId || "none"}`;
  const [state, setState] = useState<FloatingChatState>(initialFloatingChatState);
  const [stateTenantKey, setStateTenantKey] = useState(activeTenantKey);
  const visibleState = stateTenantKey === activeTenantKey
    ? state
    : initialFloatingChatState();

  useEffect(() => {
    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setState(initialFloatingChatState());
      setStateTenantKey(activeTenantKey);
    });
    return () => {
      isActive = false;
    };
  }, [activeTenantKey]);

  const openChat = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: true,
      isPresenceOpen: false,
    }));
  }, []);

  const closeChat = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: false,
      isPresenceOpen: false,
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
      isPresenceOpen: false,
    }));
  }, []);

  const setPresenceOpen = useCallback((open: boolean) => {
    setState((prev) => ({
      ...prev,
      isPresenceOpen: open,
    }));
  }, []);

  const openConversation = useCallback((conversation: WhatsAppConversation) => {
    setState((prev) => ({
      ...prev,
      isOpen: true,
      isPresenceOpen: false,
      activeConversation: conversation,
      pendingPhone: null,
      pendingLeadName: null,
      pendingLeadId: null,
    }));
  }, []);

  const openNewChat = useCallback((phone: string, leadName?: string, leadId?: string) => {
    const pendingPhone = normalizePhoneToE164(phone) || phone.trim();
    setState((prev) => ({
      ...prev,
      isOpen: true,
      isPresenceOpen: false,
      activeConversation: null,
      pendingPhone,
      pendingLeadName: leadName || null,
      pendingMessage: null,
      pendingLeadId: leadId || null,
    }));
  }, []);

  const openNewChatWithMessage = useCallback((phone: string, message: string, leadId?: string, leadName?: string) => {
    const pendingPhone = normalizePhoneToE164(phone) || phone.trim();
    setState((prev) => ({
      ...prev,
      isOpen: true,
      isPresenceOpen: false,
      activeConversation: null,
      pendingPhone,
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
        state: visibleState,
        openChat,
        closeChat,
        toggleChat,
        setPresenceOpen,
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
