"use client";

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { ConversationHeader } from "@/components/features/whatsapp/ConversationHeader";
import { ConversationLeadPanel, ConversationUnregisteredPanel } from "@/components/features/whatsapp/ConversationLeadPanel";
import { EnterAttendanceDialog } from "@/components/features/whatsapp/EnterAttendanceDialog";
import { OwnWhatsAppStartNotice } from "@/components/features/whatsapp/OwnWhatsAppStartNotice";
import { OwnWhatsAppLeadStartDialogs } from "@/components/features/whatsapp/OwnWhatsAppLeadStartDialogs";
import { useOwnWhatsAppLeadStart } from "@/hooks/whatsapp/use-own-whatsapp-lead-start";
import { ConfirmConversationLeadLinkDialog } from "@/components/features/whatsapp/ConfirmConversationLeadLinkDialog";
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
import { isLocalReadOnlyMode } from "@/lib/local-read-only";
import { useWhatsAppConversation, useWhatsAppConversationForLead, useWhatsAppConversationSnapshot, useWhatsAppConversations, useWhatsAppConversationFilterOptions, useSendWhatsAppMessage, useResolveWhatsAppSendIntent, useDiscardFailedLocalWhatsAppMessage, useReactToWhatsAppMessage, useMarkConversationAsRead, useWhatsAppInboxRealtime, useWhatsAppLeadRealtime, useArchiveConversation, useDeleteConversation, useLinkConversationToLead, type WhatsAppConversation, type WhatsAppMessage } from "@/hooks/use-whatsapp-conversations";
import { useWhatsAppMessagesPaginated } from "@/hooks/use-whatsapp-messages-paginated";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import { useWhatsAppLeadActivityRealtime } from "@/hooks/whatsapp/use-whatsapp-lead-activity-realtime";
import { projectWhatsAppCanonicalConversationPreview } from "@/lib/whatsapp-canonical-conversation-preview";
import { useWhatsAppSenderAvatars } from "@/hooks/whatsapp/use-whatsapp-sender-avatars";
import { useWhatsAppVisibleCanonicalPreviews } from "@/hooks/whatsapp/use-whatsapp-visible-canonical-previews";
import { useWhatsAppLocalSendPreviews } from "@/hooks/whatsapp/use-whatsapp-local-send-previews";
import { useWhatsAppConversationDraft } from "@/hooks/use-whatsapp-conversation-draft";
import { useWhatsAppAttachments, type WhatsAppAttachmentOutcome, type WhatsAppAttachmentSendContext } from "@/hooks/use-whatsapp-attachments";
import { useWhatsAppMessageNavigation } from "@/hooks/use-whatsapp-message-navigation";
import { ConversationHistorySearch } from "@/components/features/whatsapp/conversations/ConversationHistorySearch";
import { ConversationDetailsPane } from "@/components/features/whatsapp/conversations/ConversationDetailsPane";
import { useConversationDetailsLayout } from "@/hooks/whatsapp/use-conversation-details-layout";
import { flattenWhatsAppMessagePages } from "@/lib/whatsapp-query-cache";
import { useWhatsAppMediaGallery } from "@/hooks/use-whatsapp-media-gallery";
import { useWhatsAppUnread } from "@/hooks/use-whatsapp-unread";
import { useAccessibleSessions } from "@/hooks/use-accessible-sessions";
import { useWhatsAppAttendanceGate, type WhatsAppAttendanceTarget } from "@/hooks/use-whatsapp-attendance";
import { getWhatsAppSendFailureStatus, resolveWhatsAppConversationSessionFilter } from "@/lib/whatsapp-query-cache";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { normalizeWhatsAppContactPhoneToE164 } from "@/lib/phone-utils";
import { useTags } from "@/hooks/use-tags";
import { useAddLeadTag, useRemoveLeadTag } from "@/hooks/use-leads";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMetaConversations, useMetaMessages, useSendMetaMessage } from "@/hooks/use-meta-conversations";
import { createUUID } from "@/lib/client-id";
import { useMetaIntegrations } from "@/hooks/use-meta-integration";
import { whatsappAPI, type WhatsAppConversationLinkPreview } from "@/lib/api/whatsapp";
import {
  getWhatsAppConversationMessageScope,
  getWhatsAppMessageInputState,
  preserveWhatsAppConversationCardSnapshot,
  WHATSAPP_UNLINKED_LEAD_SNAPSHOT,
} from "@/lib/whatsapp-message-input";
import { groupLatestWhatsAppReactions } from "@/lib/whatsapp-reactions";
import {
  getWhatsAppUnlinkedExpiresAt,
  refreshWhatsAppUnlinkedInbox,
  scheduleWhatsAppUnlinkedExpiration,
} from "@/lib/whatsapp-unlinked-expiration";
import { clearUnavailableWhatsAppMessageCache } from "@/lib/whatsapp-access-revocation";
import { useAuth } from "@/contexts/AuthContext";
import { useFilters } from "@/contexts/FilterContext";
import { sharedLeadFiltersForConversations, sharedLeadConversationFilterCount } from "@/lib/filters/whatsapp-shared-filters";
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
import {
  withStoredMediaURL,
} from "@/components/features/whatsapp/stored-media-url";

import type { AudioRecorderSendContext, AudioRecorderSendResult } from "@/components/features/whatsapp/AudioRecorderButton";
import { getWhatsAppAudioSendResult, getWhatsAppFileSendFeedback } from '@/lib/whatsapp-send-intent';

import { canQuoteWhatsAppMessage, toWhatsAppQuote } from "@/components/features/whatsapp/conversations/message-actions";

type ConversationsProps = {
  initialConversationId?: string;
  initialLeadId?: string;
};

export default function Conversations({ initialConversationId, initialLeadId }: ConversationsProps) {
  const { activeOrganization, user, profile } = useAuth();
  const cancelLeadExecutions = useCancelLeadExecutions();
  const { hasPermission } = useUserPermissions();
  const { hasModule } = useOrganizationModules();
  const originalOrganization = Boolean(profile?.organization_id && profile.organization_id === activeOrganization.organizationId);
  const canOperateWhatsApp = originalOrganization && hasPermission("whatsapp_operate");
  const canManageWhatsApp = originalOrganization && hasPermission("whatsapp_manage");
  const canViewMeta = hasModule("whatsapp") && hasModule("campaigns") && hasPermission("whatsapp_view");
  const canCreateLeads = originalOrganization && hasPermission("lead_create");
  const canOperateLeads = originalOrganization && hasPermission("lead_operate");
  const canStartAutomations = hasModule("automations") && hasPermission("automations_manage");
  const isMobile = useIsMobile();
  const localReadOnly = isLocalReadOnlyMode();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const whatsappQueryScope = useWhatsAppQueryScope();
  const currentUserId = profile?.id || user?.id || null;
  const activeTenantKey = `${currentUserId || "anonymous"}:${activeOrganization.organizationId || "none"}`;
  const overlayScopeKey = JSON.stringify([whatsappQueryScope.userId, whatsappQueryScope.organizationId, whatsappQueryScope.accessScope, profile?.organization_id]);
  const overlayScopeRef = useRef(overlayScopeKey);
  const overlayGenerationRef = useRef(0);
  const [overlayOwnerKey, setOverlayOwnerKey] = useState(overlayScopeKey);
  const overlaysCurrent = overlayOwnerKey === overlayScopeKey;
  const [activePlatform, setActivePlatform] = useState<ConversationPlatform>('whatsapp');
  const [selectedSessionId, setSelectedSessionId] = useState<string>("all");
  const [selectedPageId, setSelectedPageId] = useState<string>("all");
  const [selectedConversationState, setSelectedConversationState] = useState<{
    tenantKey: string;
	conversationId: string;
	expectedLeadId: string | null;
	conversationSnapshot: ScreenConversation;
    selectionVersion: number;
  } | null>(null);
  const [mobileConversationListReturnPosition, setMobileConversationListReturnPosition] = useState<ConversationListReturnPosition | null>(null);
  const selectedConversationId = selectedConversationState?.tenantKey === activeTenantKey
    ? selectedConversationState.conversationId
    : null;
  const selectedExpectedLeadId = selectedConversationState?.tenantKey === activeTenantKey
	  ? selectedConversationState.expectedLeadId
	  : null;
  const selectedSupervisoryView = Boolean(selectedConversationId && selectedConversationState?.conversationSnapshot.supervisory_lead_view);
  const selectionGenerationRef = useRef(0);
  const setSelectedConversation = useCallback((conversation: ScreenConversation | null) => {
    selectionGenerationRef.current += 1;
	const expectedLeadId = getWhatsAppConversationMessageScope(
	  conversation as WhatsAppConversation | null,
	).expectedLeadId;
    setSelectedConversationState(conversation
	  ? {
		  tenantKey: activeTenantKey,
		  conversationId: conversation.id,
		  expectedLeadId,
		  conversationSnapshot: conversation,
          selectionVersion: selectionGenerationRef.current,
		}
      : null);
  }, [activeTenantKey]);
  const sharedLeadFilters = useFilters();
  const [metaSearchTerm, setMetaSearchTerm] = useState("");
  const searchTerm = activePlatform === 'whatsapp' ? sharedLeadFilters.searchQuery : metaSearchTerm;
  const setSearchTerm = useCallback((value: string) => {
    if (activePlatform === 'whatsapp') sharedLeadFilters.setSearchQuery(value);
    else setMetaSearchTerm(value);
  }, [activePlatform, sharedLeadFilters]);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const {
    source: selectedLeadSource, setSource: setSelectedLeadSource,
    pipelineId: selectedPipelineId, setPipelineId: setSelectedPipelineId,
    teamId: selectedTeamId, setTeamId: setSelectedTeamId,
    userId: selectedUserId, setUserId: setSelectedUserId,
    tagIds: selectedTagIds, setTagIds: setSelectedTagIds,
    dealStatus: selectedDealStatus, setDealStatus: setSelectedDealStatus,
    pageId: selectedMetaPageFilterId, setPageId: setSelectedMetaPageFilterId,
    campaignIds: selectedCampaignIds, setCampaignIds: setSelectedCampaignIds,
  } = sharedLeadFilters;
  const [conversationFiltersOpen, setConversationFiltersOpen] = useState(false);
  const conversationDraft = useWhatsAppConversationDraft(whatsappQueryScope, selectedSupervisoryView ? null : selectedConversationId,
    activePlatform === 'whatsapp' ? selectedExpectedLeadId : selectedConversationId ? `channel:${activePlatform}` : null);
  const { text: messageText, setText: setMessageText, clearConversation: clearConversationDraft } = conversationDraft;
  const [showArchived, setShowArchived] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("whatsapp-show-archived") === "true";
  });
  const [onlyLeads, setOnlyLeads] = useState(false);
  const [withoutLeadOnly, setWithoutLeadOnly] = useState(false);
  const [pendingReplyOnly, setPendingReplyOnly] = useState(false);
  const [showAutomationDialog, setShowAutomationDialog] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const conversationSearchRef = useRef<HTMLButtonElement>(null);
  const [readScrollState, setReadScrollState] = useState({ scope: '', atBottom: true });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastVisibleMessageIdRef = useRef<string | null>(null);
  const isUserScrollingRef = useRef<boolean>(false);
  const messageScrollContextRef = useRef<string | null>(null);
  const messageScrollViewportRef = useRef<HTMLElement | null>(null);
  const firstVisibleMessageIdRef = useRef<string | null>(null);
  const messageScrollSizeRef = useRef<{ width: number; height: number; scrollHeight: number } | null>(null);
  const messageScrollPositionRef = useRef<{ messageId: string | null; offset: number; scrollTop: number } | null>(null);
  const resolvedDeepLinkRef = useRef<string | null>(null);
  const deepLinkIntentRef = useRef<{ key: string; generation: number } | null>(null);
  const [pendingCreateLeadConversation, setPendingCreateLeadConversation] = useState<ScreenConversation | null>(null);
  const [createLeadLinkPreview, setCreateLeadLinkPreview] = useState<WhatsAppConversationLinkPreview | null>(null);
  const [isCreateLeadLinkPreviewLoading, setIsCreateLeadLinkPreviewLoading] = useState(false);
  const [createLeadLinkPreviewFailed, setCreateLeadLinkPreviewFailed] = useState(false);
  const createLeadLinkPreviewRequestRef = useRef(0);
  const [linkPanelConversationId, setLinkPanelConversationId] = useState<string | null>(null);
  const closeUnavailableUnlinkedConversation = useCallback((conversationId: string, expectedLeadId?: string | null) => {
    clearUnavailableWhatsAppMessageCache(queryClient, whatsappQueryScope, conversationId, expectedLeadId);
    refreshWhatsAppUnlinkedInbox(queryClient, whatsappQueryScope);
    setSelectedConversationState((current) => current?.tenantKey === activeTenantKey
      && current.conversationId === conversationId
      && (expectedLeadId === undefined || current.expectedLeadId === expectedLeadId)
      ? null
      : current);
    clearConversationDraft(conversationId);
    setLinkPanelConversationId((current) => current === conversationId ? null : current);
    if (pendingCreateLeadConversation?.id === conversationId) {
      createLeadLinkPreviewRequestRef.current += 1;
      setPendingCreateLeadConversation(null);
      setCreateLeadLinkPreview(null);
    }
  }, [activeTenantKey, clearConversationDraft, pendingCreateLeadConversation?.id, queryClient, whatsappQueryScope]);

  useEffect(() => {
    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setSelectedConversationState(null);
      setSelectedSessionId("all");
      setSelectedPageId("all");
      setActivePlatform("whatsapp");
      setWithoutLeadOnly(false);
      setMetaSearchTerm('');
      setConversationFiltersOpen(false);
      setMobileConversationListReturnPosition(null);
      setLinkPanelConversationId(null);
      setPendingCreateLeadConversation(null);
      setCreateLeadLinkPreview(null);
      createLeadLinkPreviewRequestRef.current += 1;
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
    activePlatform === "whatsapp" && !selectedSupervisoryView ? selectedConversationId : null,
	activePlatform === "whatsapp" && !selectedSupervisoryView ? selectedExpectedLeadId : null,
  );
  const deepLinkKey = `${activeTenantKey}:${initialConversationId || ""}:${initialLeadId || ""}`;
  useLayoutEffect(() => { deepLinkIntentRef.current = { key: deepLinkKey, generation: selectionGenerationRef.current }; }, [deepLinkKey]);
  const {
    data: sessions,
    isLoading: loadingSessions,
    isError: sessionsFailed,
    refetch: refetchSessions,
  } = useAccessibleSessions({
    live: activePlatform === "whatsapp" && Boolean(selectedConversationId),
    retry: false,
    timeoutMs: 8_000,
  });

  // Extract accessible session IDs for filtering
  const accessibleSessionIds = useMemo(() => sessions?.map(s => s.id) || [], [sessions]);
  const trimmedSearchTerm = searchTerm.trim();
  const conversationFilters = useMemo(
    () => ({
      ...sharedLeadFiltersForConversations(sharedLeadFilters, withoutLeadOnly),
      hideGroups: true,
      showArchived,
      onlyLeads,
      withoutLead: withoutLeadOnly,
      pendingReply: pendingReplyOnly,
      search: activePlatform === 'whatsapp' ? debouncedSearchTerm : '',
    }),
    [activePlatform, debouncedSearchTerm, onlyLeads, pendingReplyOnly, sharedLeadFilters, showArchived, withoutLeadOnly],
  );
  const conversationSessionFilter = useMemo(
    () => resolveWhatsAppConversationSessionFilter(
      selectedSessionId,
      loadingSessions ? [] : accessibleSessionIds,
    ),
    [accessibleSessionIds, loadingSessions, selectedSessionId],
  );
  const includeSupervisoryLeads = selectedSessionId === "all" && !showArchived && !withoutLeadOnly && !pendingReplyOnly;
  const conversationFilterOptionsQuery = useWhatsAppConversationFilterOptions(
    conversationSessionFilter.sessionId,
    conversationSessionFilter.accessibleSessionIds,
    {
      showArchived,
      includeSupervisoryLeads: includeSupervisoryLeads || undefined,
      pageId: conversationFilters.pageId,
      campaignIds: conversationFilters.campaignIds,
      adSetId: conversationFilters.adSetId,
      leadCreatedFrom: conversationFilters.leadCreatedFrom,
      leadCreatedTo: conversationFilters.leadCreatedTo,
    },
    conversationFiltersOpen && activePlatform === "whatsapp" &&
      sharedLeadFilters.isHydrated &&
      (selectedSessionId === "all" || (!loadingSessions && !sessionsFailed)),
  );
  const mobileConversationListPositionKey = useMemo(() => [
    "page-mobile",
    activeTenantKey,
    activePlatform,
    selectedSessionId,
    selectedLeadSource ?? "all-sources",
    selectedPipelineId ?? "all-pipelines",
    selectedTeamId ?? "all-teams",
    selectedUserId ?? "all-users",
    JSON.stringify([...selectedTagIds].sort()),
    selectedDealStatus ?? "all-statuses",
    selectedMetaPageFilterId ?? "all-meta-pages",
    JSON.stringify([...selectedCampaignIds].sort()),
    selectedPageId,
    [...accessibleSessionIds].sort().join(","),
    "hide-groups",
    showArchived ? "archived" : "active",
    onlyLeads ? "only-leads" : "all-leads",
    withoutLeadOnly ? "without-lead" : "with-lead",
    pendingReplyOnly ? "pending-reply" : "all-replies",
    sharedLeadFilters.activeDateRange?.from.toISOString() ?? 'all-lead-dates',
    sharedLeadFilters.activeDateRange?.to.toISOString() ?? 'all-lead-dates',
    sharedLeadFilters.adSetId ?? '',
    sharedLeadFilters.adId ?? '',
    trimmedSearchTerm,
    "80",
  ].join("|"), [
    accessibleSessionIds,
    activePlatform,
    activeTenantKey,
    onlyLeads,
    pendingReplyOnly,
    selectedPageId,
    selectedLeadSource,
    selectedPipelineId,
    selectedTeamId,
    selectedUserId,
    selectedTagIds,
    selectedDealStatus,
    selectedMetaPageFilterId,
    selectedCampaignIds,
    selectedSessionId,
    showArchived,
    trimmedSearchTerm,
    withoutLeadOnly,
    sharedLeadFilters.activeDateRange,
    sharedLeadFilters.adSetId,
    sharedLeadFilters.adId,
  ]);

  const {
    data: conversations,
    dataUpdatedAt: conversationsRevision = 0,
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
    80,
    {
      enabled: activePlatform === 'whatsapp' && sharedLeadFilters.isHydrated,
      includeSupervisoryLeads: includeSupervisoryLeads || undefined,
    },
  );

  const searchingConversations = activePlatform === "whatsapp" && (trimmedSearchTerm !== debouncedSearchTerm
    || (Boolean(trimmedSearchTerm) && loadingConversations));

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
    if (deepLinkIntentRef.current?.key !== deepLinkKey || deepLinkIntentRef.current.generation !== selectionGenerationRef.current) {
      resolvedDeepLinkRef.current = deepLinkKey;
      return;
    }
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
        if (resolvedDeepLinkRef.current === deepLinkKey && deepLinkIntentRef.current?.key === deepLinkKey
          && deepLinkIntentRef.current.generation === selectionGenerationRef.current) {
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

  useMetaIntegrations({ enabled: canViewMeta && activePlatform !== 'whatsapp' });

  const resolvedSelectedConversation = useMemo<ScreenConversation | null>(() => {
    if (!selectedConversationId) return null;

    if (activePlatform === "whatsapp") {
	  const conversationSnapshot = selectedConversationState?.conversationSnapshot;
	  if (conversationSnapshot?.id === selectedConversationId && (conversationSnapshot.historical_lead_view || conversationSnapshot.supervisory_lead_view)) {
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
  const selectedUnlinkedExpiresAt = activePlatform === "whatsapp"
    ? getWhatsAppUnlinkedExpiresAt(resolvedSelectedConversation)
    : null;
  const selectedConversation = resolvedSelectedConversation;
  useEffect(() => {
    if (activePlatform !== "whatsapp" || !resolvedSelectedConversation
      || selectedUnlinkedExpiresAt === null) return;

    const conversationId = resolvedSelectedConversation.id;
    const expiration = scheduleWhatsAppUnlinkedExpiration(
      selectedUnlinkedExpiresAt,
      () => closeUnavailableUnlinkedConversation(conversationId),
    );
    window.addEventListener("focus", expiration.check);
    document.addEventListener("visibilitychange", expiration.check);
    return () => {
      expiration.cancel();
      window.removeEventListener("focus", expiration.check);
      document.removeEventListener("visibilitychange", expiration.check);
    };
  }, [activePlatform, closeUnavailableUnlinkedConversation, resolvedSelectedConversation, selectedUnlinkedExpiresAt]);

  const selectedLeadId = activePlatform === "whatsapp"
    ? selectedConversation?.lead_id || selectedConversation?.lead?.id || null
    : selectedConversation?.lead?.id || null;
  const selectedMessageScope = getWhatsAppConversationMessageScope(
    activePlatform === "whatsapp" ? selectedConversation as WhatsAppConversation | null : null,
  );
	const canMutateSelectedWhatsAppConversation = canOperateWhatsApp && !localReadOnly && !sessionsFailed
	  && activePlatform === "whatsapp"
	  && selectedMessageScope.canMutate;
	const canManageSelectedWhatsAppConversation = canOperateWhatsApp && !localReadOnly && !sessionsFailed
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
    isError: whatsappMessagesFailed,
    refetch: refetchWhatsAppMessages,
    hasOlderMessages,
    loadOlderMessages,
    isLoadingOlder,
    isFetchNextPageError: olderMessagesFailed,
    isReconciliationError,
    retryReconciliation,
    readMessagePage,
    canonicalPreview: whatsappCanonicalPreview,
  } = useWhatsAppMessagesPaginated(
    activePlatform === 'whatsapp' ? selectedConversation?.id || null : null,
    {
      pageSize: 50,
      includeMediaUrls: false,
	  expectedSessionId: selectedConversation?.session_id ?? null,
	  expectedLeadId: selectedMessageScope.expectedLeadId,
	  historyLeadId: selectedMessageScope.historyLeadId,
      onConversationUnavailable: closeUnavailableUnlinkedConversation,
    },
  );

  const whatsappMessagesWithLazyMedia = useMemo<WhatsAppMessage[]>(
    () => whatsappMessages.map((message) => withStoredMediaURL(message, undefined)),
    [whatsappMessages],
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
  const messagesFailed = activePlatform === 'whatsapp' ? whatsappMessagesFailed || isReconciliationError : metaMessagesFailed;
  const refetchMessages = activePlatform === 'whatsapp'
    ? () => isReconciliationError ? retryReconciliation() : refetchWhatsAppMessages()
    : refetchMetaMessages;
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
  const resolveSendIntent = useResolveWhatsAppSendIntent();
  const discardLocalMessage = useDiscardFailedLocalWhatsAppMessage();
  const reactToMessage = useReactToWhatsAppMessage();
  const sendMetaMessage = useSendMetaMessage();
  const { mutate: markConversationAsRead } = useMarkConversationAsRead();
  const archiveConversation = useArchiveConversation();
  const deleteConversation = useDeleteConversation();
  const linkConversationToLead = useLinkConversationToLead();
  const {
    data: availableTags = [], isLoading: loadingTags, isFetching: fetchingTags,
    isError: tagsFailed, refetch: refetchTags,
  } = useTags({ catalog: true, enabled: canOperateLeads });
  const addLeadTag = useAddLeadTag();
  const removeLeadTag = useRemoveLeadTag();
  const [createLeadOpen, setCreateLeadOpen] = useState(false);
  const [createLeadContact, setCreateLeadContact] = useState<CreateLeadContact>({});
  const canReassignSelectedLead = activePlatform === "whatsapp" && Boolean(selectedConversation)
    && !selectedConversation?.is_group && selectedMessageScope.canManage
    && canOperateWhatsApp && canOperateLeads;
  const canShowLeadPanel = Boolean(selectedConversation && (selectedLeadId
    || (!selectedConversation.is_group && (canCreateLeads || canReassignSelectedLead))));
  const detailsSelectionKey = JSON.stringify([overlayScopeKey, activePlatform, selectedConversationId,
    selectedExpectedLeadId, selectedConversationState?.selectionVersion]);
  const [linkPanelOwnerKey, setLinkPanelOwnerKey] = useState<string | null>(null);
  const { bindContainer: bindDetailsContainer, docked: detailsDocked, open: showLeadPanel, setOpen: setLeadPanelOpen } = useConversationDetailsLayout({
    selectionKey: detailsSelectionKey,
    isMobile, available: canShowLeadPanel,
  });
  const conversationActionsRef = useRef<HTMLButtonElement>(null);
  const closeLeadPanel = () => { setLeadPanelOpen(false); setLinkPanelConversationId(null); };
  const openLeadLinkPanel = () => {
    if (!canReassignSelectedLead || !selectedConversation) return;
    setLinkPanelConversationId(selectedConversation.id);
    setLinkPanelOwnerKey(detailsSelectionKey);
    setLeadPanelOpen(true);
  };
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<WhatsAppConversation | null>(null);
  useLayoutEffect(() => {
    overlayScopeRef.current = overlayScopeKey;
    overlayGenerationRef.current += 1;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset modal ownership before the new tenant can paint.
    setOverlayOwnerKey(overlayScopeKey);
    setCreateLeadOpen(false);
    setCreateLeadContact({});
    setPendingDeleteConversation(null);
    setShowAutomationDialog(false);
    setPendingCreateLeadConversation(null);
    setCreateLeadLinkPreview(null);
    createLeadLinkPreviewRequestRef.current += 1;
    return () => { overlayScopeRef.current = ""; overlayGenerationRef.current += 1; createLeadLinkPreviewRequestRef.current += 1; };
  }, [overlayScopeKey]);

  useWhatsAppInboxRealtime(activePlatform === "whatsapp", true);
  useWhatsAppLeadActivityRealtime(activePlatform === "whatsapp" && hasModule("whatsapp")
    && (hasPermission("whatsapp_view") || canOperateWhatsApp), selectedLeadId, selectedConversationId);
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
      showArchived,
      onlyLeads,
      withoutLeadOnly,
      pendingReplyOnly,
      Boolean(trimmedSearchTerm),
    ].filter(Boolean).length + sharedLeadConversationFilterCount(sharedLeadFilters, withoutLeadOnly);
  }, [activePlatform, selectedSessionId, showArchived, onlyLeads, withoutLeadOnly, pendingReplyOnly, sharedLeadFilters, trimmedSearchTerm]);

  useEffect(() => {
    localStorage.setItem("whatsapp-show-archived", String(showArchived));
  }, [showArchived]);

  const rememberMessageScrollPosition = useCallback((viewport: HTMLElement) => {
    const bounds = viewport.getBoundingClientRect();
    const anchor = Array.from(viewport.querySelectorAll<HTMLElement>("[data-message-id]"))
      .find((message) => {
        const rect = message.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom;
      });
    messageScrollSizeRef.current = { width: viewport.clientWidth, height: viewport.clientHeight, scrollHeight: viewport.scrollHeight };
    messageScrollPositionRef.current = {
      messageId: anchor?.dataset.messageId ?? null,
      offset: anchor ? anchor.getBoundingClientRect().top - bounds.top : 0,
      scrollTop: viewport.scrollTop,
    };
  }, []);

  const restoreMessageScrollPosition = useCallback((viewport: HTMLElement) => {
    const position = messageScrollPositionRef.current;
    const anchor = position?.messageId
      ? Array.from(viewport.querySelectorAll<HTMLElement>("[data-message-id]"))
        .find((message) => message.dataset.messageId === position.messageId)
      : null;
    if (anchor && position) {
      viewport.scrollTop += anchor.getBoundingClientRect().top
        - viewport.getBoundingClientRect().top - position.offset;
    } else if (position) {
      viewport.scrollTop = position.scrollTop;
    }
  }, []);

  const messageScrollContext = JSON.stringify([
    activeTenantKey, whatsappQueryScope.accessScope, activePlatform,
    selectedConversation?.id ?? null, selectedExpectedLeadId, selectedConversation?.session_id ?? null,
  ]);
  const handleMessagesScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]")
      || event.currentTarget;
    const size = messageScrollSizeRef.current;
    // Resize can dispatch a scroll before ResizeObserver. It must not replace
    // the reader's last anchor or turn automatic following into a user gesture.
    if (size && (size.width !== target.clientWidth || size.height !== target.clientHeight || size.scrollHeight !== target.scrollHeight)) return;
    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 50;
    isUserScrollingRef.current = !isAtBottom;
    setReadScrollState(current => current.scope === messageScrollContext && current.atBottom === isAtBottom
      ? current : { scope: messageScrollContext, atBottom: isAtBottom });
    rememberMessageScrollPosition(target);
  }, [messageScrollContext, rememberMessageScrollPosition]);

  const lastVisibleMessageId = visibleMessages.at(-1)?.id ?? null;
  const firstVisibleMessageId = visibleMessages[0]?.id ?? null;
  // Read the committed DOM, rather than recording an id before a cancellable
  // timer. Equal message-array replacements must not cancel the initial tail.
  useLayoutEffect(() => {
    if (messageScrollContextRef.current !== messageScrollContext) {
      messageScrollContextRef.current = messageScrollContext;
      lastVisibleMessageIdRef.current = null;
      firstVisibleMessageIdRef.current = null;
      messageScrollViewportRef.current = null;
      messageScrollPositionRef.current = null;
      messageScrollSizeRef.current = null;
      isUserScrollingRef.current = false;
    }
    const viewport = messagesEndRef.current?.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!viewport || !lastVisibleMessageId || loadingMessages) return;

    const firstLoad = lastVisibleMessageIdRef.current === null;
    const viewportChanged = messageScrollViewportRef.current !== viewport;
    const olderRowsChanged = firstVisibleMessageIdRef.current !== firstVisibleMessageId;
    if (firstLoad || !isUserScrollingRef.current) {
      // Automatic following is synchronous so a burst cannot mistake an
      // intermediate smooth-scroll position for the reader scrolling away.
      messagesEndRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
      isUserScrollingRef.current = false;
    } else if (viewportChanged || olderRowsChanged) {
      // The mobile branch remounts the viewport. Preserve the visible message,
      // including its partial offset, instead of restoring desktop pixels.
      restoreMessageScrollPosition(viewport);
    }
    lastVisibleMessageIdRef.current = lastVisibleMessageId;
    firstVisibleMessageIdRef.current = firstVisibleMessageId;
    messageScrollViewportRef.current = viewport;
    rememberMessageScrollPosition(viewport);
  }, [firstVisibleMessageId, isMobile, lastVisibleMessageId, loadingMessages, messageScrollContext, rememberMessageScrollPosition, restoreMessageScrollPosition]);

  useLayoutEffect(() => {
    const viewport = messagesEndRef.current?.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!viewport || loadingMessages) return;
    const observer = new ResizeObserver(() => {
      if (messageScrollContextRef.current !== messageScrollContext
        || messageScrollViewportRef.current !== viewport || !viewport.isConnected) return;
      const size = messageScrollSizeRef.current;
      if (size?.width === viewport.clientWidth && size.height === viewport.clientHeight && size.scrollHeight === viewport.scrollHeight) return;
      if (isUserScrollingRef.current) restoreMessageScrollPosition(viewport);
      else messagesEndRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
      rememberMessageScrollPosition(viewport);
    });
    observer.observe(viewport);
    const content = viewport.querySelector<HTMLElement>("[data-whatsapp-message-log]");
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [isMobile, loadingMessages, messageScrollContext, rememberMessageScrollPosition, restoreMessageScrollPosition]);
  const scrollMessagesToLatest = useCallback(() => {
    isUserScrollingRef.current = false;
    setReadScrollState({ scope: messageScrollContext, atBottom: true });
    messagesEndRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
    const viewport = messagesEndRef.current?.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (viewport) rememberMessageScrollPosition(viewport);
  }, [messageScrollContext, rememberMessageScrollPosition]);
  const unread = useWhatsAppUnread({ scopeKey: messageScrollContext, conversationId: selectedConversationId,
    unreadCount: selectedConversation?.unread_count ?? 0, lastMessageAt: selectedConversation?.last_message_at,
    messages: whatsappMessages, enabled: canManageSelectedWhatsAppConversation && !loadingWhatsAppMessages
      && !whatsappMessagesFailed && !isReconciliationError,
    atBottom: readScrollState.scope !== messageScrollContext || readScrollState.atBottom,
    onRead: () => { if (selectedConversation) markConversationAsRead(selectedConversation as WhatsAppConversation); },
  });
  const senderAvatars = useWhatsAppSenderAvatars({ messages: visibleMessages, conversationId: selectedConversationId,
    leadId: selectedLeadId, sessionId: selectedConversation?.session_id, enabled: activePlatform === "whatsapp" && !messagesFailed });
  const selectedCanonicalConversations = useMemo(() => projectWhatsAppCanonicalConversationPreview(
    (conversations || []) as ScreenConversation[], whatsappCanonicalPreview, whatsappQueryScope,
  ), [conversations, whatsappCanonicalPreview, whatsappQueryScope]);
  const conversationsRoute = pathname === "/crm/conversas" || pathname?.startsWith("/crm/conversas/") === true;
  const visibleCanonicalPreviews = useWhatsAppVisibleCanonicalPreviews({
    conversations: (conversations || []) as ScreenConversation[],
    pausedConversationId: selectedConversationId,
    scope: whatsappQueryScope,
    listRevision: conversationsRevision,
    enabled: conversationsRoute && activePlatform === "whatsapp" && sharedLeadFilters.isHydrated
      && hasModule("whatsapp") && (hasPermission("whatsapp_view") || canOperateWhatsApp)
      && (!isMobile || !selectedConversationId),
    sourceKey: hasModule("whatsapp") && (hasPermission("whatsapp_view") || canOperateWhatsApp) ? "page" : "page:no-access",
  });
  const canonicalPreviewConversations = useMemo(() => visibleCanonicalPreviews.previews.reduce(
    (rows, preview) => preview.conversationId.toLowerCase() === selectedConversationId?.toLowerCase() ? rows
      : projectWhatsAppCanonicalConversationPreview(rows, preview, whatsappQueryScope), selectedCanonicalConversations,
  ), [selectedCanonicalConversations, selectedConversationId, visibleCanonicalPreviews.previews, whatsappQueryScope]);
  const sendPreviewConversations = useWhatsAppLocalSendPreviews(canonicalPreviewConversations, whatsappQueryScope);
  const filteredConversations = useMemo(() => {
    let source: ScreenConversation[] = [];
    if (activePlatform === 'whatsapp') {
      source = filterWhatsAppConversations(sendPreviewConversations, {
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
  }, [sendPreviewConversations, metaConversations, activePlatform, trimmedSearchTerm, onlyLeads, withoutLeadOnly, pendingReplyOnly]);

  const whatsappMessageInputState = useMemo(
    () => getWhatsAppMessageInputState(selectedConversation, selectedSessionId, sessions, currentUserId),
    [selectedConversation, selectedSessionId, sessions, currentUserId],
  );
  const selectedAttendanceTarget = useMemo<WhatsAppAttendanceTarget | null>(() => {
    if (
      activePlatform !== "whatsapp"
      || !selectedConversation?.id
      || !selectedLeadId
      || selectedConversation.historical_lead_view
      || !whatsappMessageInputState.sendSessionId
    ) {
      return null;
    }
    return {
      conversationId: selectedConversation.id,
      expectedLeadId: selectedLeadId,
      sendSessionId: whatsappMessageInputState.sendSessionId,
    };
  }, [
    activePlatform,
    selectedConversation,
    selectedLeadId,
    whatsappMessageInputState.sendSessionId,
  ]);
  const attendanceGate = useWhatsAppAttendanceGate(selectedAttendanceTarget, {
    enabled: !localReadOnly && canOperateWhatsApp && activePlatform === "whatsapp" && Boolean(selectedAttendanceTarget),
    identityKey: `${activeTenantKey}:${selectedConversationId || "none"}:${selectedLeadId || "none"}:${whatsappMessageInputState.sendSessionId || "none"}`,
  });
  const ownWhatsAppStart = useOwnWhatsAppLeadStart({
    scope: whatsappQueryScope,
    selectionKey: JSON.stringify([overlayScopeKey, activePlatform, selectedConversationId, selectedExpectedLeadId,
      selectedConversation?.session_id, selectedConversation?.historical_lead_view, selectedConversationState?.selectionVersion]),
    conversation: activePlatform === "whatsapp" ? selectedConversation : null,
    sessions,
    canOperate: canOperateWhatsApp && !localReadOnly && !sessionsFailed,
    loadingSessions,
    attendanceMissing: attendanceGate.attendance?.joined === false,
    onReady: (conversation) => {
      setReplySelection(null);
      setSelectedSessionId(conversation.session_id || "all");
      setSelectedConversation(conversation as ScreenConversation);
    },
  });
  const composerUnavailableReason = activePlatform === "whatsapp" && selectedConversation && canOperateWhatsApp
    ? localReadOnly ? "read_only" : sessionsFailed ? "sessions_failed" : undefined : undefined;
  const ownWhatsAppStartNotice = ownWhatsAppStart.notice || composerUnavailableReason ? <>
    <OwnWhatsAppStartNotice notice={ownWhatsAppStart.notice} unavailableReason={composerUnavailableReason} onRetry={() => void refetchSessions()} busy={ownWhatsAppStart.busy} onStart={ownWhatsAppStart.begin} />
    {ownWhatsAppStart.error && !ownWhatsAppStart.pending
      && <p role="alert" className="px-3 pb-2 text-[11px] text-destructive">{ownWhatsAppStart.error}</p>}
  </> : null;
  const canComposeSelectedConversation = activePlatform === "whatsapp" ? canMutateSelectedWhatsAppConversation
    : canOperateWhatsApp && canViewMeta && !localReadOnly && Boolean(selectedConversation);
  const messageInputDisabled = !canComposeSelectedConversation || (activePlatform === "whatsapp"
    ? attendanceGate.isResolving || whatsappMessageInputState.disabled : sendMetaMessage.isPending);
  const messageInputPlaceholder = !originalOrganization
    ? "Somente leitura nesta organização. Atenda os leads na organização original do seu cadastro."
    : !canOperateWhatsApp || (activePlatform !== "whatsapp" && !canViewMeta) ? "Somente leitura"
    : localReadOnly ? "Envios indisponíveis nesta prévia em somente leitura."
    : activePlatform === "whatsapp"
    ? whatsappMessageInputState.placeholder
    : "Digite sua mensagem...";

  const audioDisabled = !canMutateSelectedWhatsAppConversation || activePlatform !== "whatsapp" || whatsappMessageInputState.disabled;
  const audioContextKey = JSON.stringify([overlayScopeKey, activePlatform, selectedConversationId,
    selectedExpectedLeadId, whatsappMessageInputState.sendSessionId, audioDisabled]);
  const mediaGallery = useWhatsAppMediaGallery({ messages: activePlatform === 'whatsapp' ? whatsappMessages : [],
    scopeKey: audioContextKey, conversationId: selectedConversationId });
  const messageNavigation = useWhatsAppMessageNavigation({
    scopeKey: audioContextKey,
    messages: activePlatform === 'whatsapp' ? whatsappMessages : [],
    readPage: activePlatform === 'whatsapp' ? readMessagePage : undefined,
    logRef: messagesEndRef,
    loadOlder: activePlatform === 'whatsapp' ? async () => {
      const result = await loadOlderMessages();
      if (result.isError || result.isFetchNextPageError) throw Error('History unavailable');
      return { messages: flattenWhatsAppMessagePages(result.data?.pages ?? []), hasMore: Boolean(result.hasNextPage) };
    } : undefined,
  });
  const [replySelection, setReplySelection] = useState<{ contextKey: string; message: WhatsAppMessage } | null>(null);
  const latestReply = replySelection?.contextKey === audioContextKey
    ? whatsappMessages.find(message => message.id === replySelection.message.id) : null;
  const replyTarget = !audioDisabled && latestReply && canQuoteWhatsAppMessage(latestReply)
    && latestReply.conversation_id === selectedConversationId
    && latestReply.session_id === whatsappMessageInputState.sendSessionId ? latestReply : null;
  useLayoutEffect(() => { if (!replyTarget) setReplySelection(null); }, [audioContextKey, replyTarget]);
  const handleReply = (message: WhatsAppMessage) => {
    if (!audioDisabled && canQuoteWhatsAppMessage(message)) {
      setReplySelection({ contextKey: audioContextKey, message });
      messageInputRef.current?.focus({ preventScroll: true });
    }
  };
  const audioContextRef = useRef(audioContextKey);
  const audioGenerationRef = useRef(0);
  useLayoutEffect(() => { audioContextRef.current = audioContextKey; audioGenerationRef.current += 1; return () => { audioContextRef.current = ""; audioGenerationRef.current += 1; }; }, [audioContextKey]);
  const handleResolveAudio = async (clientMessageId: string) => {
    const generation = audioGenerationRef.current;
    if (!originalOrganization || !selectedConversation || (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation)) return "cancelled" as const;
    const result = await resolveSendIntent({ conversation: selectedConversation, clientMessageId });
    return audioContextRef.current === audioContextKey && audioGenerationRef.current === generation ? result : "cancelled" as const;
  };
  const handleSendMessage = async () => {
    const generation = audioGenerationRef.current;
    if (!canOperateWhatsApp || localReadOnly || !messageText.trim() || !selectedConversation) return;
    if (activePlatform === "whatsapp" && sendTextMessage.isPending) return;
    if (activePlatform !== "whatsapp" && (!canViewMeta || sendMetaMessage.isPending)) return;
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

    try {
      if (activePlatform === 'whatsapp') {
        const joined = await attendanceGate.ensureJoined();
        if (!joined || (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation)) return;
        setMessageText("");
        await sendTextMessage.mutateAsync({
          conversation: selectedConversation,
          text: textToSend,
          quotedMessageId: replyTarget?.id,
          optimisticQuotedMessage: replyTarget ? toWhatsAppQuote(replyTarget) : undefined,
          sendSessionId: whatsappMessageInputState.sendSessionId,
        });
        if (audioContextRef.current === audioContextKey && audioGenerationRef.current === generation)
          setReplySelection(current => current?.message.id === replyTarget?.id ? null : current);
      } else {
        setMessageText("");
        await sendMetaMessage.mutateAsync({
          conversationId: selectedConversation.id,
          text: textToSend,
          platform: selectedConversation.platform || 'instagram',
          recipientExternalId: selectedConversation.external_id || selectedConversation.remote_jid,
          idempotencyKey: metaIdempotencyKey!,
        });
      }
    } catch (error) {
      if (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation) return;
      const failureStatus = getWhatsAppSendFailureStatus(error);
      if (activePlatform !== "whatsapp" || failureStatus !== "confirming") {
        setMessageText((current) => current || textToSend);
      }
    }
  };
  const handleKeyPress = (e: React.KeyboardEvent<Element>) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleSendAudio = async (base64: string, mimetype: string, context: AudioRecorderSendContext): Promise<AudioRecorderSendResult> => {
    const generation = audioGenerationRef.current;
    if (context.contextKey !== audioContextKey || (audioContextRef.current !== context.contextKey || audioGenerationRef.current !== generation)) return { state: "cancelled" };
    if (!canOperateWhatsApp || activePlatform !== "whatsapp" || !selectedConversation) return false;
    if (sendMediaMessage.isPending) return false;
    if (whatsappMessageInputState.disabled) {
      toast({
        title: "Audio nao enviado",
        description: whatsappMessageInputState.placeholder,
        variant: "destructive",
      });
      return false;
    }

    const joined = await attendanceGate.ensureJoined();
    if (!joined || (audioContextRef.current !== context.contextKey || audioGenerationRef.current !== generation)) return { state: "cancelled" };

    try {
    const response = await sendMediaMessage.mutateAsync({
      conversation: selectedConversation,
      clientMessageId: context.clientMessageId,
      quotedMessageId: replyTarget?.id,
      optimisticQuotedMessage: replyTarget ? toWhatsAppQuote(replyTarget) : undefined,
      text: "",
      mediaType: "audio",
      base64,
      mimetype,
      filename: `audio.${getMessageMediaExtension(mimetype, "webm")}`,
      previewMediaUrl: `data:${mimetype || "audio/webm"};base64,${base64}`,
      sendSessionId: whatsappMessageInputState.sendSessionId,
    });

    if (audioContextRef.current !== context.contextKey || audioGenerationRef.current !== generation) return { state: "cancelled" };
    const delivery = getWhatsAppAudioSendResult(response, context.clientMessageId);
    if (!delivery || delivery.state === 'unconfirmed') return delivery;
    setReplySelection(current => current?.message.id === replyTarget?.id ? null : current);
    toast({
      title: "Áudio na fila",
      description: "Acompanhe o status do envio na conversa."
    });
    return { state: "queued", clientMessageId: context.clientMessageId };
    } catch (error) {
      if (audioContextRef.current !== context.contextKey || audioGenerationRef.current !== generation) return { state: "cancelled" };
      if (getWhatsAppSendFailureStatus(error) === "confirming") return { state: "unconfirmed", clientMessageId: context.clientMessageId };
      return false;
    }
  };

  const handleFileSelect = async (selection: React.ChangeEvent<HTMLInputElement> | File, caption?: string, context?: WhatsAppAttachmentSendContext): Promise<WhatsAppAttachmentOutcome> => {
    const generation = audioGenerationRef.current;
    const input = 'target' in selection ? selection.target : null;
    const file = input ? input.files?.[0] : selection as File;
    if (!file || !selectedConversation || activePlatform !== "whatsapp" || !canMutateSelectedWhatsAppConversation) return 'cancelled';
    if (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation) return 'cancelled';
    if (sendMediaMessage.isPending) {
      if (input) input.value = "";
      return 'cancelled';
    }
    if (context?.verificationOnly) {
      try {
        const result = await sendMediaMessage.mutateAsync({
          conversation: selectedConversation,
          text: caption !== undefined ? caption.trim() : file.name,
          fileIntentSource: file,
          fileIntentVerificationOnly: true,
          fileIntentIsCurrent: () => audioContextRef.current === audioContextKey && audioGenerationRef.current === generation,
          sendSessionId: whatsappMessageInputState.sendSessionId,
        });
        if (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation) return 'cancelled';
        return result.fileIntentChecked
          ? getWhatsAppFileSendFeedback(result, { conversationId: selectedConversation.id, clientMessageId: result.clientMessageId }).state
          : 'unconfirmed';
      } catch {
        return audioContextRef.current === audioContextKey && audioGenerationRef.current === generation ? 'unconfirmed' : 'cancelled';
      } finally {
        if (audioContextRef.current === audioContextKey && audioGenerationRef.current === generation && input) input.value = "";
      }
    }
    if (file.size > MAX_OUTBOUND_MESSAGE_MEDIA_BYTES) {
      toast({
        title: "Arquivo muito grande",
        description: "Envie um arquivo de até 5 MB.",
        variant: "destructive",
      });
      if (input) input.value = "";
      return 'cancelled';
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
      return 'cancelled';
    }
    const joined = await attendanceGate.ensureJoined();
    if (!joined || (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation)) {
      if (input) input.value = "";
      return 'cancelled';
    }
    let submitting = false;
    try {
      const processedFile = await compressOutboundImageFile(
        file,
        OUTBOUND_IMAGE_COMPRESSION_PROFILES.preferSmallerFile,
      );
      if (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation) { if (input) input.value = ""; return 'cancelled'; }
      if (processedFile.size > MAX_OUTBOUND_MESSAGE_MEDIA_BYTES) {
        toast({
          title: "Arquivo muito grande",
          description: "O arquivo processado ultrapassou o limite de 5 MB.",
          variant: "destructive",
        });
        if (input) input.value = "";
        return 'cancelled';
      }
      const base64Content = await blobToBase64(processedFile);

      if ((audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation)) { if (input) input.value = ""; return 'cancelled'; }
      // Determine media type
      const mediaType = getOutboundMessageMediaKind(processedFile.type);

      // Backend persists media in Storage and sends it through the provider.
      submitting = true;
      const result = await sendMediaMessage.mutateAsync({
        conversation: selectedConversation,
        text: caption !== undefined ? caption.trim() : processedFile.name,
        fileIntentSource: file,
        fileIntentVerificationOnly: context?.verificationOnly,
        fileIntentIsCurrent: () => audioContextRef.current === audioContextKey && audioGenerationRef.current === generation,
        quotedMessageId: replyTarget?.id,
        optimisticQuotedMessage: replyTarget ? toWhatsAppQuote(replyTarget) : undefined,
        mediaType,
        base64: base64Content,
        mimetype: processedFile.type || file.type || "application/octet-stream",
        filename: processedFile.name,
        previewMediaUrl: `data:${processedFile.type || file.type || "application/octet-stream"};base64,${base64Content}`,
        sendSessionId: whatsappMessageInputState.sendSessionId,
      });
      if (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation) return 'cancelled';
      const feedback = getWhatsAppFileSendFeedback(result, { conversationId: selectedConversation.id, clientMessageId: result.clientMessageId });
      if (result.fileIntentChecked) return feedback.state;
      if (feedback.state === 'queued') setReplySelection(current => current?.message.id === replyTarget?.id ? null : current);
      toast({ title: feedback.title, description: feedback.description, variant: feedback.variant });
      return feedback.state;
    } catch (error) {
      if (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation) return 'cancelled';
      if (submitting) return getWhatsAppSendFailureStatus(error) === 'confirming' ? 'unconfirmed' : 'failed'; // The mutation owns send notices.
      toast({
        title: "Não foi possível preparar o arquivo",
        description: "Confira o arquivo e tente novamente.",
        variant: "destructive"
      });
      return 'failed';
    } finally {
      if (audioContextRef.current === audioContextKey && audioGenerationRef.current === generation) if (input) input.value = "";
    }
  };
  const attachments = useWhatsAppAttachments({ scopeKey: audioContextKey, disabled: audioDisabled,
    onSend: (file, caption, context) => handleFileSelect(file, caption, context) });
  const handleReactToMessage = async (targetMessage: WhatsAppMessage, emoji: string) => {
    const generation = audioGenerationRef.current;
    if (!canMutateSelectedWhatsAppConversation || activePlatform !== "whatsapp" || !selectedConversation) return;
    const reactionSessionId = targetMessage.session_id || selectedConversation.session_id;
    if (!selectedLeadId || !reactionSessionId) return;
    const joined = await attendanceGate.ensureJoined({
      target: {
        conversationId: selectedConversation.id,
        expectedLeadId: selectedLeadId,
        sendSessionId: reactionSessionId,
      },
    });
    if (!joined || audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation) return;
    await reactToMessage.mutateAsync({
      conversation: selectedConversation,
      targetMessage,
      emoji,
    });
  };
  const handleArchive = (conv: WhatsAppConversation) => {
	if (!canOperateWhatsApp || conv.historical_lead_view || archiveConversation.isPendingFor?.(conv)) return;
    const scope = overlayScopeKey;
    const generation = overlayGenerationRef.current;
    const selection = selectionGenerationRef.current;
	archiveConversation.mutate({
	  conversation: conv,
	  archive: !conv.archived_at
    }, {
      onSuccess: () => {
        if (overlayScopeRef.current !== scope || overlayGenerationRef.current !== generation || selectionGenerationRef.current !== selection) return;
        if (selectedConversation?.id === conv.id) {
          setSelectedConversation(null);
        }
      },
    });
  };
  const handleDelete = (conv: WhatsAppConversation) => {
	if (!canOperateWhatsApp || conv.historical_lead_view) return;
    setOverlayOwnerKey(overlayScopeKey);
    setPendingDeleteConversation(conv);
  };
  const confirmDeleteConversation = async () => {
    const conversation = pendingDeleteConversation;
    const scope = overlayScopeKey;
    const generation = overlayGenerationRef.current;
    if (!conversation || !overlaysCurrent || overlayScopeRef.current !== scope) return;

    try {
	  await deleteConversation.mutateAsync(conversation);
      if (overlayScopeRef.current !== scope || overlayGenerationRef.current !== generation) return;
      setSelectedConversationState((current) => current?.tenantKey === activeTenantKey && current.conversationId === conversation.id ? null : current);
      setPendingDeleteConversation((current) => current?.id === conversation.id ? null : current);
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
    setLinkPanelConversationId(null);
    setSelectedConversation(null);
  };

  const createLeadContactFromConversation = (conversation: ScreenConversation): CreateLeadContact => ({
    phone: normalizeWhatsAppContactPhoneToE164(
      conversation.contact_phone,
      conversation.remote_jid,
    ) || undefined,
    name: conversation.contact_name || undefined,
  });

  const loadCreateLeadLinkPreview = async (conversation: ScreenConversation) => {
    const scope = overlayScopeKey;
    const requestId = ++createLeadLinkPreviewRequestRef.current;
    setIsCreateLeadLinkPreviewLoading(true);
    setCreateLeadLinkPreviewFailed(false);
    setCreateLeadLinkPreview(null);
    const expectedPreviousLeadId = getWhatsAppConversationMessageScope(
      conversation as WhatsAppConversation,
    ).expectedLeadId || WHATSAPP_UNLINKED_LEAD_SNAPSHOT;
    try {
      const preview = await whatsappAPI.getConversationLinkPreview(
        conversation.id,
        expectedPreviousLeadId,
        undefined,
        activeOrganization.organizationId,
      );
      if (requestId !== createLeadLinkPreviewRequestRef.current || overlayScopeRef.current !== scope) return;
      if (
        preview.conversationId !== conversation.id
        || preview.sessionId !== conversation.session_id
        || preview.leadId !== null
        || preview.expectedPreviousLeadId !== expectedPreviousLeadId
      ) {
        throw new Error("A prévia não corresponde à conversa selecionada");
      }
      setCreateLeadLinkPreview(preview);
    } catch {
      if (requestId === createLeadLinkPreviewRequestRef.current && overlayScopeRef.current === scope) setCreateLeadLinkPreviewFailed(true);
    } finally {
      if (requestId === createLeadLinkPreviewRequestRef.current && overlayScopeRef.current === scope) setIsCreateLeadLinkPreviewLoading(false);
    }
  };

  const openCreateLeadForConversation = (conversation: ScreenConversation) => {
    if (!canCreateLeads || overlayScopeRef.current !== overlayScopeKey) return;
    setOverlayOwnerKey(overlayScopeKey);
    if (activePlatform !== "whatsapp" || !canOperateWhatsApp) {
      setCreateLeadContact(createLeadContactFromConversation(conversation));
      setCreateLeadOpen(true);
      return;
    }
    if (conversation.is_group || conversation.historical_lead_view || conversation.lead_id) {
      toast({
        title: "Conversa já vinculada ou indisponível",
        description: "Escolha uma conversa direta sem lead para cadastrar e vincular o histórico.",
        variant: "destructive",
      });
      return;
    }
    setPendingCreateLeadConversation(conversation);
    void loadCreateLeadLinkPreview(conversation);
  };

  const closeCreateLeadLinkPreview = () => {
    createLeadLinkPreviewRequestRef.current += 1;
    setPendingCreateLeadConversation(null);
    setCreateLeadLinkPreview(null);
    setCreateLeadLinkPreviewFailed(false);
  };

  const confirmCreateLeadLinkPreview = () => {
    const conversation = pendingCreateLeadConversation;
    const preview = createLeadLinkPreview;
    if (!conversation || !preview || isCreateLeadLinkPreviewLoading || createLeadLinkPreviewFailed) return;
    const expectedPreviousLeadId = getWhatsAppConversationMessageScope(
      conversation as WhatsAppConversation,
    ).expectedLeadId || WHATSAPP_UNLINKED_LEAD_SNAPSHOT;
    if (
      preview.conversationId !== conversation.id
      || preview.sessionId !== conversation.session_id
      || preview.leadId !== null
      || preview.expectedPreviousLeadId !== expectedPreviousLeadId
    ) return;
    setCreateLeadContact({
      ...createLeadContactFromConversation(conversation),
      conversationId: conversation.id,
      expectedPreviousLeadId,
      confirmHistoryLink: true,
      futureOnly: preview.futureOnly,
    });
    closeCreateLeadLinkPreview();
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

  const handleLinkExistingLead = async (leadId: string, preview: WhatsAppConversationLinkPreview) => {
    const conversation = selectedConversation;
    const scope = overlayScopeKey;
    const generation = overlayGenerationRef.current;
    const selection = selectionGenerationRef.current;
    const current = () => overlayScopeRef.current === scope && overlayGenerationRef.current === generation && selectionGenerationRef.current === selection;
    if (!canOperateWhatsApp || !conversation || conversation.historical_lead_view) return;
    const observedPreviousLeadId = getWhatsAppConversationMessageScope(
      conversation as WhatsAppConversation,
    ).expectedLeadId || WHATSAPP_UNLINKED_LEAD_SNAPSHOT;
    if (preview.conversationId !== conversation.id
      || preview.sessionId !== conversation.session_id
      || preview.leadId !== leadId
      || preview.expectedPreviousLeadId !== observedPreviousLeadId) {
      toast({
        title: "A conversa mudou após a prévia",
        description: "Confira o vínculo atual antes de confirmar novamente.",
        variant: "destructive",
      });
      throw new Error("Prévia de vínculo desatualizada");
    }
    const conversationId = conversation.id;

    let result;
    try {
	  result = await linkConversationToLead.mutateAsync({
        conversation,
        leadId,
        expectedPreviousLeadId: preview.expectedPreviousLeadId,
        futureOnly: preview.futureOnly,
      });
    } catch (error) {
      if (!current()) return;
      toast({
        title: "Não foi possível vincular o lead",
        description: "Confirme se o lead possui o mesmo WhatsApp desta conversa e tente novamente.",
        variant: "destructive",
      });
      throw error;
    }
    if (!current()) return;
    if (result.bindingMode === 'history_only') {
      setLinkPanelConversationId(null);
      setSelectedConversation(null);
      void refetchConversations();
      return;
    }
    setLinkPanelConversationId(null);
    try {
	  const refreshed = await whatsappAPI.getConversation(
		conversationId,
		leadId,
		activeOrganization.organizationId,
	  );
      if (!current()) return;
	  setSelectedConversation(refreshed);
    } catch {
      if (!current()) return;
      setSelectedConversation(null);
      toast({
        title: "Conversa vinculada",
        description: "Atualize a lista para abrir a conversa no lead.",
      });
    }
    void refetchConversations();
  };

  const previewConversationLeadLink = async (leadId: string) => {
    const conversation = selectedConversation;
    if (!canOperateWhatsApp || !conversation || conversation.historical_lead_view || conversation.is_group) {
      throw new Error("Conversa indisponível para vínculo");
    }
    const expectedPreviousLeadId = getWhatsAppConversationMessageScope(
      conversation as WhatsAppConversation,
    ).expectedLeadId || WHATSAPP_UNLINKED_LEAD_SNAPSHOT;
    const preview = await whatsappAPI.getConversationLinkPreview(
      conversation.id,
      expectedPreviousLeadId,
      leadId,
      activeOrganization.organizationId,
    );
    if (
      preview.conversationId !== conversation.id
      || preview.leadId !== leadId
      || preview.expectedPreviousLeadId !== expectedPreviousLeadId
      || preview.sessionId !== conversation.session_id
    ) {
      throw new Error("A prévia não corresponde à conversa selecionada");
    }
    return preview;
  };

  const clearConversationFilters = () => {
    sharedLeadFilters.clearFilters();
    setSearchTerm('');
    setDebouncedSearchTerm('');
    setSelectedSessionId("all");
    setSelectedPipelineId(null);
    setSelectedTeamId(null);
    setSelectedUserId(null);
    setSelectedTagIds([]);
    setSelectedDealStatus(null);
    setSelectedMetaPageFilterId(null);
    setSelectedCampaignIds([]);
    setShowArchived(false);
    setOnlyLeads(false);
    setWithoutLeadOnly(false);
    setPendingReplyOnly(false);
    setSelectedLeadSource(null);
  };

  const conversationToolbarProps = {
    activePlatform,
    onSelectWhatsApp: () => setActivePlatform("whatsapp"),
    sessions,
    currentChannelValue,
    onChannelChange: handleChannelChange,
    options: conversationFilterOptionsQuery.data,
    optionsHasMore: Boolean(conversationFilterOptionsQuery.hasNextPage),
    optionsLoadingMore: conversationFilterOptionsQuery.isFetchingNextPage,
    onLoadMoreOptions: () => { void conversationFilterOptionsQuery.fetchNextPage(); },
    optionsLoading: (selectedSessionId !== "all" && loadingSessions) ||
      (conversationFilterOptionsQuery.isPending && conversationFilterOptionsQuery.isFetching),
    optionsError: conversationFilterOptionsQuery.isError ||
      (selectedSessionId !== "all" && (sessionsFailed || conversationSessionFilter.accessibleSessionIds?.length === 0)),
    optionsRetrying: conversationFilterOptionsQuery.isFetching,
    onRetryOptions: () => {
      if (selectedSessionId !== "all" && sessionsFailed) {
        void refetchSessions();
      } else {
        void conversationFilterOptionsQuery.refetch();
      }
    },
    onFiltersOpenChange: setConversationFiltersOpen,
    activeFilterCount: activeConversationFilterCount,
    pipelineId: selectedPipelineId,
    onPipelineChange: setSelectedPipelineId,
    teamId: selectedTeamId,
    onTeamChange: setSelectedTeamId,
    userId: selectedUserId,
    onUserChange: setSelectedUserId,
    leadSource: selectedLeadSource,
    onLeadSourceChange: setSelectedLeadSource,
    tagIds: selectedTagIds,
    onTagsChange: setSelectedTagIds,
    dealStatus: selectedDealStatus,
    onDealStatusChange: (status: string | null) => setSelectedDealStatus(
      status === "open" || status === "won" || status === "lost" ? status : null,
    ),
    pageId: selectedMetaPageFilterId,
    onPageChange: setSelectedMetaPageFilterId,
    campaignIds: selectedCampaignIds,
    onCampaignsChange: setSelectedCampaignIds,
    adSetId: sharedLeadFilters.adSetId,
    onAdSetChange: sharedLeadFilters.setAdSetId,
    adId: sharedLeadFilters.adId,
    onAdChange: sharedLeadFilters.setAdId,
    datePreset: sharedLeadFilters.datePreset,
    onDatePresetChange: sharedLeadFilters.setDatePreset,
    customDateRange: sharedLeadFilters.customDateRange,
    onCustomDateRangeChange: sharedLeadFilters.setCustomDateRange,
    showArchived,
    onShowArchivedChange: setShowArchived,
    onlyLeads,
    onOnlyLeadsChange: (checked: boolean) => {
      setOnlyLeads(checked);
      if (checked) setWithoutLeadOnly(false);
    },
    withoutLeadOnly,
    onWithoutLeadOnlyChange: (checked: boolean) => {
      setWithoutLeadOnly(checked);
      if (checked) {
        setOnlyLeads(false);
      }
    },
    pendingReplyOnly,
    onPendingReplyOnlyChange: setPendingReplyOnly,
    onClearFilters: clearConversationFilters,
    searchTerm,
    onSearchTermChange: setSearchTerm,
  };

  const conversationOverlays = (
    <>
      <OwnWhatsAppLeadStartDialogs start={ownWhatsAppStart} />
      <ConversationOverlays key={overlayScopeKey}
        ownerScopeKey={overlayOwnerKey}
        canCreateLeads={canCreateLeads}
        createLeadOpen={overlaysCurrent && createLeadOpen}
        onCreateLeadOpenChange={setCreateLeadOpen}
        createLeadContact={overlaysCurrent ? createLeadContact : {}}
        onLeadSaved={() => { if (overlayScopeRef.current === overlayScopeKey) void refreshSelectedWhatsAppConversation(); }}
        selectedLeadId={selectedLeadId}
        selectedConversation={selectedConversation}
        showAutomationDialog={overlaysCurrent && showAutomationDialog}
        onAutomationDialogOpenChange={setShowAutomationDialog}
        pendingDeleteConversation={overlaysCurrent ? pendingDeleteConversation : null}
        isDeletingConversation={deleteConversation.isPending}
        onDeleteDialogOpenChange={(open) => {
          if (!open && !deleteConversation.isPending) setPendingDeleteConversation(null);
        }}
        onConfirmDeleteConversation={() => void confirmDeleteConversation()}
      />
      <EnterAttendanceDialog
        {...attendanceGate.dialogProps}
        contactName={selectedConversation?.lead?.name || selectedConversation?.contact_name}
      />
      <ConfirmConversationLeadLinkDialog
        open={overlaysCurrent && Boolean(pendingCreateLeadConversation)}
        mode="new"
        preview={createLeadLinkPreview}
        isLoading={isCreateLeadLinkPreviewLoading}
        isConfirming={false}
        hasError={createLeadLinkPreviewFailed}
        onOpenChange={(open) => {
          if (!open) closeCreateLeadLinkPreview();
        }}
        onRetry={() => {
          if (pendingCreateLeadConversation) void loadCreateLeadLinkPreview(pendingCreateLeadConversation);
        }}
        onConfirm={confirmCreateLeadLinkPreview}
      />
    </>
  );

  const changingLeadLink = canReassignSelectedLead && linkPanelOwnerKey === detailsSelectionKey
    && linkPanelConversationId === selectedConversation?.id;
  const conversationDetails = selectedConversation && canShowLeadPanel ? (
    <ConversationDetailsPane key={detailsSelectionKey} open={showLeadPanel} docked={detailsDocked}
      onClose={closeLeadPanel} actionsRef={conversationActionsRef}>
      {selectedLeadId && !changingLeadLink ? (
        <ConversationLeadPanel key={JSON.stringify([overlayScopeKey, selectedLeadId, selectedConversation.supervisory_lead_view])}
          leadId={selectedLeadId} readOnly={selectedConversation.supervisory_lead_view} onClose={closeLeadPanel}
          contactPicture={getConversationAvatarUrl(selectedConversation)}
          contactPictureFallback={selectedConversation.contact_picture} />
      ) : (
        <ConversationUnregisteredPanel key={JSON.stringify([overlayScopeKey, selectedConversation.id, selectedExpectedLeadId, changingLeadLink])}
          contactName={selectedConversation.contact_name}
          contactPhone={normalizeWhatsAppContactPhoneToE164(selectedConversation.contact_phone, selectedConversation.remote_jid)}
          contactPicture={getConversationAvatarUrl(selectedConversation)}
          contactPictureFallback={selectedConversation.contact_picture}
          currentLeadId={selectedLeadId || undefined}
          currentLeadName={selectedConversation.lead?.name || undefined}
          onClose={selectedLeadId ? () => setLinkPanelConversationId(null) : closeLeadPanel}
          onCreateLead={!selectedLeadId && canCreateLeads ? () => openCreateLeadForConversation(selectedConversation) : undefined}
          canLinkLead={canReassignSelectedLead}
          onPreviewLinkLead={previewConversationLeadLink}
          onLinkLead={handleLinkExistingLead}
          isLinkingLead={linkConversationToLead.isPending}
          historyDeadlineAt={!selectedLeadId && selectedConversation.last_message_at
            ? new Date(new Date(selectedConversation.last_message_at).getTime() + 7 * 86400000).toISOString()
            : null} />
      )}
    </ConversationDetailsPane>
  ) : null;

  // On small screens, keep the conversation first; details open on request.
  if (isMobile) {
    return (
      <AppLayout title="Conversas" disableMainScroll>
        <div ref={bindDetailsContainer} data-conversations-mobile-surface className="app-card flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
          {selectedConversation ? (
            <div className="relative flex flex-col h-full overflow-hidden" onDrop={attachments.onDrop} onDragOver={attachments.onDragOver}>
              <MobileConversationHeader
                onCreateLead={canCreateLeads && selectedConversation && !selectedLeadId ? () => openCreateLeadForConversation(selectedConversation) : undefined}
                conversation={selectedConversation}
                selectedLeadId={selectedLeadId}
				canOperateWhatsApp={canManageSelectedWhatsAppConversation}
                isArchiving={archiveConversation.isPendingFor?.(selectedConversation) ?? false}
                onLinkLead={canReassignSelectedLead ? openLeadLinkPanel : undefined}
                onToggleLeadPanel={canShowLeadPanel ? () => setLeadPanelOpen(!showLeadPanel) : undefined}
                showLeadPanel={showLeadPanel}
                actionsButtonRef={conversationActionsRef}
                searchButtonRef={conversationSearchRef}
                onSearch={activePlatform === "whatsapp" ? () => messageNavigation.setOpen(!messageNavigation.open) : undefined}
                searchOpen={messageNavigation.open}
                onBack={handleBackToList}
                onArchive={() => handleArchive(selectedConversation)}
                onDelete={() => handleDelete(selectedConversation)}
              />
              {activePlatform === "whatsapp" && <ConversationHistorySearch navigation={messageNavigation} onClose={() => conversationSearchRef.current?.focus({ preventScroll: true })} />}
              <ConversationMessages
                layout="mobile"
                viewerUserId={currentUserId}
                viewerAvatarUrl={profile?.id === user?.id ? profile?.avatar_url ?? null : null}
                viewerAvatarName={profile?.id === user?.id ? profile?.name ?? null : null}
                activePlatform={activePlatform}
                conversation={selectedConversation}
                messages={visibleMessages}
                senderAvatars={senderAvatars}
                firstUnreadMessageId={unread.firstUnreadMessageId}
                unreadCount={unread.unreadCount}
                mediaGallery={mediaGallery}
                mediaGalleryScopeKey={audioContextKey}
                onNavigateQuoted={(message, id) => messageNavigation.navigateTo(id, { conversationId: message.conversation_id, sessionId: message.session_id })}
                isLoading={loadingMessages}
                isError={messagesFailed}
                onRetryMessages={() => void refetchMessages()}
                hasOlderMessages={hasOlderMessages}
                isLoadingOlder={isLoadingOlder}
                olderMessagesFailed={olderMessagesFailed}
                onLoadOlderMessages={() => { isUserScrollingRef.current = true; void loadOlderMessages(); }}
                messagesEndRef={messagesEndRef}
                onScrollCapture={handleMessagesScroll}
                onScrollToLatest={scrollMessagesToLatest}
                atBottom={readScrollState.scope !== messageScrollContext || readScrollState.atBottom}
				canOperateWhatsApp={canMutateSelectedWhatsAppConversation}
                canOperateLeads={canOperateLeads}
                selectedLeadId={selectedLeadId}
                onRetryMedia={retryMediaDownload}
                reactionsByMessageId={reactionsByMessageId}
                onReply={!audioDisabled ? handleReply : undefined}
                onRecoverText={!audioDisabled ? (message) => { if (audioContextRef.current === audioContextKey) setMessageText(message.content || ""); } : undefined}
                onCheckSend={originalOrganization ? (message) => handleResolveAudio(String(message.client_message_id || message.metadata?.client_message_id || message.id)) : undefined}
                onOpenLead={canOperateLeads && selectedLeadId ? () => router.push(`/crm/pipelines?lead=${selectedLeadId}`) : undefined}
                onDiscardLocal={(message) => { if (selectedConversation && audioContextRef.current === audioContextKey) discardLocalMessage({ conversation: selectedConversation, message }); }}
                attendanceEntries={attendanceGate.entries}
                onReact={handleReactToMessage}
                reactingMessageId={reactToMessage.isPending
                  ? reactToMessage.variables?.targetMessage.id ?? null
                  : null}
              />
              {ownWhatsAppStart.notice?.preserveComposer && ownWhatsAppStartNotice}
              <ConversationComposer
                layout="mobile"
                startNotice={ownWhatsAppStart.notice?.preserveComposer ? undefined : ownWhatsAppStartNotice}
                readOnly={!canComposeSelectedConversation}
                whatsAppControls={activePlatform === "whatsapp"}
                attachments={activePlatform === "whatsapp" ? attachments : undefined}
                inputRef={messageInputRef}
                fileInputRef={fileInputRef}
                onFileSelect={handleFileSelect}
                messageText={messageText}
                onMessageTextChange={setMessageText}
                onSendMessage={() => void handleSendMessage()}
                onKeyDown={handleKeyPress}
                placeholder={messageInputPlaceholder}
                disabled={messageInputDisabled}
                isSending={activePlatform === "whatsapp" ? sendTextMessage.isPending : sendMetaMessage.isPending}
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
                audioContextKey={audioContextKey}
                audioDisabled={audioDisabled}
                onResolveAudio={handleResolveAudio}
                quotedMessage={replyTarget ? toWhatsAppQuote(replyTarget) : null}
                onClearQuote={() => setReplySelection(null)}
                onSendAudio={handleSendAudio}
              />
              {conversationDetails}
            </div>
          ) : (
            <div className="flex flex-col h-full">
              <ConversationFilters
                layout="mobile"
                {...conversationToolbarProps}
              />
              <ConversationList
                layout="mobile"
                previewCardRef={activePlatform === "whatsapp" ? visibleCanonicalPreviews.previewCardRef : undefined}
                channel={activePlatform === "whatsapp" ? "whatsapp" : "meta"}
                conversations={filteredConversations}
                getDraftText={activePlatform === "whatsapp" ? c => conversationDraft.getConversationDraft(c.id, getWhatsAppConversationMessageScope(c).expectedLeadId) : undefined}
                currentUserId={currentUserId}
                isLoading={loadingConversations}
                isSearching={searchingConversations}
                isError={conversationsFailed}
                onRetry={() => void refetchConversations()}
                sessionsDisconnected={!loadingSessions && sessions?.length === 0}
                canManageWhatsApp={canManageWhatsApp}
                onConnectWhatsApp={() => router.push("/settings?tab=whatsapp")}
				canOperate={canOperateWhatsApp}
                canManageTags={canOperateLeads}
                canCreateLead={canCreateLeads}
                availableTags={availableTags}
                isTagsLoading={loadingTags || fetchingTags}
                isTagsError={tagsFailed}
                onRetryTags={() => void refetchTags()}
                isArchiving={(conversation) => archiveConversation.isPendingFor?.(conversation) ?? false}
                isTagUpdating={() => addLeadTag.isPending || removeLeadTag.isPending}
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
            onViewLead={(leadId) => router.push(`/crm/pipelines?lead=${leadId}`)}
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
      <div ref={bindDetailsContainer} className="relative flex h-full min-h-0 gap-3 overflow-hidden">
        <aside data-tour="conversations-overview" className="app-card flex w-[280px] min-w-[280px] max-w-[280px] lg:w-[365px] lg:min-w-[365px] lg:max-w-[365px] flex-col overflow-hidden">
          <ConversationFilters
            layout="desktop"
            {...conversationToolbarProps}
          />
          <ConversationList
            layout="desktop"
            previewCardRef={activePlatform === "whatsapp" ? visibleCanonicalPreviews.previewCardRef : undefined}
            getDraftText={activePlatform === "whatsapp" ? c => conversationDraft.getConversationDraft(c.id, getWhatsAppConversationMessageScope(c).expectedLeadId) : undefined}
            channel={activePlatform === "whatsapp" ? "whatsapp" : "meta"}
            conversations={desktopConversations}
            selectedConversationId={selectedConversationId || undefined}
            currentUserId={currentUserId}
            isLoading={activePlatform === "whatsapp" ? loadingConversations : loadingMetaConversations}
            isSearching={searchingConversations}
            isError={activePlatform === "whatsapp" && conversationsFailed}
            onRetry={() => void refetchConversations()}
            canManageWhatsApp={canManageWhatsApp}
            onConnectWhatsApp={() => router.push("/settings?tab=whatsapp")}
            canOperate={activePlatform === "whatsapp" && canOperateWhatsApp}
            canManageTags={canOperateLeads}
            canCreateLead={activePlatform === "whatsapp" && canCreateLeads}
            availableTags={availableTags}
            isTagsLoading={loadingTags || fetchingTags}
            isTagsError={tagsFailed}
            onRetryTags={() => void refetchTags()}
            isArchiving={(conversation) => archiveConversation.isPendingFor?.(conversation) ?? false}
            isTagUpdating={() => addLeadTag.isPending || removeLeadTag.isPending}
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
                onViewLead={(leadId) => router.push(`/crm/pipelines?lead=${leadId}`)}
            formatTime={formatConversationTime}
            hasMoreConversations={activePlatform === "whatsapp" && hasMoreConversations}
            isLoadingMoreConversations={isLoadingMoreConversations}
            onLoadMoreConversations={() => void loadMoreConversations()}
          />
        </aside>

        <main data-tour="conversations-chat" className="app-card flex min-w-0 flex-1 flex-col overflow-hidden" onDrop={attachments.onDrop} onDragOver={attachments.onDragOver}>
          {selectedConversation ? (
            <>
              <ConversationHeader
                contactName={selectedConversation.lead?.name || selectedConversation.contact_name}
                contactPhone={selectedConversation.contact_phone}
                contactPicture={getConversationAvatarUrl(selectedConversation)}
          contactPictureFallback={selectedConversation.contact_picture}
                contactPresence={selectedConversation.contact_presence}
                contactPresenceUpdatedAt={selectedConversation.presence_updated_at}
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
                isArchiving={archiveConversation.isPendingFor?.(selectedConversation) ?? false}
                onCreateLead={canCreateLeads ? () => openCreateLeadForConversation(selectedConversation) : undefined}
                onReassignLead={canReassignSelectedLead ? openLeadLinkPanel : undefined}
                onToggleLeadPanel={canShowLeadPanel ? () => setLeadPanelOpen(!showLeadPanel) : undefined}
                actionsButtonRef={conversationActionsRef}
                searchButtonRef={conversationSearchRef}
                onSearch={activePlatform === "whatsapp" ? () => messageNavigation.setOpen(!messageNavigation.open) : undefined}
                searchOpen={messageNavigation.open}
                showLeadPanel={showLeadPanel}
              />
              {activePlatform === "whatsapp" && <ConversationHistorySearch navigation={messageNavigation} onClose={() => conversationSearchRef.current?.focus({ preventScroll: true })} />}
              <ConversationMessages
                layout="desktop"
                viewerUserId={currentUserId}
                viewerAvatarUrl={profile?.id === user?.id ? profile?.avatar_url ?? null : null}
                viewerAvatarName={profile?.id === user?.id ? profile?.name ?? null : null}
                activePlatform={activePlatform}
                conversation={selectedConversation}
                messages={visibleMessages}
                senderAvatars={senderAvatars}
                firstUnreadMessageId={unread.firstUnreadMessageId}
                unreadCount={unread.unreadCount}
                mediaGallery={mediaGallery}
                mediaGalleryScopeKey={audioContextKey}
                onNavigateQuoted={(message, id) => messageNavigation.navigateTo(id, { conversationId: message.conversation_id, sessionId: message.session_id })}
                isLoading={loadingMessages}
                isError={messagesFailed}
                onRetryMessages={() => void refetchMessages()}
                hasOlderMessages={hasOlderMessages}
                isLoadingOlder={isLoadingOlder}
                olderMessagesFailed={olderMessagesFailed}
                onLoadOlderMessages={() => { isUserScrollingRef.current = true; void loadOlderMessages(); }}
                messagesEndRef={messagesEndRef}
                onScrollCapture={handleMessagesScroll}
                onScrollToLatest={scrollMessagesToLatest}
                atBottom={readScrollState.scope !== messageScrollContext || readScrollState.atBottom}
                canOperateWhatsApp={canMutateSelectedWhatsAppConversation}
                canOperateLeads={canOperateLeads}
                selectedLeadId={selectedLeadId}
                onRetryMedia={retryMediaDownload}
                reactionsByMessageId={reactionsByMessageId}
                onReply={!audioDisabled ? handleReply : undefined}
                onRecoverText={!audioDisabled ? (message) => { if (audioContextRef.current === audioContextKey) setMessageText(message.content || ""); } : undefined}
                onCheckSend={originalOrganization ? (message) => handleResolveAudio(String(message.client_message_id || message.metadata?.client_message_id || message.id)) : undefined}
                onOpenLead={canOperateLeads && selectedLeadId ? () => router.push(`/crm/pipelines?lead=${selectedLeadId}`) : undefined}
                onDiscardLocal={(message) => { if (selectedConversation && audioContextRef.current === audioContextKey) discardLocalMessage({ conversation: selectedConversation, message }); }}
                attendanceEntries={attendanceGate.entries}
                onReact={handleReactToMessage}
                reactingMessageId={reactToMessage.isPending
                  ? reactToMessage.variables?.targetMessage.id ?? null
                  : null}
              />
              {ownWhatsAppStart.notice?.preserveComposer && ownWhatsAppStartNotice}
              <ConversationComposer
                layout="desktop"
                startNotice={ownWhatsAppStart.notice?.preserveComposer ? undefined : ownWhatsAppStartNotice}
                readOnly={!canComposeSelectedConversation}
                whatsAppControls={activePlatform === "whatsapp"}
                attachments={activePlatform === "whatsapp" ? attachments : undefined}
                inputRef={messageInputRef}
                fileInputRef={fileInputRef}
                onFileSelect={handleFileSelect}
                messageText={messageText}
                onMessageTextChange={setMessageText}
                onSendMessage={() => void handleSendMessage()}
                onKeyDown={handleKeyPress}
                placeholder={messageInputPlaceholder}
                disabled={messageInputDisabled}
                isSending={activePlatform === "whatsapp" ? sendTextMessage.isPending : sendMetaMessage.isPending}
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
                audioContextKey={audioContextKey}
                audioDisabled={audioDisabled}
                onResolveAudio={handleResolveAudio}
                quotedMessage={replyTarget ? toWhatsAppQuote(replyTarget) : null}
                onClearQuote={() => setReplySelection(null)}
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

        {conversationDetails}
      </div>
      {conversationOverlays}
    </AppLayout>
  );
}
