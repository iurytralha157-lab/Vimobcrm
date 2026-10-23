import { createContext, useContext, useState, ReactNode, useCallback, useLayoutEffect, useRef } from "react";
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
  intentTenantKey: string;
  intentGeneration: number;
  pendingMessageConversationId: string | null;
}

export type FloatingChatIntent = { tenantKey: string; generation: number };

interface FloatingChatContextType {
  state: FloatingChatState;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  setPresenceOpen: (open: boolean) => void;
  openConversation: (conversation: WhatsAppConversation, intent?: FloatingChatIntent) => boolean;
  openNewChat: (phone: string, leadName?: string, leadId?: string) => void;
  openNewChatWithMessage: (phone: string, message: string, leadId?: string, leadName?: string) => void;
  clearActiveConversation: (intent?: FloatingChatIntent) => void;
  clearPendingMessage: (intent?: FloatingChatIntent) => void;
  isIntentCurrent: (intent: FloatingChatIntent) => boolean;
}

const FloatingChatContext = createContext<FloatingChatContextType | undefined>(undefined);

const initialFloatingChatState = (tenantKey = "", generation = 0): FloatingChatState => ({
  isOpen: false,
  isPresenceOpen: false,
  activeConversation: null,
  pendingPhone: null,
  pendingLeadName: null,
  pendingMessage: null,
  pendingLeadId: null,
  intentTenantKey: tenantKey,
  intentGeneration: generation,
  pendingMessageConversationId: null,
});

export function FloatingChatProvider({ children }: { children: ReactNode }) {
  const { activeOrganization, user, profile } = useAuth();
  const activeTenantKey = `${user?.id || profile?.id || "anonymous"}:${activeOrganization.organizationId || "none"}`;
  const intentRef = useRef<FloatingChatIntent>({ tenantKey: activeTenantKey, generation: 0 });
  const [state, setState] = useState<FloatingChatState>(() => initialFloatingChatState(activeTenantKey));
  const [stateTenantKey, setStateTenantKey] = useState(activeTenantKey);
  const visibleState = stateTenantKey === activeTenantKey
    ? state
    : initialFloatingChatState(activeTenantKey);

  useLayoutEffect(() => {
    const next = { tenantKey: activeTenantKey, generation: intentRef.current.generation + 1 };
    intentRef.current = next;
    setState(initialFloatingChatState(next.tenantKey, next.generation));
    setStateTenantKey(activeTenantKey);
    return () => {
      intentRef.current = { ...intentRef.current, generation: intentRef.current.generation + 1 };
    };
  }, [activeTenantKey]);

  const isIntentCurrent = useCallback((intent: FloatingChatIntent) => (
    intentRef.current.tenantKey === intent.tenantKey && intentRef.current.generation === intent.generation
  ), []);
  const advanceIntent = useCallback(() => {
    const next = { ...intentRef.current, generation: intentRef.current.generation + 1 };
    intentRef.current = next;
    return next;
  }, []);

  const openChat = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: true,
      isPresenceOpen: false,
    }));
  }, []);

  const closeChat = useCallback(() => {
    const intent = advanceIntent();
    setState(initialFloatingChatState(intent.tenantKey, intent.generation));
  }, [advanceIntent]);

  const toggleChat = useCallback(() => {
    const intent = advanceIntent();
    setState((prev) => ({
      ...prev,
      isOpen: !prev.isOpen,
      isPresenceOpen: false,
      intentTenantKey: intent.tenantKey,
      intentGeneration: intent.generation,
      pendingPhone: null,
      pendingLeadName: null,
      pendingLeadId: null,
      pendingMessage: null,
      pendingMessageConversationId: null,
    }));
  }, [advanceIntent]);

  const setPresenceOpen = useCallback((open: boolean) => {
    setState((prev) => ({
      ...prev,
      isPresenceOpen: open,
    }));
  }, []);

  const openConversation = useCallback((conversation: WhatsAppConversation, requestedIntent?: FloatingChatIntent) => {
    if (requestedIntent && !isIntentCurrent(requestedIntent)) return false;
    const intent = requestedIntent ?? advanceIntent();
    setState((prev) => {
      if (!isIntentCurrent(intent)) return prev;
      const conversationLeadId = conversation.lead_id || conversation.lead?.id || null;
      const sameOpenTarget = prev.activeConversation?.id === conversation.id
        && (prev.activeConversation.lead_id || prev.activeConversation.lead?.id || null) === conversationLeadId
        && prev.pendingMessageConversationId === conversation.id;
      const sameTarget = sameOpenTarget || (prev.pendingLeadId
        ? prev.pendingLeadId === conversationLeadId
        : Boolean(prev.pendingPhone && normalizePhoneToE164(conversation.contact_phone || "") === prev.pendingPhone));
      const keepMessage = Boolean(requestedIntent && sameTarget
        && prev.intentGeneration === intent.generation && prev.intentTenantKey === intent.tenantKey);
      return {
        ...prev,
        isOpen: true,
        isPresenceOpen: false,
        activeConversation: conversation,
        pendingPhone: null,
        pendingLeadName: null,
        pendingLeadId: null,
        intentTenantKey: intent.tenantKey,
        intentGeneration: intent.generation,
        pendingMessage: keepMessage ? prev.pendingMessage : null,
        pendingMessageConversationId: keepMessage ? conversation.id : null,
      };
    });
    return true;
  }, [advanceIntent, isIntentCurrent]);

  const openNewChat = useCallback((phone: string, leadName?: string, leadId?: string) => {
    const pendingPhone = normalizePhoneToE164(phone) || phone.trim();
    const intent = advanceIntent();
    setState((prev) => ({
      ...prev,
      isOpen: true,
      isPresenceOpen: false,
      activeConversation: null,
      pendingPhone,
      pendingLeadName: leadName || null,
      pendingMessage: null,
      pendingLeadId: leadId || null,
      intentTenantKey: intent.tenantKey,
      intentGeneration: intent.generation,
      pendingMessageConversationId: null,
    }));
  }, [advanceIntent]);

  const openNewChatWithMessage = useCallback((phone: string, message: string, leadId?: string, leadName?: string) => {
    const pendingPhone = normalizePhoneToE164(phone) || phone.trim();
    const intent = advanceIntent();
    setState((prev) => ({
      ...prev,
      isOpen: true,
      isPresenceOpen: false,
      activeConversation: null,
      pendingPhone,
      pendingLeadName: leadName || null,
      pendingMessage: message,
      pendingLeadId: leadId || null,
      intentTenantKey: intent.tenantKey,
      intentGeneration: intent.generation,
      pendingMessageConversationId: null,
    }));
  }, [advanceIntent]);

  const clearActiveConversation = useCallback((requestedIntent?: FloatingChatIntent) => {
    if (requestedIntent && !isIntentCurrent(requestedIntent)) return;
    const intent = advanceIntent();
    setState((prev) => !isIntentCurrent(intent) ? prev : ({
      ...prev,
      activeConversation: null,
      pendingPhone: null,
      pendingLeadName: null,
      pendingMessage: null,
      pendingLeadId: null,
      intentTenantKey: intent.tenantKey,
      intentGeneration: intent.generation,
      pendingMessageConversationId: null,
    }));
  }, [advanceIntent, isIntentCurrent]);

  const clearPendingMessage = useCallback((intent?: FloatingChatIntent) => {
    if (intent && !isIntentCurrent(intent)) return;
    setState((prev) => intent && !isIntentCurrent(intent) ? prev : ({
      ...prev,
      pendingMessage: null,
      pendingMessageConversationId: null,
    }));
  }, [isIntentCurrent]);

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
        isIntentCurrent,
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
