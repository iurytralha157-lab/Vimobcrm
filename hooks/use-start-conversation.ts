import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useRef } from "react";
import { toast } from "@/hooks/use-toast";
import { WhatsAppConversation } from "@/hooks/use-whatsapp-conversations";
import { isValidWhatsAppPhone } from "@/lib/phone-utils";
import { whatsappAPI } from "@/lib/api/whatsapp";
import { VimobAPIError } from "@/lib/api/vimob-client";
import { useAuth } from "@/contexts/AuthContext";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import { isWhatsAppSendScopeCurrent } from "@/lib/whatsapp-send-intent";
import { whatsappQueryKeys, type WhatsAppQueryScope } from "@/lib/whatsapp-query-cache";

import { runWhatsAppRequestIntent, abortWhatsAppRequestIntents } from '@/lib/whatsapp-request-intent';

import { useWhatsAppIntentMutation } from '@/hooks/integrations/whatsapp/use-whatsapp-mutation-intent';

interface StartConversationParams {
  phone: string;
  sessionId?: string;
  leadId?: string;
  leadName?: string;
  expectedPreviousLeadId: string;
  ownSessionOnly?: boolean;
  confirmPhoneChange?: boolean;
  expectedPreviousConversationId?: string;
  confirmDestinationHistory?: boolean;
  expectedDestinationConversationId?: string;
  _scope?: WhatsAppQueryScope;
  _generation?: number;
  suppressErrorToast?: boolean;
}

export class WhatsAppStartError extends Error {
  constructor(message: string, public readonly userMessage = message) {
    super(message);
    this.name = "WhatsAppStartError";
  }
}

export function getWhatsAppStartErrorMessage(error: unknown) {
  if (error instanceof WhatsAppStartError) return error.userMessage;

  if (error instanceof VimobAPIError && error.code === "whatsapp_conversation_send_in_flight") {
    return "Aguarde a confirmação do envio em andamento antes de trocar o telefone desta conversa.";
  }
  if (error instanceof VimobAPIError && error.code === "whatsapp_conversation_binding_changed") {
    return "A conversa ou o telefone do lead mudou. Atualize e confirme novamente antes de continuar.";
  }

  if (error instanceof VimobAPIError && error.code === "whatsapp_history_link_required") {
    return "Existe uma conversa sem lead neste WhatsApp. Atualize e confirme o vínculo do histórico antes de enviar.";
  }

  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();

  if (normalized.includes("statement timeout") || normalized.includes("timeout")) {
    return "Não foi possível abrir a conversa agora. Tente novamente em alguns instantes.";
  }

  if (
    normalized.includes("whatsapp_history_link_required")
  ) {
    return "Existe uma conversa sem lead neste WhatsApp. Atualize e confirme o vínculo do histórico antes de enviar.";
  }

  if (
    normalized.includes("conversation binding changed") ||
    normalized.includes("conversation_binding_changed") ||
    normalized.includes("linked to another lead")
  ) {
    return "A conversa foi vinculada a outro card enquanto você estava nesta tela. Atualize e tente novamente.";
  }

  if (normalized.includes("invalid") || normalized.includes("jid") || normalized.includes("phone") || normalized.includes("telefone")) {
    return "Este lead nao tem um WhatsApp valido cadastrado.";
  }

  return message || "Ocorreu um erro inesperado ao tentar abrir o chat.";
}

export function useStartConversation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const scope = useWhatsAppQueryScope();
  const currentRef = useRef({ scope, original: profile?.organization_id ?? null, generation: 0 });
  const mountedRef = useRef(false);
  const requestsRef = useRef(new Set<AbortController>());
  useLayoutEffect(() => {
    const lifecycle = currentRef.current;
    const requests = requestsRef.current;
    mountedRef.current = true;
    return () => { mountedRef.current = false; lifecycle.generation += 1; abortWhatsAppRequestIntents(requests); };
  }, []);
  useLayoutEffect(() => {
    if (!isWhatsAppSendScopeCurrent(scope, currentRef.current.scope)
      || currentRef.current.original !== (profile?.organization_id ?? null)) {
      currentRef.current.generation += 1;
      abortWhatsAppRequestIntents(requestsRef.current);
    }
    currentRef.current.scope = scope;
    currentRef.current.original = profile?.organization_id ?? null;
  }, [profile?.organization_id, scope]);

  const mutation = useMutation({
    mutationFn: async ({ phone, sessionId, leadId, leadName, expectedPreviousLeadId, ownSessionOnly, confirmPhoneChange,
      expectedPreviousConversationId, confirmDestinationHistory, expectedDestinationConversationId,
      _scope = scope, _generation }: StartConversationParams): Promise<WhatsAppConversation> => {
      if (!mountedRef.current || !isWhatsAppSendScopeCurrent(_scope, currentRef.current.scope) || _generation !== currentRef.current.generation) {
        throw new VimobAPIError("O contexto do atendimento mudou. Reabra o lead antes de iniciar a conversa.", { status: 409, code: "whatsapp_send_context_changed" });
      }
      if (!_scope.organizationId || _scope.organizationId !== currentRef.current.original) {
        throw new VimobAPIError("O atendimento WhatsApp está disponível somente na organização original do cadastro.", { status: 403, code: "whatsapp_original_organization_required" });
      }
      if (!isValidWhatsAppPhone(phone)) {
        throw new WhatsAppStartError("Telefone invalido para WhatsApp", "Este lead nao tem um WhatsApp valido cadastrado.");
      }

      return runWhatsAppRequestIntent(_scope, requestsRef.current, (intent) => whatsappAPI.startConversation({
        phone,
        sessionId,
        leadId,
        leadName,
        expectedPreviousLeadId,
        ownSessionOnly,
        confirmPhoneChange,
        expectedPreviousConversationId,
        confirmDestinationHistory,
        expectedDestinationConversationId,
      }, _scope.organizationId, intent) as Promise<WhatsAppConversation>);
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(variables._scope ?? scope) });
    },
    onError: (error: Error, variables) => {
      if (variables.suppressErrorToast || variables._generation !== currentRef.current.generation
        || (error instanceof VimobAPIError && error.code === "whatsapp_phone_change_confirmation_required")) return;
      toast({
        title: "Erro ao iniciar conversa",
        description: getWhatsAppStartErrorMessage(error),
        variant: "destructive",
      });
    },
  });
  const { mutate, mutateAsync } = mutation;
  const stableMutate = useCallback((variables: StartConversationParams, options?: Parameters<typeof mutate>[1]) =>
    mutate({ ...variables, _scope: { ...currentRef.current.scope }, _generation: currentRef.current.generation }, options), [mutate]);
  const stableMutateAsync = useCallback((variables: StartConversationParams, options?: Parameters<typeof mutateAsync>[1]) =>
    mutateAsync({ ...variables, _scope: { ...currentRef.current.scope }, _generation: currentRef.current.generation }, options), [mutateAsync]);
  return {
    ...mutation,
    mutate: stableMutate,
    mutateAsync: stableMutateAsync,
  };
}

export function useFindConversationByPhone() {
  const { activeOrganization } = useAuth();

  return useWhatsAppIntentMutation({
    mutationFn: async ({ phone, leadId, sessionId }: { phone: string; leadId?: string; sessionId?: string }, intent): Promise<WhatsAppConversation | null> => {
      const canSearchByPhone = isValidWhatsAppPhone(phone);
      if (!canSearchByPhone) {
        if (leadId) return null;
        throw new WhatsAppStartError("Telefone invalido para WhatsApp", "Este lead nao tem um WhatsApp valido cadastrado.");
      }

      return whatsappAPI.findConversation({
        phone,
        leadId,
        sessionId,
        organizationId: activeOrganization.organizationId,
      }, intent) as Promise<WhatsAppConversation | null>;
    },
  });
}
