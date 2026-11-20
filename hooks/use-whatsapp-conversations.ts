import { useCallback, useLayoutEffect, useRef } from "react";
import { useMutation, useQueryClient, useIsMutating } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { whatsappAPI } from "@/lib/api/whatsapp";
import { VimobAPIError } from "@/lib/api/vimob-error";
import { createClientId } from "@/lib/client-id";
import { isWhatsAppSendScopeCurrent } from "@/lib/whatsapp-send-intent";
import { canReactToWhatsAppMessage } from "@/lib/whatsapp-reactions";
import {
  getWhatsAppSendFailureStatus,
  matchesLeadMessagesQueryKey,
  matchesPaginatedWhatsAppMessagesQueryKey,
  whatsappQueryKeys,
  type WhatsAppQueryScope,
} from "@/lib/whatsapp-query-cache";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import { runWhatsAppRequestIntent, abortWhatsAppRequestIntents } from '@/lib/whatsapp-request-intent';
import { useWhatsAppIntentMutation } from '@/hooks/integrations/whatsapp/use-whatsapp-mutation-intent';
import { isWhatsAppArchiveInvocation, matchesWhatsAppArchiveQuery, runExclusiveWhatsAppArchive } from '@/lib/whatsapp-archive';
import type { WhatsAppConversation, WhatsAppMessage, PaginatedWhatsAppMessages } from "@/hooks/whatsapp/whatsapp-conversation-types";
import {
  getConversationLeadId,
  requireConversationBindingSnapshot,
  requireConversationLeadId,
} from "@/hooks/whatsapp/whatsapp-conversation-binding";
import { upsertCachedWhatsAppMessage, matchesWhatsAppMessagesQuery } from "@/hooks/whatsapp/whatsapp-message-cache";

export type {
  WhatsAppConversation,
  WhatsAppMessage,
  ConversationFilters,
} from "@/hooks/whatsapp/whatsapp-conversation-types";
export {
  useWhatsAppConversationFilterOptions,
  useWhatsAppConversations,
  useWhatsAppUnreadCount,
  useWhatsAppConversation,
  useWhatsAppConversationSnapshot,
  useWhatsAppConversationForLead,
  useWhatsAppMessages,
} from "@/hooks/whatsapp/use-whatsapp-conversation-queries";
export { scheduleWhatsAppRealtimeRefresh } from "@/hooks/whatsapp/whatsapp-message-cache";
export {
  useWhatsAppInboxRealtime,
  useWhatsAppLeadRealtime,
} from "@/hooks/whatsapp/use-whatsapp-realtime";
export {
  useSendWhatsAppMessage,
  useResolveWhatsAppSendIntent,
  useDiscardFailedLocalWhatsAppMessage,
} from "@/hooks/whatsapp/use-whatsapp-send-message";

type ReactToWhatsAppMessageVariables = {
  conversation: WhatsAppConversation;
  targetMessage: WhatsAppMessage;
  emoji: string;
  _clientReactionId?: string;
  _scope?: WhatsAppQueryScope;
  _scopeGeneration?: number;
};

export function useReactToWhatsAppMessage() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const scope = useWhatsAppQueryScope();
  const lifecycleRef = useRef({ scope, original: profile?.organization_id ?? null, generation: 0, mounted: false });
  const requestsRef = useRef(new Set<AbortController>());
  useLayoutEffect(() => {
    const lifecycle = lifecycleRef.current;
    const requests = requestsRef.current;
    lifecycle.mounted = true;
    return () => { lifecycle.mounted = false; lifecycle.generation += 1; abortWhatsAppRequestIntents(requests); };
  }, []);
  useLayoutEffect(() => {
    const lifecycle = lifecycleRef.current;
    if (!isWhatsAppSendScopeCurrent(scope, lifecycle.scope) || lifecycle.original !== (profile?.organization_id ?? null)) {
      lifecycle.generation += 1;
      abortWhatsAppRequestIntents(requestsRef.current);
    }
    lifecycle.scope = scope;
    lifecycle.original = profile?.organization_id ?? null;
  }, [profile?.organization_id, scope]);
  const isCurrent = (variables: ReactToWhatsAppMessageVariables) => lifecycleRef.current.mounted
    && variables._scopeGeneration === lifecycleRef.current.generation
    && !!variables._scope && isWhatsAppSendScopeCurrent(variables._scope, lifecycleRef.current.scope);
  const assertCurrent = (variables: ReactToWhatsAppMessageVariables) => {
    if (!isCurrent(variables)) throw new VimobAPIError('O contexto do atendimento mudou. Reabra a conversa antes de reagir.', { status: 409, code: 'whatsapp_send_context_changed' });
    if (!variables._scope?.organizationId || variables._scope.organizationId !== lifecycleRef.current.original) {
      throw new VimobAPIError('O atendimento WhatsApp está disponível somente na organização original do cadastro.', { status: 403, code: 'whatsapp_original_organization_required' });
    }
  };

  const updateReactionCaches = (
    scope: WhatsAppQueryScope,
    conversationId: string,
    leadId: string | null,
    updater: (messages: WhatsAppMessage[]) => WhatsAppMessage[],
  ) => {
    queryClient.setQueriesData<WhatsAppMessage[]>(
      {
        predicate: (query) => matchesWhatsAppMessagesQuery(
          query,
          scope,
          conversationId,
          leadId,
        ),
      },
      (old) => old ? updater(old) : old,
    );
    queryClient.setQueriesData<PaginatedWhatsAppMessages>(
      {
        predicate: (query) => matchesPaginatedWhatsAppMessagesQueryKey(
          query.queryKey,
          scope,
          conversationId,
          leadId,
        ),
      },
      (old) => {
        const firstPage = old?.pages?.[0];
        if (!old || !firstPage) return old;
        return {
          ...old,
          pages: [
            { ...firstPage, messages: updater(firstPage.messages) },
            ...old.pages.slice(1),
          ],
        };
      },
    );
    if (leadId) {
      queryClient.setQueriesData<PaginatedWhatsAppMessages>(
        {
          predicate: (query) => matchesLeadMessagesQueryKey(query.queryKey, scope, leadId),
        },
        (old) => {
          const firstPage = old?.pages?.[0];
          if (!old || !firstPage) return old;
          return {
            ...old,
            pages: [
              { ...firstPage, messages: updater(firstPage.messages) },
              ...old.pages.slice(1),
            ],
          };
        },
      );
    }
  };

  const refreshReactionCaches = (scope: WhatsAppQueryScope, conversationId: string, leadId: string | null) => {
    void queryClient.invalidateQueries({
      predicate: (query) => matchesWhatsAppMessagesQuery(
        query,
        scope,
        conversationId,
        leadId,
      ),
    });
    void queryClient.invalidateQueries({
      queryKey: whatsappQueryKeys.paginatedMessagesForConversation(scope, conversationId),
    });
    if (leadId) {
      void queryClient.invalidateQueries({
        queryKey: whatsappQueryKeys.leadMessagesScope(scope, leadId),
      });
    }
  };

  const mutation = useMutation({
    mutationFn: async (variables: ReactToWhatsAppMessageVariables) => {
      assertCurrent(variables);
      const reactionScope = variables._scope!;
      if (!variables.conversation.session_id || !variables.targetMessage.session_id) {
        throw new Error("WHATSAPP_SESSION_UNAVAILABLE");
      }
      if (!canReactToWhatsAppMessage(variables.targetMessage)) {
        throw new Error("WHATSAPP_MESSAGE_NOT_READY_FOR_REACTION");
      }
	  const expectedLeadId = requireConversationLeadId(variables.conversation);

      return runWhatsAppRequestIntent(reactionScope, requestsRef.current, (intent) => whatsappAPI.reactToMessage(
        variables.conversation.id,
        variables.targetMessage.id,
        {
          emoji: variables.emoji,
          clientReactionId: variables._clientReactionId || createClientId('reaction'),
		  expectedLeadId,
        },
        reactionScope.organizationId,
        intent,
      ));
    },
    onMutate: async (variables) => {
      assertCurrent(variables);
      const scope = variables._scope!;
      if (!variables.conversation.session_id || !variables.targetMessage.session_id) {
        throw new Error("WHATSAPP_SESSION_UNAVAILABLE");
      }
      if (!canReactToWhatsAppMessage(variables.targetMessage)) {
        throw new Error("WHATSAPP_MESSAGE_NOT_READY_FOR_REACTION");
      }

      const conversationId = variables.conversation.id;
	  const leadId = requireConversationLeadId(variables.conversation);
      const clientReactionId = createClientId('reaction');
      variables._clientReactionId = clientReactionId;
      const targetProviderMessageId = variables.targetMessage.message_id || variables.targetMessage.id;

      await Promise.all([
        queryClient.cancelQueries({
          predicate: (query) => matchesWhatsAppMessagesQuery(
            query,
            scope,
            conversationId,
            leadId,
          ),
        }),
        queryClient.cancelQueries({
          queryKey: whatsappQueryKeys.paginatedMessagesForConversation(scope, conversationId),
        }),
        leadId
          ? queryClient.cancelQueries({
              queryKey: whatsappQueryKeys.leadMessagesScope(scope, leadId),
            })
          : Promise.resolve(),
      ]);

      assertCurrent(variables);
      const optimisticReaction: WhatsAppMessage = {
        id: clientReactionId,
        conversation_id: conversationId,
        session_id: variables.targetMessage.session_id || variables.conversation.session_id,
        message_id: clientReactionId,
        client_message_id: clientReactionId,
        from_me: true,
        content: variables.emoji || null,
        message_type: 'reaction',
        media_url: null,
        media_mime_type: null,
        remote_jid: variables.targetMessage.remote_jid || variables.conversation.remote_jid,
        reaction_to_message_id: targetProviderMessageId,
        reaction_emoji: variables.emoji || null,
        reaction_sender_jid: null,
        reaction_sender_name: profile?.name || null,
        status: 'queued',
        sent_at: new Date().toISOString(),
        delivered_at: null,
        read_at: null,
        sender_jid: null,
        sender_name: profile?.name || null,
      };

      updateReactionCaches(
        scope,
        conversationId,
        leadId,
        (messages) => upsertCachedWhatsAppMessage(messages, optimisticReaction),
      );

      return { clientReactionId, conversationId, leadId, scope };
    },
    onSuccess: (result, variables, context) => {
      const conversationId = result.conversationId || context?.conversationId || variables.conversation.id;
      const leadId = context?.leadId ?? getConversationLeadId(variables.conversation);
      const scope = context?.scope ?? variables._scope!;
      updateReactionCaches(
        scope,
        conversationId,
        leadId,
        (messages) => upsertCachedWhatsAppMessage(messages, result.reaction as WhatsAppMessage),
      );

      const refresh = () => refreshReactionCaches(scope, conversationId, leadId);
      if (typeof window === 'undefined') refresh();
      else window.setTimeout(refresh, 4_000);
    },
    onError: (error: Error, variables, context) => {
      if (!context?.clientReactionId) return;
      const status = getWhatsAppSendFailureStatus(error);
      const isDefinitive = status === 'failed';
      updateReactionCaches(
        context.scope,
        context.conversationId,
        context.leadId,
        (messages) => isDefinitive
          ? messages.filter((message) => message.id !== context.clientReactionId)
          : messages.map((message) => message.id === context.clientReactionId
            ? { ...message, status: 'confirming' }
            : message),
      );
      refreshReactionCaches(context.scope, context.conversationId, context.leadId);
      if (!isCurrent(variables)) return;
      toast({
        title: isDefinitive ? 'Reacao nao enviada' : 'Confirmando reacao',
        description: isDefinitive
          ? 'Não foi possível aplicar esta reação.'
          : 'A confirmacao ainda nao chegou. A reacao sera atualizada automaticamente.',
        variant: isDefinitive ? 'destructive' : 'default',
      });
    },
  });
  const { mutate, mutateAsync } = mutation;
  const stableMutate = useCallback((variables: ReactToWhatsAppMessageVariables, options?: Parameters<typeof mutate>[1]) =>
    mutate({ ...variables, _scope: { ...lifecycleRef.current.scope }, _scopeGeneration: lifecycleRef.current.generation }, options), [mutate]);
  const stableMutateAsync = useCallback((variables: ReactToWhatsAppMessageVariables, options?: Parameters<typeof mutateAsync>[1]) =>
    mutateAsync({ ...variables, _scope: { ...lifecycleRef.current.scope }, _scopeGeneration: lifecycleRef.current.generation }, options), [mutateAsync]);
  return {
    ...mutation,
    mutate: stableMutate,
    mutateAsync: stableMutateAsync,
  };
}

export function useMarkConversationAsRead() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();

  return useWhatsAppIntentMutation({
    mutationFn: async (conversation: {
      id: string;
      session_id: string | null;
      remote_jid: string;
      is_group?: boolean;
	  lead_id?: string | null;
	  lead?: { id: string };
    }, intent) => {
	  const expectedLeadId = requireConversationBindingSnapshot(conversation as WhatsAppConversation);
	  await whatsappAPI.markConversationAsRead(conversation.id, expectedLeadId, scope.organizationId, intent);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
    },
  });
}

export function useMarkAsSeenOnWhatsApp() {
  const scope = useWhatsAppQueryScope();

  return useWhatsAppIntentMutation({
    mutationFn: async (conversation: {
      id: string;
      session_id: string | null;
      remote_jid: string;
      is_group?: boolean;
	  lead_id?: string | null;
	  lead?: { id: string };
    }, intent) => {
	  if (!conversation.session_id) {
		throw new Error("WHATSAPP_SESSION_UNAVAILABLE");
	  }
	  const expectedLeadId = requireConversationBindingSnapshot(conversation as WhatsAppConversation);
	  await whatsappAPI.markAsSeenOnWhatsApp(conversation.id, expectedLeadId, scope.organizationId, intent);
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Não foi possível marcar como lida no WhatsApp",
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({
        title: "Sucesso",
        description: "Mensagem marcada como lida no WhatsApp",
      });
    },
  });
}

export function useArchiveConversation() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();
  useIsMutating({ predicate: mutation => isWhatsAppArchiveInvocation(mutation.state.variables, scope) });

	const mutation = useWhatsAppIntentMutation({
	mutationFn: async ({ conversation, archive }: { conversation: WhatsAppConversation; archive: boolean }, intent) => {
	  const expectedLeadId = requireConversationBindingSnapshot(conversation);
	  return runExclusiveWhatsAppArchive(queryClient, intent.scope, conversation.id, async () => {
	    try {
	      await whatsappAPI.archiveConversation(conversation.id, archive, expectedLeadId, intent.scope.organizationId, intent);
	    } finally {
	      // A transport abort after HTTP cannot undo a server effect. Mark only the
	      // captured owner's entries stale, including inactive physical snapshots.
	      await queryClient.invalidateQueries({ refetchType: 'none', predicate: query =>
	        matchesWhatsAppArchiveQuery(query.queryKey, intent.scope, conversation.id, expectedLeadId) });
	    }
	  });
    },
    onSuccess: async (_, variables, _context, intent) => {
      const expectedLeadId = requireConversationBindingSnapshot(variables.conversation);
      await queryClient.invalidateQueries({ predicate: query =>
        matchesWhatsAppArchiveQuery(query.queryKey, intent.scope, variables.conversation.id, expectedLeadId) });
      if (!intent.isCurrent()) return;
      toast({
        title: variables.archive ? "Conversa arquivada" : "Conversa desarquivada",
        description: variables.archive
          ? "A conversa foi movida para o arquivo"
          : "A conversa foi restaurada",
      });
    },
    onError: () => {
      toast({
        title: "Não foi possível atualizar a conversa",
        description: "Tente novamente em alguns instantes.",
        variant: "destructive",
      });
    },
  });
  return { ...mutation, isPendingFor: (conversation: Pick<WhatsAppConversation, 'id'>) =>
    queryClient.getMutationCache().findAll({ status: 'pending', predicate: entry =>
      isWhatsAppArchiveInvocation(entry.state.variables, scope, conversation.id) }).length > 0 };
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();

  return useWhatsAppIntentMutation({
	mutationFn: async (conversation: WhatsAppConversation, intent) => {
	  const expectedLeadId = requireConversationBindingSnapshot(conversation);
	  await whatsappAPI.deleteConversation(conversation.id, expectedLeadId, scope.organizationId, intent);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
      toast({
        title: "Conversa removida",
        description: "A conversa foi removida da lista",
      });
    },
    onError: () => {
      toast({
        title: "Não foi possível remover a conversa",
        description: "A conversa foi mantida. Tente novamente.",
        variant: "destructive",
      });
    },
  });
}

export function useLinkConversationToLead() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();

  return useWhatsAppIntentMutation({
    mutationFn: async ({ conversation, leadId, expectedPreviousLeadId, ownSessionOnly, futureOnly }: {
      conversation: WhatsAppConversation;
      leadId: string;
      expectedPreviousLeadId: string;
      ownSessionOnly?: boolean;
      futureOnly?: true;
    }, intent) => {
      if (requireConversationBindingSnapshot(conversation) !== expectedPreviousLeadId) {
        throw new Error('A conversa mudou depois da prévia de vínculo');
      }
      return whatsappAPI.linkConversationToLead(
        conversation.id,
        leadId,
        expectedPreviousLeadId,
        scope.organizationId, intent, ownSessionOnly, futureOnly,
      );
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({
		queryKey: whatsappQueryKeys.conversation(scope, variables.conversation.id, variables.leadId),
      });
      queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
      queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.leadMessagesScope(scope, variables.leadId) });
      queryClient.invalidateQueries({ queryKey: ['lead-history-v2', variables.leadId] });
      toast({
        title: result.bindingMode === 'history_only' ? "Histórico vinculado" : "Conversa vinculada",
        description: variables.futureOnly ? 'O vínculo vale para as próximas mensagens.' : result.attachedMessageCount > 0
          ? result.attachedMessageCount === 1
            ? "1 mensagem preservada foi anexada ao lead."
            : `${result.attachedMessageCount} mensagens preservadas foram anexadas ao lead.`
          : "Nenhuma mensagem preservada foi anexada ao lead.",
      });
    },
    onError: () => {
      toast({
        title: "A conversa mudou",
        description: "Atualize a conversa antes de tentar vinculá-la novamente.",
        variant: "destructive",
      });
    },
  });
}
