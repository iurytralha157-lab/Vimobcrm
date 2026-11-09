import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { canQuoteWhatsAppMessage, toWhatsAppQuote } from "@/components/features/whatsapp/conversations/message-actions";
import { ScopedMessageBox } from "@/components/features/whatsapp/ScopedMessageBox";
import { useFloatingChat, type FloatingChatIntent } from "@/contexts/FloatingChatContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { WhatsAppAvatarImage as AvatarImage } from "@/components/features/whatsapp/WhatsAppAvatarImage";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FilterAwareMobileChatSurface } from "@/components/features/chat/FilterAwareMobileChatSurface";
import { useFilterPanelLayout } from "@/contexts/FilterPanelLayoutContext";
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
import { MessageCircle, X, ArrowLeft, Search, Loader2, Phone, Users, Paperclip, ExternalLink, ArrowRight, SlidersHorizontal } from "lucide-react";
import { ScrollToLatestButton } from "@/components/features/whatsapp/ScrollToLatestButton";
import { CONVERSATION_LIST_UI, LoadOlderMessagesButton } from "@/components/features/whatsapp";
import { cn } from "@/lib/utils";
import { formatWhatsAppPersonName } from "@/lib/whatsapp-person-name";
import { useWhatsAppConversations, useWhatsAppUnreadCount, useSendWhatsAppMessage, useResolveWhatsAppSendIntent, useDiscardFailedLocalWhatsAppMessage, useReactToWhatsAppMessage, useMarkConversationAsRead, useWhatsAppInboxRealtime, useWhatsAppLeadRealtime, useArchiveConversation, useDeleteConversation, useLinkConversationToLead, WhatsAppConversation, type WhatsAppMessage } from "@/hooks/use-whatsapp-conversations";
import { useWhatsAppMessagesPaginated } from "@/hooks/use-whatsapp-messages-paginated";
import { useWhatsAppThreadScroll } from "@/hooks/use-whatsapp-thread-scroll";
import { useWhatsAppUnread } from "@/hooks/use-whatsapp-unread";
import { useWhatsAppMediaGallery } from "@/hooks/use-whatsapp-media-gallery";
import { useWhatsAppConversationDraft } from "@/hooks/use-whatsapp-conversation-draft";
import { useWhatsAppMessageNavigation } from "@/hooks/use-whatsapp-message-navigation";
import { ConversationHistorySearch } from "@/components/features/whatsapp/conversations/ConversationHistorySearch";
import { useWhatsAppAttachments, type WhatsAppAttachmentOutcome, type WhatsAppAttachmentSendContext } from "@/hooks/use-whatsapp-attachments";
import { AttachmentPreviewComposer } from "@/components/features/whatsapp/AttachmentPreviewComposer";
import { OwnWhatsAppStartNotice } from "@/components/features/whatsapp/OwnWhatsAppStartNotice";
import { getOwnWhatsAppStartNotice } from "@/lib/whatsapp-own-start";
import { getWhatsAppMessageGrouping, isWhatsAppMessageBlockStart } from "@/lib/whatsapp-message-grouping";
import { useCancelLeadExecutions, useLeadActiveAutomationExecutions } from "@/hooks/use-automations";
import { ConversationAutomationAction } from "@/components/features/whatsapp/ConversationAutomationAction";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import { useWhatsAppLeadActivityRealtime } from "@/hooks/whatsapp/use-whatsapp-lead-activity-realtime";
import { projectWhatsAppCanonicalConversationPreview } from "@/lib/whatsapp-canonical-conversation-preview";
import { useWhatsAppSenderAvatars } from "@/hooks/whatsapp/use-whatsapp-sender-avatars";
import { useWhatsAppVisibleCanonicalPreviews } from "@/hooks/whatsapp/use-whatsapp-visible-canonical-previews";
import { useWhatsAppLocalSendPreviews } from "@/hooks/whatsapp/use-whatsapp-local-send-previews";
import { useAccessibleSessions } from "@/hooks/use-accessible-sessions";
import { useWhatsAppAttendanceGate, type WhatsAppAttendanceTarget } from "@/hooks/use-whatsapp-attendance";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { WhatsAppSession } from "@/hooks/use-whatsapp-sessions";
import { getWhatsAppStartErrorMessage, useStartConversation, useFindConversationByPhone } from "@/hooks/use-start-conversation";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { DateSeparator, shouldShowDateSeparator } from "@/components/features/whatsapp/DateSeparator";
import type { AudioRecorderSendContext, AudioRecorderSendResult } from "@/components/features/whatsapp/AudioRecorderButton";
import { getWhatsAppAudioSendResult, getWhatsAppFileSendFeedback } from '@/lib/whatsapp-send-intent';
import { MessageBubble } from "@/components/features/whatsapp/MessageBubble";
import { MessageErrorBoundary } from "@/components/features/whatsapp/MessageErrorBoundary";
import { StartAutomationDialog } from "@/components/features/whatsapp/StartAutomationDialog";
import { AttendanceTimelineEvents } from "@/components/features/whatsapp/AttendanceTimelineEvents";
import { EnterAttendanceDialog } from "@/components/features/whatsapp/EnterAttendanceDialog";
import { ConfirmConversationLeadLinkDialog } from "@/components/features/whatsapp/ConfirmConversationLeadLinkDialog";
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
import { conversationLeadDetailAPI } from "@/lib/api/conversation-lead-detail";
import { VimobAPIError } from "@/lib/api/vimob-error";
import { useAuth } from "@/contexts/AuthContext";
import { useFilters } from "@/contexts/FilterContext";
import { sharedLeadFiltersForConversations, sharedLeadConversationFilterCount } from "@/lib/filters/whatsapp-shared-filters";
import { whatsappAPI, getWhatsAppPhoneChangeConfirmation, type WhatsAppPhoneChangeConfirmation, type WhatsAppAttendanceEntry, type WhatsAppConversationLinkPreview } from "@/lib/api/whatsapp";
import {
  getWhatsAppConversationMessageScope,
  getWhatsAppMessageInputState,
  preserveWhatsAppConversationCardSnapshot,
  WHATSAPP_UNLINKED_LEAD_SNAPSHOT,
} from "@/lib/whatsapp-message-input";
import { flattenWhatsAppMessagePages, getWhatsAppSendFailureStatus, resolveWhatsAppConversationSessionFilter } from "@/lib/whatsapp-query-cache";
import { sortWhatsAppTimelineItems } from "@/lib/whatsapp-message-order";
import {
  getWhatsAppUnlinkedExpiresAt,
  refreshWhatsAppUnlinkedInbox,
  scheduleWhatsAppUnlinkedExpiration,
} from "@/lib/whatsapp-unlinked-expiration";
import { clearUnavailableWhatsAppMessageCache } from "@/lib/whatsapp-access-revocation";
import { canReactToWhatsAppMessage, groupLatestWhatsAppReactions } from "@/lib/whatsapp-reactions";
import { isLocalReadOnlyMode } from "@/lib/local-read-only";
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

function FloatingChatExtraTags({
  tags,
  chipClassName,
}: {
  tags: NonNullable<NonNullable<WhatsAppConversation["lead"]>["tags"]>;
  chipClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={`Ver mais ${tags.length} tags`}
          aria-expanded={open}
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            // Radix dismisses on click by default; keep touch and keyboard toggles explicit.
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            setOpen(!open);
          }}
          className={cn(badgeVariants(), chipClassName, "shrink-0 cursor-help bg-primary px-1.5")}
        >
          +{tags.length}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="max-w-[200px]"
        onPointerDownOutside={(event) => {
          if (event.detail.originalEvent.target instanceof Node
            && triggerRef.current?.contains(event.detail.originalEvent.target)) event.preventDefault();
        }}
      >
        <div className="flex flex-wrap gap-1">
          {tags.map((lt) => (
            <Badge
              key={lt.tag.id}
              variant="secondary"
              className={chipClassName}
              style={getTagColorStyleWithWhiteText(lt.tag.color)}
            >
              {lt.tag.name}
            </Badge>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

type FloatingConversationFiltersProps = {
  sharedFilterCount: number;
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
  sharedFilterCount,
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
    Boolean(searchTerm.trim()),
  ].filter(Boolean).length + sharedFilterCount;

  return (
    <div className="shrink-0 border-b border-black/[0.035] bg-[var(--app-surface-solid)] px-2.5 py-2 dark:border-white/[0.035]">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar conversas"
            maxLength={180}
            placeholder="Buscar conversas..."
            value={searchTerm}
            onChange={e => onSearchChange(e.target.value)}
            className={CONVERSATION_LIST_UI.search}
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
              {sharedFilterCount > 0 && <p className="text-[11px] text-muted-foreground">{sharedFilterCount} filtro(s) geral(is) do CRM aplicado(s). Ajuste-os na Dashboard, Pipeline, Contatos ou WhatsApp.</p>}
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
                  className={cn("h-8 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-[length:var(--app-font-size-caption)] font-light shadow-none hover:bg-[var(--app-surface-hover)]", CONVERSATION_LIST_UI.clear)}
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

function eligibleLeadStartSession(session: WhatsAppSession, userId: string | null | undefined, leadId: string | null | undefined, originalOrganization: boolean) {
  if (!userId) return false;
  if (!originalOrganization || session.status !== "connected" || session.can_send === false) return false;
  if (userId && session.owner_user_id === userId) return true;
  return Boolean(leadId && session.can_send === true);
}

export function FloatingChat() {
  const {
    state,
    closeChat,
    openConversation,
    clearActiveConversation,
    clearPendingMessage,
    isIntentCurrent
  } = useFloatingChat();
  const {
    isOpen,
    isPresenceOpen,
    activeConversation,
    pendingPhone,
    pendingLeadName,
    pendingMessage,
    pendingLeadId,
    intentTenantKey,
    intentGeneration,
    pendingMessageConversationId
  } = state;
  const activeSupervisoryView = Boolean(activeConversation?.supervisory_lead_view);
  const isMobile = useIsMobile();
  const filterPanelLayout = useFilterPanelLayout();
  const presentationMinimized = filterPanelLayout.active || filterPanelLayout.present;
  const [selectedSessionId, setSelectedSessionId] = useState<string>("all");
  const { activeOrganization, profile, user } = useAuth();
  const sharedFilters = useFilters();
  const { hasModule, isLoading: modulesLoading } = useOrganizationModules();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const canStartAutomations = hasModule("automations") && hasPermission("automations_manage");
  const localReadOnly = isLocalReadOnlyMode();
  const hasWhatsAppViewPermission = hasPermission("whatsapp_view");
  const originalOrganization = Boolean(profile?.organization_id && profile.organization_id === activeOrganization.organizationId);
  const canOperateWhatsApp = originalOrganization && hasPermission("whatsapp_operate");
  const canOperateLeads = originalOrganization && hasPermission("lead_operate");
  const currentUserId = profile?.id || user?.id || null;
  const activeTenantKey = `${currentUserId || "anonymous"}:${activeOrganization.organizationId || "none"}`;
  const queryClient = useQueryClient();
  const whatsappQueryScope = useWhatsAppQueryScope();
  const searchTerm = sharedFilters.searchQuery;
  const setSearchTerm = sharedFilters.setSearchQuery;
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  const inheritedLeadFilters = useMemo(() => sharedLeadFiltersForConversations(sharedFilters, false), [sharedFilters]);
  const [hideGroups, setHideGroups] = useState(() =>
    readFloatingChatPreference("whatsapp-hide-groups-floating"),
  );
  const [showArchived, setShowArchived] = useState(() =>
    readFloatingChatPreference("whatsapp-show-archived-floating"),
  );
  const floatingListFilters = useMemo(() => ({ ...inheritedLeadFilters, hideGroups, showArchived, search: debouncedSearchTerm }), [inheritedLeadFilters, hideGroups, showArchived, debouncedSearchTerm]);
  const inheritedFilterCount = sharedLeadConversationFilterCount(sharedFilters, false);
  const [shouldLoadTags, setShouldLoadTags] = useState(false);
  const [showAutomationDialog, setShowAutomationDialog] = useState(false);
  const [showSessionSelector, setShowSessionSelector] = useState(false);
  const [pendingStartData, setPendingStartData] = useState<{phone: string, leadName?: string, leadId?: string, ownOnly?: boolean} | null>(null);
  const [pendingLeadLink, setPendingLeadLink] = useState<{
    conversation: WhatsAppConversation;
    leadId: string;
    leadName?: string;
    sessionId: string;
    phone: string;
    ownOnly?: boolean;
  } | null>(null);
  const [leadLinkPreview, setLeadLinkPreview] = useState<WhatsAppConversationLinkPreview | null>(null);
  const [isLeadLinkPreviewLoading, setIsLeadLinkPreviewLoading] = useState(false);
  const [leadLinkPreviewFailed, setLeadLinkPreviewFailed] = useState(false);
  const leadLinkPreviewRequestRef = useRef(0);
  const [isStartingConversation, setIsStartingConversation] = useState(false);
  const [visibleStartRequestGeneration, setVisibleStartRequestGeneration] = useState(0);
  const [pendingPhoneChange, setPendingPhoneChange] = useState<{
    phone: string; leadName?: string; confirmation: WhatsAppPhoneChangeConfirmation;
    intent: FloatingChatIntent; scope: string; requestGeneration: number;
    ownOnly?: boolean;
  } | null>(null);
  const [phoneChangeError, setPhoneChangeError] = useState<string | null>(null);
  const [phoneChangePreview, setPhoneChangePreview] = useState<WhatsAppConversationLinkPreview | null>(null);
  const [phoneChangePreviewLoading, setPhoneChangePreviewLoading] = useState(false);
  const [phoneChangePreviewFailed, setPhoneChangePreviewFailed] = useState(false);
  const phoneChangePreviewRequestRef = useRef(0);
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<WhatsAppConversation | null>(null);
  const pathname = usePathname();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const conversationListScrollAreaRef = useRef<HTMLDivElement>(null);
  const conversationListPositionRef = useRef<ConversationListReturnPosition | null>(null);
  const shouldRestoreConversationListScrollRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const conversationSearchRef = useRef<HTMLButtonElement>(null);
  const messageScrollAreaRef = useRef<HTMLDivElement>(null);
  const navigationNonceRef = useRef(0);
  const pendingStartKeyRef = useRef<string | null>(null);
  const startRequestGenerationRef = useRef(0);
  const startupScope = JSON.stringify([activeTenantKey, whatsappQueryScope.accessScope, profile?.organization_id, intentTenantKey, intentGeneration]);
  const [connectingPendingScope, setConnectingPendingScope] = useState<string | null>(null);
  const startupScopeRef = useRef(startupScope);
  useLayoutEffect(() => {
    startupScopeRef.current = startupScope;
    startRequestGenerationRef.current += 1;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Cancel obsolete session/link dialogs before another intent can paint.
    setIsStartingConversation(false);
    setShowSessionSelector(false);
    setPendingStartData(null);
    setPendingLeadLink(null);
    setLeadLinkPreview(null);
    setPendingDeleteConversation(null);
    setShowAutomationDialog(false);
    setPendingPhoneChange(null);
    setPhoneChangeError(null);
    phoneChangePreviewRequestRef.current += 1;
    setPhoneChangePreview(null);
    setPhoneChangePreviewLoading(false);
    setPhoneChangePreviewFailed(false);
    leadLinkPreviewRequestRef.current += 1;
    return () => { startRequestGenerationRef.current += 1; };
  }, [startupScope]);
  const pendingConversationLinkRef = useRef<{ conversationId: string; leadId: string } | null>(null);
  const chatSurfaceRef = useRef<HTMLDivElement>(null);
  const preferredChatFocusRef = useRef<HTMLElement | null>(null);
  const restoringFromFilterPanelRef = useRef(false);
  const activeConversationRef = useRef(activeConversation);
  const previousAccessScopeRef = useRef(whatsappQueryScope.accessScope);
  const activeConversationTenantRef = useRef(activeTenantKey);
  const wasChatVisibleRef = useRef(false);
  const accessReady = !modulesLoading && !permissionsLoading;
  const canViewWhatsApp = hasModule("whatsapp")
    && (hasWhatsAppViewPermission || canOperateWhatsApp);
  const chatVisible = isOpen
    && accessReady
    && canViewWhatsApp
    && !isPresenceOpen
    && !(pendingPhone && !activeConversation && connectingPendingScope === startupScope && pathname === "/settings")
    && pathname !== "/crm/conversas";
  const chatSurfaceVisible = chatVisible && !presentationMinimized;
  useLayoutEffect(() => {
    if (presentationMinimized && chatVisible) restoringFromFilterPanelRef.current = true;
  }, [chatVisible, presentationMinimized]);
  const focusChatSurface = useCallback(() => {
    const surface = chatSurfaceRef.current;
    if (!surface) return;
    const current = document.activeElement;
    if (current && surface.contains(current)) { restoringFromFilterPanelRef.current = false; return; }
    const restoring = restoringFromFilterPanelRef.current;
    const otherDialog = current instanceof Element ? current.closest('[role="dialog"], [role="alertdialog"]') : null;
    if (restoring && otherDialog && !otherDialog.contains(surface)) {
      restoringFromFilterPanelRef.current = false;
      return;
    }
    const preferred = preferredChatFocusRef.current;
    const target = restoring && preferred?.isConnected && surface.contains(preferred) ? preferred : surface;
    target.focus({ preventScroll: true });
    restoringFromFilterPanelRef.current = false;
  }, []);
  const rememberChatFocus = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement) preferredChatFocusRef.current = event.target;
  }, []);

  useLayoutEffect(() => {
    activeConversationRef.current = activeConversation;
    activeConversationTenantRef.current = activeTenantKey;
  }, [activeConversation, activeTenantKey]);

  useLayoutEffect(() => {
    if (previousAccessScopeRef.current === whatsappQueryScope.accessScope) return;
    previousAccessScopeRef.current = whatsappQueryScope.accessScope;
    if (activeSupervisoryView) clearActiveConversation();
  }, [activeSupervisoryView, clearActiveConversation, whatsappQueryScope.accessScope]);

  useEffect(() => {
    const wasChatVisible = wasChatVisibleRef.current;
    wasChatVisibleRef.current = chatSurfaceVisible;
    if (!chatSurfaceVisible || wasChatVisible) return undefined;

    const focusFrame = window.requestAnimationFrame(() => {
      focusChatSurface();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [chatSurfaceVisible, focusChatSurface]);

  useEffect(() => {
    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setSelectedSessionId("all");
      setShouldLoadTags(false);
      setPendingStartData(null);
      conversationListPositionRef.current = null;
      shouldRestoreConversationListScrollRef.current = false;
      pendingStartKeyRef.current = null;
      pendingConversationLinkRef.current = null;
      leadLinkPreviewRequestRef.current += 1;
      setPendingLeadLink(null);
      setLeadLinkPreview(null);
    });
    return () => {
      isActive = false;
    };
  }, [profile?.id, activeOrganization.organizationId]);
  const activeConversationId = activeConversation?.id;
  const activeConversationMessageScope = getWhatsAppConversationMessageScope(activeConversation);
  const conversationVisitGenerationRef = useRef(0);
  const conversationVisitKey = JSON.stringify([startupScope, activeConversationId, activeConversationMessageScope.expectedLeadId,
    activeConversation?.session_id, chatVisible]);
  useLayoutEffect(() => {
    conversationVisitGenerationRef.current += 1;
    return () => { conversationVisitGenerationRef.current += 1; };
  }, [conversationVisitKey]);
  const { text: messageText, setText: setMessageText, clearConversation: clearConversationDraft, getConversationDraft } = useWhatsAppConversationDraft(
    whatsappQueryScope, activeSupervisoryView ? null : activeConversationId ?? null,
    activeConversationMessageScope.expectedLeadId,
  );
  const activeUnlinkedExpiresAt = getWhatsAppUnlinkedExpiresAt(activeConversation);
  const closeUnavailableUnlinkedConversation = useCallback((conversationId: string, expectedLeadId?: string | null) => {
    const current = activeConversationRef.current;
    if (activeConversationTenantRef.current !== activeTenantKey || current?.id !== conversationId
      || (expectedLeadId !== undefined
        && getWhatsAppConversationMessageScope(current).expectedLeadId !== expectedLeadId)) return;

    const currentLeadId = getWhatsAppConversationMessageScope(current).expectedLeadId;
    clearUnavailableWhatsAppMessageCache(queryClient, whatsappQueryScope, conversationId, currentLeadId);
    if (!current.supervisory_lead_view) clearConversationDraft(conversationId);
    clearActiveConversation();
    refreshWhatsAppUnlinkedInbox(queryClient, whatsappQueryScope);
    if (pendingLeadLink?.conversation.id === conversationId) {
      leadLinkPreviewRequestRef.current += 1;
      setPendingLeadLink(null);
      setLeadLinkPreview(null);
    }
  }, [activeTenantKey, clearActiveConversation, clearConversationDraft, pendingLeadLink?.conversation.id, queryClient, whatsappQueryScope]);

  useEffect(() => {
    if (!chatVisible || !activeConversation || activeUnlinkedExpiresAt === null) return;

    const expiration = scheduleWhatsAppUnlinkedExpiration(
      activeUnlinkedExpiresAt,
      () => closeUnavailableUnlinkedConversation(activeConversation.id),
    );
    window.addEventListener("focus", expiration.check);
    document.addEventListener("visibilitychange", expiration.check);
    return () => {
      expiration.cancel();
      window.removeEventListener("focus", expiration.check);
      document.removeEventListener("visibilitychange", expiration.check);
    };
  }, [activeConversation, activeUnlinkedExpiresAt, chatVisible, closeUnavailableUnlinkedConversation]);
  const activeConversationLead = activeConversation?.lead;
  const activeConversationLeadId = activeConversation?.lead_id || activeConversationLead?.id || null;
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
  const canMutateActiveConversation = canOperateWhatsApp && !localReadOnly && !sessionsFailed && activeConversationMessageScope.canMutate;
  const canManageActiveConversation = canOperateWhatsApp && !localReadOnly && !sessionsFailed && activeConversationMessageScope.canManage;
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
    JSON.stringify(inheritedLeadFilters),
    "30",
  ].join("|"), [
    accessibleSessionIds,
    activeOrganization.organizationId,
    currentUserId,
    hideGroups,
    searchTerm,
    selectedSessionId,
    showArchived,
    inheritedLeadFilters,
  ]);
  const {
    data: conversations,
    dataUpdatedAt: conversationsRevision = 0,
    isLoading: loadingConversations,
    isFetching: fetchingConversations,
    isError: conversationsFailed,
    refetch: refetchConversations,
    hasMoreConversations,
    loadMoreConversations,
    isLoadingMoreConversations,
  } = useWhatsAppConversations(
    shouldSyncFloatingChat ? conversationSessionFilter.sessionId : undefined,
    floatingListFilters,
    shouldSyncFloatingChat ? conversationSessionFilter.accessibleSessionIds : [],
    30,
    {
      enabled: shouldSyncFloatingChat && sharedFilters.isHydrated,
      includeSupervisoryLeads: selectedSessionId === "all" && !showArchived ? true : undefined,
      refetchOnWindowFocus: true,
    },
  );
  const { data: unreadCount = 0 } = useWhatsAppUnreadCount(
    shouldSyncFloatingChat ? conversationSessionFilter.sessionId : undefined,
    floatingListFilters,
    shouldSyncFloatingChat ? conversationSessionFilter.accessibleSessionIds : [],
    { enabled: shouldSyncFloatingChat && sharedFilters.isHydrated },
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
    isReconciliationError: reconciliationFailed,
    retryReconciliation,
    readMessagePage,
    canonicalPreview,
    refetch: refetchMessages,
  } = useWhatsAppMessagesPaginated(
    shouldSyncFloatingChat ? activeConversationId || null : null,
    {
      pageSize: 50,
      includeMediaUrls: false,
      expectedSessionId: activeConversation?.session_id ?? null,
      expectedLeadId: activeConversationMessageScope.expectedLeadId,
      historyLeadId: activeConversationMessageScope.historyLeadId,
      onConversationUnavailable: closeUnavailableUnlinkedConversation,
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
  const sendMediaMessage = useSendWhatsAppMessage();
  const resolveSendIntent = useResolveWhatsAppSendIntent();
  const discardLocalMessage = useDiscardFailedLocalWhatsAppMessage();
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
    catalog: true,
    enabled: shouldSyncFloatingChat && !activeConversationId && shouldLoadTags,
  });
  const addLeadTag = useAddLeadTag();
  const removeLeadTag = useRemoveLeadTag();
  const startConversation = useStartConversation();
  const findConversation = useFindConversationByPhone();
  const hasWhatsAppAccess = Boolean(sessions?.length);
  const router = useRouter();
  const activeLeadAutomations = useLeadActiveAutomationExecutions(activeConversationLeadId, { enabled: canStartAutomations && shouldSyncFloatingChat });
  const cancelLeadExecutions = useCancelLeadExecutions();
  const isReadOnlyMode = !canMutateActiveConversation;
  const whatsappMessageInputState = getWhatsAppMessageInputState(
    activeConversation,
    selectedSessionId,
    sessions,
    currentUserId,
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
    enabled: chatVisible && canOperateWhatsApp && !localReadOnly && !sessionsFailed && Boolean(activeAttendanceTarget),
    identityKey: `${activeTenantKey}:${activeConversationId || "none"}:${activeConversationLeadId || "none"}:${whatsappMessageInputState.sendSessionId || "none"}`,
  });
  const messageInputDisabled = sessionsFailed || attendanceGate.isResolving
    || isReadOnlyMode
    || whatsappMessageInputState.disabled;
  const floatingTimelineItems = useMemo<FloatingTimelineItem[]>(() => sortWhatsAppTimelineItems([
    ...visibleMessages.map((message): FloatingTimelineItem => ({
      kind: "message",
      id: `message-${message.id}`,
      timestamp: message.sent_at,
      message: message as WhatsAppMessage,
    })),
    ...attendanceGate.entries.map((entry): FloatingTimelineItem => ({
      kind: "attendance",
      id: `attendance-${entry.id}`,
      timestamp: entry.markerAt ?? entry.joinedAt,
      entry,
    })),
  ]), [attendanceGate.entries, visibleMessages]);

  useWhatsAppInboxRealtime(shouldSyncFloatingChat, true);
  useWhatsAppLeadActivityRealtime(shouldSyncFloatingChat, activeConversationLeadId, activeConversationId ?? null);
  useWhatsAppLeadRealtime(
    shouldSyncFloatingChat,
    activeConversationLeadId ? [activeConversationLeadId] : [],
  );

  const getLeadPipelineUrl = (leadId: string) => {
    navigationNonceRef.current += 1;
    return `/crm/pipelines?lead=${leadId}&t=${navigationNonceRef.current}`;
  };

  useEffect(() => {
    if (!activeConversationId || !activeConversation || activeSupervisoryView || !conversations) return;

    const updatedConv = conversations.find((conversation) => conversation.id === activeConversationId);
    if (updatedConv && updatedConv !== activeConversation) {
      const pendingLink = pendingConversationLinkRef.current;
      if (pendingLink?.conversationId === updatedConv.id) {
        if (updatedConv.lead_id !== pendingLink.leadId) return;
        pendingConversationLinkRef.current = null;
		openConversation(updatedConv, { tenantKey: intentTenantKey, generation: intentGeneration });
		return;
      }
	  const resolvedConversation = preserveWhatsAppConversationCardSnapshot(
		activeConversation,
		updatedConv,
	  );
	  openConversation(resolvedConversation, { tenantKey: intentTenantKey, generation: intentGeneration });
    }
  }, [activeConversation, activeConversationId, activeConversationLeadId, activeSupervisoryView, conversations, openConversation, intentTenantKey, intentGeneration]);

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

  const conversationViewScope = JSON.stringify([activeTenantKey, whatsappQueryScope.accessScope, activeConversationId,
    activeConversationMessageScope.expectedLeadId, activeConversation?.session_id, chatVisible]);
  const messageNavigation = useWhatsAppMessageNavigation({
    scopeKey: conversationViewScope, messages: visibleMessages, readPage: readMessagePage,
    logRef: messageScrollAreaRef,
    loadOlder: async () => {
      const result = await loadOlderMessages();
      if (result.isError || result.isFetchNextPageError) throw Error("History page unavailable");
      return { messages: flattenWhatsAppMessagePages(result.data?.pages ?? []), hasMore: Boolean(result.hasNextPage) };
    },
  });
  const threadScroll = useWhatsAppThreadScroll(
    conversationViewScope,
    floatingTimelineItems.at(-1)?.id ?? null,
    messageScrollAreaRef, messagesEndRef,
    { firstItemId: floatingTimelineItems[0]?.id ?? null, radixViewport: true,
      enabled: chatVisible && Boolean(activeConversationId), suspended: presentationMinimized,
      layoutKey: isMobile ? "mobile" : "desktop" },
  );
  const conversationUnread = useWhatsAppUnread({ scopeKey: conversationViewScope,
    conversationId: activeConversationId ?? null, unreadCount: activeConversationUnreadCount,
    lastMessageAt: activeConversation?.last_message_at, messages: visibleMessages,
    enabled: chatSurfaceVisible && !loadingMessages && !messagesFailed && !reconciliationFailed && canManageActiveConversation,
    atBottom: !threadScroll.showScrollToLatest,
    onRead: () => {
      if (!activeConversationReadTarget) return;
      markConversationAsRead({ id: activeConversationReadTarget.id, session_id: activeConversationReadTarget.sessionId,
        remote_jid: activeConversationReadTarget.remoteJid, is_group: activeConversationReadTarget.isGroup,
        lead_id: activeConversationReadTarget.leadId });
    },
  });

  useEffect(() => {
    if (!chatSurfaceVisible || activeConversationId || !shouldRestoreConversationListScrollRef.current) {
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
    chatSurfaceVisible,
    conversationListPositionKey,
    conversations?.length,
    loadingConversations,
  ]);

  useEffect(() => {
    if (pendingMessage && activeConversation && pendingMessageConversationId === activeConversation.id) {
      let isActive = true;
      const intent = { tenantKey: intentTenantKey, generation: intentGeneration };
      queueMicrotask(() => {
        if (!isActive || !isIntentCurrent(intent)) return;
        if (!activeSupervisoryView) setMessageText(pendingMessage);
        clearPendingMessage(intent);
      });
      return () => {
        isActive = false;
      };
    }
  }, [activeConversation, activeSupervisoryView, clearPendingMessage, pendingMessage, pendingMessageConversationId, intentTenantKey, intentGeneration, isIntentCurrent, setMessageText]);

  useEffect(() => {
    if (!chatSurfaceVisible || isMobile || !activeConversationId || !canMutateActiveConversation
      || restoringFromFilterPanelRef.current) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      messageInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [activeConversationId, canMutateActiveConversation, chatSurfaceVisible, isMobile]);

  const { open: historySearchOpen, setOpen: setHistorySearchOpen } = messageNavigation;
  const handleChatEscape = useCallback((event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      const surface = chatSurfaceRef.current;
      if (!surface || !event.composedPath().includes(surface)) return;
      if (showSessionSelector || showAutomationDialog || pendingDeleteConversation) return;
      if (historySearchOpen) {
        event.preventDefault();
        setHistorySearchOpen(false);
        conversationSearchRef.current?.focus({ preventScroll: true });
        return;
      }
      event.preventDefault();
      if (activeConversationId) {
        surface.focus({ preventScroll: true });
        clearActiveConversation();
        return;
      }
      closeChat();
    }, [
      activeConversationId, clearActiveConversation, closeChat, pendingDeleteConversation,
      showAutomationDialog, showSessionSelector, historySearchOpen, setHistorySearchOpen,
    ]);
  useEffect(() => {
    if (!chatSurfaceVisible || isMobile) return undefined;
    document.addEventListener("keydown", handleChatEscape);
    return () => document.removeEventListener("keydown", handleChatEscape);
  }, [
    chatSurfaceVisible,
    isMobile,
    handleChatEscape,
  ]);


  const handleSessionSelect = (session: WhatsAppSession) => {
    if (!pendingStartData || !canOperateWhatsApp || !startSelectionSessions.some(item => item.id === session.id)) return;
    setShowSessionSelector(false);
    if (pendingStartData) {
      if (pendingStartData.ownOnly) {
        void handleStartConversationWithSession(pendingStartData.phone, session.id, pendingStartData.leadName, pendingStartData.leadId, true);
      } else {
        void handleStartConversationWithSession(pendingStartData.phone, session.id, pendingStartData.leadName, pendingStartData.leadId);
      }
      setPendingStartData(null);
    }
  };

  const loadPendingLeadLinkPreview = async (target: NonNullable<typeof pendingLeadLink>) => {
    const requestId = ++leadLinkPreviewRequestRef.current;
    setIsLeadLinkPreviewLoading(true);
    setLeadLinkPreviewFailed(false);
    setLeadLinkPreview(null);
    const expectedPreviousLeadId = getWhatsAppConversationMessageScope(target.conversation).expectedLeadId
      || WHATSAPP_UNLINKED_LEAD_SNAPSHOT;
    try {
      const preview = await whatsappAPI.getConversationLinkPreview(
        target.conversation.id,
        expectedPreviousLeadId,
        target.leadId,
        activeOrganization.organizationId,
      );
      if (requestId !== leadLinkPreviewRequestRef.current) return;
      if (
        preview.conversationId !== target.conversation.id
        || preview.sessionId !== target.sessionId
        || preview.leadId !== target.leadId
        || preview.expectedPreviousLeadId !== expectedPreviousLeadId
      ) {
        throw new Error("A prévia não corresponde à conversa selecionada");
      }
      setLeadLinkPreview(preview);
    } catch {
      if (requestId === leadLinkPreviewRequestRef.current) setLeadLinkPreviewFailed(true);
    } finally {
      if (requestId === leadLinkPreviewRequestRef.current) setIsLeadLinkPreviewLoading(false);
    }
  };

  const requestLeadLinkConfirmation = (target: NonNullable<typeof pendingLeadLink>) => {
    setPendingLeadLink(target);
    void loadPendingLeadLinkPreview(target);
  };

  const confirmPendingLeadLink = async () => {
    const intent = { tenantKey: intentTenantKey, generation: intentGeneration };
    const requestScope = startupScope;
    const current = () => isIntentCurrent(intent) && startupScopeRef.current === requestScope;
    if (!current()) return;
    const target = pendingLeadLink;
    const preview = leadLinkPreview;
    if (!target || !preview || leadLinkPreviewFailed || linkConversationToLead.isPending) return;
    if (target.ownOnly && !sessions?.some(session => session.id === target.sessionId && session.owner_user_id === currentUserId
      && session.status === 'connected' && session.can_send !== false && session.provider !== 'evolution')) return;
    if (preview.conversationId !== target.conversation.id
      || preview.sessionId !== target.sessionId
      || preview.leadId !== target.leadId
      || preview.expectedPreviousLeadId !== (
        getWhatsAppConversationMessageScope(target.conversation).expectedLeadId
        || WHATSAPP_UNLINKED_LEAD_SNAPSHOT
      )) return;
    let bindingMode: 'active' | 'history_only';
    try {
      const result = await linkConversationToLead.mutateAsync({
        conversation: target.conversation,
        leadId: target.leadId,
        expectedPreviousLeadId: preview.expectedPreviousLeadId,
        ...(target.ownOnly ? { ownSessionOnly: true } : {}),
      });
      if (!current()) return;
      bindingMode = result.bindingMode;
    } catch {
      if (!current()) return;
      toast({
        title: "Não foi possível vincular esta conversa",
        description: "Confira o histórico e tente novamente. Nenhuma mensagem foi enviada.",
        variant: "destructive",
      });
      return;
    }
    leadLinkPreviewRequestRef.current += 1;
    setPendingLeadLink(null);
    setLeadLinkPreview(null);
    try {
      if (bindingMode === 'history_only') {
        const newConversation = await startConversation.mutateAsync({
          phone: target.phone,
          sessionId: target.sessionId,
          leadId: target.leadId,
          leadName: target.leadName,
          expectedPreviousLeadId: WHATSAPP_UNLINKED_LEAD_SNAPSHOT,
          ...(target.ownOnly ? { ownSessionOnly: true } : {}),
        });
        if (!current()) return;
        setSelectedSessionId(target.sessionId);
        openConversation(newConversation, intent);
        return;
      }
      pendingConversationLinkRef.current = {
        conversationId: target.conversation.id,
        leadId: target.leadId,
      };
      const linkedConversation = await whatsappAPI.getConversation(
        target.conversation.id,
        target.leadId,
        activeOrganization.organizationId,
      );
      if (!current()) return;
      setSelectedSessionId(target.sessionId);
      openConversation(linkedConversation, intent);
    } catch {
      if (!current()) return;
      toast({
        title: "Histórico vinculado, chat não aberto",
        description: "Atualize o lead antes de iniciar o atendimento. Nenhuma mensagem foi enviada.",
        variant: "destructive",
      });
    }
  };

  const cancelPendingLeadLink = () => {
    if (linkConversationToLead.isPending) return;
    leadLinkPreviewRequestRef.current += 1;
    setPendingLeadLink(null);
    setLeadLinkPreview(null);
    setLeadLinkPreviewFailed(false);
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

    const connectedSession = sessions?.find(session => eligibleLeadStartSession(session, currentUserId, leadId, originalOrganization));
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
  async function handleStartConversationWithSession(phone: string, sessionId?: string, leadName?: string, leadId?: string, ownOnly = false) {
    const intent = { tenantKey: intentTenantKey, generation: intentGeneration };
    if (!isIntentCurrent(intent) || startupScopeRef.current !== startupScope) return;
    if (ownOnly && !sessions?.some(session => session.id === sessionId && session.owner_user_id === currentUserId
      && session.status === 'connected' && session.can_send !== false && session.provider !== 'evolution')) return;
    const requestGeneration = ++startRequestGenerationRef.current;
    setVisibleStartRequestGeneration(requestGeneration);
    const current = () => isIntentCurrent(intent)
      && requestGeneration === startRequestGenerationRef.current
      && startupScopeRef.current === startupScope;
    if (!originalOrganization) {
      if (!leadId) { clearActiveConversation(intent); return; }
      try {
        const history = await whatsappAPI.findConversation({ phone: "", leadId, organizationId: activeOrganization.organizationId });
        if (!current()) return;
        if (history) {
          openConversation({ ...history, historical_lead_view: true }, intent);
          clearPendingMessage(intent);
        } else clearActiveConversation(intent);
      } catch { if (current()) clearActiveConversation(intent); }
      return;
    }
    const canonicalPhone = normalizePhoneToE164(phone);
    if (!canonicalPhone) {
      toast({
        title: "Lead sem WhatsApp",
        description: "Este lead não tem um WhatsApp válido cadastrado.",
        variant: "destructive"
      });
      clearActiveConversation(intent);
      return;
    }

    setIsStartingConversation(true);

    try {
      // A new contact intent follows the lead's current phone. Canonical
      // history reads remain separate and never change a physical route.
      if (leadId) {
		const existingForLead = await whatsappAPI.findConversation({
		  phone: canonicalPhone,
		  leadId,
		  sessionId,
		  organizationId: activeOrganization.organizationId,
		}) as WhatsAppConversation | null;
        if (!current()) return;
		if (existingForLead && (!ownOnly || !existingForLead.historical_lead_view)) {
		  if (sessionId) setSelectedSessionId(sessionId);
		  openConversation(existingForLead, intent);
		  return;
		}
	  }

      // Sem histórico do card, a busca física permanece restrita à sessão
      // escolhida. Encontrar a conversa não autoriza vincular seu histórico.
      if (sessionId) {
        const existing = await findConversation.mutateAsync({
          phone: canonicalPhone,
          sessionId,
        });
        if (!current()) return;
        if (existing) {
          if (leadId && existing.lead_id !== leadId) {
            if (existing.lead_id) {
              toast({
                title: "Conversa vinculada a outro lead",
                description: "Escolha o vínculo no módulo Conversas. Nenhuma mensagem foi enviada.",
                variant: "destructive",
              });
              return;
            }
            if (!canOperateWhatsApp) {
              toast({
                title: "Conversa não vinculada",
                description: "Você pode visualizar conversas existentes, mas não vincular ou iniciar uma nova conversa.",
                variant: "destructive",
              });
              clearActiveConversation(intent);
              return;
            }
            // Start decides whether an active route for this lead must be
            // retired. Importing P2 through the ordinary link API first would
            // collide with P1 and skip the separate phone-change consent.
            try {
              const admitted = await startConversation.mutateAsync({
                phone: canonicalPhone, sessionId, leadId, leadName,
                expectedPreviousLeadId: leadId,
                ...(ownOnly ? { ownSessionOnly: true } : {}),
                suppressErrorToast: true,
              });
              if (!current()) return;
              setSelectedSessionId(sessionId);
              openConversation(admitted, intent);
              return;
            } catch (error) {
              if (!current()) return;
              if (!(error instanceof VimobAPIError) || error.code !== "whatsapp_history_link_required") throw error;
            }
            requestLeadLinkConfirmation({
              conversation: existing,
              leadId,
              leadName,
              sessionId,
              phone: canonicalPhone,
              ownOnly,
            });
            return;
          }
          setSelectedSessionId(sessionId);
          openConversation(existing, intent);
          return;
        }
      }

      if (!current()) return;
      if (!canOperateWhatsApp) {
        toast({
          title: "Conversa não encontrada",
          description: "Você não tem permissão para iniciar uma nova conversa.",
          variant: "destructive",
        });
        clearActiveConversation(intent);
        return;
      }

      // Keep this intent and its prepared text while the user connects. The
      // startup key changes when an eligible session appears, then resumes it.
      if (!sessionId || localReadOnly || sessionsFailed) return;

      const newConversation = await startConversation.mutateAsync({
        phone: canonicalPhone,
        sessionId,
        leadId,
        leadName,
        expectedPreviousLeadId: WHATSAPP_UNLINKED_LEAD_SNAPSHOT,
        ...(ownOnly ? { ownSessionOnly: true } : {}),
        suppressErrorToast: true,
      });

      if (!current()) return;
      setSelectedSessionId(sessionId);
      openConversation(newConversation, intent);
    } catch (error: unknown) {
      if (!current()) return;
      const confirmation = getWhatsAppPhoneChangeConfirmation(error);
      if (confirmation && leadId && sessionId && confirmation.leadId === leadId && confirmation.sessionId === sessionId) {
        const target = { phone: canonicalPhone, leadName, confirmation, intent, scope: startupScope, requestGeneration, ownOnly };
        setPhoneChangeError(null);
        setPhoneChangePreview(null);
        setPhoneChangePreviewFailed(false);
        setPendingPhoneChange(target);
        if (confirmation.requiresDestinationHistoryConfirmation) void loadPhoneChangePreview(target);
        return;
      }
      console.error("[WhatsApp Start] Erro final no fluxo:", error);
      toast({
        title: "Erro ao iniciar conversa",
        description: getWhatsAppStartErrorMessage(error),
        variant: "destructive"
      });
      // Limpar o estado de pending em caso de erro critico
      clearActiveConversation(intent);
    } finally {
      if (current()) setIsStartingConversation(false);
    }
  }
  const senderAvatars = useWhatsAppSenderAvatars({ messages: visibleMessages, conversationId: activeConversationId,
    leadId: activeConversationLeadId, sessionId: activeConversation?.session_id, enabled: shouldSyncFloatingChat && !messagesFailed });
  const selectedCanonicalConversations = useMemo(() => projectWhatsAppCanonicalConversationPreview(
    conversations ?? [], canonicalPreview, whatsappQueryScope,
  ), [conversations, canonicalPreview, whatsappQueryScope]);
  const conversationsRoute = pathname === "/crm/conversas" || pathname?.startsWith("/crm/conversas/") === true;
  const visibleCanonicalPreviews = useWhatsAppVisibleCanonicalPreviews({
    conversations: conversations ?? [],
    pausedConversationId: activeConversationId,
    scope: whatsappQueryScope,
    listRevision: conversationsRevision,
    enabled: shouldSyncFloatingChat && !activeConversation && !isStartingConversation
      && !conversationsRoute && sharedFilters.isHydrated,
    sourceKey: canViewWhatsApp ? "floating" : "floating:no-access",
  });
  const canonicalPreviewConversations = useMemo(() => visibleCanonicalPreviews.previews.reduce(
      (rows, preview) => preview.conversationId.toLowerCase() === activeConversationId?.toLowerCase() ? rows
        : projectWhatsAppCanonicalConversationPreview(rows, preview, whatsappQueryScope),
      selectedCanonicalConversations,
    ), [selectedCanonicalConversations, activeConversationId, visibleCanonicalPreviews.previews, whatsappQueryScope]);
  const sendPreviewConversations = useWhatsAppLocalSendPreviews(canonicalPreviewConversations, whatsappQueryScope);
  // Memoize filtered conversations to prevent re-renders that cause input focus loss
  const filteredConversations = useMemo(() => {
    return sendPreviewConversations.filter((conversation) =>
      matchesConversationSearch(conversation, searchTerm, normalizeSearchText),
    );
  }, [sendPreviewConversations, searchTerm]);

  const phoneChangeCurrent = (target: NonNullable<typeof pendingPhoneChange>) => originalOrganization && canOperateWhatsApp
    && isIntentCurrent(target.intent) && startupScopeRef.current === target.scope
    && startRequestGenerationRef.current === target.requestGeneration;
  const phoneChangePreviewMatches = (target: NonNullable<typeof pendingPhoneChange>) => Boolean(phoneChangePreview
    && !phoneChangePreviewLoading && !phoneChangePreviewFailed
    && phoneChangePreview.conversationId === target.confirmation.destinationConversationId
    && phoneChangePreview.sessionId === target.confirmation.sessionId
    && phoneChangePreview.leadId === target.confirmation.leadId
    && phoneChangePreview.expectedPreviousLeadId === WHATSAPP_UNLINKED_LEAD_SNAPSHOT
    && phoneChangePreview.bindingMode === "active");
  async function loadPhoneChangePreview(target: NonNullable<typeof pendingPhoneChange>) {
    if (!phoneChangeCurrent(target) || !target.confirmation.destinationConversationId) return;
    const request = ++phoneChangePreviewRequestRef.current;
    setPhoneChangePreview(null);
    setPhoneChangePreviewLoading(true);
    setPhoneChangePreviewFailed(false);
    const current = () => phoneChangeCurrent(target) && phoneChangePreviewRequestRef.current === request;
    try {
      const preview = await whatsappAPI.getConversationLinkPreview(target.confirmation.destinationConversationId,
        WHATSAPP_UNLINKED_LEAD_SNAPSHOT, target.confirmation.leadId, activeOrganization.organizationId);
      if (!current()) return;
      if (preview.conversationId !== target.confirmation.destinationConversationId
        || preview.sessionId !== target.confirmation.sessionId || preview.leadId !== target.confirmation.leadId
        || preview.expectedPreviousLeadId !== WHATSAPP_UNLINKED_LEAD_SNAPSHOT || preview.bindingMode !== "active") {
        throw new Error("A prévia não corresponde à nova conversa");
      }
      setPhoneChangePreview(preview);
    } catch { if (current()) setPhoneChangePreviewFailed(true); }
    finally { if (current()) setPhoneChangePreviewLoading(false); }
  }
  const cancelPhoneChange = () => {
    const target = pendingPhoneChange;
    setPendingPhoneChange(null);
    setPhoneChangeError(null);
    phoneChangePreviewRequestRef.current += 1;
    setPhoneChangePreview(null);
    if (target && phoneChangeCurrent(target)) clearActiveConversation(target.intent);
  };
  const confirmPhoneChange = async () => {
    const target = pendingPhoneChange;
    if (!target || !phoneChangeCurrent(target) || startConversation.isPending) return;
    if (target.confirmation.requiresDestinationHistoryConfirmation && !phoneChangePreviewMatches(target)) return;
    setPhoneChangeError(null);
    try {
      const conversation = await startConversation.mutateAsync({
        phone: target.phone, leadId: target.confirmation.leadId, leadName: target.leadName,
        sessionId: target.confirmation.sessionId, expectedPreviousLeadId: target.confirmation.leadId,
        expectedPreviousConversationId: target.confirmation.conversationId, confirmPhoneChange: true,
        ...(target.confirmation.requiresDestinationHistoryConfirmation ? {
          confirmDestinationHistory: true, expectedDestinationConversationId: target.confirmation.destinationConversationId,
        } : {}),
        suppressErrorToast: true,
        ...(target.ownOnly ? { ownSessionOnly: true } : {}),
      });
      if (!phoneChangeCurrent(target)) return;
      setPendingPhoneChange(null);
      openConversation(conversation, target.intent);
    } catch (error) {
      if (!phoneChangeCurrent(target)) return;
      setPhoneChangeError(getWhatsAppStartErrorMessage(error));
    }
  };
  useEffect(() => {
    if (!pendingPhone) {
      pendingStartKeyRef.current = null;
      return;
    }
    if (loadingSessions || !accessReady || !canViewWhatsApp) return;

    const connectedSessionKey = (sessions || [])
      .filter((session) => eligibleLeadStartSession(session, currentUserId, pendingLeadId, originalOrganization))
      .map((session) => `${session.id}:${session.status}`)
      .join("|");
    const pendingStartKey = [startupScope, intentTenantKey, intentGeneration, pendingPhone, pendingLeadName || "", pendingLeadId || "", connectedSessionKey].join("::");
    if (pendingStartKeyRef.current === pendingStartKey) return;
    pendingStartKeyRef.current = pendingStartKey;

    const openPendingConversation = async () => {
      if (!originalOrganization) {
        await handleStartConversationWithSession(pendingPhone, undefined, pendingLeadName || undefined, pendingLeadId || undefined);
        return;
      }
      const connected = sessions?.filter(session => eligibleLeadStartSession(session, currentUserId, pendingLeadId, originalOrganization)) || [];

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
    intentTenantKey,
    intentGeneration,
    startupScope,
    pendingPhone,
    pendingLeadName,
    pendingLeadId,
    currentUserId,
    sessions,
    loadingSessions,
    accessReady,
    canViewWhatsApp,
    originalOrganization,
    handleStartConversationWithSession,
  ]);
  const handleViewLead = (leadId: string) => {
    closeChat();
    // Usar contador para forcar React Router a detectar mudanca mesmo na mesma pagina
    const url = getLeadPipelineUrl(leadId);
    router.push(url);
  };

  const handleArchiveConversation = (conversation: WhatsAppConversation) => {
    if (!canOperateWhatsApp || conversation.historical_lead_view || archiveConversation.isPendingFor?.(conversation)) return;
	const intent = { tenantKey: intentTenantKey, generation: intentGeneration };
	const scope = startupScope;
    const visit = conversationVisitGenerationRef.current;
	archiveConversation.mutate({
	  conversation,
	  archive: !conversation.archived_at,
    }, {
      onSuccess: () => {
        if (!isIntentCurrent(intent) || startupScopeRef.current !== scope || conversationVisitGenerationRef.current !== visit) return;
        const current = activeConversationRef.current;
        if (current?.id === conversation.id && getWhatsAppConversationMessageScope(current).expectedLeadId === getWhatsAppConversationMessageScope(conversation).expectedLeadId
          && current.session_id === conversation.session_id) clearActiveConversation(intent);
      },
    });
  };

  const handleDeleteConversation = (conversation: WhatsAppConversation) => {
    if (!canOperateWhatsApp || conversation.historical_lead_view) return;
    setPendingDeleteConversation(conversation);
  };

  const confirmDeleteConversation = async () => {
    if (!pendingDeleteConversation || !canOperateWhatsApp) return;
    const conversation = pendingDeleteConversation;
    const intent = { tenantKey: intentTenantKey, generation: intentGeneration };
    const scope = startupScope;
    try {
	  await deleteConversation.mutateAsync(conversation);
      if (!isIntentCurrent(intent) || startupScopeRef.current !== scope) return;
      if (activeConversationRef.current?.id === conversation.id) clearActiveConversation(intent);
      setPendingDeleteConversation((current) => current?.id === conversation.id ? null : current);
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

  const audioDisabled = isReadOnlyMode || whatsappMessageInputState.disabled;
  const audioContextKey = JSON.stringify([activeTenantKey, whatsappQueryScope.accessScope,
    activeConversationId, activeConversationMessageScope.expectedLeadId, whatsappMessageInputState.sendSessionId, audioDisabled,
    intentTenantKey, intentGeneration, chatVisible]);
  const mediaGallery = useWhatsAppMediaGallery({ messages: visibleMessages,
    scopeKey: audioContextKey, conversationId: activeConversationId });
  const [replySelection, setReplySelection] = useState<{ contextKey: string; message: WhatsAppMessage } | null>(null);
  const latestReply = replySelection?.contextKey === audioContextKey
    ? visibleMessages.find(message => message.id === replySelection.message.id) : null;
  const replyTarget = !audioDisabled && latestReply && canQuoteWhatsAppMessage(latestReply)
    && latestReply.conversation_id === activeConversationId
    && latestReply.session_id === whatsappMessageInputState.sendSessionId ? latestReply : null;
  // eslint-disable-next-line react-hooks/set-state-in-effect -- A reply belongs to exactly one conversation and access scope.
  useLayoutEffect(() => { if (!replyTarget) setReplySelection(null); }, [audioContextKey, replyTarget]);
  const audioContextRef = useRef(audioContextKey);
  const audioGenerationRef = useRef(0);
  useLayoutEffect(() => { audioContextRef.current = audioContextKey; audioGenerationRef.current += 1; return () => { audioContextRef.current = ""; audioGenerationRef.current += 1; }; }, [audioContextKey]);
  const handleResolveAudio = async (clientMessageId: string) => {
    const generation = audioGenerationRef.current;
    if (!originalOrganization || !activeConversation || (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation)) return "cancelled" as const;
    const result = await resolveSendIntent({ conversation: activeConversation, clientMessageId });
    return audioContextRef.current === audioContextKey && audioGenerationRef.current === generation ? result : "cancelled" as const;
  };
  const handleSendMessage = async () => {
    const generation = audioGenerationRef.current;
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
    if (!joined || (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation)) return;

    // O rascunho só é limpo depois que a entrada no atendimento foi confirmada.
    setMessageText("");

    try {
      await sendMessage.mutateAsync({
        conversation: activeConversation,
        text: textToSend,
        quotedMessageId: replyTarget?.id,
        optimisticQuotedMessage: replyTarget ? toWhatsAppQuote(replyTarget) : undefined,
        sendSessionId: whatsappMessageInputState.sendSessionId,
      });
      if (audioContextRef.current === audioContextKey && audioGenerationRef.current === generation)
        setReplySelection(current => current?.message.id === replyTarget?.id ? null : current);
    } catch (error) {
      if (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation) return;
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

  const handleSendAudio = async (base64: string, mimetype: string, context: AudioRecorderSendContext): Promise<AudioRecorderSendResult> => {
    const generation = audioGenerationRef.current;
    if (context.contextKey !== audioContextKey || (audioContextRef.current !== context.contextKey || audioGenerationRef.current !== generation)) return { state: "cancelled" };
    if (!canMutateActiveConversation || !activeConversation) return false;
    if (sendMediaMessage.isPending) return false;
    if (whatsappMessageInputState.disabled || isReadOnlyMode) {
      toast({
        title: "Audio nao enviado",
        description: isReadOnlyMode ? "Você tem acesso somente leitura a esta conversa." : whatsappMessageInputState.placeholder,
        variant: "destructive",
      });
      return false;
    }

    const joined = await attendanceGate.ensureJoined();
    if (!joined || (audioContextRef.current !== context.contextKey || audioGenerationRef.current !== generation)) return { state: "cancelled" };

    try {
      const response = await sendMediaMessage.mutateAsync({
        conversation: activeConversation,
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
      // The mutation owns the definitive failure notice.
      return false;
    }
  };

  const handleFileSelect = async (selection: React.ChangeEvent<HTMLInputElement> | File, caption?: string, context?: WhatsAppAttachmentSendContext): Promise<WhatsAppAttachmentOutcome> => {
    const generation = audioGenerationRef.current;
    const input = 'target' in selection ? selection.target : null;
    const file = input?.files?.[0] ?? (input ? undefined : selection as File);
    if (!file || !canMutateActiveConversation || !activeConversation) return 'cancelled';
    if (sendMediaMessage.isPending) { if (input) input.value = ""; return 'cancelled'; }
    if (context?.verificationOnly) {
      if (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation) return 'cancelled';
      try {
        const result = await sendMediaMessage.mutateAsync({
          conversation: activeConversation,
          text: caption ?? file.name,
          fileIntentSource: file,
          fileIntentVerificationOnly: true,
          fileIntentIsCurrent: () => audioContextRef.current === audioContextKey && audioGenerationRef.current === generation,
          sendSessionId: whatsappMessageInputState.sendSessionId,
        });
        if (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation) return 'cancelled';
        return result.fileIntentChecked
          ? getWhatsAppFileSendFeedback(result, { conversationId: activeConversation.id, clientMessageId: result.clientMessageId }).state
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
      return 'failed';
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
      return 'failed';
    }
    const joined = await attendanceGate.ensureJoined();
    if (!joined || (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation)) {
      if (input) input.value = "";
      return 'cancelled';
    }
    let processedFile: File;
    let base64Content: string;
    try {
      processedFile = await compressOutboundImageFile(
        file,
        OUTBOUND_IMAGE_COMPRESSION_PROFILES.preservePngEncoding,
      );
      if (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation) { if (input) input.value = ""; return 'cancelled'; }
      if (processedFile.size > MAX_OUTBOUND_MESSAGE_MEDIA_BYTES) {
        toast({
          title: "Arquivo muito grande",
          description: "O arquivo processado ultrapassou o limite de 5 MB.",
          variant: "destructive",
        });
        if (input) input.value = "";
        return 'failed';
      }
      base64Content = await blobToBase64(processedFile);
    } catch {
      if (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation) { if (input) input.value = ""; return 'cancelled'; }
      toast({
        title: "Não foi possível preparar o arquivo",
        description: "Confira o arquivo e tente novamente.",
        variant: "destructive",
      });
      if (input) input.value = "";
      return 'failed';
    }

    if ((audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation)) { if (input) input.value = ""; return 'cancelled'; }
    const mediaType = getOutboundMessageMediaKind(processedFile.type);
    try {
      const result = await sendMediaMessage.mutateAsync({
        conversation: activeConversation,
        text: caption ?? processedFile.name,
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
      const feedback = getWhatsAppFileSendFeedback(result, { conversationId: activeConversation.id, clientMessageId: result.clientMessageId });
      if (result.fileIntentChecked) return feedback.state === 'unconfirmed' ? 'unconfirmed' : feedback.state;
      if (feedback.state === 'queued') setReplySelection(current => current?.message.id === replyTarget?.id ? null : current);
      toast({ title: feedback.title, description: feedback.description, variant: feedback.variant });
      return feedback.state === 'unconfirmed' ? 'unconfirmed' : feedback.state;
    } catch (error) {
      // A mutação é a única responsável pelo aviso de falha.
      if (audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation) return 'cancelled';
      return getWhatsAppSendFailureStatus(error) === 'confirming' ? 'unconfirmed' : 'failed';
    } finally {
      if (audioContextRef.current === audioContextKey && audioGenerationRef.current === generation && fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };
  const attachments = useWhatsAppAttachments({ scopeKey: JSON.stringify([audioContextKey, chatVisible]),
    disabled: audioDisabled, onSend: (file, caption, context) => handleFileSelect(file, caption, context) });
  const handleReactToMessage = async (message: WhatsAppMessage, emoji: string) => {
    const generation = audioGenerationRef.current;
    if (!canMutateActiveConversation || !activeConversation || !activeConversationLeadId) return;
    const reactionSessionId = message.session_id || activeConversation.session_id;
    if (!reactionSessionId) return;
    const joined = await attendanceGate.ensureJoined({
      target: {
        conversationId: activeConversation.id,
        expectedLeadId: activeConversationLeadId,
        sendSessionId: reactionSessionId,
      },
    });
    if (!joined || audioContextRef.current !== audioContextKey || audioGenerationRef.current !== generation) return;
    await reactToMessage.mutateAsync({
      conversation: activeConversation,
      targetMessage: message,
      emoji,
    });
  };
  const connectedSessions = sessions?.filter(s => s.status === "connected" && s.owner_user_id === currentUserId && s.can_send !== false && s.provider !== "evolution") || [];
  const startSelectionSessions = sessions?.filter(session => eligibleLeadStartSession(session, currentUserId, pendingStartData?.leadId, originalOrganization)
    && (!pendingStartData?.ownOnly || (session.owner_user_id === currentUserId && session.provider !== "evolution"))) || [];
  const ownStartNotice = getOwnWhatsAppStartNotice({ conversation: activeConversation, sessions,
    currentUserId, canOperate: canOperateWhatsApp && !localReadOnly && !sessionsFailed, loadingSessions });
  const pendingConnection = Boolean(pendingPhone && !activeConversation && originalOrganization && canOperateWhatsApp
    && !loadingSessions && !sessions?.some(session => eligibleLeadStartSession(session, currentUserId, pendingLeadId, originalOrganization)));
  const activeConversationFilterCount = [
    selectedSessionId !== "all",
    hideGroups,
    showArchived,
    Boolean(searchTerm.trim()),
  ].filter(Boolean).length + inheritedFilterCount;

  const clearConversationFilters = () => {
    sharedFilters.clearFilters();
    setSearchTerm('');
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
          {startSelectionSessions.map(session => (
            <Button
              key={session.id}
              variant="outline"
              className="h-auto w-full justify-start px-4 py-3 hover:bg-[var(--app-surface-hover)]"
              onClick={() => handleSessionSelect(session)}
            >
              <div className="flex items-center gap-3 w-full">
                <div className="w-3 h-3 rounded-full bg-green-500 shrink-0 animate-pulse motion-reduce:animate-none" />
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
          "relative flex shrink-0 items-center justify-between",
          mobile
            ? "border-b border-[var(--app-border)] bg-primary/50 px-4 py-3 text-primary-foreground"
            : "relative z-10 h-12 bg-primary/50 px-3.5 text-primary-foreground shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
        )} style={{ zIndex: isStartingConversation ? 60 : undefined }}>
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            <span className="text-[length:var(--app-font-size-caption)] font-light">WhatsApp</span>
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
                "rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text-primary)] [&_svg]:size-3.5",
                mobile
                  ? "h-11 w-11"
                  : "h-8 w-8"
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
    const displayName = formatWhatsAppPersonName(activeConversation.lead?.name) || formatWhatsAppContactLabel(
      activeConversation.is_group ? activeConversation.contact_name : formatWhatsAppPersonName(activeConversation.contact_name),
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
    const contextChipClassName = "min-h-[18px] max-w-full min-w-0 whitespace-normal [overflow-wrap:anywhere] rounded-[4px] border-0 px-1.5 py-0.5 text-[9px] font-medium leading-[12px] text-white shadow-none";

    return (
      <TooltipProvider>
        <div className="relative shrink-0 border-b border-[var(--app-border)] bg-[var(--app-surface-solid)]" style={{ zIndex: isStartingConversation ? 60 : undefined }}>
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
                  disabled={isStartingConversation}
                  className={cn(
                    "shrink-0 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text-primary)]",
                    mobile ? "h-11 w-11" : "h-9 w-9",
                  )}
                  onClick={() => clearActiveConversation()}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Voltar</TooltipContent>
            </Tooltip>

            {/* Avatar */}
            <Avatar className="h-8 w-8 shrink-0 border border-primary/20">
              <AvatarImage src={getConversationAvatarUrl(activeConversation)} fallbackSrc={activeConversation.contact_picture} alt={displayName} />
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
              <p className="font-light text-[13px] leading-4 truncate">{displayName}</p>
              {activeConversation.lead?.name && phone && (
                <p className="text-[10px] font-light text-muted-foreground truncate">{phone}</p>
              )}
            </div>

            {/* Acoes */}
            <div className="flex min-w-fit shrink-0 items-center justify-end gap-1 pr-0.5">
              <Button ref={conversationSearchRef} type="button" variant="ghost" size="icon" aria-label="Buscar nesta conversa" disabled={isStartingConversation} className={mobile ? "h-11 w-11" : "h-9 w-9"} onClick={() => messageNavigation.setOpen(!messageNavigation.open)}>
                <Search className="h-4 w-4" aria-hidden="true" />
              </Button>
              {leadId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Ver lead no funil"
                      disabled={isStartingConversation}
                      className={cn(
                        "rounded-[6px] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-soft)] hover:text-[var(--app-text-primary)]",
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
                      "rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text-primary)]",
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
                <FloatingChatExtraTags
                  key={JSON.stringify([startupScope, activeConversation.id, mobile])}
                  tags={remainingTags}
                  chipClassName={contextChipClassName}
                />
              )}

              {/* Separador */}
              {visibleTags.length > 0 && pipelineName && <span className="shrink-0 text-[9px] text-muted-foreground/70">•</span>}

              {/* Pipeline > Stage */}
              {pipelineName && (
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-muted-foreground">
                  <Badge className={cn(contextChipClassName, "shrink-0 bg-primary/10 text-primary")} title={pipelineName}>
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
      {pendingPhone && <p className="mb-2 max-w-full truncate text-[12px] font-light">{pendingLeadName || pendingPhone}</p>}
      <p className="text-[14px] font-light text-muted-foreground mb-2">Nenhum WhatsApp conectado</p>
      {originalOrganization && canOperateWhatsApp ? <OwnWhatsAppStartNotice
        notice={{ kind: "connect", ownConnectedSessionIds: [] }}
        unavailableReason={localReadOnly ? "read_only" : sessionsFailed ? "sessions_failed" : undefined}
        onRetry={() => void refetchSessions()} onConnect={() => setConnectingPendingScope(startupScope)} />
        : <p className="text-[12px] font-light text-muted-foreground">Acesse Configurações &gt; WhatsApp para conectar</p>}
    </div>;
  const messagesViewJsx = (
    <>
    <ConversationHistorySearch navigation={messageNavigation} onClose={() => conversationSearchRef.current?.focus({ preventScroll: true })} />
    <FloatingMessagesViewport
      key={`${activeTenantKey}:${activeConversationId || "none"}`}
      scrollAreaRef={messageScrollAreaRef}
      onScroll={threadScroll.onScroll}
      showScrollToLatest={threadScroll.showScrollToLatest}
      onScrollToLatest={threadScroll.scrollToLatest}
      unreadCount={conversationUnread.unreadCount}
    >
        <div role="log" data-whatsapp-message-log aria-live="polite" aria-relevant="additions" className="px-3 py-3 w-full max-w-full min-w-0 overflow-hidden overflow-x-hidden">
          {(messagesFailed || reconciliationFailed) && visibleMessages.length > 0 && <div role="status" className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Não foi possível atualizar. Exibindo mensagens já carregadas.</span>
            <Button size="sm" variant="ghost" onClick={() => void (reconciliationFailed ? retryReconciliation() : refetchMessages())}>Tentar novamente</Button>
          </div>}
          {hasOlderMessages && (
            <div className="flex flex-col items-center justify-center gap-1.5 pb-2">
              <LoadOlderMessagesButton
                onClick={() => void threadScroll.loadOlderPreservingPosition(() => loadOlderMessages())}
                loading={isLoadingOlder}
                error={olderMessagesFailed}
              />
              {olderMessagesFailed && (
                <p className="text-center text-[11px] text-destructive" role="alert">
                  Não foi possível carregar mensagens anteriores. O histórico atual foi mantido.
                </p>
              )}
            </div>
          )}
          {((loadingMessages || fetchingMessages) && visibleMessages.length === 0) ? <div className="flex flex-col items-center justify-center gap-2 py-8" role="status" aria-live="polite">
              <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Carregando mensagens...</span>
            </div> : (messagesFailed || reconciliationFailed) && (messages?.length ?? 0) === 0 ? <div className="flex flex-col items-center justify-center gap-3 px-5 py-12 text-center" role="alert">
              <MessageCircle className="h-9 w-9 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">Não foi possível carregar as mensagens</p>
                <p className="mt-1 text-xs text-muted-foreground">Tente novamente sem sair da conversa.</p>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={() => void (reconciliationFailed ? retryReconciliation() : refetchMessages())}>
                Tentar novamente
              </Button>
            </div> : floatingTimelineItems.length === 0 ? <div className="flex flex-col items-center justify-center py-12">
              <MessageCircle className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">Nenhuma mensagem</p>
              <p className="text-xs text-muted-foreground">Envie uma mensagem para começar</p>
            </div> : <div className="flex flex-col">
              {floatingTimelineItems.map((item, index) => {
                const previousItem = index > 0 ? floatingTimelineItems[index - 1] : null;
                const nextItem = floatingTimelineItems[index + 1];
                const grouping = item.kind === "message" ? getWhatsAppMessageGrouping(
                  previousItem?.kind === "message" && item.message.id !== conversationUnread.firstUnreadMessageId ? previousItem.message : null, item.message,
                  nextItem?.kind === "message" && nextItem.message.id !== conversationUnread.firstUnreadMessageId ? nextItem.message : null,
                ) : "single";
                const showSeparator = shouldShowDateSeparator(item.timestamp, previousItem?.timestamp || null);
                return (
                  <div key={item.id} data-thread-item-id={item.id} className={grouping === "middle" || grouping === "last" ? "mt-0.5" : "mt-2"}>
                    {showSeparator && <DateSeparator date={new Date(item.timestamp)} />}
                    {item.kind === "message" && item.message.id === conversationUnread.firstUnreadMessageId && (
                      <div role="separator" aria-label="Mensagens não lidas" className="my-3 rounded bg-[var(--app-surface-muted)] px-3 py-1.5 text-center text-xs text-muted-foreground">Mensagens não lidas</div>
                    )}
                    {item.kind === "attendance" ? (
                      <AttendanceTimelineEvents entries={[item.entry]} />
                    ) : (
                      <MessageErrorBoundary messageId={item.message.id}>
                        <MessageBubble
                          grouping={grouping}
                          showSenderName={Boolean(activeConversation?.is_group) && isWhatsAppMessageBlockStart(grouping)}
                          content={item.message.content}
                          messageType={item.message.message_type}
                          mediaUrl={item.message.media_url ?? null}
                          mediaMimeType={item.message.media_mime_type ?? null}
                          mediaFilename={item.message.media_filename}
                          contacts={item.message.contacts}
                          location={item.message.location}
                          quotedMessage={item.message.quoted_message}
                          mediaGallery={mediaGallery}
                          mediaGalleryScopeKey={audioContextKey}
                          onNavigateQuoted={(id) => messageNavigation.navigateTo(id, { conversationId: item.message.conversation_id, sessionId: item.message.session_id })}
                          canAttachToLead={canOperateLeads && !activeConversation?.supervisory_lead_view}
                          onReply={!audioDisabled && canQuoteWhatsAppMessage(item.message) ? () => { setReplySelection({ contextKey: audioContextKey, message: item.message }); messageInputRef.current?.focus({ preventScroll: true }); } : undefined}
                          onRecoverText={!audioDisabled && item.message.content ? () => { if (audioContextRef.current === audioContextKey) setMessageText(item.message.content || ""); } : undefined}
                          onCheckSend={!activeConversation?.supervisory_lead_view && originalOrganization && item.message.from_me ? () => handleResolveAudio(String(item.message.client_message_id || item.message.metadata?.client_message_id || item.message.id)) : undefined}
                          onOpenLead={canOperateLeads && activeConversationLeadId ? () => handleViewLead(activeConversationLeadId) : undefined}
                          onDiscardLocal={!activeConversation?.supervisory_lead_view && item.message.metadata?.local_delivery_state === "failed" ? () => { if (activeConversation && audioContextRef.current === audioContextKey) discardLocalMessage({ conversation: activeConversation, message: item.message }); } : undefined}
                          mediaStatus={item.message.media_status as 'pending' | 'ready' | 'failed' | null}
                          mediaError={item.message.media_error ?? null}
                          storedMedia={Boolean(item.message.media_storage_path)}
                          mediaSize={item.message.media_size}
                          fromMe={item.message.from_me}
                          status={item.message.status ?? ''}
                          sentAt={item.message.sent_at}
                          deliveryErrorCode={item.message.delivery_error_code ?? null}
                          deliveryErrorReason={item.message.delivery_error_reason}
                          deliveryFailedAt={item.message.delivery_failed_at ?? null}
                          senderName={item.message.sender_name ?? null}
                          senderUserId={item.message.sender_user_id ?? null}
                          senderAvatarUrl={senderAvatars.get(item.message.sender_user_id?.trim().toLowerCase() || "")?.url}
                          senderAvatarUserId={senderAvatars.get(item.message.sender_user_id?.trim().toLowerCase() || "")?.userId}
                          viewerUserId={currentUserId}
                          viewerAvatarUrl={profile?.id === user?.id ? profile?.avatar_url ?? null : null}
                          viewerAvatarName={profile?.id === user?.id ? profile?.name ?? null : null}
                          isGroup={activeConversation!.is_group}
                          onRetryMedia={!item.message.media_storage_path && canMutateActiveConversation ? () => retryMediaDownload(item.message.id) : undefined}
                          messageId={item.message.id}
                          leadId={activeConversation!.lead?.id || activeConversation!.lead_id || ''}
                          leadName={activeConversation!.lead?.name || activeConversation!.contact_name || ''}
                          contactAvatarUrl={getConversationAvatarUrl(activeConversation)}
                          contactAvatarFallbackUrl={activeConversation?.contact_picture}
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
    </FloatingMessagesViewport>
    </>
  );
  const requestOwnWhatsAppStart = async () => {
    const leadId = activeConversationLeadId;
    const intent = { tenantKey: intentTenantKey, generation: intentGeneration };
    const scope = startupScope;
    const current = () => isIntentCurrent(intent) && startupScopeRef.current === scope;
    if (!canOperateWhatsApp || !leadId || !current() || ownStartNotice?.kind !== 'start' || connectedSessions.length === 0) return;
    setIsStartingConversation(true);
    try {
      const lead = await conversationLeadDetailAPI.get(leadId, activeOrganization.organizationId);
      if (!current()) return;
      const phone = normalizePhoneToE164(lead.phone);
      if (!phone) throw new Error("Cadastre um telefone válido no lead.");
      if (connectedSessions.length === 1) {
        await handleStartConversationWithSession(phone, connectedSessions[0].id, lead.name, leadId, true);
      } else {
        setPendingStartData({ phone, leadName: lead.name, leadId, ownOnly: true });
        setShowSessionSelector(true);
      }
    } catch (error) {
      if (current()) toast({ title: "Não foi possível iniciar", description: error instanceof Error ? error.message : "Confira o telefone do lead e tente novamente.", variant: "destructive" });
    } finally { if (current()) setIsStartingConversation(false); }
  };
  const renderMessageInput = (mobile = false) => {
    const activeLeadId = activeConversation?.lead?.id || activeConversation?.lead_id;
    if (activeSupervisoryView) return <div role="status" className="border-t border-[var(--app-border)] p-3 text-xs text-muted-foreground">Histórico deste lead (somente leitura)</div>;
    if (!originalOrganization) return <div role="status" className="border-t border-[var(--app-border)] p-3 text-xs text-muted-foreground">Somente leitura nesta organização. Atenda os leads na organização original do seu cadastro.</div>;
    const composerUnavailableReason = canOperateWhatsApp
      ? localReadOnly ? "read_only" : sessionsFailed ? "sessions_failed" : undefined : undefined;
    if ((ownStartNotice && !ownStartNotice.preserveComposer) || composerUnavailableReason) return (
      <div className={cn("shrink-0 border-t border-[var(--app-border)] bg-[var(--app-surface-solid)] p-3", mobile && "pb-2")}>
        <OwnWhatsAppStartNotice notice={ownStartNotice} unavailableReason={composerUnavailableReason} onRetry={() => void refetchSessions()} busy={isStartingConversation} onStart={() => void requestOwnWhatsAppStart()} />
      </div>
    );
    return (
    <div className={cn("shrink-0 border-t border-[var(--app-border)] bg-[var(--app-surface-solid)] p-3", mobile && "pb-2")} onPaste={attachments.onPaste}>
       {ownStartNotice?.preserveComposer && <OwnWhatsAppStartNotice notice={ownStartNotice} busy={isStartingConversation} onStart={() => void requestOwnWhatsAppStart()} />}
      <input key={audioContextKey} type="file" ref={fileInputRef} multiple onChange={attachments.onFileSelect} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" disabled={messageInputDisabled} />
      <AttachmentPreviewComposer attachments={attachments} />
      {replyTarget && <div role="status" className="mb-2 flex min-w-0 justify-between gap-2 border-l-2 border-primary bg-muted px-2 py-1 text-xs">
        <span className="truncate">Respondendo: {replyTarget.content || replyTarget.media_filename || "Mensagem"}</span>
        <button type="button" aria-label="Cancelar resposta citada" onClick={() => setReplySelection(null)}>×</button>
      </div>}
      <ScopedMessageBox
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
        leftActions={
          <>
            <button aria-label="Anexar arquivo" title="Anexar arquivo" type="button" onClick={() => fileInputRef.current?.click()} disabled={messageInputDisabled || sendMediaMessage.isPending}>
              <Paperclip className="w-5 h-5" aria-hidden="true" />
            </button>
            {activeLeadId && canStartAutomations && canMutateActiveConversation && !sessionsFailed && <ConversationAutomationAction
              loading={activeLeadAutomations.isPending} unavailable={activeLeadAutomations.isError}
              active={Boolean(activeLeadAutomations.data?.length)} cancelling={cancelLeadExecutions.isPending}
              onStart={() => setShowAutomationDialog(true)}
              onCancel={() => { if (activeConversationLeadId === activeLeadId) cancelLeadExecutions.mutate(activeLeadId); }} />}
          </>
        }
        audio={{ contextKey: audioContextKey, onSend: handleSendAudio,
          onResolveUnconfirmed: handleResolveAudio, disabled: audioDisabled || sendMediaMessage.isPending }}
      />
    </div>
    );
  };
  const conversationFilters = (
    <FloatingConversationFilters
      sharedFilterCount={inheritedFilterCount}
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
  const searchingConversations = searchTerm.trim() !== debouncedSearchTerm.trim()
    || (Boolean(searchTerm.trim()) && fetchingConversations);
  const ConversationList = () => <div className="flex-1 overflow-hidden min-h-0 w-full max-w-full overflow-x-hidden bg-[var(--app-surface-solid)]">
      <ScrollArea
        ref={conversationListScrollAreaRef}
        className="h-full w-full max-w-full"
      >
        <div className="flex w-full max-w-full flex-col divide-y divide-[var(--app-border)]">
          {(conversationsFailed || sessionsFailed) && Boolean(conversations?.length) && (
            <div role="status" className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
              <span>Não foi possível atualizar. Exibindo conversas já carregadas.</span>
              <Button size="sm" variant="ghost" onClick={() => void Promise.all([refetchSessions(), refetchConversations()])}>Tentar novamente</Button>
            </div>
          )}
          {searchingConversations && filteredConversations.length > 0 && <p role="status" className="px-3 py-1.5 text-[11px] font-light text-muted-foreground">Buscando conversas…</p>}
          {(loadingConversations || loadingSessions || searchingConversations) && filteredConversations.length === 0 ? <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">{searchingConversations ? "Buscando conversas" : "Carregando conversas"}</span>
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
                  previewCardRef={visibleCanonicalPreviews.previewCardRef}
                  conversation={conversation}
                  draftText={getConversationDraft(conversation.id, getWhatsAppConversationMessageScope(conversation).expectedLeadId ?? WHATSAPP_UNLINKED_LEAD_SNAPSHOT)}
                  isSelected={false}
                  currentUserId={currentUserId}
                  onClick={() => handleOpenConversationFromList(conversation)}
                  formatTime={formatConversationTime}
                  onArchive={() => handleArchiveConversation(conversation)}
                  isArchiving={archiveConversation.isPendingFor?.(conversation) ?? false}
                  isTagUpdating={(addLeadTag.isPending && addLeadTag.variables?.leadId === conversation.lead?.id)
                    || (removeLeadTag.isPending && removeLeadTag.variables?.leadId === conversation.lead?.id)}
                  onDelete={() => handleDeleteConversation(conversation)}
                  availableTags={availableTags}
                  isTagsLoading={isTagsLoading || isTagsFetching}
                  isTagsError={tagsFailed}
                  onRetryTags={() => void refetchTags()}
                  onAddTag={(tagId) => canOperateLeads && !addLeadTag.isPending && !removeLeadTag.isPending && conversation.lead && addLeadTag.mutate({
                    leadId: conversation.lead.id,
                    tagId,
                  })}
                  onRemoveTag={(tagId) => canOperateLeads && !addLeadTag.isPending && !removeLeadTag.isPending && conversation.lead && removeLeadTag.mutate({
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
                    className={CONVERSATION_LIST_UI.pagination}
                    onClick={() => void loadMoreConversations()}
                    disabled={isLoadingMoreConversations}
                  >
                    {isLoadingMoreConversations && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
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
  const phoneChangeDialog = (
    <AlertDialog open={Boolean(pendingPhoneChange && originalOrganization && canOperateWhatsApp
      && pendingPhoneChange.scope === startupScope
      && pendingPhoneChange.intent.tenantKey === intentTenantKey
      && pendingPhoneChange.intent.generation === intentGeneration
      && pendingPhoneChange.requestGeneration === visibleStartRequestGeneration)}
      onOpenChange={(open) => { if (!open && !startConversation.isPending) cancelPhoneChange(); }}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 shadow-none">
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmar novo telefone do atendimento?</AlertDialogTitle>
          <AlertDialogDescription>
            O lead já tem um atendimento neste WhatsApp. O histórico do número anterior continuará no lead.
            Ao confirmar, esse atendimento será encerrado e uma nova conversa será aberta para {pendingPhoneChange?.phone}.
            Você precisará entrar no novo atendimento antes de enviar. Nenhuma mensagem será enviada nesta confirmação.
            {pendingPhoneChange?.confirmation.requiresDestinationHistoryConfirmation
              && " A conversa já existente no novo número e seu histórico elegível serão vinculados a este lead na mesma confirmação."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {pendingPhoneChange?.confirmation.requiresDestinationHistoryConfirmation && (
          phoneChangePreviewLoading ? (
            <p className="flex items-center gap-2 text-xs" role="status"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />Conferindo histórico do novo número...</p>
          ) : phoneChangePreviewFailed || !phoneChangePreviewMatches(pendingPhoneChange) ? (
            <div className="rounded-[8px] bg-destructive/8 p-3 text-xs" role="alert">
              <p>Não foi possível validar o histórico do novo número. O atendimento anterior será preservado.</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => void loadPhoneChangePreview(pendingPhoneChange)}>Conferir novamente</Button>
            </div>
          ) : (
            <div className="space-y-1 rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-xs">
              <p>WhatsApp: {phoneChangePreview?.sessionDisplayName}</p>
              <p>Contato do novo número: {phoneChangePreview?.contactDisplayName}</p>
              <p>Mensagens preservadas: {phoneChangePreview?.eligibleMessageCount}</p>
              {phoneChangePreview?.firstEligibleAt && phoneChangePreview?.lastEligibleAt && (
                <p>Período: {new Date(phoneChangePreview.firstEligibleAt).toLocaleString("pt-BR")} até {new Date(phoneChangePreview.lastEligibleAt).toLocaleString("pt-BR")}</p>
              )}
              <p className="border-t border-[var(--app-border)] pt-2">Esse histórico ficará visível às pessoas com acesso ao lead. O histórico do número anterior continuará no lead e seu atendimento será encerrado.</p>
            </div>
          )
        )}
        {phoneChangeError && <p className="text-xs text-destructive" role="alert">{phoneChangeError}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={startConversation.isPending} onClick={cancelPhoneChange}>Cancelar</AlertDialogCancel>
          <AlertDialogAction disabled={startConversation.isPending || Boolean(pendingPhoneChange?.confirmation.requiresDestinationHistoryConfirmation && !phoneChangePreviewMatches(pendingPhoneChange))} onClick={(event) => { event.preventDefault(); void confirmPhoneChange(); }}>
            {startConversation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}
            {pendingPhoneChange?.confirmation.requiresDestinationHistoryConfirmation ? "Confirmar novo telefone e anexar histórico" : "Confirmar novo telefone"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
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
            {deleteConversation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
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
  const leadLinkConfirmationDialog = (
    <ConfirmConversationLeadLinkDialog
      open={Boolean(pendingLeadLink)}
      mode="existing"
      leadName={pendingLeadLink?.leadName}
      preview={leadLinkPreview}
      isLoading={isLeadLinkPreviewLoading}
      isConfirming={linkConversationToLead.isPending}
      hasError={leadLinkPreviewFailed}
      onOpenChange={(open) => {
        if (!open) cancelPendingLeadLink();
      }}
      onRetry={() => {
        if (pendingLeadLink) void loadPendingLeadLinkPreview(pendingLeadLink);
      }}
      onConfirm={() => void confirmPendingLeadLink()}
    />
  );

  // Mobile version - fullscreen fixed container (stable bottom input)
  if (isMobile) {
    return (
      <>
        {SessionSelectorDialog()}
        {phoneChangeDialog}
        {deleteConversationDialog}
        {enterAttendanceDialog}
        {leadLinkConfirmationDialog}
        {activeLeadId && canMutateActiveConversation && (
          <StartAutomationDialog
            open={showAutomationDialog}
            onOpenChange={setShowAutomationDialog}
            leadId={activeLeadId}
            conversationId={activeConversation?.id}
            contactName={activeContactName}
          />
        )}
        <FilterAwareMobileChatSurface minimized={presentationMinimized}
          onOpenAutoFocus={event => { event.preventDefault(); focusChatSurface(); }}
          onEscapeKeyDown={event => { handleChatEscape(event); event.preventDefault(); }}>
    <div
          id="floating-whatsapp-chat"
          ref={chatSurfaceRef}
          onFocusCapture={rememberChatFocus}
          onDragOver={attachments.onDragOver}
          onDrop={attachments.onDrop}
          role="dialog"
          aria-modal="true"
          aria-label="Chat do WhatsApp"
          tabIndex={-1}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--app-surface-solid)] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] focus:outline-none"
        >
          {FloatingChatHeader({ mobile: true })}

          {isStartingConversation && (
            <div className="absolute inset-0 bg-background/50 flex flex-col items-center justify-center z-50">
              <Loader2 className="h-8 w-8 animate-spin motion-reduce:animate-none text-primary mb-2" />
              <p className="text-xs text-muted-foreground animate-pulse motion-reduce:animate-none">Iniciando conversa...</p>
            </div>
          )}

          <div className="flex-1 flex flex-col overflow-hidden min-h-0 w-full max-w-full">
            {activeConversation ? (
              <>
                {messagesViewJsx}
                {renderMessageInput(true)}
              </>
            ) : pendingConnection || (!loadingSessions && !loadingConversations && !sessionsFailed && !conversationsFailed && !hasWhatsAppAccess && !conversations?.length) ? (
              DisconnectedState()
            ) : (
              <>
                {conversationFilters}
                {ConversationList()}
              </>
            )}
          </div>
        </div>
        </FilterAwareMobileChatSurface>
      </>
    );
  }

  // Desktop version - floating window
  return (
    <>
      {SessionSelectorDialog()}
      {phoneChangeDialog}
      {deleteConversationDialog}
      {enterAttendanceDialog}
      {leadLinkConfirmationDialog}
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
        onFocusCapture={rememberChatFocus}
        hidden={presentationMinimized}
        inert={presentationMinimized}
        aria-hidden={presentationMinimized || undefined}
        data-filter-panel-chat-minimized={presentationMinimized ? '' : undefined}
        onDragOver={attachments.onDragOver}
        onDrop={attachments.onDrop}
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
          display: presentationMinimized ? 'none' : undefined,
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
            <Loader2 className="h-8 w-8 animate-spin motion-reduce:animate-none text-primary mb-2" />
            <p className="text-xs text-muted-foreground animate-pulse motion-reduce:animate-none">Iniciando conversa...</p>
          </div>
        )}

        {activeConversation ? (
          <>
            {messagesViewJsx}
            {renderMessageInput(false)}
          </>
        ) : pendingConnection || (!loadingSessions && !loadingConversations && !sessionsFailed && !conversationsFailed && !hasWhatsAppAccess && !conversations?.length) ? (
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

function FloatingMessagesViewport({
  children,
  scrollAreaRef,
  onScroll,
  showScrollToLatest,
  onScrollToLatest,
  unreadCount = 0,
}: {
  children: React.ReactNode;
  scrollAreaRef: React.RefObject<HTMLDivElement | null>;
  onScroll: React.UIEventHandler<HTMLDivElement>;
  showScrollToLatest: boolean;
  onScrollToLatest: () => void;
  unreadCount?: number;
}) {
  return (
    <div className="relative flex-1 overflow-hidden min-h-0 flex flex-col bg-[var(--app-surface-solid)]">
      <ScrollArea ref={scrollAreaRef} className="flex-1 [&_[data-radix-scroll-area-viewport]>div]:block! [&_[data-radix-scroll-area-viewport]>div]:min-w-0! [&_[data-radix-scroll-area-viewport]>div]:w-full" onScrollCapture={onScroll}>
        {children}
      </ScrollArea>
      {showScrollToLatest && (
        <ScrollToLatestButton onClick={onScrollToLatest} unreadCount={unreadCount} />
      )}
    </div>
  );
}
