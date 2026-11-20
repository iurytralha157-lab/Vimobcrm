import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQueryClient, type Query } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { whatsappAPI, type SendWhatsAppMessageResult, type WhatsAppQuotedMessage } from "@/lib/api/whatsapp";
import { VimobAPIError } from "@/lib/api/vimob-error";
import { createClientId } from "@/lib/client-id";
import { fingerprintWhatsAppFile, getWhatsAppFileIntentStore, getWhatsAppFileIntentOwnerKey, runWhatsAppFileIntent, settleWhatsAppFileIntent } from '@/lib/whatsapp-file-send-intent';
import { reserveWhatsAppSendAdmission } from '@/lib/whatsapp-send-admission';
import { canDiscardFailedLocalWhatsAppMessage, getWhatsAppSendIntentResolution, isWhatsAppSendScopeCurrent, type WhatsAppSendIntentResolution } from "@/lib/whatsapp-send-intent";
import { getWhatsAppSendFailureStatus, matchesLeadMessagesQueryKey, matchesPaginatedWhatsAppMessagesQueryKey, whatsappQueryKeys, type WhatsAppQueryScope } from "@/lib/whatsapp-query-cache";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import { getWhatsAppLocalSendPreviewStore, getWhatsAppLocalSendPreviewText, type SendPreviewOwner } from '@/lib/whatsapp-local-send-preview';
import { runWhatsAppRequestIntent, abortWhatsAppRequestIntents } from '@/lib/whatsapp-request-intent';
import type { WhatsAppConversation, WhatsAppMessage, PaginatedWhatsAppMessages } from "@/hooks/whatsapp/whatsapp-conversation-types";
import { getConversationLeadId, requireConversationLeadId } from "@/hooks/whatsapp/whatsapp-conversation-binding";
import {
  matchesWhatsAppMessagesQuery,
  scheduleWhatsAppMessageReconciliation,
  scheduleWhatsAppRealtimeRefresh,
  upsertOptimisticWhatsAppMessage,
  WHATSAPP_SEND_RECONCILE_DELAYS_MS,
  WHATSAPP_UNCERTAIN_SEND_RECONCILE_DELAYS_MS,
} from "@/hooks/whatsapp/whatsapp-message-cache";

export function useSendWhatsAppMessage() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const scope = useWhatsAppQueryScope();
  const previewStore = getWhatsAppLocalSendPreviewStore(queryClient);
  const previewOwner = useRef<SendPreviewOwner | null>(null);
  const { organizationId: previewOrganizationId, userId: previewUserId, accessScope: previewAccessScope } = scope;
  useLayoutEffect(() => {
    const owner = previewStore.createOwner({ organizationId: previewOrganizationId, userId: previewUserId, accessScope: previewAccessScope });
    previewOwner.current = owner;
    return () => {
      previewStore.retireOwner(owner, true);
      if (previewOwner.current === owner) previewOwner.current = null;
    };
  }, [previewStore, previewOrganizationId, previewUserId, previewAccessScope]);
  const resolveFileIntent = useResolveWhatsAppSendIntent();
  const resolveFileIntentRef = useRef(resolveFileIntent);
  useLayoutEffect(() => { resolveFileIntentRef.current = resolveFileIntent; }, [resolveFileIntent]);
  const currentScopeRef = useRef(scope);
  const originalOrganizationRef = useRef(profile?.organization_id ?? null);
  const currentScopeGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const requestsRef = useRef(new Set<AbortController>());
  const [pendingAdmissions, setPendingAdmissions] = useState(() => ({ generation: 0, tokens: new Map<symbol, number>() }));
  useLayoutEffect(() => {
    const requests = requestsRef.current;
    mountedRef.current = true;
    const generation = currentScopeGenerationRef.current;
    setPendingAdmissions(current => current.generation === generation ? current : { ...current, generation });
    return () => { mountedRef.current = false; currentScopeGenerationRef.current += 1; abortWhatsAppRequestIntents(requests); };
  }, []);
  useLayoutEffect(() => {
    if (!isWhatsAppSendScopeCurrent(scope, currentScopeRef.current)
      || originalOrganizationRef.current !== (profile?.organization_id ?? null)) {
      currentScopeGenerationRef.current += 1;
      abortWhatsAppRequestIntents(requestsRef.current);
      const generation = currentScopeGenerationRef.current;
      setPendingAdmissions(current => ({ ...current, generation }));
    }
    currentScopeRef.current = scope;
    originalOrganizationRef.current = profile?.organization_id ?? null;
  }, [profile?.organization_id, scope]);

  const mutation = useMutation({
    mutationFn: async ({
      conversation,
      text,
      mediaUrl,
      mediaType,
      base64,
      mimetype,
      filename,
      sendSessionId,
      clientMessageId,
      quotedMessageId,
      _scope,
      _scopeGeneration,
      _optimisticId,
      _admissionQueued,
    }: {
      conversation: WhatsAppConversation;
      text: string;
      mediaUrl?: string;
      mediaType?: string;
      base64?: string;
      mimetype?: string;
      filename?: string;
      sendSessionId?: string;
      previewMediaUrl?: string;
      clientMessageId?: string;
      quotedMessageId?: string;
      optimisticQuotedMessage?: WhatsAppQuotedMessage;
      fileIntentSource?: File;
      fileIntentIsCurrent?: () => boolean;
      fileIntentVerificationOnly?: boolean;
      _scope?: WhatsAppQueryScope;
      _scopeGeneration?: number;
      _optimisticId?: string;
      _admissionQueued?: boolean;
    }): Promise<SendWhatsAppMessageResult> => {
      const sendScope = _scope ?? scope;
      if (!sendScope.organizationId || sendScope.organizationId !== originalOrganizationRef.current) {
        throw new VimobAPIError("O atendimento WhatsApp está disponível somente na organização original do seu cadastro.", { status: 403, code: "whatsapp_original_organization_required" });
      }
      if (!mountedRef.current || !isWhatsAppSendScopeCurrent(sendScope, currentScopeRef.current)
        || (_scopeGeneration !== undefined && _scopeGeneration !== currentScopeGenerationRef.current)) {
        throw new VimobAPIError("O contexto do atendimento mudou. Reabra a conversa antes de enviar.", { status: 409, code: "whatsapp_send_context_changed" });
      }
      if (!conversation.session_id) {
        throw new Error("WHATSAPP_SESSION_UNAVAILABLE");
      }
	  const expectedLeadId = requireConversationLeadId(conversation);
      if (_admissionQueued) {
        // An admission waited behind another hook/gesture. Recheck attendance
        // after that wait and asynchronous onMutate; the POST rechecks grants.
        const sessionId = sendSessionId || conversation.session_id;
        const [attendance, authorized] = await runWhatsAppRequestIntent(sendScope, requestsRef.current, intent => Promise.all([
          whatsappAPI.getConversationAttendance(conversation.id, { expectedLeadId, sendSessionId: sessionId }, sendScope.organizationId, intent),
          whatsappAPI.getSessions(sendScope.organizationId, undefined, intent),
        ]));
        if (!mountedRef.current || !isWhatsAppSendScopeCurrent(sendScope, currentScopeRef.current)
          || _scopeGeneration !== currentScopeGenerationRef.current) {
          throw new VimobAPIError("O contexto do atendimento mudou. Reabra a conversa antes de enviar.", { status: 409, code: "whatsapp_send_context_changed" });
        }
        if (!attendance.joined) throw new VimobAPIError("Confirme o início do atendimento antes de enviar.", { status: 409, code: "whatsapp_attendance_required" });
        const freshSession = authorized.data.find(session => session.id === sessionId && session.organization_id === sendScope.organizationId);
        if (!freshSession || freshSession.is_active === false || freshSession.provider !== "evolution_go") {
          throw new VimobAPIError("Você não tem mais acesso para enviar por este WhatsApp.", { status: 403, code: "whatsapp_session_access_revoked" });
        }
        if (freshSession.status !== "connected") throw new VimobAPIError("WhatsApp desconectado.", { status: 400, code: "whatsapp_disconnected" });
        if (freshSession.can_send !== true) throw new VimobAPIError("Você não tem mais acesso para enviar por este WhatsApp.", { status: 403, code: "whatsapp_session_access_revoked" });
      }

      return runWhatsAppRequestIntent(sendScope, requestsRef.current, (intent) => whatsappAPI.sendMessage(
        conversation.id,
        {
          text,
		  expectedLeadId,
          mediaUrl,
          mediaType,
          base64,
          mimetype,
          filename,
          sendSessionId,
          clientMessageId: clientMessageId || _optimisticId,
          quotedMessageId,
        },
        sendScope.organizationId,
        intent,
      ));
    },
    onMutate: async (variables) => {
      const scope = variables._scope ?? currentScopeRef.current;
      const scopeGeneration = variables._scopeGeneration ?? currentScopeGenerationRef.current;
      if (!mountedRef.current) {
        throw new VimobAPIError("O contexto do atendimento mudou. Reabra a conversa antes de enviar.", { status: 409, code: "whatsapp_send_context_changed" });
      }
      if (!scope.organizationId || scope.organizationId !== originalOrganizationRef.current) {
        throw new VimobAPIError("O atendimento WhatsApp está disponível somente na organização original do seu cadastro.", { status: 403, code: "whatsapp_original_organization_required" });
      }
      if (!variables.conversation.session_id) {
        throw new Error("WHATSAPP_SESSION_UNAVAILABLE");
      }

      const conversationId = variables.conversation.id;
	  const leadId = requireConversationLeadId(variables.conversation);
      const optimisticId = variables.clientMessageId || variables._optimisticId || createClientId('message');
      variables.clientMessageId = optimisticId;
      variables._optimisticId = optimisticId;

      const messagesPredicate = (q: Query) =>
        matchesWhatsAppMessagesQuery(q, scope, conversationId, leadId);
      const leadMessagesPredicate = (q: Query) => Boolean(
        leadId && matchesLeadMessagesQueryKey(q.queryKey, scope, leadId),
      );
      await Promise.all([
        queryClient.cancelQueries({ predicate: messagesPredicate }),
        queryClient.cancelQueries({ predicate: leadMessagesPredicate }),
      ]);
      if (!mountedRef.current || !isWhatsAppSendScopeCurrent(scope, currentScopeRef.current)
        || scopeGeneration !== currentScopeGenerationRef.current) {
        throw new VimobAPIError("O contexto do atendimento mudou. Reabra a conversa antes de enviar.", { status: 409, code: "whatsapp_send_context_changed" });
      }

      const isMediaMessage = !!(variables.mediaType && variables.mediaType !== "text");
      const isFilenameContent = variables.text && (
        variables.text === variables.filename ||
        variables.text.match(/^[a-f0-9-]+\.(png|jpg|jpeg|gif|webp|mp4|mp3|ogg|pdf|doc|docx)$/i) ||
        variables.text.match(/^\S+\.(png|jpg|jpeg|gif|webp|mp4|mp3|ogg|pdf|doc|docx)$/i)
      );
      const optimisticContent = isMediaMessage && isFilenameContent ? null : variables.text;

      const optimisticMessage: WhatsAppMessage & { client_message_id?: string } = {
        id: optimisticId,
        conversation_id: conversationId,
        session_id: variables.sendSessionId || variables.conversation.session_id,
        message_id: optimisticId,
        client_message_id: optimisticId,
        from_me: true,
        content: optimisticContent,
        message_type: variables.mediaType || "text",
        media_url: variables.previewMediaUrl || variables.mediaUrl || null,
        media_mime_type: variables.mimetype || null,
        media_filename: variables.filename || null,
        quoted_message: variables.optimisticQuotedMessage,
        remote_jid: variables.conversation.remote_jid,
        status: "pending",
        sent_at: new Date().toISOString(),
        delivered_at: null,
        read_at: null,
        sender_jid: null,
        sender_name: profile?.name || null,
        sender_user_id: scope.userId || null,
        media_status: (variables.previewMediaUrl || variables.mediaUrl) ? "ready" : null,
        media_storage_path: null,
        media_error: null,
      };

      queryClient.setQueriesData<WhatsAppMessage[]>(
        {
          predicate: (q) =>
            matchesWhatsAppMessagesQuery(q, scope, conversationId, leadId),
        },
        (old) => {
          return old
            ? upsertOptimisticWhatsAppMessage(old, optimisticMessage)
            : [optimisticMessage];
        },
      );

      queryClient.setQueriesData<PaginatedWhatsAppMessages>(
        {
          predicate: (query) =>
            matchesPaginatedWhatsAppMessagesQueryKey(query.queryKey, scope, conversationId, leadId),
        },
        (old) => {
          const firstPage = old?.pages?.[0];
          if (!old?.pages || !firstPage) return old;
          return {
            ...old,
            pages: [
              {
                ...firstPage,
                messages: upsertOptimisticWhatsAppMessage(firstPage.messages, optimisticMessage),
              },
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
            if (!old?.pages || !firstPage) return old;
            return {
              ...old,
              pages: [
                {
                  ...firstPage,
                  messages: upsertOptimisticWhatsAppMessage(firstPage.messages, optimisticMessage),
                },
                ...old.pages.slice(1),
              ],
            };
          },
        );
      }

      const previewToken = previewOwner.current ? previewStore.begin(previewOwner.current, variables.conversation, {
        clientId: optimisticId, sessionId: optimisticMessage.session_id!, sentAt: optimisticMessage.sent_at,
        preview: getWhatsAppLocalSendPreviewText(optimisticContent, variables.mediaType),
      }) : undefined;
      return { optimisticId, conversationId, scope, scopeGeneration, previewToken };
    },
    onSuccess: (result, variables, context) => {
      const scope = context?.scope ?? variables._scope ?? currentScopeRef.current;
      const conversationId = result?.conversationId || variables.conversation.id;
      const originalConversationId = context?.conversationId || variables.conversation.id;
      const leadId = getConversationLeadId(variables.conversation);
      const messageKeys = new Set([conversationId, originalConversationId]);
      const acceptedMessage = result.message;
      if (conversationId !== originalConversationId) previewStore.discard(context?.previewToken);
      else previewStore.advance(context?.previewToken, {
        status: acceptedMessage?.status || result.status || 'confirming', messageId: acceptedMessage?.id,
        conversationId, sessionId: acceptedMessage?.session_id, sentAt: acceptedMessage?.sent_at, fromMe: acceptedMessage?.from_me,
        clientId: acceptedMessage?.client_message_id || result.clientMessageId, canonical: Boolean(acceptedMessage?.id),
      });

      if (context?.optimisticId) {
        const canonicalMessage = result.message as WhatsAppMessage | undefined;
        const updateMessage = (msg: WhatsAppMessage): WhatsAppMessage => {
          if (msg.id !== context.optimisticId) return msg;

          if (canonicalMessage) {
            return {
              ...msg,
              ...canonicalMessage,
              client_message_id: canonicalMessage.client_message_id || result.clientMessageId,
              media_url: canonicalMessage.media_url || variables.mediaUrl || variables.previewMediaUrl || msg.media_url,
              media_status: canonicalMessage.media_status
                || (variables.mediaUrl || variables.previewMediaUrl || msg.media_url ? "ready" : msg.media_status),
            };
          }

          return {
            ...msg,
            client_message_id: result?.clientMessageId || msg.client_message_id,
            conversation_id: conversationId,
            status: result.status || "confirming",
            media_url: variables.mediaUrl || variables.previewMediaUrl || msg.media_url,
            media_status: variables.mediaUrl || variables.previewMediaUrl || msg.media_url ? "ready" : msg.media_status,
          };
        };

        for (const cacheConversationId of messageKeys) {
          queryClient.setQueriesData<WhatsAppMessage[]>(
            {
              predicate: (q) =>
                matchesWhatsAppMessagesQuery(q, scope, cacheConversationId, leadId),
            },
            (old) => old?.map(updateMessage),
          );
          queryClient.setQueriesData<PaginatedWhatsAppMessages>(
            {
              predicate: (query) => matchesPaginatedWhatsAppMessagesQueryKey(
                query.queryKey,
                scope,
                cacheConversationId,
                leadId,
              ),
            },
            (old) => old
              ? {
                  ...old,
                  pages: old.pages.map((page) => ({
                    ...page,
                    messages: page.messages.map(updateMessage),
                  })),
                }
              : old,
          );
        }

        if (leadId) {
          queryClient.setQueriesData<PaginatedWhatsAppMessages>(
            {
              predicate: (query) => matchesLeadMessagesQueryKey(query.queryKey, scope, leadId),
            },
            (old) => old
              ? {
                  ...old,
                  pages: old.pages.map((page) => ({
                    ...page,
                    messages: page.messages.map(updateMessage),
                  })),
                }
              : old,
          );
        }
      }

      queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
      scheduleWhatsAppMessageReconciliation(
        queryClient,
        scope,
        [...messageKeys],
        leadId,
        WHATSAPP_SEND_RECONCILE_DELAYS_MS,
      );
    },
    onError: (error: Error, variables, context) => {
      const scope = context?.scope ?? variables._scope ?? currentScopeRef.current;
      const errorMessage = error.message || "";
      const leadId = getConversationLeadId(variables.conversation);
      const failureStatus = getWhatsAppSendFailureStatus(error);
      const accessRevoked = error instanceof VimobAPIError && error.code === "whatsapp_session_access_revoked";
      if (accessRevoked) previewStore.discard(context?.previewToken);
      else previewStore.advance(context?.previewToken, { status: failureStatus });
      if (accessRevoked) {
        // The active composer must reflect the revocation immediately. The
        // caller keeps its draft after this definite send failure.
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.sessions(scope) }),
          queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.accessibleSessions(scope) }),
        ]);
      }

      if (context?.optimisticId) {
        const updateFailedMessage = (msg: WhatsAppMessage): WhatsAppMessage =>
          msg.id === context.optimisticId
            ? {
                ...msg,
                status: failureStatus,
                // A send error is not a media-processing error, and its raw
                // provider text can contain the recipient phone.
                media_error: msg.media_error,
                delivery_error_code: failureStatus === "failed" ? "send_failed" : null,
                delivery_failed_at: failureStatus === "failed" ? new Date().toISOString() : null,
                metadata: {
                  ...(msg.metadata ?? {}),
                  local_delivery_state: failureStatus === "confirming"
                    ? "awaiting_reconciliation"
                    : "failed",
                },
              }
            : msg;

        queryClient.setQueriesData<WhatsAppMessage[]>(
          {
            predicate: (q) =>
              matchesWhatsAppMessagesQuery(q, scope, variables.conversation.id, leadId),
          },
          (old) => old?.map(updateFailedMessage),
        );
        queryClient.setQueriesData<PaginatedWhatsAppMessages>(
          {
            predicate: (query) => matchesPaginatedWhatsAppMessagesQueryKey(
              query.queryKey,
              scope,
              variables.conversation.id,
              leadId,
            ),
          },
          (old) => old
            ? {
                ...old,
                pages: old.pages.map((page) => ({
                  ...page,
                  messages: page.messages.map(updateFailedMessage),
                })),
              }
              : old,
        );

        if (leadId) {
          queryClient.setQueriesData<PaginatedWhatsAppMessages>(
            {
              predicate: (query) => matchesLeadMessagesQueryKey(query.queryKey, scope, leadId),
            },
            (old) => old
              ? {
                  ...old,
                  pages: old.pages.map((page) => ({
                    ...page,
                    messages: page.messages.map(updateFailedMessage),
                  })),
                }
              : old,
          );
        }
      }

      if (failureStatus === "confirming") {
        queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
        scheduleWhatsAppMessageReconciliation(
          queryClient,
          scope,
          [variables.conversation.id],
          leadId,
          WHATSAPP_UNCERTAIN_SEND_RECONCILE_DELAYS_MS,
        );
      }

      const normalizedErrorMessage = errorMessage.toLowerCase();
      const isRateLimited = normalizedErrorMessage.includes("rate_limit_local") ||
                            normalizedErrorMessage.includes("rate_limit_exceeded") ||
                            normalizedErrorMessage.includes("muitas requisi");
      const isDisconnected = normalizedErrorMessage.includes("whatsapp_disconnected") ||
                             normalizedErrorMessage.includes("desconectad") ||
                             normalizedErrorMessage.includes("qr code") ||
                             normalizedErrorMessage.includes("not connected");
      const isNumberNotExists = normalizedErrorMessage.includes("nao possui whatsapp") ||
                                normalizedErrorMessage.includes("nao esta registrado") ||
                                normalizedErrorMessage.includes("not exist") ||
                                normalizedErrorMessage.includes("invalid number");

      let title = "Erro ao enviar mensagem";
      let description = "Não foi possível enviar esta mensagem. Confira a conexão e tente novamente.";

      if (failureStatus === "confirming") {
        title = "Confirmando envio";
        description = "Ainda não recebemos a confirmação. A mensagem continuará visível; não reenvie agora.";
      } else if (accessRevoked) {
        title = "Acesso ao WhatsApp revogado";
        description = "Você não tem mais acesso a este número. Inicie pelo seu WhatsApp ou conecte um número.";
      } else if (isDisconnected) {
        title = "WhatsApp Desconectado";
        description = "Vá em Configurações > WhatsApp e escaneie o QR Code novamente.";
      } else if (isNumberNotExists) {
        title = "Contato sem WhatsApp";
        description = "Este número não está no WhatsApp. Tente ligar ou enviar SMS.";
      } else if (isRateLimited) {
        title = "Aguarde um instante";
        description = "Você está enviando mensagens muito rápido. Tente novamente em alguns segundos.";
      }

      if (!isWhatsAppSendScopeCurrent(scope, currentScopeRef.current)
        || (context?.scopeGeneration ?? variables._scopeGeneration) !== currentScopeGenerationRef.current) return;
      toast({
        title,
        description,
        variant: failureStatus === "confirming" ? "default" : "destructive",
      });
    },
  });
  // TanStack may replace mutation callbacks while onMutate is awaiting cache
  // cancellation. Snapshot the tenant synchronously at the user's send gesture.
  type Variables = Parameters<typeof mutation.mutate>[0];
  const { mutateAsync } = mutation;
  const stableMutateAsync = useCallback(async (variables: Variables, options?: Parameters<typeof mutateAsync>[1]): Promise<SendWhatsAppMessageResult> => {
    const snapshot = {
      ...variables,
      conversation: {
        ...variables.conversation,
        lead: variables.conversation.lead ? { ...variables.conversation.lead,
          assignee: variables.conversation.lead.assignee ? { ...variables.conversation.lead.assignee } : variables.conversation.lead.assignee,
        } : variables.conversation.lead,
        session: variables.conversation.session ? { ...variables.conversation.session } : variables.conversation.session,
      },
      _scope: { ...currentScopeRef.current },
      _scopeGeneration: currentScopeGenerationRef.current,
    };
    const admission = reserveWhatsAppSendAdmission(snapshot._scope, snapshot.sendSessionId || snapshot.conversation.session_id, snapshot.conversation.id);
    const pendingToken = Symbol();
    if (mountedRef.current) setPendingAdmissions(current => ({ ...current,
      tokens: new Map(current.tokens).set(pendingToken, snapshot._scopeGeneration),
    }));
    const admittedSend = async (value: Variables) => {
      await admission.wait();
      if (!mountedRef.current || snapshot._scopeGeneration !== currentScopeGenerationRef.current
        || !isWhatsAppSendScopeCurrent(snapshot._scope, currentScopeRef.current)
        || (snapshot.fileIntentIsCurrent && !snapshot.fileIntentIsCurrent())) {
        throw new VimobAPIError("O contexto do atendimento mudou. Reabra a conversa antes de enviar.", { status: 409, code: "whatsapp_send_context_changed" });
      }
      if (!snapshot._scope.organizationId || snapshot._scope.organizationId !== originalOrganizationRef.current) {
        throw new VimobAPIError("O atendimento WhatsApp está disponível somente na organização original do seu cadastro.", { status: 403, code: "whatsapp_original_organization_required" });
      }
      return mutateAsync({ ...value, _admissionQueued: admission.queued }, options);
    };
    try {
      if (!snapshot.fileIntentSource) {
        if (snapshot.fileIntentVerificationOnly) return { clientMessageId: snapshot.clientMessageId || '',
          conversationId: snapshot.conversation.id, fileIntentChecked: true, fileIntentResolution: 'pending' };
        return await admittedSend(snapshot);
      }
      const isCurrent = () => mountedRef.current && snapshot._scopeGeneration === currentScopeGenerationRef.current
        && isWhatsAppSendScopeCurrent(snapshot._scope, currentScopeRef.current)
        && snapshot._scope.organizationId === originalOrganizationRef.current
        && (!snapshot.fileIntentIsCurrent || snapshot.fileIntentIsCurrent());
      await admission.wait();
      if (!isCurrent()) return { clientMessageId: '', conversationId: snapshot.conversation.id, fileIntentChecked: true, fileIntentResolution: 'cancelled' };
      const fingerprint = await fingerprintWhatsAppFile(snapshot.fileIntentSource);
      if (!isCurrent()) return { clientMessageId: '', conversationId: snapshot.conversation.id, fileIntentChecked: true, fileIntentResolution: 'cancelled' };
      const store = getWhatsAppFileIntentStore(getWhatsAppFileIntentOwnerKey(snapshot._scope));
      const key = JSON.stringify([snapshot.conversation.id, requireConversationLeadId(snapshot.conversation),
        snapshot.sendSessionId || snapshot.conversation.session_id, fingerprint]);
      const originalId = admission.fileIntent(key);
      const outcome = originalId ? { kind: 'checked' as const, clientMessageId: originalId,
        resolution: await resolveFileIntentRef.current({ conversation: snapshot.conversation, clientMessageId: originalId }),
      } : await runWhatsAppFileIntent(store, key, {
        isCurrent,
        verificationOnly: snapshot.fileIntentVerificationOnly,
        send: clientMessageId => {
          admission.rememberFileIntent(key, clientMessageId);
          return admittedSend({ ...snapshot, clientMessageId });
        },
        check: clientMessageId => resolveFileIntentRef.current({ conversation: snapshot.conversation, clientMessageId }),
        isUnconfirmed: result => getWhatsAppSendIntentResolution(result, {
          conversationId: snapshot.conversation.id, clientMessageId: result.clientMessageId,
        }) === 'pending',
      });
      if (outcome.kind === 'sent') return outcome.result;
      // Checking an earlier unknown intent may settle/remove its store entry.
      // Gestures already overlapping this original check still use that ID;
      // a duplicate checking F1's receipt must not widen F1's overlap boundary.
      if (!originalId && outcome.clientMessageId) admission.rememberFileIntent(key, outcome.clientMessageId);
      if (isCurrent() && outcome.resolution !== 'cancelled') toast({
        title: outcome.resolution === 'pending' ? 'Confirmando envio' : 'Envio verificado',
        description: outcome.resolution === 'pending'
          ? outcome.clientMessageId
            ? 'Ainda não foi possível confirmar o envio original. Confira o estado na conversa antes de enviar novamente.'
            : 'A referência da tentativa não está disponível. Reabra a conversa e confira o envio original antes de continuar.'
          : outcome.resolution === 'accepted' ? 'O envio original está registrado na conversa.' : 'A tentativa original falhou. Você pode escolher o arquivo novamente.',
      });
      return { clientMessageId: outcome.clientMessageId, conversationId: snapshot.conversation.id,
        fileIntentChecked: true, fileIntentResolution: outcome.resolution };
    } finally {
      admission.release();
      if (mountedRef.current) setPendingAdmissions(current => {
        const tokens = new Map(current.tokens);
        tokens.delete(pendingToken);
        return { ...current, tokens };
      });
    }
  }, [mutateAsync]);
  const stableMutate = useCallback((variables: Variables, options?: Parameters<typeof mutateAsync>[1]) => {
    void stableMutateAsync(variables, options).catch(() => {});
  }, [stableMutateAsync]);
  return {
    ...mutation,
    isPending: [...pendingAdmissions.tokens.values()].some(generation => generation === pendingAdmissions.generation)
      || (mutation.isPending && mutation.variables?._scopeGeneration === pendingAdmissions.generation),
    mutate: stableMutate,
    mutateAsync: stableMutateAsync,
  };
}

export function useResolveWhatsAppSendIntent() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const scope = useWhatsAppQueryScope();
  const currentRef = useRef({ scope, originalOrganization: profile?.organization_id ?? null, generation: 0, mounted: false });
  const pendingRef = useRef(new Set<AbortController>());
  useLayoutEffect(() => {
    const lifecycle = currentRef.current;
    lifecycle.mounted = true;
    const pending = pendingRef.current;
    return () => {
      lifecycle.mounted = false;
      lifecycle.generation += 1;
      for (const controller of pending) controller.abort();
      pending.clear();
    };
  }, []);
  useLayoutEffect(() => {
    if (!isWhatsAppSendScopeCurrent(scope, currentRef.current.scope)) {
      currentRef.current.generation += 1;
      for (const controller of pendingRef.current) controller.abort();
      pendingRef.current.clear();
    }
    currentRef.current.scope = scope;
    currentRef.current.originalOrganization = profile?.organization_id ?? null;
  }, [profile?.organization_id, scope]);
  return async ({ conversation, clientMessageId }: {
    conversation: WhatsAppConversation; clientMessageId: string;
  }): Promise<WhatsAppSendIntentResolution> => {
    const generation = currentRef.current.generation;
    const isCurrent = () => currentRef.current.mounted
      && generation === currentRef.current.generation
      && isWhatsAppSendScopeCurrent(scope, currentRef.current.scope);
    if (!isCurrent()) return 'cancelled';
    const leadId = requireConversationLeadId(conversation);
    const controller = new AbortController();
    pendingRef.current.add(controller);
    try {
      const result = await whatsappAPI.getSendStatus({
        conversationId: conversation.id, expectedLeadId: leadId, clientMessageId,
        organizationId: scope.organizationId,
        signal: controller.signal,
      }, { expectedUserId: scope.userId });
      if (!isCurrent()) return 'cancelled';
      const resolution = getWhatsAppSendIntentResolution(result, { conversationId: conversation.id, clientMessageId });
      if (resolution === 'accepted' || resolution === 'failed') {
        settleWhatsAppFileIntent(getWhatsAppFileIntentStore(getWhatsAppFileIntentOwnerKey(scope)), clientMessageId);
      }
      if (resolution !== 'pending' && result.message) {
        // Canonical data replaces a local attempt only in its original scope.
        scheduleWhatsAppRealtimeRefresh(queryClient, scope, {
          refreshConversations: true, refreshMessages: true, refreshLeadMessages: true,
          conversationIds: [conversation.id], leadIds: [leadId],
        });
      }
      return resolution;
    } catch (error) {
      if (!isCurrent()) return 'cancelled';
      if (error instanceof VimobAPIError) {
        if (error.status === 404 && error.code === 'whatsapp_message_not_found') return 'pending';
        if (error.code === 'api_request_identity_changed') return 'cancelled';
        if (error.status === 403 || error.status === 404 || error.status === 410
          || (error.status === 400 && error.code === 'invalid_whatsapp_reference')) return 'cancelled';
      }
      return 'pending';
    } finally {
      pendingRef.current.delete(controller);
    }
  };
}

export function useDiscardFailedLocalWhatsAppMessage() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();
  return ({ conversation, message }: { conversation: WhatsAppConversation; message: WhatsAppMessage }) => {
    if (!canDiscardFailedLocalWhatsAppMessage(message)) return;
    const leadId = requireConversationLeadId(conversation);
    const remove = (messages: WhatsAppMessage[]) => messages.filter((current) =>
      current.id !== message.id || !canDiscardFailedLocalWhatsAppMessage(current));
    const predicate = (query: Query) => matchesWhatsAppMessagesQuery(query, scope, conversation.id, leadId)
      || matchesPaginatedWhatsAppMessagesQueryKey(query.queryKey, scope, conversation.id, leadId)
      || matchesLeadMessagesQueryKey(query.queryKey, scope, leadId);
    queryClient.setQueriesData<WhatsAppMessage[] | PaginatedWhatsAppMessages>({ predicate }, (old) => {
      if (Array.isArray(old)) return remove(old);
      return old ? { ...old, pages: old.pages.map((page) => ({ ...page, messages: remove(page.messages) })) } : old;
    });
  };
}
