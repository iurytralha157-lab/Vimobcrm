import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { MessageBox } from "@/components/ui/message-box";
import { useFloatingChat } from "@/contexts/FloatingChatContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MessageCircle, X, ArrowLeft, ArrowDown, Search, Loader2, Phone, Users, Paperclip, ExternalLink, ArrowRight, SlidersHorizontal, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWhatsAppConversations, useWhatsAppUnreadCount, useSendWhatsAppMessage, useReactToWhatsAppMessage, useMarkConversationAsRead, useWhatsAppLeadRealtime, useArchiveConversation, useDeleteConversation, useLinkConversationToLead, WhatsAppConversation, type WhatsAppMessage } from "@/hooks/use-whatsapp-conversations";
import { useWhatsAppMessagesPaginated } from "@/hooks/use-whatsapp-messages-paginated";
import { useAccessibleSessions } from "@/hooks/use-accessible-sessions";
import { useWhatsAppAttendanceGate, type WhatsAppAttendanceTarget } from "@/hooks/use-whatsapp-attendance";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { WhatsAppSession } from "@/hooks/use-whatsapp-sessions";
import { getWhatsAppStartErrorMessage, useStartConversation, useFindConversationByPhone } from "@/hooks/use-start-conversation";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { DateSeparator, shouldShowDateSeparator } from "@/components/features/whatsapp/DateSeparator";
import { AudioRecorderButton } from "@/components/features/whatsapp/AudioRecorderButton";
import { MessageBubble } from "@/components/features/whatsapp/MessageBubble";
import { MessageErrorBoundary } from "@/components/features/whatsapp/MessageErrorBoundary";
import { StartAutomationDialog } from "@/components/features/whatsapp/StartAutomationDialog";
import { AttendanceTimelineEvents } from "@/components/features/whatsapp/AttendanceTimelineEvents";
import { EnterAttendanceDialog } from "@/components/features/whatsapp/EnterAttendanceDialog";
import {
  captureConversationListReturnPosition,
  ConversationListItem,
  formatConversationTime,
  getConversationAvatarUrl,
  matchesConversationSearch,
  restoreConversationListReturnPosition,
  type ConversationListReturnPosition,
} from "@/components/features/whatsapp/conversations";
import { usePathname, useRouter } from 'next/navigation';
import {
  formatWhatsAppContactLabel,
  formatWhatsAppContactPhoneForDisplay,
  normalizePhoneToE164,
} from "@/lib/phone-utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { whatsappAPI, type WhatsAppAttendanceEntry } from "@/lib/api/whatsapp";
import {
  getWhatsAppConversationDraftKey,
  getWhatsAppConversationMessageScope,
  getWhatsAppMessageInputState,
  preserveWhatsAppConversationCardSnapshot,
  updateWhatsAppConversationDraft,
  WHATSAPP_UNLINKED_LEAD_SNAPSHOT,
} from "@/lib/whatsapp-message-input";
import { getWhatsAppSendFailureStatus, resolveWhatsAppConversationSessionFilter } from "@/lib/whatsapp-query-cache";
import { canReactToWhatsAppMessage, groupLatestWhatsAppReactions } from "@/lib/whatsapp-reactions";
import { normalizeSearchText } from "@/lib/search-text";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { useTags } from "@/hooks/use-tags";
import { useAddLeadTag, useRemoveLeadTag } from "@/hooks/use-leads";
import { getTagColorStyleWithWhiteText } from "@/lib/tag-color";
import {
  blobToBase64,
  compressOutboundImageFile,
  getMessageMediaExtension,
  getOutboundMessageMediaKind,
  MAX_OUTBOUND_MESSAGE_MEDIA_BYTES,
  OUTBOUND_IMAGE_COMPRESSION_PROFILES,
} from "@/components/features/whatsapp/message-media";

async function withTimeout<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function readFloatingChatPreference(key: string) {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeFloatingChatPreference(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

type FloatingConversationFiltersProps = {
  sessions: WhatsAppSession[];
  selectedSessionId: string;
  onSessionChange: (sessionId: string) => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  hideGroups: boolean;
  onHideGroupsChange: (value: boolean) => void;
  showArchived: boolean;
  onShowArchivedChange: (value: boolean) => void;
  onClearFilters: () => void;
};

type FloatingTimelineItem =
  | { kind: "message"; id: string; timestamp: string; message: WhatsAppMessage }
  | { kind: "attendance"; id: string; timestamp: string; entry: WhatsAppAttendanceEntry };

function FloatingConversationFilters({
  sessions,
  selectedSessionId,
  onSessionChange,
  searchTerm,
  onSearchChange,
  hideGroups,
  onHideGroupsChange,
  showArchived,
  onShowArchivedChange,
  onClearFilters,
}: FloatingConversationFiltersProps) {
  const activeFilterCount = [
    selectedSessionId !== "all",
    hideGroups,
    showArchived,
  ].filter(Boolean).length;

  return (
    <div className="shrink-0 border-b border-black/[0.035] bg-[var(--app-surface-solid)] px-2.5 py-2 dark:border-white/[0.035]">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar conversas"
            placeholder="Buscar conversas..."
            value={searchTerm}
            onChange={e => onSearchChange(e.target.value)}
            className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] py-0 pl-8 pr-3 text-[11px] font-light shadow-none focus-visible:ring-1 focus-visible:ring-primary/25 focus-visible:ring-offset-0 md:text-[11px]"
            autoComplete="off"
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              aria-label="Filtrar conversas"
              className={cn(
                "h-8 shrink-0 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-[11px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] [&_svg]:size-3.5",
                activeFilterCount > 0 && "bg-[var(--app-surface-hover)] text-primary",
              )}
            >
              <SlidersHorizontal aria-hidden="true" />
              <span>Filtros</span>
              {activeFilterCount > 0 && (
                <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] leading-none text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="z-[70] w-[240px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-2.5 text-[var(--app-text-primary)] shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
          >
            <div className="space-y-2">
              {sessions.length > 1 && (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-medium text-muted-foreground">Conta</span>
                  <Select value={selectedSessionId} onValueChange={onSessionChange}>
                    <SelectTrigger className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] font-light shadow-none focus:ring-0">
                      <SelectValue placeholder="Selecione a conta" />
                    </SelectTrigger>
                    <SelectContent className="z-[80] bg-popover">
                      <SelectItem value="all">Todas as contas</SelectItem>
                      {sessions.map((session) => (
                        <SelectItem key={session.id} value={session.id}>
                          {session.display_name || session.instance_name || session.phone_number}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid gap-2">
                <label className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                  <span>Ocultar grupos</span>
                  <Checkbox
                    className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3"
                    checked={hideGroups}
                    onCheckedChange={(checked) => onHideGroupsChange(checked === true)}
                  />
                </label>
                <label className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                  <span>Mostrar arquivadas</span>
                  <Checkbox
                    className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3"
                    checked={showArchived}
                    onCheckedChange={(checked) => onShowArchivedChange(checked === true)}
                  />
                </label>
              </div>

              {activeFilterCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full rounded-[6px] border-0 bg-primary/10 px-2 text-[11px] font-medium text-primary shadow-none hover:bg-primary/15 hover:text-primary"
                  onClick={onClearFilters}
                >
                  Limpar filtros
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

export function FloatingChat() {
  const {
    state,
    closeChat,
    openConversation,
    clearActiveConversation,
    clearPendingMessage
  } = useFloatingChat();
  const {
    isOpen,
    isPresenceOpen,
    activeConversation,
    pendingPhone,
    pendingLeadName,
    pendingMessage,
    pendingLeadId
  } = state;
  const isMobile = useIsMobile();
  const [selectedSessionId, setSelectedSessionId] = useState<string>("all");
  const { activeOrganization, profile, user } = useAuth();
  const { hasModule, isLoading: modulesLoading } = useOrganizationModules();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const canStartAutomations = hasPermission("automations_manage");
  const hasWhatsAppViewPermission = hasPermission("whatsapp_view");
  const canOperateWhatsApp = hasPermission("whatsapp_operate");
  const canOperateLeads = hasPermission("lead_operate");
  const currentUserId = profile?.id || user?.id || null;
  const activeTenantKey = `${currentUserId || "anonymous"}:${activeOrganization.organizationId || "none"}`;
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({});
  const [hideGroups, setHideGroups] = useState(() =>
    readFloatingChatPreference("whatsapp-hide-groups-floating"),
  );
  const [showArchived, setShowArchived] = useState(() =>
    readFloatingChatPreference("whatsapp-show-archived-floating"),
  );
  const [shouldLoadTags, setShouldLoadTags] = useState(false);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const [showAutomationDialog, setShowAutomationDialog] = useState(false);
  const [showSessionSelector, setShowSessionSelector] = useState(false);
  const [pendingStartData, setPendingStartData] = useState<{phone: string, leadName?: string, leadId?: string} | null>(null);
  const [isStartingConversation, setIsStartingConversation] = useState(false);
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<WhatsAppConversation | null>(null);
  const pathname = usePathname();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const conversationListScrollAreaRef = useRef<HTMLDivElement>(null);
  const conversationListPositionRef = useRef<ConversationListReturnPosition | null>(null);
  const shouldRestoreConversationListScrollRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const lastVisibleMessageIdRef = useRef<string | null>(null);
  const lastMessagesConversationIdRef = useRef<string | null>(null);
  const isUserScrollingRef = useRef<boolean>(false);
  const navigationNonceRef = useRef(0);
  const pendingStartKeyRef = useRef<string | null>(null);
  const pendingConversationLinkRef = useRef<{ conversationId: string; leadId: string } | null>(null);
  const chatSurfaceRef = useRef<HTMLDivElement>(null);
  const wasChatVisibleRef = useRef(false);
  const latestMessageScrollTimeoutRef = useRef<number | null>(null);
  const accessReady = !modulesLoading && !permissionsLoading;
  const canViewWhatsApp = hasModule("whatsapp")
    && (hasWhatsAppViewPermission || canOperateWhatsApp);
  const chatVisible = isOpen
    && accessReady
    && canViewWhatsApp
    && !isPresenceOpen
    && pathname !== "/crm/conversas";

  useEffect(() => {
    const wasChatVisible = wasChatVisibleRef.current;
    wasChatVisibleRef.current = chatVisible;
    if (!chatVisible || wasChatVisible) return undefined;

    const focusFrame = window.requestAnimationFrame(() => {
      chatSurfaceRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [chatVisible]);

  useEffect(() => {
    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setSelectedSessionId("all");
      setSearchTerm("");
      setMessageDrafts({});
      setShouldLoadTags(false);
      setPendingStartData(null);
      setShowScrollToLatest(false);
      conversationListPositionRef.current = null;
      shouldRestoreConversationListScrollRef.current = false;
      pendingStartKeyRef.current = null;
      pendingConversationLinkRef.current = null;
    });
    return () => {
      isActive = false;
    };
  }, [profile?.id, activeOrganization.organizationId]);
  const activeConversationId = activeConversation?.id;
  const activeConversationMessageScope = getWhatsAppConversationMessageScope(activeConversation);
  const activeMessageDraftKey = getWhatsAppConversationDraftKey({
    tenantKey: activeTenantKey,
    conversationId: activeConversationId,
    expectedLeadId: activeConversationMessageScope.expectedLeadId,
  });
  const messageText = activeMessageDraftKey ? messageDrafts[activeMessageDraftKey] ?? "" : "";
  const setMessageText = useCallback((value: string | ((current: string) => string)) => {
    if (!activeMessageDraftKey) return;
    setMessageDrafts((currentDrafts) => updateWhatsAppConversationDraft(
      currentDrafts,
      activeMessageDraftKey,
      value,
    ));
  }, [activeMessageDraftKey]);
  const activeConversationLead = activeConversation?.lead;
  const activeConversationLeadId = activeConversation?.lead_id || activeConversationLead?.id || null;
  const canMutateActiveConversation = canOperateWhatsApp && activeConversationMessageScope.canMutate;
  const canManageActiveConversation = canOperateWhatsApp && activeConversationMessageScope.canManage;
  const activeConversationUnreadCount = activeConversation?.unread_count ?? 0;
  const activeConversationSessionId = activeConversation?.session_id;
  const activeConversationRemoteJid = activeConversation?.remote_jid;
  const activeConversationIsGroup = activeConversation?.is_group;
  const shouldSyncFloatingChat = chatVisible;
  const shouldLoadFloatingChatData = accessReady
    && canViewWhatsApp
    && (isOpen || Boolean(pendingPhone) || Boolean(activeConversation));
  const activeConversationReadTarget = useMemo(() => (
    activeConversationId && activeConversationSessionId && activeConversationRemoteJid
      ? {
          id: activeConversationId,
          unreadCount: activeConversationUnreadCount,
          sessionId: activeConversationSessionId,
		  remoteJid: activeConversationRemoteJid,
		  isGroup: Boolean(activeConversationIsGroup),
		  leadId: activeConversationLeadId,
        }
      : null
  ), [
	activeConversationId,
	activeConversationLeadId,
    activeConversationUnreadCount,
    activeConversationSessionId,
    activeConversationRemoteJid,
    activeConversationIsGroup,
  ]);
  const {
    data: sessions,
    isLoading: loadingSessions,
    isError: sessionsFailed,
    refetch: refetchSessions,
  } = useAccessibleSessions({ enabled: shouldLoadFloatingChatData });
  const accessibleSessionIds = useMemo(
    () => sessions?.map((session) => session.id) || [],
    [sessions],
  );
  const conversationSessionFilter = useMemo(
    () => resolveWhatsAppConversationSessionFilter(
      selectedSessionId,
      loadingSessions ? [] : accessibleSessionIds,
    ),
    [accessibleSessionIds, loadingSessions, selectedSessionId],
  );
  const conversationListPositionKey = useMemo(() => [
    "floating",
    currentUserId || "anonymous",
    activeOrganization.organizationId || "none",
    selectedSessionId,
    [...accessibleSessionIds].sort().join(","),
    hideGroups ? "hide-groups" : "show-groups",
    showArchived ? "archived" : "active",
    searchTerm.trim(),
    "30",
  ].join("|"), [
    accessibleSessionIds,
    activeOrganization.organizationId,
    currentUserId,
    hideGroups,
    searchTerm,
    selectedSessionId,
    showArchived,
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
    shouldSyncFloatingChat ? conversationSessionFilter.sessionId : undefined,
    {
      hideGroups,
      showArchived,
      search: debouncedSearchTerm,
    },
    shouldSyncFloatingChat ? conversationSessionFilter.accessibleSessionIds : [],
    30,
    {
      enabled: shouldSyncFloatingChat,
      refetchOnWindowFocus: true,
    },
  );
  const { data: unreadCount = 0 } = useWhatsAppUnreadCount(
    undefined,
    undefined,
    undefined,
    { enabled: shouldSyncFloatingChat },
  );
  const {
    messages,
    isLoading: loadingMessages,
    isFetching: fetchingMessages,
    hasOlderMessages,
    loadOlderMessages,
    isLoadingOlder,
    isError: messagesFailed,
    isFetchNextPageError: olderMessagesFailed,
    refetch: refetchMessages,
  } = useWhatsAppMessagesPaginated(
    shouldSyncFloatingChat ? activeConversationId || null : null,
    {
      pageSize: 30,
      expectedLeadId: activeConversationMessageScope.expectedLeadId,
      historyLeadId: activeConversationMessageScope.historyLeadId,
    },
  );
  const reactionMessages = useMemo(() => {
    return (messages || []).filter((message) => message.message_type === "reaction");
  }, [messages]);
  const reactionsByMessageId = useMemo(() => {
    return groupLatestWhatsAppReactions(reactionMessages);
  }, [reactionMessages]);
  const visibleMessages = useMemo(() => {
    return (messages || []).filter((message) => message.message_type !== "reaction");
  }, [messages]);
  const sendMessage = useSendWhatsAppMessage();
  const reactToMessage = useReactToWhatsAppMessage();
  const { mutate: markConversationAsRead } = useMarkConversationAsRead();
  const archiveConversation = useArchiveConversation();
  const deleteConversation = useDeleteConversation();
  const linkConversationToLead = useLinkConversationToLead();
  const {
    data: availableTags = [],
    isLoading: isTagsLoading,
    isFetching: isTagsFetching,
    isError: tagsFailed,
    refetch: refetchTags,
  } = useTags({
    enabled: shouldSyncFloatingChat && !activeConversationId && shouldLoadTags,
  });
  const addLeadTag = useAddLeadTag();
  const removeLeadTag = useRemoveLeadTag();
  const startConversation = useStartConversation();
  const findConversation = useFindConversationByPhone();
  const hasWhatsAppAccess = Boolean(sessions?.length);
  const router = useRouter();
  const isReadOnlyMode = !canMutateActiveConversation;
  const whatsappMessageInputState = getWhatsAppMessageInputState(
    activeConversation,
    selectedSessionId,
    sessions,
  );
  const activeAttendanceTarget = useMemo<WhatsAppAttendanceTarget | null>(() => {
    if (
      !activeConversationId
      || !activeConversationLeadId
      || activeConversation?.historical_lead_view
      || !whatsappMessageInputState.sendSessionId
    ) {
      return null;
    }
    return {
      conversationId: activeConversationId,
      expectedLeadId: activeConversationLeadId,
      sendSessionId: whatsappMessageInputState.sendSessionId,
    };
  }, [
    activeConversation?.historical_lead_view,
    activeConversationId,
    activeConversationLeadId,
    whatsappMessageInputState.sendSessionId,
  ]);
  const attendanceGate = useWhatsAppAttendanceGate(activeAttendanceTarget, {
    enabled: chatVisible && Boolean(activeAttendanceTarget),
    identityKey: `${activeTenantKey}:${activeConversationId || "none"}:${activeConversationLeadId || "none"}:${whatsappMessageInputState.sendSessionId || "none"}`,
  });
  const messageInputDisabled = attendanceGate.isResolving
    || isReadOnlyMode
    || whatsappMessageInputState.disabled;
  const floatingTimelineItems = useMemo<FloatingTimelineItem[]>(() => [
    ...visibleMessages.map((message): FloatingTimelineItem => ({
      kind: "message",
      id: `message-${message.id}`,
      timestamp: message.sent_at,
      message: message as WhatsAppMessage,
    })),
    ...attendanceGate.entries.map((entry): FloatingTimelineItem => ({
      kind: "attendance",
      id: `attendance-${entry.id}`,
      timestamp: entry.joinedAt,
      entry,
    })),
  ].sort((left, right) => (
    new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  )), [attendanceGate.entries, visibleMessages]);

  useWhatsAppLeadRealtime(
    shouldSyncFloatingChat,
    activeConversationLeadId ? [activeConversationLeadId] : [],
  );

  const getLeadPipelineUrl = (leadId: string) => {
    navigationNonceRef.current += 1;
    return `/crm/pipelines?lead=${leadId}&t=${navigationNonceRef.current}`;
  };

  useEffect(() => {
    if (!activeConversationId || !activeConversation || !conversations) return;

    const updatedConv = conversations.find((conversation) => conversation.id === activeConversationId);
    if (updatedConv && updatedConv !== activeConversation) {
      const pendingLink = pendingConversationLinkRef.current;
      if (pendingLink?.conversationId === updatedConv.id) {
        if (updatedConv.lead_id !== pendingLink.leadId) return;
        pendingConversationLinkRef.current = null;
		openConversation(updatedConv);
		return;
      }
	  const resolvedConversation = preserveWhatsAppConversationCardSnapshot(
		activeConversation,
		updatedConv,
	  );
	  openConversation(resolvedConversation);
    }
  }, [activeConversation, activeConversationId, activeConversationLeadId, conversations, openConversation]);

  const handleScrollArea = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]")
      || event.currentTarget;
    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 50;
    isUserScrollingRef.current = !isAtBottom;
    setShowScrollToLatest(!isAtBottom);
  }, []);

  const handleScrollToLatest = useCallback(() => {
    isUserScrollingRef.current = false;
    setShowScrollToLatest(false);
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleOpenConversationFromList = useCallback((conversation: WhatsAppConversation) => {
    conversationListPositionRef.current = captureConversationListReturnPosition(
      conversationListScrollAreaRef.current,
      conversationListPositionKey,
      conversation.id,
    );
    shouldRestoreConversationListScrollRef.current = true;
    openConversation(conversation);
  }, [conversationListPositionKey, openConversation]);

  useEffect(() => {
    writeFloatingChatPreference("whatsapp-hide-groups-floating", hideGroups);
  }, [hideGroups]);

  useEffect(() => {
    writeFloatingChatPreference("whatsapp-show-archived-floating", showArchived);
  }, [showArchived]);

  useEffect(() => {
    if (!pendingPhone) {
      pendingStartKeyRef.current = null;
      return;
    }
    if (loadingSessions || !accessReady || !canViewWhatsApp) return;

    const connectedSessionKey = (sessions || [])
      .filter((session) => session.status === "connected")
      .map((session) => `${session.id}:${session.status}`)
      .join("|");
    const pendingStartKey = [pendingPhone, pendingLeadName || "", pendingLeadId || "", connectedSessionKey].join("::");
    if (pendingStartKeyRef.current === pendingStartKey) return;
    pendingStartKeyRef.current = pendingStartKey;

    const openPendingConversation = async () => {
      const connected = sessions?.filter(s => s.status === "connected") || [];

      if (connected.length === 1) {
        await handleStartConversationWithSession(pendingPhone, connected[0].id, pendingLeadName || undefined, pendingLeadId || undefined);
        return;
      }

      if (connected.length > 1) {
        setPendingStartData({ phone: pendingPhone, leadName: pendingLeadName || undefined, leadId: pendingLeadId || undefined });
        setShowSessionSelector(true);
        return;
      }

      if (pendingLeadId) {
        await handleStartConversationWithSession(pendingPhone, undefined, pendingLeadName || undefined, pendingLeadId || undefined);
        return;
      }

      toast({
        title: "Nenhuma sessão conectada",
        description: "Conecte um WhatsApp em Configurações > WhatsApp",
        variant: "destructive"
      });
    };

    openPendingConversation();
  }, [
    pendingPhone,
    pendingLeadName,
    pendingLeadId,
    sessions,
    loadingSessions,
    accessReady,
    canViewWhatsApp,
    handleStartConversationWithSession,
  ]);
  useEffect(() => {
    if (!chatVisible || !activeConversationId) {
      lastMessagesConversationIdRef.current = null;
      lastVisibleMessageIdRef.current = null;
      isUserScrollingRef.current = false;
      setShowScrollToLatest(false);
      return undefined;
    }
    if (lastMessagesConversationIdRef.current !== activeConversationId) {
      lastMessagesConversationIdRef.current = activeConversationId;
      lastVisibleMessageIdRef.current = null;
      isUserScrollingRef.current = false;
      setShowScrollToLatest(false);
    }
    const lastMessageId = visibleMessages.at(-1)?.id ?? null;
    if (!lastMessageId || lastMessageId === lastVisibleMessageIdRef.current) return undefined;

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
  }, [activeConversationId, chatVisible, visibleMessages]);

  useEffect(() => {
    if (!chatVisible || activeConversationId || !shouldRestoreConversationListScrollRef.current) {
      return undefined;
    }
    if (conversationListPositionRef.current?.key !== conversationListPositionKey) {
      shouldRestoreConversationListScrollRef.current = false;
      return undefined;
    }

    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        if (restoreConversationListReturnPosition(
          conversationListScrollAreaRef.current,
          conversationListPositionKey,
          conversationListPositionRef.current,
        )) {
          shouldRestoreConversationListScrollRef.current = false;
        }
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    activeConversationId,
    chatVisible,
    conversationListPositionKey,
    conversations?.length,
    loadingConversations,
  ]);

  useEffect(() => {
    if (pendingMessage && activeConversation) {
      let isActive = true;
      queueMicrotask(() => {
        if (!isActive) return;
        setMessageText(pendingMessage);
        clearPendingMessage();
      });
      return () => {
        isActive = false;
      };
    }
  }, [activeConversation, clearPendingMessage, pendingMessage, setMessageText]);

  useEffect(() => {
    if (!chatVisible || isMobile || !activeConversationId || !canMutateActiveConversation) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      messageInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [activeConversationId, canMutateActiveConversation, chatVisible, isMobile]);

  useEffect(() => {
    if (!chatVisible) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (showSessionSelector || showAutomationDialog || pendingDeleteConversation) return;
      event.preventDefault();
      if (activeConversationId) {
        clearActiveConversation();
        return;
      }
      closeChat();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [
    activeConversationId,
    chatVisible,
    clearActiveConversation,
    closeChat,
    pendingDeleteConversation,
    showAutomationDialog,
    showSessionSelector,
  ]);

  useEffect(() => {
	if (canManageActiveConversation && activeConversationReadTarget && activeConversationReadTarget.unreadCount > 0) {
	  markConversationAsRead({
        id: activeConversationReadTarget.id,
        session_id: activeConversationReadTarget.sessionId,
        remote_jid: activeConversationReadTarget.remoteJid,
		is_group: activeConversationReadTarget.isGroup,
		lead_id: activeConversationReadTarget.leadId,
      });
    }
  }, [activeConversationReadTarget, canManageActiveConversation, markConversationAsRead]);

  const handleSessionSelect = (session: WhatsAppSession) => {
    setShowSessionSelector(false);
    if (pendingStartData) {
      handleStartConversationWithSession(pendingStartData.phone, session.id, pendingStartData.leadName, pendingStartData.leadId);
      setPendingStartData(null);
    }
  };

  const handleStartConversation = async (phone: string, leadName?: string, leadId?: string) => {
    const canonicalPhone = normalizePhoneToE164(phone);
    if (!canonicalPhone) {
      toast({
        title: "Lead sem WhatsApp",
        description: "Este lead não tem um WhatsApp válido cadastrado.",
        variant: "destructive"
      });
      clearActiveConversation();
      return;
    }

    const connectedSession = sessions?.find(session => session.status === "connected");
    const explicitlySelectedSessionId = selectedSessionId === "all" ? undefined : selectedSessionId;
    if (!explicitlySelectedSessionId && !leadId && !connectedSession) {
      toast({
        title: "Nenhuma sessão WhatsApp",
        description: "Configure uma sessão WhatsApp primeiro",
        variant: "destructive"
      });
      return;
    }
    await handleStartConversationWithSession(canonicalPhone, explicitlySelectedSessionId || connectedSession?.id, leadName, leadId);
  };
  void handleStartConversation;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- Existing startup effect depends on this legacy async flow; wrapping it would broaden this lint-only pass.
  async function handleStartConversationWithSession(phone: string, sessionId?: string, leadName?: string, leadId?: string) {
    const canonicalPhone = normalizePhoneToE164(phone);
    if (!canonicalPhone) {
      toast({
        title: "Lead sem WhatsApp",
        description: "Este lead não tem um WhatsApp válido cadastrado.",
        variant: "destructive"
      });
      clearActiveConversation();
      return;
    }

    setIsStartingConversation(true);

    try {
      // Reabra primeiro a projeção do próprio card. Se a conversa física já
      // estiver vinculada a outro card, o backend devolve o histórico imutável
      // deste lead e a simples navegação nunca reativa o vínculo antigo.
      if (leadId) {
		const existingForLead = await whatsappAPI.findConversation({
		  phone: "",
		  leadId,
		  organizationId: activeOrganization.organizationId,
		}) as WhatsAppConversation | null;
		if (existingForLead) {
		  openConversation(existingForLead);
		  return;
		}
	  }

      // Sem histórico do card, a busca física permanece restrita à sessão
      // escolhida. Um vínculo só é ativado abaixo como parte do fluxo explícito
      // de iniciar a conversa para esse card.
      if (sessionId) {
        const existing = await findConversation.mutateAsync({
          phone: canonicalPhone,
          sessionId,
        });
        if (existing) {
          let conversationToOpen = existing;
          if (leadId && existing.lead_id !== leadId) {
            if (!canOperateWhatsApp) {
              toast({
                title: "Conversa não vinculada",
                description: "Você pode visualizar conversas existentes, mas não vincular ou iniciar uma nova conversa.",
                variant: "destructive",
              });
              clearActiveConversation();
              return;
            }
            await linkConversationToLead.mutateAsync({
              conversation: existing,
              leadId,
            });
            pendingConversationLinkRef.current = {
              conversationId: existing.id,
              leadId,
            };
            // Read back the binding we just requested. A concurrent rebind or
            // an unavailable read must stop here; fabricating a lead_id in the
            // browser would display a card snapshot the server never proved.
            conversationToOpen = await whatsappAPI.getConversation(
              existing.id,
			  leadId,
              activeOrganization.organizationId,
            );
          }
          openConversation(conversationToOpen);
          return;
        }
      }

      // Fallback: tentar historico via edge function (acesso restrito)
      // Adicionamos um timeout para nao travar o fluxo
      if (leadId) {
        try {
          const restrictedData = await withTimeout(
            whatsappAPI.getHistoryAccess({
              leadId,
              organizationId: activeOrganization.organizationId,
            }),
            5000,
          );

          if (restrictedData?.conversation) {
            openConversation(restrictedData.conversation);
            return;
          }
        } catch {
          // Fallback silencioso: se o historico restrito falhar, o fluxo tenta seguir pela sessao selecionada.
        }
      }

      if (!canOperateWhatsApp) {
        toast({
          title: "Conversa não encontrada",
          description: "Você não tem permissão para iniciar uma nova conversa.",
          variant: "destructive",
        });
        clearActiveConversation();
        return;
      }

      if (!sessionId) {
        toast({
          title: "Sessão não encontrada",
          description: "Não há conversa existente e nenhuma sessão WhatsApp conectada/selecionada.",
          variant: "destructive"
        });
        // Limpar o estado de pending para nao ficar tentando em loop
        clearActiveConversation();
        return;
      }

      const newConversation = await startConversation.mutateAsync({
        phone: canonicalPhone,
        sessionId,
        leadId,
        leadName,
        expectedPreviousLeadId: WHATSAPP_UNLINKED_LEAD_SNAPSHOT,
      });

      openConversation(newConversation);
    } catch (error: unknown) {
      console.error("[WhatsApp Start] Erro final no fluxo:", error);
      toast({
        title: "Erro ao iniciar conversa",
        description: getWhatsAppStartErrorMessage(error),
        variant: "destructive"
      });
      // Limpar o estado de pending em caso de erro critico
      clearActiveConversation();
    } finally {
      setIsStartingConversation(false);
    }
  }
  // Memoize filtered conversations to prevent re-renders that cause input focus loss
  const filteredConversations = useMemo(() => {
    return conversations?.filter((conversation) =>
      matchesConversationSearch(conversation, searchTerm, normalizeSearchText),
    );
  }, [conversations, searchTerm]);

  const handleViewLead = (leadId: string) => {
    closeChat();
    // Usar contador para forcar React Router a detectar mudanca mesmo na mesma pagina
    const url = getLeadPipelineUrl(leadId);
    router.push(url);
  };

  const handleArchiveConversation = (conversation: WhatsAppConversation) => {
    if (!canOperateWhatsApp || conversation.historical_lead_view) return;
	archiveConversation.mutate({
	  conversation,
	  archive: !conversation.archived_at,
    }, {
      onSuccess: () => {
        if (activeConversation?.id === conversation.id) clearActiveConversation();
      },
    });
  };

  const handleDeleteConversation = (conversation: WhatsAppConversation) => {
    if (!canOperateWhatsApp || conversation.historical_lead_view) return;
    setPendingDeleteConversation(conversation);
  };

  const confirmDeleteConversation = async () => {
    if (!pendingDeleteConversation) return;

    try {
	  await deleteConversation.mutateAsync(pendingDeleteConversation);
      if (activeConversation?.id === pendingDeleteConversation.id) clearActiveConversation();
      setPendingDeleteConversation(null);
    } catch {
      // A mutação exibe o erro e o diálogo permanece aberto para uma nova tentativa.
    }
  };

  const retryMediaDownload = async (messageId: string) => {
    if (!canMutateActiveConversation) return;
    try {
      await whatsappAPI.retryMediaDownload(messageId, activeOrganization.organizationId);
      await refetchMessages();
      toast({
        title: "Tentando novamente",
        description: "Aguarde enquanto baixamos a mídia...",
      });
    } catch {
      toast({
        title: "Não foi possível baixar a mídia",
        description: "Tente novamente em alguns instantes.",
        variant: "destructive",
      });
    }
  };

  const handleSendMessage = async () => {
    const textToSend = messageText.trim();
    if (!canMutateActiveConversation || !textToSend || !activeConversation) return;
    if (sendMessage.isPending) return;
    if (whatsappMessageInputState.disabled || isReadOnlyMode) {
      toast({
        title: "Mensagem nao enviada",
        description: isReadOnlyMode ? "Você tem acesso somente leitura a esta conversa." : whatsappMessageInputState.placeholder,
        variant: "destructive",
      });
      return;
    }

    const joined = await attendanceGate.ensureJoined();
    if (!joined) return;

    // O rascunho só é limpo depois que a entrada no atendimento foi confirmada.
    setMessageText("");

    try {
      await sendMessage.mutateAsync({
        conversation: activeConversation,
        text: textToSend,
        sendSessionId: whatsappMessageInputState.sendSessionId,
      });
    } catch (error) {
      if (getWhatsAppSendFailureStatus(error) !== "confirming") {
        setMessageText((current) => current || textToSend);
      }
    }
  };
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleSendAudio = async (base64: string, mimetype: string) => {
    if (!canMutateActiveConversation || !activeConversation) return false;
    if (whatsappMessageInputState.disabled || isReadOnlyMode) {
      toast({
        title: "Audio nao enviado",
        description: isReadOnlyMode ? "Você tem acesso somente leitura a esta conversa." : whatsappMessageInputState.placeholder,
        variant: "destructive",
      });
      return false;
    }

    const joined = await attendanceGate.ensureJoined();
    if (!joined) return false;

    try {
      await sendMessage.mutateAsync({
        conversation: activeConversation,
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
      return true;
    } catch {
      // A mutação é a única responsável pelo aviso de falha.
      return false;
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canMutateActiveConversation || !activeConversation) return;
    if (file.size > MAX_OUTBOUND_MESSAGE_MEDIA_BYTES) {
      toast({
        title: "Arquivo muito grande",
        description: "Envie um arquivo de até 5 MB.",
        variant: "destructive",
      });
      e.target.value = "";
      return;
    }
    if (whatsappMessageInputState.disabled || isReadOnlyMode) {
      toast({
        title: "Arquivo nao enviado",
        description: isReadOnlyMode ? "Você tem acesso somente leitura a esta conversa." : whatsappMessageInputState.placeholder,
        variant: "destructive",
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }
    const joined = await attendanceGate.ensureJoined();
    if (!joined) {
      e.target.value = "";
      return;
    }
    let processedFile: File;
    let base64Content: string;
    try {
      processedFile = await compressOutboundImageFile(
        file,
        OUTBOUND_IMAGE_COMPRESSION_PROFILES.preservePngEncoding,
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
      base64Content = await blobToBase64(processedFile);
    } catch {
      toast({
        title: "Não foi possível preparar o arquivo",
        description: "Confira o arquivo e tente novamente.",
        variant: "destructive",
      });
      e.target.value = "";
      return;
    }

    const mediaType = getOutboundMessageMediaKind(processedFile.type);
    try {
      await sendMessage.mutateAsync({
        conversation: activeConversation,
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
      // A mutação é a única responsável pelo aviso de falha.
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };
  const handleReactToMessage = async (message: WhatsAppMessage, emoji: string) => {
    if (!activeConversation || !activeConversationLeadId) return;
    const reactionSessionId = message.session_id || activeConversation.session_id;
    if (!reactionSessionId) return;
    const joined = await attendanceGate.ensureJoined({
      target: {
        conversationId: activeConversation.id,
        expectedLeadId: activeConversationLeadId,
        sendSessionId: reactionSessionId,
      },
    });
    if (!joined) return;
    await reactToMessage.mutateAsync({
      conversation: activeConversation,
      targetMessage: message,
      emoji,
    });
  };
  const connectedSessions = sessions?.filter(s => s.status === "connected") || [];
  const activeConversationFilterCount = [
    selectedSessionId !== "all",
    hideGroups,
    showArchived,
  ].filter(Boolean).length;

  const clearConversationFilters = () => {
    setSelectedSessionId("all");
    setHideGroups(false);
    setShowArchived(false);
  };

  // Session Selector Dialog Component
  const SessionSelectorDialog = () => (
    <Dialog open={showSessionSelector} onOpenChange={(open) => {
      if (!open) {
        setShowSessionSelector(false);
        setPendingStartData(null);
      }
    }}>
      <DialogContent className="sm:max-w-md w-[90%] sm:w-full rounded-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" />
            Escolher Instância WhatsApp
          </DialogTitle>
          <DialogDescription>
            Selecione qual instância usar para enviar mensagem para{" "}
            <span className="font-medium text-foreground">
              {pendingStartData?.leadName || pendingStartData?.phone}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 mt-4">
          {connectedSessions.map(session => (
            <Button
              key={session.id}
              variant="outline"
              className="h-auto w-full justify-start px-4 py-3 hover:bg-[var(--app-surface-hover)]"
              onClick={() => handleSessionSelect(session)}
            >
              <div className="flex items-center gap-3 w-full">
                <div className="w-3 h-3 rounded-full bg-green-500 shrink-0 animate-pulse" />
                <div className="flex flex-col items-start flex-1 min-w-0">
                  <span className="font-medium truncate">
                    {session.instance_name}
                  </span>
                  {session.phone_number && (
                    <span className="text-xs text-muted-foreground">
                      {session.phone_number}
                    </span>
                  )}
                </div>
                <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );

  // Nao renderizar se o chat nao esta aberto.
  // IMPORTANTE: usuarios SEM sessao WhatsApp ainda podem abrir o chat para
  // visualizar o historico de mensagens de leads (somente leitura).
  if (!chatVisible) return null;

  // Shared content components
  const FloatingChatHeader = ({
    mobile = false
  }: {
    mobile?: boolean;
  } = {}) => {
    // Header padrao quando nao ha conversa ativa (lista de conversas)
    if (!activeConversation) {
      return (
        <div className={cn(
          "flex shrink-0 items-center justify-between",
          mobile
            ? "border-b border-[var(--app-border)] bg-[var(--app-surface-solid)] px-4 py-3"
            : "relative z-10 h-12 bg-primary px-3.5 text-primary-foreground shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
        )}>
          <div className="flex items-center gap-2">
            <MessageCircle className={cn("h-4 w-4", mobile && "text-primary")} />
            <span className={cn("font-medium", mobile ? "text-base" : "text-[13px]")}>WhatsApp</span>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="flex h-5 min-w-5 items-center justify-center px-1.5 text-[10px]">
                {unreadCount > 99 ? "99+" : unreadCount}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Fechar chat do WhatsApp"
              className={cn(
                "rounded-[7px] [&_svg]:size-3.5",
                mobile
                  ? "h-11 w-11 bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text-primary)]"
                  : "h-8 w-8 bg-black/10 text-primary-foreground hover:bg-black/20"
              )}
              onClick={closeChat}
            >
              <X />
            </Button>
          </div>
        </div>
      );
    }

    // Header compacto e organizado para o FloatingChat
    const displayName = activeConversation.lead?.name || formatWhatsAppContactLabel(
      activeConversation.contact_name,
      activeConversation.contact_phone,
      activeConversation.remote_jid,
    );

    const phone = formatWhatsAppContactPhoneForDisplay(
      activeConversation.contact_phone,
      activeConversation.remote_jid,
    );
    const leadId = activeConversation.lead?.id;
    const tags = activeConversation.lead?.tags || [];
    const pipelineName = activeConversation.lead?.pipeline?.name;
    const stageName = activeConversation.lead?.stage?.name;
    const stageColor = activeConversation.lead?.stage?.color;
    const visibleTags = tags.slice(0, 1);
    const remainingTags = tags.slice(1);
    const contextChipClassName = "min-h-[18px] max-w-full min-w-0 whitespace-normal [overflow-wrap:anywhere] rounded-[6px] border-0 px-2 py-1 text-[9px] font-semibold leading-[12px] text-white shadow-none";

    return (
      <TooltipProvider>
        <div className="shrink-0 border-b border-[var(--app-border)] bg-[var(--app-surface-solid)]">
          {/* Linha 1: Navegacao e info principal */}
          <div className="flex items-center gap-2 px-3 py-2">
            {/* Botao Voltar */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Voltar à lista de conversas"
                  className={cn(
                    "shrink-0 rounded-[7px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text-primary)]",
                    mobile ? "h-11 w-11" : "h-9 w-9",
                  )}
                  onClick={clearActiveConversation}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Voltar</TooltipContent>
            </Tooltip>

            {/* Avatar */}
            <Avatar className="h-8 w-8 shrink-0 border border-primary/20">
              <AvatarImage src={getConversationAvatarUrl(activeConversation)} />
              <AvatarFallback className="bg-primary/50 text-[12px] font-light text-primary-foreground">
                {activeConversation.is_group ? (
                  <Users className="h-4 w-4" />
                ) : (
                  displayName?.[0]?.toUpperCase() || "?"
                )}
              </AvatarFallback>
            </Avatar>

            {/* Nome */}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{displayName}</p>
              {activeConversation.lead?.name && phone && (
                <p className="text-xs text-muted-foreground truncate">{phone}</p>
              )}
            </div>

            {/* Acoes */}
            <div className="flex min-w-fit shrink-0 items-center justify-end gap-1 pr-0.5">
              {leadId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Ver lead no funil"
                      className={cn(
                        "rounded-[7px] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-soft)] hover:text-[var(--app-text-primary)]",
                        mobile ? "h-11 w-11" : "h-9 w-9",
                      )}
                      onClick={() => handleViewLead(leadId)}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Ver Lead</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Fechar chat do WhatsApp"
                    className={cn(
                      "rounded-[7px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text-primary)]",
                      mobile ? "h-11 w-11" : "h-9 w-9",
                    )}
                    onClick={closeChat}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Fechar</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Linha 2: Tags e Pipeline (se houver) */}
          {(visibleTags.length > 0 || pipelineName) && (
            <div data-floating-chat-context className="flex w-full min-w-0 flex-wrap items-start gap-1.5 px-3 pb-2.5 pt-0.5">
              {/* Tags */}
              {visibleTags.map((lt) => (
                <Badge
                  key={lt.tag.id}
                  variant="secondary"
                  className={cn(contextChipClassName, "shrink-0")}
                  style={getTagColorStyleWithWhiteText(lt.tag.color)}
                  title={lt.tag.name}
                >
                  {lt.tag.name}
                </Badge>
              ))}
              {remainingTags.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      className={cn(contextChipClassName, "shrink-0 cursor-help bg-primary px-1.5")}
                    >
                      +{remainingTags.length}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[200px]">
                    <div className="flex flex-wrap gap-1">
                      {remainingTags.map((lt) => (
                        <Badge
                          key={lt.tag.id}
                          variant="secondary"
                          className={contextChipClassName}
                          style={getTagColorStyleWithWhiteText(lt.tag.color)}
                        >
                          {lt.tag.name}
                        </Badge>
                      ))}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Separador */}
              {visibleTags.length > 0 && pipelineName && <span className="shrink-0 text-[9px] text-muted-foreground/70">•</span>}

              {/* Pipeline > Stage */}
              {pipelineName && (
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-muted-foreground">
                  <Badge className={cn(contextChipClassName, "shrink-0 bg-primary")} title={pipelineName}>
                    {pipelineName}
                  </Badge>
                  {stageName && (
                    <>
                      <ArrowRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/70" />
                      <Badge
                        className={cn(contextChipClassName, "shrink-0")}
                        style={getTagColorStyleWithWhiteText(stageColor)}
                        title={stageName}
                      >
                        {stageName}
                      </Badge>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </TooltipProvider>
    );
  };

  const DisconnectedState = () => <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-[var(--app-surface-solid)]">
      <Phone className="h-12 w-12 text-muted-foreground mb-4" />
      <p className="text-muted-foreground mb-2">Nenhum WhatsApp conectado</p>
      <p className="text-sm text-muted-foreground">
        Acesse Configurações &gt; WhatsApp para conectar
      </p>
    </div>;
  const messagesViewJsx = (
    <div className="relative flex-1 overflow-hidden min-h-0 flex flex-col bg-[var(--app-surface-solid)]">
      <ScrollArea className="flex-1" onScrollCapture={handleScrollArea}>
        <div className="px-3 py-3 w-full max-w-full min-w-0 overflow-hidden overflow-x-hidden">
          {hasOlderMessages && (
            <div className="flex flex-col items-center justify-center gap-1.5 pb-2">
              <Button
                type="button"
                data-load-older-messages
                variant="default"
                size="sm"
                className="h-8 rounded-[6px] bg-primary px-3 text-[11px] font-medium text-primary-foreground shadow-none hover:bg-primary/90 hover:text-primary-foreground"
                onClick={() => void loadOlderMessages()}
                disabled={isLoadingOlder}
              >
                {isLoadingOlder ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                {olderMessagesFailed ? "Tentar carregar mensagens anteriores" : "Carregar mensagens anteriores"}
              </Button>
              {olderMessagesFailed && (
                <p className="text-center text-[11px] text-destructive" role="alert">
                  Não foi possível carregar mensagens anteriores. O histórico atual foi mantido.
                </p>
              )}
            </div>
          )}
          {(loadingMessages || (fetchingMessages && visibleMessages.length === 0)) ? <div className="flex flex-col items-center justify-center gap-2 py-8" role="status" aria-live="polite">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Carregando mensagens...</span>
            </div> : messagesFailed && (messages?.length ?? 0) === 0 ? <div className="flex flex-col items-center justify-center gap-3 px-5 py-12 text-center" role="alert">
              <MessageCircle className="h-9 w-9 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">Não foi possível carregar as mensagens</p>
                <p className="mt-1 text-xs text-muted-foreground">Tente novamente sem sair da conversa.</p>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={() => void refetchMessages()}>
                Tentar novamente
              </Button>
            </div> : floatingTimelineItems.length === 0 ? <div className="flex flex-col items-center justify-center py-12">
              <MessageCircle className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">Nenhuma mensagem</p>
              <p className="text-xs text-muted-foreground">Envie uma mensagem para começar</p>
            </div> : <div className="flex flex-col gap-2">
              {floatingTimelineItems.map((item, index) => {
                const previousItem = index > 0 ? floatingTimelineItems[index - 1] : null;
                const showSeparator = shouldShowDateSeparator(item.timestamp, previousItem?.timestamp || null);
                return (
                  <div key={item.id}>
                    {showSeparator && <DateSeparator date={new Date(item.timestamp)} />}
                    {item.kind === "attendance" ? (
                      <AttendanceTimelineEvents entries={[item.entry]} />
                    ) : (
                      <MessageErrorBoundary messageId={item.message.id}>
                        <MessageBubble
                          content={item.message.content}
                          messageType={item.message.message_type}
                          mediaUrl={item.message.media_url ?? null}
                          mediaMimeType={item.message.media_mime_type ?? null}
                          mediaStatus={item.message.media_status as 'pending' | 'ready' | 'failed' | null}
                          mediaError={item.message.media_error ?? null}
                          mediaSize={item.message.media_size}
                          fromMe={item.message.from_me}
                          status={item.message.status ?? ''}
                          sentAt={item.message.sent_at}
                          senderName={item.message.sender_name ?? null}
                          isGroup={activeConversation!.is_group}
                          onRetryMedia={canMutateActiveConversation ? () => retryMediaDownload(item.message.id) : undefined}
                          messageId={item.message.id}
                          leadId={canOperateLeads ? activeConversation!.lead?.id || activeConversation!.lead_id || '' : ''}
                          leadName={activeConversation!.lead?.name || activeConversation!.contact_name || ''}
                          contactAvatarUrl={getConversationAvatarUrl(activeConversation)}
                          conversationRemoteJid={activeConversation!.remote_jid ?? null}
                          conversationSessionId={activeConversation!.session_id ?? null}
                          reactionPickerPosition="outside"
                          reactions={reactionsByMessageId.get(item.message.message_id) || reactionsByMessageId.get(item.message.id) || []}
                          onReact={canMutateActiveConversation
                            && Boolean(activeConversation?.session_id)
                            && Boolean(item.message.session_id)
                            && canReactToWhatsAppMessage(item.message)
                            ? (emoji) => handleReactToMessage(item.message, emoji)
                            : undefined}
                          isReacting={reactToMessage.isPending
                            && reactToMessage.variables?.targetMessage.id === item.message.id}
                        />
                      </MessageErrorBoundary>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>}
        </div>
      </ScrollArea>
      {showScrollToLatest && (
        <Button
          type="button"
          data-scroll-to-latest
          size="icon"
          aria-label="Ir para mensagens mais recentes"
          title="Ir para mensagens mais recentes"
          className="absolute bottom-3 right-4 z-20 h-8 w-8 rounded-full bg-primary text-primary-foreground shadow-[0_4px_12px_rgba(0,0,0,0.14)] hover:bg-primary/90 hover:text-primary-foreground"
          onClick={handleScrollToLatest}
        >
          <ArrowDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
  const renderMessageInput = (mobile = false) => {
    const activeLeadId = activeConversation?.lead?.id || activeConversation?.lead_id;

    return (
    <div className={cn("shrink-0 border-t border-[var(--app-border)] bg-[var(--app-surface-solid)] p-3", mobile && "pb-2")}>
      <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" disabled={messageInputDisabled} />
      <MessageBox
        value={messageText}
        inputAriaLabel="Digite sua mensagem"
        onChange={setMessageText}
        onSend={handleSendMessage}
        onKeyDown={handleKeyPress}
        placeholder={isReadOnlyMode ? "Somente leitura" : whatsappMessageInputState.placeholder}
        disabled={messageInputDisabled}
        isSending={sendMessage.isPending}
        multiline
        inputRef={messageInputRef}
        showRightActionsWhenEmpty={!sendMessage.isPending}
        leftActions={
          <>
            <button aria-label="Anexar arquivo" title="Anexar arquivo" type="button" onClick={() => fileInputRef.current?.click()} disabled={messageInputDisabled}>
              <Paperclip className="w-5 h-5" aria-hidden="true" />
            </button>
            {activeLeadId && canStartAutomations && canMutateActiveConversation && (
              <button aria-label="Iniciar automação" type="button" onClick={() => setShowAutomationDialog(true)} title="Iniciar automação">
                <Zap className="w-5 h-5" aria-hidden="true" />
              </button>
            )}
          </>
        }
        rightActions={
          <AudioRecorderButton
            onSend={handleSendAudio}
            disabled={messageInputDisabled}
          />
        }
      />
    </div>
    );
  };
  const conversationFilters = (
    <FloatingConversationFilters
      sessions={sessions || []}
      selectedSessionId={selectedSessionId}
      onSessionChange={setSelectedSessionId}
      searchTerm={searchTerm}
      onSearchChange={setSearchTerm}
      hideGroups={hideGroups}
      onHideGroupsChange={setHideGroups}
      showArchived={showArchived}
      onShowArchivedChange={setShowArchived}
      onClearFilters={clearConversationFilters}
    />
  );
  const ConversationList = () => <div className="flex-1 overflow-hidden min-h-0 w-full max-w-full overflow-x-hidden bg-[var(--app-surface-solid)]">
      <ScrollArea
        ref={conversationListScrollAreaRef}
        className="h-full w-full max-w-full"
      >
        <div className="flex w-full max-w-full flex-col divide-y divide-[var(--app-border)]">
          {loadingConversations || loadingSessions ? <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div> : (conversationsFailed || sessionsFailed) && !conversations?.length ? <div className="flex flex-col items-center justify-center px-5 py-12 text-center" role="alert">
              <MessageCircle className="mb-3 h-8 w-8 text-[var(--app-text-tertiary)]" />
              <p className="text-xs font-medium text-foreground">Não foi possível atualizar o WhatsApp</p>
              <p className="mt-1 text-[11px] font-light text-muted-foreground">Verifique a conexão e tente novamente.</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-3 h-8 rounded-[6px] bg-primary/10 px-3 text-[11px] font-medium text-primary shadow-none hover:bg-primary/15 hover:text-primary"
                onClick={() => void Promise.all([refetchSessions(), refetchConversations()])}
              >
                Tentar novamente
              </Button>
            </div> : !filteredConversations || filteredConversations.length === 0 ? <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
              <MessageCircle className="mb-3 h-8 w-8 text-[var(--app-text-tertiary)]" />
              <p className="text-xs font-medium text-foreground">
                {searchTerm ? "Nenhuma conversa encontrada" : activeConversationFilterCount > 0 ? "Nenhuma conversa com estes filtros" : "Nenhuma conversa"}
              </p>
              <p className="mt-1 text-[11px] font-light text-muted-foreground">
                {searchTerm ? "Tente buscar por outro nome ou telefone." : activeConversationFilterCount > 0 ? "Ajuste ou limpe os filtros para ver outras conversas." : "As novas conversas aparecerão aqui automaticamente."}
              </p>
              {activeConversationFilterCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-3 h-8 rounded-[6px] bg-primary/10 px-3 text-[11px] font-medium text-primary shadow-none hover:bg-primary/15 hover:text-primary"
                  onClick={clearConversationFilters}
                >
                  Limpar filtros
                </Button>
              )}
            </div> : <>
              {filteredConversations.map((conversation) => (
                <ConversationListItem
                  key={conversation.id}
                  conversation={conversation}
                  isSelected={false}
                  currentUserId={currentUserId}
                  onClick={() => handleOpenConversationFromList(conversation)}
                  formatTime={formatConversationTime}
                  onArchive={() => handleArchiveConversation(conversation)}
                  onDelete={() => handleDeleteConversation(conversation)}
                  availableTags={availableTags}
                  isTagsLoading={isTagsLoading || isTagsFetching}
                  isTagsError={tagsFailed}
                  onRetryTags={() => void refetchTags()}
                  onAddTag={(tagId) => canOperateLeads && conversation.lead && addLeadTag.mutate({
                    leadId: conversation.lead.id,
                    tagId,
                  })}
                  onRemoveTag={(tagId) => canOperateLeads && conversation.lead && removeLeadTag.mutate({
                    leadId: conversation.lead.id,
                    tagId,
                  })}
                  onCreateLead={() => undefined}
                  onViewLead={conversation.lead ? () => handleViewLead(conversation.lead!.id) : undefined}
                  onActionsOpenChange={canOperateLeads && conversation.lead ? (open) => {
                    if (open) setShouldLoadTags(true);
                  } : undefined}
                  canOperate={canOperateWhatsApp}
                  canManageTags={canOperateLeads}
                  canCreateLead={false}
                />
              ))}
              {hasMoreConversations && (
                <div className="flex justify-center px-3 py-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-[11px] font-medium text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text-primary)]"
                    onClick={() => void loadMoreConversations()}
                    disabled={isLoadingMoreConversations}
                  >
                    {isLoadingMoreConversations && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                    Carregar mais conversas
                  </Button>
                </div>
              )}
            </>}
        </div>
      </ScrollArea>
    </div>;

  const activeLeadId = activeConversation?.lead?.id || activeConversation?.lead_id;
  const activeContactName =
    activeConversation?.lead?.name ||
    formatWhatsAppContactLabel(
      activeConversation?.contact_name,
      activeConversation?.contact_phone,
      activeConversation?.remote_jid,
    ) ||
    undefined;
  const pendingDeleteName = pendingDeleteConversation?.lead?.name || formatWhatsAppContactLabel(
    pendingDeleteConversation?.contact_name,
    pendingDeleteConversation?.contact_phone,
    pendingDeleteConversation?.remote_jid,
  ) || "esta conversa";
  const deleteConversationDialog = (
    <AlertDialog
      open={Boolean(pendingDeleteConversation)}
      onOpenChange={(open) => {
        if (!open && !deleteConversation.isPending) setPendingDeleteConversation(null);
      }}
    >
      <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 shadow-none">
        <AlertDialogHeader>
          <AlertDialogTitle>Remover conversa?</AlertDialogTitle>
          <AlertDialogDescription>
            {`A conversa com ${pendingDeleteName} sairá da caixa de entrada. O histórico já vinculado ao lead será preservado.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteConversation.isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={deleteConversation.isPending}
            onClick={(event) => {
              event.preventDefault();
              void confirmDeleteConversation();
            }}
          >
            {deleteConversation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Remover conversa
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  const enterAttendanceDialog = (
    <EnterAttendanceDialog
      {...attendanceGate.dialogProps}
      contactName={activeContactName}
    />
  );

  // Mobile version - fullscreen fixed container (stable bottom input)
  if (isMobile) {
    return (
      <>
        {SessionSelectorDialog()}
        {deleteConversationDialog}
        {enterAttendanceDialog}
        {activeLeadId && canMutateActiveConversation && (
          <StartAutomationDialog
            open={showAutomationDialog}
            onOpenChange={setShowAutomationDialog}
            leadId={activeLeadId}
            conversationId={activeConversation?.id}
            contactName={activeContactName}
          />
        )}
        <div
          id="floating-whatsapp-chat"
          ref={chatSurfaceRef}
          role="dialog"
          aria-label="Chat do WhatsApp"
          tabIndex={-1}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--app-surface-solid)] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] focus:outline-none"
        >
          {FloatingChatHeader({ mobile: true })}

          {isStartingConversation && (
            <div className="absolute inset-0 bg-background/50 flex flex-col items-center justify-center z-50">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
              <p className="text-xs text-muted-foreground animate-pulse">Iniciando conversa...</p>
            </div>
          )}

          <div className="flex-1 flex flex-col overflow-hidden min-h-0 w-full max-w-full">
            {activeConversation ? (
              <>
                {messagesViewJsx}
                {renderMessageInput(true)}
              </>
            ) : !loadingSessions && !loadingConversations && !sessionsFailed && !conversationsFailed && !hasWhatsAppAccess && !conversations?.length ? (
              DisconnectedState()
            ) : (
              <>
                {conversationFilters}
                {ConversationList()}
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  // Desktop version - floating window
  return (
    <>
      {SessionSelectorDialog()}
      {deleteConversationDialog}
      {enterAttendanceDialog}
      {activeLeadId && canMutateActiveConversation && (
        <StartAutomationDialog
          open={showAutomationDialog}
          onOpenChange={setShowAutomationDialog}
          leadId={activeLeadId}
          conversationId={activeConversation?.id}
          contactName={activeContactName}
        />
      )}
      <div
        id="floating-whatsapp-chat"
        ref={chatSurfaceRef}
        role="dialog"
        aria-label="Chat do WhatsApp"
        tabIndex={-1}
        className={cn(
          "fixed z-50",
          "bg-[var(--app-surface-solid)]",
          "rounded-[8px]",
          "shadow-[0_12px_32px_rgba(0,0,0,0.10)]",
          "transition-colors",
          "flex flex-col overflow-hidden",
          "animate-scale-in",
          "motion-reduce:animate-none",
          "focus:outline-none"
        )}
        style={{
          right: "max(24px, env(safe-area-inset-right))",
          bottom: "max(24px, env(safe-area-inset-bottom))",
          width: "min(420px, calc(100vw - 48px))",
          height: "min(600px, calc(100vh - 48px))",
        }}
      >
        {/* Header */}
        {FloatingChatHeader()}

        {isStartingConversation && (
          <div className="absolute inset-0 bg-background/50 flex flex-col items-center justify-center z-50">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
            <p className="text-xs text-muted-foreground animate-pulse">Iniciando conversa...</p>
          </div>
        )}

        {activeConversation ? (
          <>
            {messagesViewJsx}
            {renderMessageInput(false)}
          </>
        ) : !loadingSessions && !loadingConversations && !sessionsFailed && !conversationsFailed && !hasWhatsAppAccess && !conversations?.length ? (
          DisconnectedState()
        ) : (
          <>
            {conversationFilters}
            {ConversationList()}
          </>
        )}
      </div>
    </>
  );
}
