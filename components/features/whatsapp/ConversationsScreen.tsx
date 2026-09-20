"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { ConversationHeader } from "@/components/features/whatsapp/ConversationHeader";
import { ConversationLeadPanel, ConversationUnregisteredPanel } from "@/components/features/whatsapp/ConversationLeadPanel";
import {
  ConversationComposer,
  ConversationEmptyState,
  ConversationFilters,
  ConversationList,
  ConversationMessages,
  ConversationOverlays,
  MobileConversationHeader,
  filterWhatsAppConversations,
  formatConversationTime,
  getConversationAvatarUrl,
  matchesConversationSearch,
  toScreenConversation,
  type ConversationListReturnPosition,
  type ConversationPlatform,
  type CreateLeadContact,
  type DisplayMessage,
  type ScreenConversation,
} from "@/components/features/whatsapp/conversations";
import { normalizeSearchText } from "@/lib/search-text";
import { useWhatsAppConversation, useWhatsAppConversationForLead, useWhatsAppConversationSnapshot, useWhatsAppConversations, useSendWhatsAppMessage, useReactToWhatsAppMessage, useMarkConversationAsRead, useWhatsAppLeadRealtime, useArchiveConversation, useDeleteConversation, useLinkConversationToLead, type WhatsAppConversation, type WhatsAppMessage } from "@/hooks/use-whatsapp-conversations";
import { useWhatsAppMessagesPaginated } from "@/hooks/use-whatsapp-messages-paginated";
import { useAccessibleSessions } from "@/hooks/use-accessible-sessions";
import { getWhatsAppSendFailureStatus, resolveWhatsAppConversationSessionFilter } from "@/lib/whatsapp-query-cache";
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { normalizeWhatsAppContactPhoneToE164 } from "@/lib/phone-utils";
import { useTags } from "@/hooks/use-tags";
import { useAddLeadTag, useRemoveLeadTag } from "@/hooks/use-leads";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMetaConversations, useMetaMessages, useSendMetaMessage } from "@/hooks/use-meta-conversations";
import { createUUID } from "@/lib/client-id";
import { useMetaIntegrations } from "@/hooks/use-meta-integration";
import { whatsappAPI } from "@/lib/api/whatsapp";
import {
	getWhatsAppConversationDraftKey,
  getWhatsAppConversationMessageScope,
  getWhatsAppMessageInputState,
  preserveWhatsAppConversationCardSnapshot,
	updateWhatsAppConversationDraft,
} from "@/lib/whatsapp-message-input";
import { groupLatestWhatsAppReactions } from "@/lib/whatsapp-reactions";
import { useAuth } from "@/contexts/AuthContext";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useCancelLeadExecutions, useLeadActiveAutomationExecutions } from "@/hooks/use-automations";
import {
  blobToBase64,
  compressOutboundImageFile,
  getMessageMediaExtension,
  getOutboundMessageMediaKind,
  MAX_OUTBOUND_MESSAGE_MEDIA_BYTES,
  OUTBOUND_IMAGE_COMPRESSION_PROFILES,
} from "@/components/features/whatsapp/message-media";

type ConversationsProps = {
  initialConversationId?: string;
  initialLeadId?: string;
};

type LazyMediaURL = {
  url: string;
  refreshAt: number;
};

export default function Conversations({ initialConversationId, initialLeadId }: ConversationsProps) {
  const { activeOrganization, user, profile } = useAuth();
  const cancelLeadExecutions = useCancelLeadExecutions();
  const { hasPermission } = useUserPermissions();
  const { hasModule } = useOrganizationModules();
  const canOperateWhatsApp = hasPermission("whatsapp_operate");
  const canManageWhatsApp = hasPermission("whatsapp_manage");
  const canViewMeta = hasModule("whatsapp") && hasModule("campaigns") && hasPermission("whatsapp_view");
  const canCreateLeads = hasPermission("lead_create");
  const canOperateLeads = hasPermission("lead_operate");
  const canStartAutomations = hasModule("automations") && hasPermission("automations_manage");
  const isMobile = useIsMobile();
  const router = useRouter();
  const currentUserId = profile?.id || user?.id || null;
  const activeTenantKey = `${currentUserId || "anonymous"}:${activeOrganization.organizationId || "none"}`;
  const [activePlatform, setActivePlatform] = useState<ConversationPlatform>('whatsapp');
  const [selectedSessionId, setSelectedSessionId] = useState<string>("all");
  const [selectedPageId, setSelectedPageId] = useState<string>("all");
  const [selectedConversationState, setSelectedConversationState] = useState<{
    tenantKey: string;
	conversationId: string;
	expectedLeadId: string | null;
	conversationSnapshot: ScreenConversation;
  } | null>(null);
  const [mobileConversationListReturnPosition, setMobileConversationListReturnPosition] = useState<ConversationListReturnPosition | null>(null);
  const selectedConversationId = selectedConversationState?.tenantKey === activeTenantKey
    ? selectedConversationState.conversationId
    : null;
  const selectedExpectedLeadId = selectedConversationState?.tenantKey === activeTenantKey
	  ? selectedConversationState.expectedLeadId
	  : null;
  const setSelectedConversation = useCallback((conversation: ScreenConversation | null) => {
	const expectedLeadId = getWhatsAppConversationMessageScope(
	  conversation as WhatsAppConversation | null,
	).expectedLeadId;
    setSelectedConversationState(conversation
	  ? {
		  tenantKey: activeTenantKey,
		  conversationId: conversation.id,
		  expectedLeadId,
		  conversationSnapshot: conversation,
		}
      : null);
  }, [activeTenantKey]);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({});
  const selectedMessageDraftKey = useMemo(() => getWhatsAppConversationDraftKey({
    tenantKey: activeTenantKey,
    conversationId: selectedConversationId,
    expectedLeadId: activePlatform === "whatsapp"
      ? selectedExpectedLeadId
      : selectedConversationId ? `channel:${activePlatform}` : null,
  }), [activePlatform, activeTenantKey, selectedConversationId, selectedExpectedLeadId]);
  const messageText = selectedMessageDraftKey
    ? messageDrafts[selectedMessageDraftKey] ?? ""
    : "";
  const setMessageText = useCallback((value: string | ((current: string) => string)) => {
    if (!selectedMessageDraftKey) return;
    setMessageDrafts((currentDrafts) => updateWhatsAppConversationDraft(
      currentDrafts,
      selectedMessageDraftKey,
      value,
    ));
  }, [selectedMessageDraftKey]);
  const [hideGroups, setHideGroups] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("whatsapp-hide-groups") === "true";
  });
  const [showArchived, setShowArchived] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("whatsapp-show-archived") === "true";
  });
  const [onlyLeads, setOnlyLeads] = useState(false);
  const [withoutLeadOnly, setWithoutLeadOnly] = useState(false);
  const [pendingReplyOnly, setPendingReplyOnly] = useState(false);
  const [showAutomationDialog, setShowAutomationDialog] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastVisibleMessageIdRef = useRef<string | null>(null);
  const isUserScrollingRef = useRef<boolean>(false);
  const latestMessageScrollTimeoutRef = useRef<number | null>(null);
  const conversationChangeScrollTimeoutRef = useRef<number | null>(null);
  const resolvedDeepLinkRef = useRef<string | null>(null);
  const lazyMediaRequestsRef = useRef(new Set<string>());
  const [lazyMediaURLs, setLazyMediaURLs] = useState<Record<string, LazyMediaURL>>({});

  useEffect(() => {
    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setSelectedConversation(null);
      setSelectedSessionId("all");
      setSelectedPageId("all");
      setActivePlatform("whatsapp");
      setMessageDrafts({});
      setMobileConversationListReturnPosition(null);
      lastVisibleMessageIdRef.current = null;
      isUserScrollingRef.current = false;
    });
    return () => {
      isActive = false;
    };
  }, [user?.id, activeOrganization.organizationId, setSelectedConversation]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const leadConversationQuery = useWhatsAppConversationForLead(
	initialLeadId,
	initialConversationId,
  );
  const {
    data: selectedWhatsAppConversation,
    refetch: refetchSelectedWhatsAppConversation,
  } = useWhatsAppConversation(
    activePlatform === "whatsapp" ? selectedConversationId : null,
	activePlatform === "whatsapp" ? selectedExpectedLeadId : null,
  );
  const deepLinkKey = `${activeTenantKey}:${initialConversationId || ""}:${initialLeadId || ""}`;
  const {
    data: sessions,
    isLoading: loadingSessions,
  } = useAccessibleSessions();

  // Extract accessible session IDs for filtering
  const accessibleSessionIds = useMemo(() => sessions?.map(s => s.id) || [], [sessions]);
  const trimmedSearchTerm = searchTerm.trim();
  const conversationFilters = useMemo(
    () => ({
      hideGroups,
      showArchived,
      onlyLeads,
      withoutLead: withoutLeadOnly,
      pendingReply: pendingReplyOnly,
      search: activePlatform === 'whatsapp' ? debouncedSearchTerm : '',
    }),
    [activePlatform, debouncedSearchTerm, hideGroups, onlyLeads, pendingReplyOnly, showArchived, withoutLeadOnly],
  );
  const conversationSessionFilter = useMemo(
    () => resolveWhatsAppConversationSessionFilter(
      selectedSessionId,
      loadingSessions ? [] : accessibleSessionIds,
    ),
    [accessibleSessionIds, loadingSessions, selectedSessionId],
  );
  const mobileConversationListPositionKey = useMemo(() => [
    "page-mobile",
    activeTenantKey,
    activePlatform,
    selectedSessionId,
    selectedPageId,
    [...accessibleSessionIds].sort().join(","),
    hideGroups ? "hide-groups" : "show-groups",
    showArchived ? "archived" : "active",
    onlyLeads ? "only-leads" : "all-leads",
    withoutLeadOnly ? "without-lead" : "with-lead",
    pendingReplyOnly ? "pending-reply" : "all-replies",
    trimmedSearchTerm,
    "80",
  ].join("|"), [
    accessibleSessionIds,
    activePlatform,
    activeTenantKey,
    hideGroups,
    onlyLeads,
    pendingReplyOnly,
    selectedPageId,
    selectedSessionId,
    showArchived,
    trimmedSearchTerm,
    withoutLeadOnly,
  ]);

  const {
    data: conversations,
    isLoading: loadingConversations,
    isError: conversationsFailed,
    refetch: refetchConversations,
    hasMoreConversations,
    loadMoreConversations,
    isLoadingMoreConversations,
  } = useWhatsAppConversations(
    conversationSessionFilter.sessionId,
    conversationFilters,
    conversationSessionFilter.accessibleSessionIds,
  );

  // Legacy notifications may carry only a physical conversation id. Resolve
  // its current binding through a direct authorized read, independent of inbox
  // pagination, filters and archive state. The second request is pinned to that
  // UUID or to the explicit unlinked sentinel, so a concurrent rebind fails
  // closed instead of opening another card. New links should include both ids.
  const legacyDeepLinkSnapshotQuery = useWhatsAppConversationSnapshot(
    initialConversationId && !initialLeadId ? initialConversationId : null,
  );
  const legacyDeepLinkExpectedLeadId = getWhatsAppConversationMessageScope(
    legacyDeepLinkSnapshotQuery.data,
  ).expectedLeadId;
  const legacyDeepLinkQuery = useWhatsAppConversation(
    initialConversationId && !initialLeadId ? initialConversationId : null,
    legacyDeepLinkExpectedLeadId,
  );

  useEffect(() => {
    if ((!initialConversationId && !initialLeadId) || resolvedDeepLinkRef.current === deepLinkKey) return;
    if (!currentUserId || !activeOrganization.organizationId) return;

    const legacyConversationLink = Boolean(initialConversationId && !initialLeadId);
    if (legacyConversationLink) {
      if (!legacyDeepLinkSnapshotQuery.isFetched || legacyDeepLinkSnapshotQuery.isFetching) return;
      if (!legacyDeepLinkSnapshotQuery.data) {
        resolvedDeepLinkRef.current = deepLinkKey;
        toast({
          title: "Conversa não encontrada",
          description: legacyDeepLinkSnapshotQuery.isError
            ? "Esta conversa não pôde ser resolvida na sua caixa autorizada. Atualize a página e tente novamente."
            : "Esta conversa não existe ou não está disponível para o seu acesso.",
          variant: "destructive",
        });
        return;
      }
      if (!legacyDeepLinkQuery.isFetched || legacyDeepLinkQuery.isFetching) return;
    } else if (!leadConversationQuery.isFetched) {
      return;
    }

    const deepLinkData = legacyConversationLink
      ? legacyDeepLinkQuery.data
      : leadConversationQuery.data;
    const deepLinkError = legacyConversationLink
      ? legacyDeepLinkQuery.isError
      : leadConversationQuery.isError;
    resolvedDeepLinkRef.current = deepLinkKey;
    if (deepLinkData) {
      queueMicrotask(() => {
        if (resolvedDeepLinkRef.current === deepLinkKey) {
          setSelectedConversation(deepLinkData);
        }
      });
      return;
    }

    toast({
      title: "Conversa não encontrada",
      description: deepLinkError
        ? "A conversa mudou de vínculo ou não pôde ser aberta agora. Atualize a caixa e tente novamente."
        : "Esta conversa não existe ou não está disponível para o seu acesso.",
      variant: "destructive",
    });
  }, [
    activeOrganization.organizationId,
    currentUserId,
    deepLinkKey,
    initialConversationId,
    initialLeadId,
    leadConversationQuery.data,
    leadConversationQuery.isError,
    leadConversationQuery.isFetched,
    legacyDeepLinkQuery.data,
    legacyDeepLinkQuery.isError,
    legacyDeepLinkQuery.isFetched,
    legacyDeepLinkQuery.isFetching,
    legacyDeepLinkSnapshotQuery.data,
    legacyDeepLinkSnapshotQuery.isError,
    legacyDeepLinkSnapshotQuery.isFetched,
    legacyDeepLinkSnapshotQuery.isFetching,
    setSelectedConversation,
  ]);

  const {
    data: metaConversations,
    isLoading: loadingMetaConversations
  } = useMetaConversations(selectedPageId, { enabled: canViewMeta && activePlatform !== 'whatsapp' });

  const {
    data: metaIntegrations
  } = useMetaIntegrations({ enabled: canViewMeta && activePlatform !== 'whatsapp' });

  const selectedConversation = useMemo<ScreenConversation | null>(() => {
    if (!selectedConversationId) return null;

    if (activePlatform === "whatsapp") {
	  const conversationSnapshot = selectedConversationState?.conversationSnapshot;
	  if (conversationSnapshot?.id === selectedConversationId && conversationSnapshot.historical_lead_view) {
		return conversationSnapshot;
	  }
      const conversationFromList = conversations?.find(
        (conversation) => conversation.id === selectedConversationId,
      );
	  if (conversationFromList) {
		const candidateLeadId = getWhatsAppConversationMessageScope(
		  conversationFromList,
		).expectedLeadId;
		if (selectedExpectedLeadId && candidateLeadId !== selectedExpectedLeadId && conversationSnapshot) {
		  return preserveWhatsAppConversationCardSnapshot(
			conversationSnapshot,
			conversationFromList as ScreenConversation,
		  );
		}
		return conversationFromList as ScreenConversation;
	  }

      const conversationFromDetail = selectedWhatsAppConversation;
	  if (conversationFromDetail?.id === selectedConversationId) {
		const candidateLeadId = getWhatsAppConversationMessageScope(
		  conversationFromDetail,
		).expectedLeadId;
		if (!selectedExpectedLeadId || candidateLeadId === selectedExpectedLeadId) {
		  return conversationFromDetail as ScreenConversation;
		}
	  }
	  return conversationSnapshot?.id === selectedConversationId ? conversationSnapshot : null;
    }

    const metaConversation = metaConversations?.find(
      (conversation) => conversation.id === selectedConversationId,
    );
    return metaConversation ? toScreenConversation(metaConversation) : null;
  }, [
    activePlatform,
    conversations,
    metaConversations,
    selectedConversationId,
	selectedConversationState?.conversationSnapshot,
	selectedExpectedLeadId,
    selectedWhatsAppConversation,
  ]);

  const selectedLeadId = activePlatform === "whatsapp"
    ? selectedConversation?.lead_id || selectedConversation?.lead?.id || null
    : selectedConversation?.lead?.id || null;
  const selectedMessageScope = getWhatsAppConversationMessageScope(
    activePlatform === "whatsapp" ? selectedConversation as WhatsAppConversation | null : null,
  );
	const canMutateSelectedWhatsAppConversation = canOperateWhatsApp
	  && activePlatform === "whatsapp"
	  && selectedMessageScope.canMutate;
	const canManageSelectedWhatsAppConversation = canOperateWhatsApp
	  && activePlatform === "whatsapp"
	  && selectedMessageScope.canManage;
  const selectedRealtimeLeadIds = useMemo(
    () => {
      if (activePlatform !== "whatsapp" || !selectedLeadId) return [];
      return [selectedLeadId];
    },
    [activePlatform, selectedLeadId],
  );
  const activeLeadAutomations = useLeadActiveAutomationExecutions(selectedLeadId, {
    enabled: canStartAutomations,
  });
  const hasActiveLeadAutomation = (activeLeadAutomations.data?.length ?? 0) > 0;

  const {
    messages: whatsappMessages,
    isLoading: loadingWhatsAppMessages,
    isFetching: fetchingWhatsAppMessages,
    isError: whatsappMessagesFailed,
    refetch: refetchWhatsAppMessages,
    hasOlderMessages,
    loadOlderMessages,
    isLoadingOlder,
  } = useWhatsAppMessagesPaginated(
    activePlatform === 'whatsapp' ? selectedConversation?.id || null : null,
    {
      pageSize: 50,
      includeMediaUrls: false,
	  expectedLeadId: selectedMessageScope.expectedLeadId,
	  historyLeadId: selectedMessageScope.historyLeadId,
    },
  );

  useEffect(() => {
    lazyMediaRequestsRef.current.clear();
    queueMicrotask(() => setLazyMediaURLs({}));
  }, [activeTenantKey, selectedConversationId]);

  useEffect(() => {
    if (activePlatform !== "whatsapp" || !activeOrganization.organizationId) return;
    const pendingRequests = lazyMediaRequestsRef.current;
    const now = Date.now();
    const candidates = whatsappMessages.filter((message) => (
      message.media_status === "ready"
      && Boolean(message.media_storage_path)
      && !message.media_url
      && (!lazyMediaURLs[message.id] || lazyMediaURLs[message.id].refreshAt <= now)
      && !pendingRequests.has(message.id)
    ));
    if (candidates.length === 0) return;

    let cancelled = false;
    let cursor = 0;
    const resolved: Record<string, LazyMediaURL> = {};
    for (const message of candidates) pendingRequests.add(message.id);

    const hydrateNext = async () => {
      while (!cancelled && cursor < candidates.length) {
        const message = candidates[cursor++];
        try {
          const media = await whatsappAPI.getMessageMediaURL(
            message.id,
            activeOrganization.organizationId,
          );
          if (!cancelled) {
            resolved[message.id] = {
              url: media.url,
              refreshAt: Date.now() + Math.max(1, media.expiresIn) * 1000,
            };
          }
        } catch {
          pendingRequests.delete(message.id);
        }
      }
    };
    const concurrency = Math.min(4, candidates.length);
    void Promise.all(Array.from({ length: concurrency }, hydrateNext)).then(() => {
      if (cancelled || Object.keys(resolved).length === 0) return;
      setLazyMediaURLs((current) => ({ ...current, ...resolved }));
    });

    return () => {
      cancelled = true;
      for (const message of candidates) pendingRequests.delete(message.id);
    };
  }, [activeOrganization.organizationId, activePlatform, lazyMediaURLs, whatsappMessages]);

  useEffect(() => {
    const refreshTimes = Object.values(lazyMediaURLs).map((entry) => entry.refreshAt);
    if (refreshTimes.length === 0) return;
    const nextRefreshAt = Math.min(...refreshTimes);
    const timeout = window.setTimeout(() => {
      const now = Date.now();
      setLazyMediaURLs((current) => Object.fromEntries(
        Object.entries(current).filter(([, entry]) => entry.refreshAt > now),
      ));
    }, Math.max(0, nextRefreshAt - Date.now() + 250));
    return () => window.clearTimeout(timeout);
  }, [lazyMediaURLs]);

  const whatsappMessagesWithLazyMedia = useMemo<WhatsAppMessage[]>(
    () => whatsappMessages.map((message) => {
      const mediaURL = message.media_url || lazyMediaURLs[message.id]?.url;
      return mediaURL && mediaURL !== message.media_url
        ? { ...message, media_url: mediaURL }
        : message;
    }),
    [lazyMediaURLs, whatsappMessages],
  );

  const {
    data: metaMessages,
    isLoading: loadingMetaMessages,
    isError: metaMessagesFailed,
    refetch: refetchMetaMessages,
  } = useMetaMessages(
    activePlatform !== 'whatsapp' ? selectedConversation?.id || null : null,
    { enabled: canViewMeta },
  );

  const messages = activePlatform === 'whatsapp' ? whatsappMessagesWithLazyMedia : metaMessages;
  const loadingMessages = activePlatform === 'whatsapp' ? loadingWhatsAppMessages : loadingMetaMessages;
  const fetchingMessages = activePlatform === 'whatsapp' ? fetchingWhatsAppMessages : false;
  const messagesFailed = activePlatform === 'whatsapp' ? whatsappMessagesFailed : metaMessagesFailed;
  const refetchMessages = activePlatform === 'whatsapp' ? refetchWhatsAppMessages : refetchMetaMessages;
  const reactionMessages = useMemo<DisplayMessage[]>(() => {
    if (activePlatform !== "whatsapp") return [];
    return ((messages || []) as DisplayMessage[]).filter((message) => message.message_type === "reaction");
  }, [activePlatform, messages]);
  const reactionsByMessageId = useMemo(() => {
    return groupLatestWhatsAppReactions(reactionMessages);
  }, [reactionMessages]);
  const visibleMessages = useMemo<DisplayMessage[]>(() => {
    if (activePlatform !== "whatsapp") return (messages || []) as DisplayMessage[];
    return ((messages || []) as DisplayMessage[]).filter((message) => message.message_type !== "reaction");
  }, [activePlatform, messages]);

  // Keep text mutation state independent from base64/compression media work so
  // a slow audio/image/video request never disables the basic text composer.
  const sendTextMessage = useSendWhatsAppMessage();
  const sendMediaMessage = useSendWhatsAppMessage();
  const reactToMessage = useReactToWhatsAppMessage();
  const sendMetaMessage = useSendMetaMessage();
  const { mutate: markConversationAsRead } = useMarkConversationAsRead();
  const archiveConversation = useArchiveConversation();
  const deleteConversation = useDeleteConversation();
  const linkConversationToLead = useLinkConversationToLead();
  const {
    data: availableTags
  } = useTags();
  const addLeadTag = useAddLeadTag();
  const removeLeadTag = useRemoveLeadTag();
  const [createLeadOpen, setCreateLeadOpen] = useState(false);
  const [createLeadContact, setCreateLeadContact] = useState<CreateLeadContact>({});
  const [showLeadPanel, setShowLeadPanel] = useState(true);
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<WhatsAppConversation | null>(null);
  useWhatsAppLeadRealtime(
    true,
    selectedRealtimeLeadIds,
  );

  const handleChannelChange = (value: string) => {
    if (value === 'meta-all') {
      if (!canViewMeta) return;
      setActivePlatform('meta');
      setSelectedPageId('all');
    } else if (value.startsWith('meta-')) {
      if (!canViewMeta) return;
      setActivePlatform('meta');
      setSelectedPageId(value.replace('meta-', ''));
    } else if (value === 'whatsapp-all') {
      setActivePlatform('whatsapp');
      setSelectedSessionId('all');
    } else if (value.startsWith('whatsapp-')) {
      setActivePlatform('whatsapp');
      const sessionId = value.replace('whatsapp-', '');
      setSelectedSessionId(sessionId);
    }
    setSelectedConversation(null);
  };

  const currentChannelValue = activePlatform !== 'whatsapp'
    ? (selectedPageId === 'all' ? 'meta-all' : `meta-${selectedPageId}`)
    : (selectedSessionId === 'all' ? 'whatsapp-all' : `whatsapp-${selectedSessionId}`);

  const activeConversationFilterCount = useMemo(() => {
    if (activePlatform !== 'whatsapp') return 0;
    return [
      selectedSessionId !== "all",
      hideGroups,
      showArchived,
      onlyLeads,
      withoutLeadOnly,
      pendingReplyOnly,
    ].filter(Boolean).length;
  }, [activePlatform, selectedSessionId, hideGroups, showArchived, onlyLeads, withoutLeadOnly, pendingReplyOnly]);

  // Save hide groups preference
  useEffect(() => {
    localStorage.setItem("whatsapp-hide-groups", String(hideGroups));
  }, [hideGroups]);

  useEffect(() => {
    localStorage.setItem("whatsapp-show-archived", String(showArchived));
  }, [showArchived]);

  const handleMessagesScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]")
      || event.currentTarget;
    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 50;
    isUserScrollingRef.current = !isAtBottom;
  }, []);

  // Loading an older cursor prepends rows but keeps the last visible message.
  // Scroll only when the newest message identity actually changes.
  useEffect(() => {
    const lastMessageId = visibleMessages.at(-1)?.id ?? null;
    if (!lastMessageId || lastMessageId === lastVisibleMessageIdRef.current) return;

    const isFirstLoad = lastVisibleMessageIdRef.current === null;
    lastVisibleMessageIdRef.current = lastMessageId;
    if (isFirstLoad || !isUserScrollingRef.current) {
      if (latestMessageScrollTimeoutRef.current !== null) {
        window.clearTimeout(latestMessageScrollTimeoutRef.current);
      }
      latestMessageScrollTimeoutRef.current = window.setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({
          behavior: isFirstLoad ? "instant" : "smooth"
        });
        if (isFirstLoad) isUserScrollingRef.current = false;
        latestMessageScrollTimeoutRef.current = null;
      }, 50);
    }
    return () => {
      if (latestMessageScrollTimeoutRef.current !== null) {
        window.clearTimeout(latestMessageScrollTimeoutRef.current);
        latestMessageScrollTimeoutRef.current = null;
      }
    };
  }, [visibleMessages]);

  // Reset scroll state when changing conversations
  useEffect(() => {
    lastVisibleMessageIdRef.current = null;
    isUserScrollingRef.current = false;
    if (conversationChangeScrollTimeoutRef.current !== null) {
      window.clearTimeout(conversationChangeScrollTimeoutRef.current);
    }
    conversationChangeScrollTimeoutRef.current = window.setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      conversationChangeScrollTimeoutRef.current = null;
    }, 80);
    return () => {
      if (conversationChangeScrollTimeoutRef.current !== null) {
        window.clearTimeout(conversationChangeScrollTimeoutRef.current);
        conversationChangeScrollTimeoutRef.current = null;
      }
    };
  }, [selectedConversation?.id]);
  useEffect(() => {
    const selectedConversationId = selectedConversation?.id;
    const selectedConversationUnreadCount = selectedConversation?.unread_count ?? 0;
    const selectedConversationSessionId = selectedConversation?.session_id;
    const selectedConversationRemoteJid = selectedConversation?.remote_jid;

	if (canManageSelectedWhatsAppConversation && selectedConversationId && selectedConversationSessionId && selectedConversationRemoteJid && selectedConversationUnreadCount > 0) {
	  markConversationAsRead(selectedConversation as WhatsAppConversation);
	}
	}, [canManageSelectedWhatsAppConversation, markConversationAsRead, selectedConversation]);
  const filteredConversations = useMemo(() => {
    let source: ScreenConversation[] = [];
    if (activePlatform === 'whatsapp') {
      source = filterWhatsAppConversations((conversations || []) as ScreenConversation[], {
        onlyLeads,
        withoutLeadOnly,
        pendingReplyOnly,
      });
    } else {
      source = (metaConversations || [])
        .filter((conv) => activePlatform === 'instagram'
          ? conv.platform === 'instagram'
          : activePlatform === 'facebook'
            ? conv.platform === 'messenger'
            : true)
        .map(toScreenConversation);
    }

    if (!trimmedSearchTerm) return source;
    return source.filter((conversation) => matchesConversationSearch(
      conversation,
      trimmedSearchTerm,
      normalizeSearchText,
    ));
  }, [conversations, metaConversations, activePlatform, trimmedSearchTerm, onlyLeads, withoutLeadOnly, pendingReplyOnly]);

  const whatsappMessageInputState = useMemo(
    () => getWhatsAppMessageInputState(selectedConversation, selectedSessionId, sessions),
    [selectedConversation, selectedSessionId, sessions],
  );
  const messageInputDisabled = !canOperateWhatsApp || (activePlatform === "whatsapp"
    ? whatsappMessageInputState.disabled
    : sendMetaMessage.isPending);
  const messageInputPlaceholder = activePlatform === "whatsapp"
    ? whatsappMessageInputState.placeholder
    : "Digite sua mensagem...";

  const handleSendMessage = async () => {
    if (!canOperateWhatsApp || !messageText.trim() || !selectedConversation) return;
    if (activePlatform === "whatsapp" && sendTextMessage.isPending) return;
    if (activePlatform === "whatsapp" && whatsappMessageInputState.disabled) {
      toast({
        title: "Mensagem nao enviada",
        description: whatsappMessageInputState.placeholder,
        variant: "destructive",
      });
      return;
    }

    const textToSend = messageText.trim();
    const metaIdempotencyKey = activePlatform === 'whatsapp' ? null : createUUID();
    setMessageText("");

    try {
      if (activePlatform === 'whatsapp') {
        await sendTextMessage.mutateAsync({
          conversation: selectedConversation,
          text: textToSend,
          sendSessionId: whatsappMessageInputState.sendSessionId,
        });
      } else {
        await sendMetaMessage.mutateAsync({
          conversationId: selectedConversation.id,
          text: textToSend,
          platform: selectedConversation.platform || 'instagram',
          recipientExternalId: selectedConversation.external_id || selectedConversation.remote_jid,
          idempotencyKey: metaIdempotencyKey!,
        });
      }
    } catch (error) {
      const failureStatus = getWhatsAppSendFailureStatus(error);
      if (activePlatform !== "whatsapp" || failureStatus !== "confirming") {
        setMessageText((current) => current || textToSend);
      }
    }
  };
  const handleKeyPress = (e: React.KeyboardEvent<Element>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleSendAudio = async (base64: string, mimetype: string) => {
    if (!canOperateWhatsApp || activePlatform !== "whatsapp" || !selectedConversation) return;
    if (sendMediaMessage.isPending) return;
    if (whatsappMessageInputState.disabled) {
      toast({
        title: "Audio nao enviado",
        description: whatsappMessageInputState.placeholder,
        variant: "destructive",
      });
      return;
    }

    await sendMediaMessage.mutateAsync({
      conversation: selectedConversation,
      text: "",
      mediaType: "audio",
      base64,
      mimetype,
      filename: `audio.${getMessageMediaExtension(mimetype, "webm")}`,
      previewMediaUrl: `data:${mimetype || "audio/webm"};base64,${base64}`,
      sendSessionId: whatsappMessageInputState.sendSessionId,
    });

    toast({
      title: "Áudio enviado",
      description: "Sua mensagem de voz foi enviada"
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedConversation) return;
    if (sendMediaMessage.isPending) {
      e.target.value = "";
      return;
    }
    if (file.size > MAX_OUTBOUND_MESSAGE_MEDIA_BYTES) {
      toast({
        title: "Arquivo muito grande",
        description: "Envie um arquivo de até 5 MB.",
        variant: "destructive",
      });
      e.target.value = "";
      return;
    }
    if (whatsappMessageInputState.disabled) {
      toast({
        title: "Arquivo nao enviado",
        description: whatsappMessageInputState.placeholder,
        variant: "destructive",
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }
    try {
      const processedFile = await compressOutboundImageFile(
        file,
        OUTBOUND_IMAGE_COMPRESSION_PROFILES.preferSmallerFile,
      );
      if (processedFile.size > MAX_OUTBOUND_MESSAGE_MEDIA_BYTES) {
        toast({
          title: "Arquivo muito grande",
          description: "O arquivo processado ultrapassou o limite de 5 MB.",
          variant: "destructive",
        });
        e.target.value = "";
        return;
      }
      const base64Content = await blobToBase64(processedFile);

      // Determine media type
      const mediaType = getOutboundMessageMediaKind(processedFile.type);

      // Backend persists media in Storage and sends it through the provider.
      await sendMediaMessage.mutateAsync({
        conversation: selectedConversation,
        text: processedFile.name,
        mediaType,
        base64: base64Content,
        mimetype: processedFile.type || file.type || "application/octet-stream",
        filename: processedFile.name,
        previewMediaUrl: `data:${processedFile.type || file.type || "application/octet-stream"};base64,${base64Content}`,
        sendSessionId: whatsappMessageInputState.sendSessionId,
      });
      toast({
        title: "Arquivo enviado",
        description: "O arquivo foi enviado com sucesso"
      });
    } catch {
      toast({
        title: "Erro ao enviar arquivo",
        description: "Não foi possível enviar o arquivo",
        variant: "destructive"
      });
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };
  const handleArchive = (conv: WhatsAppConversation) => {
	if (!canOperateWhatsApp || conv.historical_lead_view) return;
	archiveConversation.mutate({
	  conversation: conv,
	  archive: !conv.archived_at
    }, {
      onSuccess: () => {
        if (selectedConversation?.id === conv.id) {
          setSelectedConversation(null);
        }
      },
    });
  };
  const handleDelete = (conv: WhatsAppConversation) => {
	if (!canOperateWhatsApp || conv.historical_lead_view) return;
    setPendingDeleteConversation(conv);
  };
  const confirmDeleteConversation = async () => {
    const conversation = pendingDeleteConversation;
    if (!conversation) return;

    try {
	  await deleteConversation.mutateAsync(conversation);
      if (selectedConversation?.id === conversation.id) {
        setSelectedConversation(null);
      }
      setPendingDeleteConversation(null);
    } catch {
      // The mutation owns the user-facing error. Keep the dialog open for retry.
    }
  };
  const retryMediaDownload = async (messageId: string) => {
    try {
      await whatsappAPI.retryMediaDownload(messageId, activeOrganization.organizationId);
      await refetchWhatsAppMessages();
      toast({
        title: "Tentando novamente",
        description: "Aguarde enquanto baixamos a mídia..."
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Não foi possível tentar novamente"
      });
    }
  };
  const handleBackToList = () => {
    setSelectedConversation(null);
  };

  const openCreateLeadForConversation = (conversation: ScreenConversation) => {
    const expectedPreviousLeadId = getWhatsAppConversationMessageScope(
      conversation as WhatsAppConversation,
    ).expectedLeadId;
    setCreateLeadContact({
      phone: normalizeWhatsAppContactPhoneToE164(
        conversation.contact_phone,
        conversation.remote_jid,
      ) || undefined,
      name: conversation.contact_name || undefined,
      conversationId: conversation.id,
      expectedPreviousLeadId: expectedPreviousLeadId || undefined,
    });
    setCreateLeadOpen(true);
  };

  const refreshSelectedWhatsAppConversation = useCallback(async () => {
    if (activePlatform !== "whatsapp" || !selectedConversationId) return;
    await Promise.all([
      refetchConversations(),
      refetchSelectedWhatsAppConversation(),
    ]);
  }, [
    activePlatform,
    refetchConversations,
    selectedConversationId,
    refetchSelectedWhatsAppConversation,
  ]);

  const handleLinkExistingLead = async (leadId: string) => {
    const conversation = selectedConversation;
	if (!canOperateWhatsApp || !conversation || conversation.historical_lead_view) return;
    const conversationId = conversation.id;

    try {
	  await linkConversationToLead.mutateAsync({ conversation, leadId });
	  const refreshed = await whatsappAPI.getConversation(
		conversationId,
		leadId,
		activeOrganization.organizationId,
	  );
	  setSelectedConversation(refreshed);
	  await refetchConversations();
    } catch (error) {
      toast({
        title: "Não foi possível vincular o lead",
        description: "Confirme se o lead possui o mesmo WhatsApp desta conversa e tente novamente.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const clearConversationFilters = () => {
    setSelectedSessionId("all");
    setHideGroups(false);
    setShowArchived(false);
    setOnlyLeads(false);
    setWithoutLeadOnly(false);
    setPendingReplyOnly(false);
  };

  const conversationOverlays = (
    <ConversationOverlays
      canCreateLeads={canCreateLeads}
      createLeadOpen={createLeadOpen}
      onCreateLeadOpenChange={setCreateLeadOpen}
      createLeadContact={createLeadContact}
      onLeadSaved={() => void refreshSelectedWhatsAppConversation()}
      selectedLeadId={selectedLeadId}
      selectedConversation={selectedConversation}
      showAutomationDialog={showAutomationDialog}
      onAutomationDialogOpenChange={setShowAutomationDialog}
      pendingDeleteConversation={pendingDeleteConversation}
      isDeletingConversation={deleteConversation.isPending}
      onDeleteDialogOpenChange={(open) => {
        if (!open && !deleteConversation.isPending) setPendingDeleteConversation(null);
      }}
      onConfirmDeleteConversation={() => void confirmDeleteConversation()}
    />
  );

  // Mobile: Show either conversation list OR chat (not both)
  if (isMobile) {
    return (
      <AppLayout title="Conversas" disableMainScroll>
        <div className="flex h-full min-h-0 -mb-20 flex-col overflow-hidden bg-transparent">
          {selectedConversation ? (
            <div className="flex flex-col h-full overflow-hidden">
              <MobileConversationHeader
                conversation={selectedConversation}
                selectedLeadId={selectedLeadId}
				canOperateWhatsApp={canManageSelectedWhatsAppConversation}
                onBack={handleBackToList}
                onArchive={() => handleArchive(selectedConversation)}
                onDelete={() => handleDelete(selectedConversation)}
              />
              <ConversationMessages
                layout="mobile"
                activePlatform={activePlatform}
                conversation={selectedConversation}
                messages={visibleMessages}
                isLoading={loadingMessages}
                isFetching={fetchingMessages}
                isError={messagesFailed}
                onRetryMessages={() => void refetchMessages()}
                hasOlderMessages={hasOlderMessages}
                isLoadingOlder={isLoadingOlder}
                onLoadOlderMessages={() => void loadOlderMessages()}
                messagesEndRef={messagesEndRef}
                onScrollCapture={handleMessagesScroll}
				canOperateWhatsApp={canMutateSelectedWhatsAppConversation}
                canOperateLeads={canOperateLeads}
                selectedLeadId={selectedLeadId}
                onRetryMedia={retryMediaDownload}
                reactionsByMessageId={reactionsByMessageId}
                onReact={(targetMessage, emoji) => reactToMessage.mutateAsync({
                  conversation: selectedConversation,
                  targetMessage,
                  emoji,
                })}
                reactingMessageId={reactToMessage.isPending
                  ? reactToMessage.variables?.targetMessage.id ?? null
                  : null}
              />
              <ConversationComposer
                layout="mobile"
                fileInputRef={fileInputRef}
                onFileSelect={handleFileSelect}
                messageText={messageText}
                onMessageTextChange={setMessageText}
                onSendMessage={() => void handleSendMessage()}
                onKeyDown={handleKeyPress}
                placeholder={messageInputPlaceholder}
                disabled={messageInputDisabled}
                isSending={sendTextMessage.isPending}
                selectedLeadId={selectedLeadId}
                canStartAutomations={canStartAutomations && canMutateSelectedWhatsAppConversation}
                hasActiveAutomation={hasActiveLeadAutomation}
                isLoadingAutomationState={activeLeadAutomations.isPending}
                isAutomationStateUnavailable={activeLeadAutomations.isError}
                onStartAutomation={() => setShowAutomationDialog(true)}
                onCancelAutomation={() => {
                  if (selectedLeadId) cancelLeadExecutions.mutate(selectedLeadId);
                }}
                isCancellingAutomation={cancelLeadExecutions.isPending}
                onSendAudio={handleSendAudio}
              />
            </div>
          ) : (
            <div className="flex flex-col h-full">
              <ConversationFilters
                layout="mobile"
                activePlatform={activePlatform}
                onSelectWhatsApp={() => setActivePlatform("whatsapp")}
                sessions={sessions}
                metaIntegrations={metaIntegrations}
                currentChannelValue={currentChannelValue}
                onChannelChange={handleChannelChange}
                activeFilterCount={activeConversationFilterCount}
                hideGroups={hideGroups}
                onHideGroupsChange={setHideGroups}
                showArchived={showArchived}
                onShowArchivedChange={setShowArchived}
                onlyLeads={onlyLeads}
                onOnlyLeadsChange={(next) => {
                  setOnlyLeads(next);
                  if (next) setWithoutLeadOnly(false);
                }}
                withoutLeadOnly={withoutLeadOnly}
                onWithoutLeadOnlyChange={(next) => {
                  setWithoutLeadOnly(next);
                  if (next) setOnlyLeads(false);
                }}
                pendingReplyOnly={pendingReplyOnly}
                onPendingReplyOnlyChange={setPendingReplyOnly}
                onClearFilters={clearConversationFilters}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
              />
              <ConversationList
                layout="mobile"
                channel={activePlatform === "whatsapp" ? "whatsapp" : "meta"}
                conversations={filteredConversations}
                currentUserId={currentUserId}
                isLoading={loadingConversations}
                isError={conversationsFailed}
                onRetry={() => void refetchConversations()}
                sessionsDisconnected={!loadingSessions && sessions?.length === 0}
                canManageWhatsApp={canManageWhatsApp}
                onConnectWhatsApp={() => router.push("/settings?tab=whatsapp")}
				canOperate={canOperateWhatsApp}
                canCreateLead={canCreateLeads}
                availableTags={availableTags || []}
                onSelect={setSelectedConversation}
                onArchive={handleArchive}
                onDelete={handleDelete}
                onAddTag={(conversation, tagId) => conversation.lead && addLeadTag.mutate({
                  leadId: conversation.lead.id,
                  tagId,
                })}
                onRemoveTag={(conversation, tagId) => conversation.lead && removeLeadTag.mutate({
                  leadId: conversation.lead.id,
                  tagId,
                })}
                onCreateLead={openCreateLeadForConversation}
                formatTime={formatConversationTime}
                hasMoreConversations={activePlatform === "whatsapp" && hasMoreConversations}
                isLoadingMoreConversations={isLoadingMoreConversations}
                onLoadMoreConversations={() => void loadMoreConversations()}
                returnPositionKey={mobileConversationListPositionKey}
                returnPosition={mobileConversationListReturnPosition}
                onReturnPositionChange={setMobileConversationListReturnPosition}
              />
            </div>
          )}
        </div>
        {conversationOverlays}
      </AppLayout>
    );
  }

  // Desktop Layout
  const desktopConversations = activePlatform === "whatsapp"
    ? filteredConversations
    : (metaConversations || []).map(toScreenConversation);

  return (
    <AppLayout title="Conversas" disableMainScroll>
      <div className="relative flex h-full min-h-0 gap-3 overflow-hidden">
        <aside data-tour="conversations-overview" className="app-card flex w-[365px] min-w-[365px] max-w-[365px] flex-col overflow-hidden">
          <ConversationFilters
            layout="desktop"
            activePlatform={activePlatform}
            onSelectWhatsApp={() => setActivePlatform("whatsapp")}
            sessions={sessions}
            metaIntegrations={metaIntegrations}
            currentChannelValue={currentChannelValue}
            onChannelChange={handleChannelChange}
            activeFilterCount={activeConversationFilterCount}
            hideGroups={hideGroups}
            onHideGroupsChange={setHideGroups}
            showArchived={showArchived}
            onShowArchivedChange={setShowArchived}
            onlyLeads={onlyLeads}
            onOnlyLeadsChange={(next) => {
              setOnlyLeads(next);
              if (next) setWithoutLeadOnly(false);
            }}
            withoutLeadOnly={withoutLeadOnly}
            onWithoutLeadOnlyChange={(next) => {
              setWithoutLeadOnly(next);
              if (next) setOnlyLeads(false);
            }}
            pendingReplyOnly={pendingReplyOnly}
            onPendingReplyOnlyChange={setPendingReplyOnly}
            onClearFilters={clearConversationFilters}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
          />
          <ConversationList
            layout="desktop"
            channel={activePlatform === "whatsapp" ? "whatsapp" : "meta"}
            conversations={desktopConversations}
            selectedConversationId={selectedConversationId || undefined}
            currentUserId={currentUserId}
            isLoading={activePlatform === "whatsapp" ? loadingConversations : loadingMetaConversations}
            isError={activePlatform === "whatsapp" && conversationsFailed}
            onRetry={() => void refetchConversations()}
            canManageWhatsApp={canManageWhatsApp}
            onConnectWhatsApp={() => router.push("/settings?tab=whatsapp")}
            canOperate={activePlatform === "whatsapp" && canOperateWhatsApp}
            canCreateLead={activePlatform === "whatsapp" && canCreateLeads}
            availableTags={availableTags || []}
            onSelect={setSelectedConversation}
            onArchive={activePlatform === "whatsapp" ? handleArchive : () => {}}
            onDelete={activePlatform === "whatsapp" ? handleDelete : () => {}}
            onAddTag={(conversation, tagId) => conversation.lead && addLeadTag.mutate({
              leadId: conversation.lead.id,
              tagId,
            })}
            onRemoveTag={(conversation, tagId) => conversation.lead && removeLeadTag.mutate({
              leadId: conversation.lead.id,
              tagId,
            })}
            onCreateLead={openCreateLeadForConversation}
            formatTime={formatConversationTime}
            hasMoreConversations={activePlatform === "whatsapp" && hasMoreConversations}
            isLoadingMoreConversations={isLoadingMoreConversations}
            onLoadMoreConversations={() => void loadMoreConversations()}
          />
        </aside>

        <main data-tour="conversations-chat" className="app-card flex min-w-0 flex-1 flex-col overflow-hidden">
          {selectedConversation ? (
            <>
              <ConversationHeader
                contactName={selectedConversation.lead?.name || selectedConversation.contact_name}
                contactPhone={selectedConversation.contact_phone}
                contactPicture={getConversationAvatarUrl(selectedConversation)}
                contactPresence={selectedConversation.contact_presence}
                isGroup={selectedConversation.is_group}
                isArchived={!!selectedConversation.archived_at}
                leadId={selectedLeadId}
                leadTags={selectedConversation.lead?.tags}
                leadAssigneeName={selectedConversation.lead?.assignee?.name}
                leadAssigneeIsCurrentUser={!selectedConversation.lead?.assignee?.id || !currentUserId || selectedConversation.lead.assignee.id === currentUserId}
                pipelineName={selectedConversation.lead?.pipeline?.name}
                stageName={selectedConversation.lead?.stage?.name}
                stageColor={selectedConversation.lead?.stage?.color}
                conversationId={selectedConversation.id}
                sessionId={selectedConversation.session_id}
                remoteJid={selectedConversation.remote_jid}
                onArchive={() => handleArchive(selectedConversation)}
                onDelete={() => handleDelete(selectedConversation)}
                canOperate={canManageSelectedWhatsAppConversation}
                onCreateLead={canCreateLeads ? () => openCreateLeadForConversation(selectedConversation) : undefined}
                onToggleLeadPanel={() => setShowLeadPanel((previous) => !previous)}
                showLeadPanel={showLeadPanel}
              />
              <ConversationMessages
                layout="desktop"
                activePlatform={activePlatform}
                conversation={selectedConversation}
                messages={visibleMessages}
                isLoading={loadingMessages}
                isFetching={fetchingMessages}
                isError={messagesFailed}
                onRetryMessages={() => void refetchMessages()}
                hasOlderMessages={hasOlderMessages}
                isLoadingOlder={isLoadingOlder}
                onLoadOlderMessages={() => void loadOlderMessages()}
                messagesEndRef={messagesEndRef}
                onScrollCapture={handleMessagesScroll}
                canOperateWhatsApp={canMutateSelectedWhatsAppConversation}
                canOperateLeads={canOperateLeads}
                selectedLeadId={selectedLeadId}
                onRetryMedia={retryMediaDownload}
                reactionsByMessageId={reactionsByMessageId}
                onReact={(targetMessage, emoji) => reactToMessage.mutateAsync({
                  conversation: selectedConversation,
                  targetMessage,
                  emoji,
                })}
                reactingMessageId={reactToMessage.isPending
                  ? reactToMessage.variables?.targetMessage.id ?? null
                  : null}
              />
              <ConversationComposer
                layout="desktop"
                fileInputRef={fileInputRef}
                onFileSelect={handleFileSelect}
                messageText={messageText}
                onMessageTextChange={setMessageText}
                onSendMessage={() => void handleSendMessage()}
                onKeyDown={handleKeyPress}
                placeholder={messageInputPlaceholder}
                disabled={messageInputDisabled}
                isSending={sendTextMessage.isPending}
                selectedLeadId={selectedLeadId}
                canStartAutomations={canStartAutomations && canMutateSelectedWhatsAppConversation}
                hasActiveAutomation={hasActiveLeadAutomation}
                isLoadingAutomationState={activeLeadAutomations.isPending}
                isAutomationStateUnavailable={activeLeadAutomations.isError}
                onStartAutomation={() => setShowAutomationDialog(true)}
                onCancelAutomation={() => {
                  if (selectedLeadId) cancelLeadExecutions.mutate(selectedLeadId);
                }}
                isCancellingAutomation={cancelLeadExecutions.isPending}
                onSendAudio={handleSendAudio}
              />
            </>
          ) : (
            <ConversationEmptyState
              sessionsDisconnected={!loadingSessions && sessions?.length === 0}
              canManageWhatsApp={canManageWhatsApp}
              onConnectWhatsApp={() => router.push("/settings?tab=whatsapp")}
              onRequestConnectionHelp={() => router.push("/suporte")}
            />
          )}
        </main>

        {selectedConversation && showLeadPanel && (
          selectedLeadId ? (
            <ConversationLeadPanel
              leadId={selectedLeadId}
              onClose={() => setShowLeadPanel(false)}
              contactPicture={getConversationAvatarUrl(selectedConversation)}
              className="absolute inset-y-0 right-0 z-30 w-[330px] min-w-[330px] max-w-[330px] shrink-0 animate-in slide-in-from-right-5 duration-300 xl:static xl:z-auto"
            />
          ) : !selectedConversation.is_group && (
            canCreateLeads || (activePlatform === "whatsapp" && canOperateWhatsApp && canOperateLeads)
          ) ? (
            <ConversationUnregisteredPanel
              key={selectedConversation.id}
              contactName={selectedConversation.contact_name}
              contactPhone={normalizeWhatsAppContactPhoneToE164(
                selectedConversation.contact_phone,
                selectedConversation.remote_jid,
              )}
              contactPicture={getConversationAvatarUrl(selectedConversation)}
              onClose={() => setShowLeadPanel(false)}
              onCreateLead={canCreateLeads
                ? () => openCreateLeadForConversation(selectedConversation)
                : undefined}
              canLinkLead={activePlatform === "whatsapp" && canOperateWhatsApp && canOperateLeads}
              onLinkLead={handleLinkExistingLead}
              isLinkingLead={linkConversationToLead.isPending}
              className="absolute inset-y-0 right-0 z-30 w-[330px] min-w-[330px] max-w-[330px] shrink-0 animate-in slide-in-from-right-5 duration-300 xl:static xl:z-auto"
            />
          ) : null
        )}
      </div>
      {conversationOverlays}
    </AppLayout>
  );
}
