import type { Query, QueryClient } from "@tanstack/react-query";
import { sortWhatsAppMessages } from "@/lib/whatsapp-message-order";
import { WhatsAppRealtimeRefreshCoordinator, type WhatsAppRealtimeRefreshRequest } from "@/lib/realtime/whatsapp-refresh-coordinator";
import {
  matchesLeadMessagesQueryKey,
  matchesPaginatedWhatsAppMessagesQueryKey,
  matchesWhatsAppAttendanceQueryKey,
  matchesWhatsAppMessageRefreshQueryKey,
  matchesWhatsAppMessagesQueryKey,
  WHATSAPP_MESSAGES_RECONCILE_EVENT,
  whatsappQueryKeys,
  type WhatsAppQueryScope,
} from "@/lib/whatsapp-query-cache";
import { refreshWhatsAppQueries } from "@/lib/realtime/whatsapp-query-refresh";
import type { WhatsAppMessage } from "@/hooks/whatsapp/whatsapp-conversation-types";

export const WHATSAPP_SEND_RECONCILE_DELAYS_MS = [4_000, 15_000] as const;

export const WHATSAPP_UNCERTAIN_SEND_RECONCILE_DELAYS_MS = [0, 4_000, 15_000, 60_000] as const;

const scheduledMessageReconciliations = new Map<string, ReturnType<typeof setTimeout>>();

const whatsappRealtimeRefreshCoordinators = new WeakMap<
  QueryClient,
  WhatsAppRealtimeRefreshCoordinator<WhatsAppQueryScope>
>();

const messageIdentityAliases = (message: WhatsAppMessage) => [
  message.id,
  message.message_id,
  message.client_message_id,
].filter((value): value is string => Boolean(value));

export const upsertCachedWhatsAppMessage = (
  messages: WhatsAppMessage[],
  nextMessage: WhatsAppMessage,
) => {
  const nextAliases = new Set(messageIdentityAliases(nextMessage));
  const existingIndex = messages.findIndex((message) =>
    messageIdentityAliases(message).some((alias) => nextAliases.has(alias)),
  );
  const next = [...messages];
  if (existingIndex >= 0) {
    next[existingIndex] = { ...next[existingIndex], ...nextMessage };
  } else {
    next.push(nextMessage);
  }
  return sortWhatsAppMessages(next);
};

const RETRYABLE_LOCAL_MESSAGE_STATUSES = new Set([
  "queued",
  "pending",
  "sending",
  "confirming",
  "failed",
  "error",
]);

export const upsertOptimisticWhatsAppMessage = (
  messages: WhatsAppMessage[],
  optimisticMessage: WhatsAppMessage,
) => {
  const optimisticAliases = new Set(messageIdentityAliases(optimisticMessage));
  const existingIndex = messages.findIndex((message) =>
    messageIdentityAliases(message).some((alias) => optimisticAliases.has(alias)),
  );

  if (existingIndex < 0) return sortWhatsAppMessages([...messages, optimisticMessage]);
  if (!RETRYABLE_LOCAL_MESSAGE_STATUSES.has(messages[existingIndex].status)) return messages;

  const next = [...messages];
  next[existingIndex] = {
    ...next[existingIndex],
    status: "pending",
    sent_at: optimisticMessage.sent_at,
    media_error: null,
    delivery_error_code: null,
    delivery_failed_at: null,
    metadata: {
      ...(next[existingIndex].metadata ?? {}),
      local_delivery_state: "retrying_same_client_id",
    },
  };
  return sortWhatsAppMessages(next);
};

export const matchesWhatsAppMessagesQuery = (
  query: Query,
  scope: WhatsAppQueryScope,
  conversationId?: string | null,
  leadId?: string | null,
) => matchesWhatsAppMessagesQueryKey(query.queryKey, scope, conversationId, leadId);

function dispatchWhatsAppMessagesReconcile(scope: WhatsAppQueryScope, conversationIds?: readonly string[]) {
  if (typeof window === "undefined") return false;
  window.dispatchEvent(new CustomEvent(WHATSAPP_MESSAGES_RECONCILE_EVENT, {
    detail: { scope, ...(conversationIds?.length ? { conversationIds: [...new Set(conversationIds)] } : {}) },
  }));
  return true;
}

const getWhatsAppRealtimeScopeKey = (scope: WhatsAppQueryScope) => JSON.stringify([
  scope.organizationId ?? "none",
  scope.userId ?? "none",
  scope.accessScope,
]);

function getWhatsAppRealtimeRefreshCoordinator(queryClient: QueryClient) {
  let coordinator = whatsappRealtimeRefreshCoordinators.get(queryClient);
  if (coordinator) return coordinator;

  coordinator = new WhatsAppRealtimeRefreshCoordinator((batch) => {
    const { scope } = batch;

    if (batch.refreshConversations) {
      refreshWhatsAppQueries(queryClient, whatsappQueryKeys.conversationsScope(scope));
    }

    if (batch.refreshMessages) {
      if (batch.conversationIds.length || batch.leadIds.length) {
        void queryClient.invalidateQueries({
          predicate: (query) => query.isActive() && matchesWhatsAppAttendanceQueryKey(
            query.queryKey,
            scope,
            batch.conversationIds,
            batch.leadIds,
          ),
          refetchType: "active",
        });
      }
      if (batch.allMessages) {
        void queryClient.invalidateQueries({
          queryKey: whatsappQueryKeys.messagesScope(scope),
          refetchType: "active",
        });
      } else if (batch.conversationIds.length || batch.leadIds.length) {
        void queryClient.invalidateQueries({
          predicate: (query) => batch.conversationIds.some((conversationId) =>
            matchesWhatsAppMessagesQuery(query, scope, conversationId),
          ) || batch.leadIds.some((leadId) =>
            matchesWhatsAppMessagesQuery(query, scope, null, leadId),
          ),
          refetchType: "active",
        });
      }

      const refreshEveryPaginatedConversation = batch.allMessages
        || batch.conversationIds.length === 0;
      if (!dispatchWhatsAppMessagesReconcile(
        scope,
        refreshEveryPaginatedConversation ? undefined : batch.conversationIds,
      )) {
        void queryClient.invalidateQueries({
          ...(refreshEveryPaginatedConversation
            ? { queryKey: whatsappQueryKeys.paginatedMessagesScope(scope) }
            : {
                predicate: (query: Query) => batch.conversationIds.some((conversationId) =>
                  matchesPaginatedWhatsAppMessagesQueryKey(query.queryKey, scope, conversationId),
                ),
              }),
          refetchType: "active",
        });
      }
    }

    if (batch.refreshLeadMessages) {
      if (batch.allLeadMessages) {
        void queryClient.invalidateQueries({
          queryKey: whatsappQueryKeys.leadMessagesScope(scope),
          refetchType: "active",
        });
      } else if (batch.leadIds.length) {
        void queryClient.invalidateQueries({
          predicate: (query) => batch.leadIds.some((leadId) =>
            matchesLeadMessagesQueryKey(query.queryKey, scope, leadId),
          ),
          refetchType: "active",
        });
      }
    }
  });
  whatsappRealtimeRefreshCoordinators.set(queryClient, coordinator);
  return coordinator;
}

export function scheduleWhatsAppRealtimeRefresh(
  queryClient: QueryClient,
  scope: WhatsAppQueryScope,
  request: Omit<WhatsAppRealtimeRefreshRequest<WhatsAppQueryScope>, "scopeKey" | "scope">,
) {
  getWhatsAppRealtimeRefreshCoordinator(queryClient).schedule({
    ...request,
    scope,
    scopeKey: getWhatsAppRealtimeScopeKey(scope),
  });
}

function reconcileWhatsAppMessageQueries(
  queryClient: QueryClient,
  scope: WhatsAppQueryScope,
  conversationIds: readonly string[],
  leadId?: string | null,
) {
  const uniqueConversationIds = [...new Set(conversationIds.filter(Boolean))];
  refreshWhatsAppQueries(queryClient, whatsappQueryKeys.conversationsScope(scope));
  void queryClient.invalidateQueries({
    predicate: (query) => query.isActive() && matchesWhatsAppAttendanceQueryKey(
      query.queryKey,
      scope,
      uniqueConversationIds,
      leadId ? [leadId] : [],
    ),
    refetchType: "active",
  });
  void queryClient.invalidateQueries({
    predicate: (query) => uniqueConversationIds.some((conversationId) =>
      matchesWhatsAppMessagesQuery(query, scope, conversationId, leadId),
    ) || Boolean(leadId && matchesWhatsAppMessagesQuery(query, scope, null, leadId)),
    refetchType: "active",
  });

  if (leadId) {
    void queryClient.invalidateQueries({
      queryKey: whatsappQueryKeys.leadMessagesScope(scope, leadId),
      refetchType: "active",
    });
  }

  if (!dispatchWhatsAppMessagesReconcile(scope, uniqueConversationIds)) {
    void queryClient.invalidateQueries({
      predicate: (query) => matchesWhatsAppMessageRefreshQueryKey(
        query.queryKey,
        scope,
        uniqueConversationIds,
        leadId,
      ),
      refetchType: "active",
    });
  }
}

export function scheduleWhatsAppMessageReconciliation(
  queryClient: QueryClient,
  scope: WhatsAppQueryScope,
  conversationIds: readonly string[],
  leadId: string | null,
  delays: readonly number[],
) {
  const uniqueConversationIds = [...new Set(conversationIds.filter(Boolean))].sort();
  const targetKey = [
    scope.organizationId ?? "none",
    scope.userId ?? "none",
    scope.accessScope,
    uniqueConversationIds.join(","),
    leadId ?? "none",
  ].join(":");

  delays.forEach((delay) => {
    const run = () => reconcileWhatsAppMessageQueries(
      queryClient,
      scope,
      uniqueConversationIds,
      leadId,
    );
    if (delay <= 0) {
      run();
      return;
    }

    const timerKey = `${targetKey}:${delay}`;
    if (scheduledMessageReconciliations.has(timerKey)) return;
    const timer = setTimeout(() => {
      scheduledMessageReconciliations.delete(timerKey);
      run();
    }, delay);
    scheduledMessageReconciliations.set(timerKey, timer);
  });
}
