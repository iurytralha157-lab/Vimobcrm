"use client";

import { forwardRef, useState, useEffect, useRef, useMemo, useCallback } from "react";
import { MessageBox } from "@/components/ui/message-box";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Search, MessageSquare, MessageCircle, User, Loader2, MoreVertical, Archive, Trash2, Users, Paperclip, Tag, UserPlus, ArrowLeft, Zap, Plus, SlidersHorizontal, Square } from "lucide-react";
import { StartAutomationDialog } from "@/components/features/whatsapp/StartAutomationDialog";
import { MessageBubble } from "@/components/features/whatsapp/MessageBubble";
import { MessageErrorBoundary } from "@/components/features/whatsapp/MessageErrorBoundary";
import { DateSeparator, shouldShowDateSeparator } from "@/components/features/whatsapp/DateSeparator";
import { CreateLeadDialog } from "@/components/features/leads/CreateLeadDialog";
import { ConversationHeader } from "@/components/features/whatsapp/ConversationHeader";
import { ConversationLeadPanel, ConversationUnregisteredPanel } from "@/components/features/whatsapp/ConversationLeadPanel";
import { cn } from "@/lib/utils";
import { normalizeSearchText } from "@/lib/search-text";
import { format, isToday, isYesterday } from "date-fns";
import { useWhatsAppConversation, useWhatsAppConversationForLead, useWhatsAppConversations, useSendWhatsAppMessage, useReactToWhatsAppMessage, useMarkConversationAsRead, useWhatsAppLeadRealtime, useArchiveConversation, useDeleteConversation, type WhatsAppConversation, type WhatsAppMessage } from "@/hooks/use-whatsapp-conversations";
import { useWhatsAppMessagesPaginated } from "@/hooks/use-whatsapp-messages-paginated";
import { useAccessibleSessions } from "@/hooks/use-accessible-sessions";
import { resolveWhatsAppConversationSessionFilter } from "@/lib/whatsapp-query-cache";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import {
  formatWhatsAppContactLabel,
  normalizeWhatsAppContactPhoneToE164,
} from "@/lib/phone-utils";
import { useTags, Tag as TagType } from "@/hooks/use-tags";
import { useAddLeadTag, useRemoveLeadTag } from "@/hooks/use-leads";
import { useIsMobile } from "@/hooks/use-mobile";
import { AudioRecorderButton } from "@/components/features/whatsapp/AudioRecorderButton";
import { useMetaConversations, useMetaMessages, useSendMetaMessage, type MetaConversation } from "@/hooks/use-meta-conversations";
import { createUUID } from "@/lib/client-id";
import { useMetaIntegrations } from "@/hooks/use-meta-integration";
import { useMentionNames } from "@/hooks/use-mention-names";
import { whatsappAPI } from "@/lib/api/whatsapp";
import { getWhatsAppMessageInputState } from "@/lib/whatsapp-message-input";
import { groupLatestWhatsAppReactions } from "@/lib/whatsapp-reactions";
import { getTagColorStyle } from "@/lib/tag-color";
import { useAuth } from "@/contexts/AuthContext";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useCancelLeadExecutions } from "@/hooks/use-automations";
import { MAX_OUTBOUND_MESSAGE_MEDIA_BYTES } from "@/components/features/whatsapp/message-media";

const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_QUALITY = 0.82;

const mimeExtension = (mimetype: string, fallback = "bin") => {
  const clean = mimetype.split(";")[0].toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "audio/mpeg": "mp3",
    "video/mp4": "mp4",
    "application/pdf": "pdf",
  };
  return map[clean] || fallback;
};

const fileToBase64 = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const getConversationAvatarUrl = (conversation?: WhatsAppConversation | null) =>
  conversation?.lead?.whatsapp_avatar_url || conversation?.contact_picture || undefined;

const hasConversationLead = (conversation: ScreenConversation) =>
  Boolean(conversation.lead_id || conversation.lead?.id);

const getSearchDigits = (value: string) => value.replace(/\D/g, "");

const matchesConversationSearch = (conversation: ScreenConversation, rawSearch: string) => {
  const search = normalizeSearchText(rawSearch);
  if (!search) return true;

  const searchDigits = getSearchDigits(search);
  const searchableText = normalizeSearchText([
    conversation.contact_name,
    conversation.contact_phone,
    conversation.lead?.name,
    conversation.last_message,
    conversation.remote_jid,
  ]
    .filter(Boolean)
    .join(" "));

  if (searchableText.includes(search)) return true;
  if (!searchDigits) return false;

  const searchableDigits = getSearchDigits([
    conversation.contact_phone,
    conversation.remote_jid,
    conversation.last_message,
  ]
    .filter(Boolean)
    .join(" "));

  return searchableDigits.includes(searchDigits);
};

type ScreenConversation = WhatsAppConversation & {
  external_id?: string;
  platform?: MetaConversation["platform"];
};
type DisplayMessage = Pick<
  WhatsAppMessage,
  "content" | "from_me" | "id" | "media_mime_type" | "media_url" | "message_type" | "sent_at"
> &
  Partial<
    Pick<
      WhatsAppMessage,
      | "media_error"
      | "media_status"
      | "message_id"
      | "reaction_emoji"
      | "reaction_sender_jid"
      | "reaction_sender_name"
      | "reaction_to_message_id"
      | "sender_jid"
      | "sender_name"
    >
  > & {
    metadata?: Record<string, unknown>;
    status: string | null;
  };

const toScreenConversation = (conversation: MetaConversation): ScreenConversation => ({
  id: conversation.id,
  session_id: "",
  lead_id: conversation.lead_id,
  remote_jid: conversation.external_id,
  contact_name: conversation.contact_name,
  contact_phone: null,
  contact_picture: conversation.contact_picture,
  contact_presence: null,
  presence_updated_at: null,
  last_message: conversation.last_message,
  last_message_at: conversation.last_message_at,
  unread_count: conversation.unread_count,
  is_group: false,
  archived_at: conversation.is_archived ? conversation.updated_at : null,
  deleted_at: null,
  created_at: conversation.created_at,
  updated_at: conversation.updated_at,
  lead: conversation.lead ? { id: conversation.lead.id, name: conversation.lead.name } : undefined,
  external_id: conversation.external_id,
  platform: conversation.platform,
});

async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = reject;
    });
    image.src = imageUrl;
    await loaded;

    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height));
    if (scale >= 1 && file.size < 900_000) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const targetType = file.type === "image/png" ? "image/webp" : file.type;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, targetType, IMAGE_QUALITY));
    if (!blob || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.${mimeExtension(targetType, "webp")}`, { type: targetType });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

type ConversationsProps = {
  initialConversationId?: string;
  initialLeadId?: string;
};

export default function Conversations({ initialConversationId, initialLeadId }: ConversationsProps) {
  const { user, profile, organization } = useAuth();
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
  const activeTenantKey = `${currentUserId || "anonymous"}:${organization?.id || profile?.organization_id || "none"}`;
  const [activePlatform, setActivePlatform] = useState<'whatsapp' | 'instagram' | 'facebook' | 'meta'>('whatsapp');
  const [selectedSessionId, setSelectedSessionId] = useState<string>("all");
  const [selectedPageId, setSelectedPageId] = useState<string>("all");
  const [selectedConversationState, setSelectedConversationState] = useState<{
    tenantKey: string;
    conversation: ScreenConversation;
  } | null>(null);
  const selectedConversation = selectedConversationState?.tenantKey === activeTenantKey
    ? selectedConversationState.conversation
    : null;
  const setSelectedConversation = useCallback((conversation: ScreenConversation | null) => {
    setSelectedConversationState(conversation
      ? { tenantKey: activeTenantKey, conversation }
      : null);
  }, [activeTenantKey]);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [messageText, setMessageText] = useState("");
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
  const resolvedDeepLinkRef = useRef<string | null>(null);

  useEffect(() => {
    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setSelectedConversation(null);
      setSelectedSessionId("all");
      setSelectedPageId("all");
      setActivePlatform("whatsapp");
      setMessageText("");
      lastVisibleMessageIdRef.current = null;
      isUserScrollingRef.current = false;
    });
    return () => {
      isActive = false;
    };
  }, [user?.id, organization?.id, profile?.organization_id, setSelectedConversation]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const directConversationQuery = useWhatsAppConversation(initialConversationId || null);
  const leadConversationQuery = useWhatsAppConversationForLead(
    initialConversationId ? null : initialLeadId,
  );
  const deepLinkQuery = initialConversationId ? directConversationQuery : leadConversationQuery;
  const deepLinkKey = `${activeTenantKey}:${initialConversationId || ""}:${initialLeadId || ""}`;

  useEffect(() => {
    if ((!initialConversationId && !initialLeadId) || resolvedDeepLinkRef.current === deepLinkKey) return;
    if (!currentUserId || !(organization?.id || profile?.organization_id) || !deepLinkQuery.isFetched) return;

    resolvedDeepLinkRef.current = deepLinkKey;
    if (deepLinkQuery.data) {
      const conversation = deepLinkQuery.data;
      queueMicrotask(() => {
        if (resolvedDeepLinkRef.current === deepLinkKey) {
          setSelectedConversation(conversation);
        }
      });
      return;
    }

    toast({
      title: "Conversa não encontrada",
      description: deepLinkQuery.isError
        ? "Não foi possível abrir esta conversa agora. Tente novamente."
        : "Esta conversa não existe ou não está disponível para o seu acesso.",
      variant: "destructive",
    });
  }, [
    currentUserId,
    deepLinkKey,
    deepLinkQuery.data,
    deepLinkQuery.isError,
    deepLinkQuery.isFetched,
    initialConversationId,
    initialLeadId,
    organization?.id,
    profile?.organization_id,
    setSelectedConversation,
  ]);
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

  const {
    data: metaConversations,
    isLoading: loadingMetaConversations
  } = useMetaConversations(selectedPageId, { enabled: canViewMeta && activePlatform !== 'whatsapp' });

  const {
    data: metaIntegrations
  } = useMetaIntegrations({ enabled: canViewMeta && activePlatform !== 'whatsapp' });

  const selectedLeadId = activePlatform === "whatsapp"
    ? selectedConversation?.lead_id || selectedConversation?.lead?.id || null
    : selectedConversation?.lead?.id || null;
  const selectedRealtimeLeadIds = useMemo(
    () => {
      if (activePlatform !== "whatsapp" || !selectedLeadId) return [];
      return [selectedLeadId];
    },
    [activePlatform, selectedLeadId],
  );

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
    { pageSize: 50 },
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

  const messages = activePlatform === 'whatsapp' ? whatsappMessages : metaMessages;
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

  const sendMessage = useSendWhatsAppMessage();
  const reactToMessage = useReactToWhatsAppMessage();
  const sendMetaMessage = useSendMetaMessage();
  const { mutate: markConversationAsRead } = useMarkConversationAsRead();
  const archiveConversation = useArchiveConversation();
  const deleteConversation = useDeleteConversation();
  const {
    data: availableTags
  } = useTags();
  const addLeadTag = useAddLeadTag();
  const removeLeadTag = useRemoveLeadTag();
  const [createLeadOpen, setCreateLeadOpen] = useState(false);
  const [createLeadContact, setCreateLeadContact] = useState<{
    phone?: string;
    name?: string;
    conversationId?: string;
  }>({});
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
  // Loading an older cursor prepends rows but keeps the last visible message.
  // Scroll only when the newest message identity actually changes.
  useEffect(() => {
    const lastMessageId = visibleMessages.at(-1)?.id ?? null;
    if (!lastMessageId || lastMessageId === lastVisibleMessageIdRef.current) return;

    const isFirstLoad = lastVisibleMessageIdRef.current === null;
    lastVisibleMessageIdRef.current = lastMessageId;
    if (isFirstLoad || !isUserScrollingRef.current) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({
          behavior: isFirstLoad ? "instant" : "smooth"
        });
        if (isFirstLoad) isUserScrollingRef.current = false;
      }, 50);
    }
  }, [visibleMessages]);

  // Reset scroll state when changing conversations
  useEffect(() => {
    lastVisibleMessageIdRef.current = null;
    isUserScrollingRef.current = false;
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    }, 80);
  }, [selectedConversation?.id]);
  useEffect(() => {
    const selectedConversationId = selectedConversation?.id;
    const selectedConversationUnreadCount = selectedConversation?.unread_count ?? 0;
    const selectedConversationSessionId = selectedConversation?.session_id;
    const selectedConversationRemoteJid = selectedConversation?.remote_jid;
    const selectedConversationIsGroup = selectedConversation?.is_group ?? false;

    if (canOperateWhatsApp && selectedConversationId && selectedConversationSessionId && selectedConversationRemoteJid && selectedConversationUnreadCount > 0) {
      markConversationAsRead({
        id: selectedConversationId,
        session_id: selectedConversationSessionId,
        remote_jid: selectedConversationRemoteJid,
        is_group: selectedConversationIsGroup
      });
    }
  }, [canOperateWhatsApp, markConversationAsRead, selectedConversation]);
  const filteredConversations = useMemo(() => {
    let source: ScreenConversation[] = [];
    if (activePlatform === 'whatsapp') {
      source = (conversations || []) as ScreenConversation[];
      if (onlyLeads) {
        source = source.filter(hasConversationLead);
      }
      if (withoutLeadOnly) {
        source = source.filter(conv => !hasConversationLead(conv));
      }
      if (pendingReplyOnly) {
        source = source.filter(conv => (conv.unread_count ?? 0) > 0);
      }
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
    return source.filter(conv => matchesConversationSearch(conv, trimmedSearchTerm));
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
    if (activePlatform === "whatsapp" && sendMessage.isPending) return;
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
        await sendMessage.mutateAsync({
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
    } catch {
      setMessageText((current) => current || textToSend);
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
    if (whatsappMessageInputState.disabled) {
      toast({
        title: "Audio nao enviado",
        description: whatsappMessageInputState.placeholder,
        variant: "destructive",
      });
      return;
    }

    await sendMessage.mutateAsync({
      conversation: selectedConversation,
      text: "",
      mediaType: "audio",
      base64,
      mimetype,
      filename: `audio.${mimeExtension(mimetype, "webm")}`,
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
      const processedFile = await compressImageFile(file);
      if (processedFile.size > MAX_OUTBOUND_MESSAGE_MEDIA_BYTES) {
        toast({
          title: "Arquivo muito grande",
          description: "O arquivo processado ultrapassou o limite de 5 MB.",
          variant: "destructive",
        });
        e.target.value = "";
        return;
      }
      const base64Content = await fileToBase64(processedFile);

      // Determine media type
      let mediaType = "document";
      if (processedFile.type.startsWith("image/")) mediaType = "image";else if (processedFile.type.startsWith("video/")) mediaType = "video";else if (processedFile.type.startsWith("audio/")) mediaType = "audio";

      // Backend persists media in Storage and sends it through the provider.
      await sendMessage.mutateAsync({
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
    if (!canOperateWhatsApp) return;
    archiveConversation.mutate({
      conversationId: conv.id,
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
    if (!canOperateWhatsApp) return;
    setPendingDeleteConversation(conv);
  };
  const confirmDeleteConversation = async () => {
    const conversation = pendingDeleteConversation;
    if (!conversation) return;

    try {
      await deleteConversation.mutateAsync(conversation.id);
      if (selectedConversation?.id === conversation.id) {
        setSelectedConversation(null);
      }
      setPendingDeleteConversation(null);
    } catch {
      // The mutation owns the user-facing error. Keep the dialog open for retry.
    }
  };
  const formatConversationTime = (date: string | null) => {
    if (!date) return "";
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    if (isToday(d)) return format(d, "HH:mm");
    if (isYesterday(d)) return "Ontem";
    return format(d, "dd/MM");
  };
  const retryMediaDownload = async (messageId: string) => {
    try {
      await whatsappAPI.retryMediaDownload(messageId, organization?.id || profile?.organization_id);
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

  const pendingDeleteName = pendingDeleteConversation?.lead?.name
    || formatWhatsAppContactLabel(
      pendingDeleteConversation?.contact_name,
      pendingDeleteConversation?.contact_phone,
      pendingDeleteConversation?.remote_jid,
    )
    || "esta conversa";
  const deleteConversationDialog = (
    <AlertDialog
      open={!!pendingDeleteConversation}
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

  // Mobile: Show either conversation list OR chat (not both)
  if (isMobile) {
    return <AppLayout title="Conversas" disableMainScroll>
        <div className="flex h-full min-h-0 -mb-20 flex-col overflow-hidden bg-transparent">
          {selectedConversation ?
        // Mobile Chat View
        <div className="flex flex-col h-full overflow-hidden">
              {/* Mobile Chat Header */}
              <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--app-border)] bg-[var(--app-surface)] px-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Button aria-label="Voltar para a lista de conversas" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={handleBackToList}>
                    <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                  </Button>
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarImage src={getConversationAvatarUrl(selectedConversation)} />
                    <AvatarFallback className="bg-[var(--app-surface-soft)] text-[12px] font-light text-muted-foreground">
                      {selectedConversation.is_group ? <Users className="w-4 h-4" /> : (selectedConversation.contact_name || selectedConversation.contact_phone)?.[0] || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate text-foreground">
                      {selectedConversation.lead?.name || formatWhatsAppContactLabel(
                        selectedConversation.contact_name,
                        selectedConversation.contact_phone,
                        selectedConversation.remote_jid,
                      )}
                    </p>
                    {selectedConversation.contact_presence === 'composing' ? <p className="text-xs text-primary animate-pulse">digitando...</p> : selectedConversation.contact_presence === 'recording' ? <p className="text-xs text-primary animate-pulse">gravando...</p> : null}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {selectedLeadId && <Button variant="ghost" size="sm" className="h-8 text-xs px-2" asChild>
                      <Link href={`/crm/pipelines?lead=${selectedLeadId}`} aria-label="Abrir lead no pipeline">
                        <User className="w-3.5 h-3.5" aria-hidden="true" />
                      </Link>
                    </Button>}
                  {canOperateWhatsApp && <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button aria-label="Mais ações da conversa" variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="w-4 h-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-popover">
                      <DropdownMenuItem onClick={() => handleArchive(selectedConversation)}>
                        <Archive className="w-4 h-4 mr-2" />
                        {selectedConversation.archived_at ? "Desarquivar" : "Arquivar"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleDelete(selectedConversation)} className="text-destructive">
                        <Trash2 className="w-4 h-4 mr-2" />
                        Remover
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>}
                </div>
              </header>

              {/* Mobile Messages */}
              <div className="flex-1 overflow-hidden min-h-0">
                <ScrollArea className="h-full">
                  <div className="p-3 space-y-2 bg-[var(--app-background)] min-h-full">
                    {activePlatform === 'whatsapp' && hasOlderMessages && (
                      <div className="flex justify-center py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-muted-foreground"
                          onClick={() => void loadOlderMessages()}
                          disabled={isLoadingOlder}
                        >
                          {isLoadingOlder ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : null}
                          Carregar mensagens anteriores
                        </Button>
                      </div>
                    )}
                    {(loadingMessages || (fetchingMessages && visibleMessages.length === 0)) ? <div className="flex flex-col items-center justify-center gap-2 py-12" role="status" aria-live="polite">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Carregando mensagens...</span>
                      </div> : messagesFailed ? <div className="flex flex-col items-center justify-center gap-3 py-12 text-center" role="alert">
                        <MessageSquare className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                        <div>
                          <p className="text-sm font-medium">Não foi possível carregar as mensagens</p>
                          <p className="mt-1 text-xs text-muted-foreground">Tente novamente sem sair da conversa.</p>
                        </div>
                        <Button size="sm" variant="secondary" onClick={() => void refetchMessages()}>Tentar novamente</Button>
                      </div> : visibleMessages.length === 0 ? <div className="flex flex-col items-center justify-center py-12 text-center">
                        <MessageSquare className="w-8 h-8 text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">Nenhuma mensagem</p>
                      </div> : visibleMessages.map((msg, index) => {
                        const previousMsg = index > 0 ? visibleMessages[index - 1] : null;
                        const showSeparator = shouldShowDateSeparator(msg.sent_at, previousMsg?.sent_at || null);
                        return (
                          <MessageErrorBoundary key={msg.id} messageId={msg.id}>
                            {showSeparator && <DateSeparator date={new Date(msg.sent_at)} />}
                            <MessageBubble
                              content={msg.content}
                              messageType={msg.message_type}
                              mediaUrl={msg.media_url}
                              mediaMimeType={msg.media_mime_type}
                              mediaStatus={msg.media_status ?? null}
                              mediaError={msg.media_error ?? null}
                              fromMe={msg.from_me}
                              status={msg.status ?? "sent"}
                              sentAt={msg.sent_at}
                              senderName={msg.sender_name ?? null}
                              isGroup={selectedConversation.is_group}
                              onRetryMedia={canOperateWhatsApp ? () => retryMediaDownload(msg.id) : undefined}
                              messageId={msg.id}
                              leadId={canOperateLeads ? selectedLeadId || "" : ""}
                              leadName={selectedConversation.lead?.name || selectedConversation.contact_name || "Contato"}
                              contactAvatarUrl={getConversationAvatarUrl(selectedConversation)}
                              conversationRemoteJid={selectedConversation.remote_jid}
                              conversationSessionId={selectedConversation.session_id}
                              reactions={(msg.message_id ? reactionsByMessageId.get(msg.message_id) : undefined) || reactionsByMessageId.get(msg.id) || []}
                              onReact={activePlatform === 'whatsapp' && canOperateWhatsApp
                                ? (emoji) => reactToMessage.mutateAsync({
                                    conversation: selectedConversation,
                                    targetMessage: msg as WhatsAppMessage,
                                    emoji,
                                  })
                                : undefined}
                              isReacting={reactToMessage.isPending}
                            />
                          </MessageErrorBoundary>
                        );
                      })}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>
              </div>

              {/* Mobile Message Input */}
              <footer className="shrink-0 bg-[var(--app-surface-soft)] px-3 pb-3 pt-2">
                <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" />
                <MessageBox
                  value={messageText}
                  onChange={setMessageText}
                  onSend={handleSendMessage}
                  onKeyDown={handleKeyPress}
                  placeholder={messageInputPlaceholder}
                  disabled={messageInputDisabled}
                  isSending={sendMessage.isPending}
                  multiline
                  leftActions={
                    <>
                      <button aria-label="Anexar arquivo" type="button" onClick={() => fileInputRef.current?.click()} disabled={messageInputDisabled}>
                        <Paperclip className="w-5 h-5" />
                      </button>
                      {selectedLeadId && canStartAutomations && (
                        <button aria-label="Iniciar automação" type="button" onClick={() => setShowAutomationDialog(true)} title="Iniciar Automação">
                          <Zap className="w-5 h-5" />
                        </button>
                      )}
                      {selectedLeadId && canStartAutomations && (
                        <button
                          type="button"
                          onClick={() => cancelLeadExecutions.mutate(selectedLeadId)}
                          disabled={cancelLeadExecutions.isPending}
                          aria-label="Parar automação"
                          title="Parar automação"
                        >
                          {cancelLeadExecutions.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Square className="w-5 h-5" />}
                        </button>
                      )}
                    </>
                  }
                />
              </footer>
            </div> :
        // Mobile Conversation List
        <div className="flex flex-col h-full">
              {/* Mobile Header with Filters */}
              <div className="shrink-0 space-y-2 border-b border-[var(--app-border)] bg-[var(--app-surface)] p-2.5">
                <div className="flex items-center gap-2">
                  <div data-tour="conversations-channel" className="flex min-w-0 flex-1 gap-1 rounded-[6px] bg-[var(--app-surface-soft)] p-0.5">
                    <Button
                      variant={activePlatform === 'whatsapp' ? 'secondary' : 'ghost'}
                      size="sm"
                      className={cn("h-7 flex-1 gap-1.5 rounded-[6px] border-0 text-[11px] shadow-none", activePlatform === 'whatsapp' && "bg-[var(--app-surface-hover)] text-primary")}
                      onClick={() => setActivePlatform('whatsapp')}
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      <span className="text-[11px] font-medium">WhatsApp</span>
                    </Button>
                  </div>

                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        data-tour="conversations-filters"
                        variant="ghost"
                        className={cn(
                          "h-8 shrink-0 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-[12px] font-light text-foreground shadow-none hover:bg-[var(--app-surface-hover)]",
                          activeConversationFilterCount > 0 && "bg-[var(--app-surface-hover)] text-primary"
                        )}
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        <span>Filtros</span>
                        {activeConversationFilterCount > 0 && (
                          <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] leading-none text-primary-foreground">
                            {activeConversationFilterCount}
                          </span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" side="bottom" sideOffset={8} className="w-[min(90vw,300px)] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-2.5 text-[var(--app-text-primary)] shadow-none">
                      <div className="space-y-2">
                        {activePlatform === 'whatsapp' && sessions && sessions.length > 1 && (
                          <div className="space-y-1.5">
                            <span className="text-[10px] font-medium text-muted-foreground">Conta</span>
                            <Select value={currentChannelValue} onValueChange={handleChannelChange}>
                              <SelectTrigger className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] shadow-none focus:ring-0">
                                <SelectValue placeholder="Selecione a conta WhatsApp" />
                              </SelectTrigger>
                              <SelectContent className="z-[70] bg-popover">
                                <SelectGroup>
                                  <SelectItem value="whatsapp-all">Todas as contas</SelectItem>
                                  {sessions.map(session => (
                                    <SelectItem key={session.id} value={`whatsapp-${session.id}`}>
                                      {session.display_name || session.instance_name || session.phone_number}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {activePlatform === 'whatsapp' && (
                          <div className="grid gap-2">
                            <label data-tour="conversations-hide-groups" className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                              <span>Ocultar grupos</span>
                              <Checkbox className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3" checked={hideGroups} onCheckedChange={checked => setHideGroups(checked === true)} />
                            </label>
                            <label data-tour="conversations-archived" className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                              <span>Arquivadas</span>
                              <Checkbox className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3" checked={showArchived} onCheckedChange={checked => setShowArchived(checked === true)} />
                            </label>
                            <label className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                              <span>Somente leads</span>
                              <Checkbox className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3" checked={onlyLeads} onCheckedChange={checked => {
                                const next = checked === true;
                                setOnlyLeads(next);
                                if (next) setWithoutLeadOnly(false);
                              }} />
                            </label>
                            <label className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                              <span>Sem lead</span>
                              <Checkbox className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3" checked={withoutLeadOnly} onCheckedChange={checked => {
                                const next = checked === true;
                                setWithoutLeadOnly(next);
                                if (next) setOnlyLeads(false);
                              }} />
                            </label>
                            <label className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                              <span>Sem resposta</span>
                              <Checkbox className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3" checked={pendingReplyOnly} onCheckedChange={checked => setPendingReplyOnly(checked === true)} />
                            </label>
                          </div>
                        )}

                        {activeConversationFilterCount > 0 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-full rounded-[6px] border-0 bg-primary/10 px-2 text-[11px] font-medium text-primary shadow-none hover:bg-primary/15 hover:text-primary"
                            onClick={() => {
                              setSelectedSessionId("all");
                              setHideGroups(false);
                              setShowArchived(false);
                              setOnlyLeads(false);
                              setWithoutLeadOnly(false);
                              setPendingReplyOnly(false);
                            }}
                          >
                            Limpar filtros
                          </Button>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                <div data-tour="conversations-search" className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Buscar conversas"
                    placeholder={activePlatform === 'whatsapp' ? "Buscar conversas..." : "Buscar no Instagram/Meta..."}
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] py-0 pl-8 pr-3 text-xs shadow-none focus-visible:ring-1 focus-visible:ring-white/[0.09] focus-visible:ring-offset-0"
                  />
                </div>

              </div>

              {/* Mobile Conversation List */}
              <ScrollArea data-tour="conversations-list" className="flex-1">
                <div className="divide-y divide-white/[0.045]">
                  {conversationsFailed ? (
                    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                      <MessageSquare className="w-8 h-8 text-muted-foreground mb-2" />
                      <p className="text-sm font-medium mb-1">Não foi possível carregar as conversas</p>
                      <p className="text-xs text-muted-foreground mb-4">Verifique a conexão do WhatsApp e tente novamente.</p>
                      <Button size="sm" variant="secondary" onClick={() => void refetchConversations()}>
                        Tentar novamente
                      </Button>
                    </div>
                  ) : loadingConversations ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredConversations?.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                      <MessageSquare className="w-8 h-8 text-muted-foreground mb-2" />
                      {!loadingSessions && sessions?.length === 0 ? (
                        <>
                          <p className="text-sm font-medium mb-1">WhatsApp não conectado</p>
                          <p className="text-xs text-muted-foreground mb-4">Conecte sua conta para ver suas conversas.</p>
                          {canManageWhatsApp && <Button size="sm" onClick={() => router.push('/settings?tab=whatsapp')}>
                            Conectar WhatsApp
                          </Button>}
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">Nenhuma conversa encontrada</p>
                      )}
                    </div>
                  ) : (
                    filteredConversations?.map(conv => (
                      <ConversationItem
                        key={conv.id}
                        conversation={conv}
                        isSelected={false}
                        currentUserId={currentUserId}
                        onClick={() => setSelectedConversation(conv)}
                        formatTime={formatConversationTime}
                        onArchive={() => handleArchive(conv)}
                        onDelete={() => handleDelete(conv)}
                        canOperate={canOperateWhatsApp}
                        canCreateLead={canCreateLeads}
                        availableTags={availableTags || []}
                        onAddTag={tagId => conv.lead && addLeadTag.mutate({
                          leadId: conv.lead.id,
                          tagId
                        })}
                        onRemoveTag={tagId => conv.lead && removeLeadTag.mutate({
                          leadId: conv.lead.id,
                          tagId
                        })}
                        onCreateLead={() => {
                          setCreateLeadContact({
                            phone: normalizeWhatsAppContactPhoneToE164(
                              conv.contact_phone,
                              conv.remote_jid,
                            ) || undefined,
                            name: conv.contact_name || undefined,
                            conversationId: conv.id,
                          });
                          setCreateLeadOpen(true);
                        }}
                      />
                    ))
                  )}
                  {activePlatform === 'whatsapp' && !loadingConversations && !conversationsFailed && hasMoreConversations && (
                    <div className="flex justify-center p-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isLoadingMoreConversations}
                        onClick={() => void loadMoreConversations()}
                      >
                        {isLoadingMoreConversations && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                        Carregar mais conversas
                      </Button>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>}
        </div>

        {canCreateLeads && <CreateLeadDialog open={createLeadOpen} onOpenChange={setCreateLeadOpen} contactPhone={createLeadContact.phone} contactName={createLeadContact.name} conversationId={createLeadContact.conversationId} />}
        {selectedLeadId && selectedConversation && (
          <StartAutomationDialog
            open={showAutomationDialog}
            onOpenChange={setShowAutomationDialog}
            leadId={selectedLeadId}
            conversationId={selectedConversation.id}
            contactName={selectedConversation.lead?.name || selectedConversation.contact_name || "Contato"}
          />
        )}
        {deleteConversationDialog}
      </AppLayout>;
  }

  // Desktop Layout
  return <AppLayout title="Conversas" disableMainScroll>
      <div className="relative flex h-full min-h-0 gap-3 overflow-hidden">
        {/* Sidebar */}
        <aside data-tour="conversations-overview" className="app-card flex w-[365px] min-w-[365px] max-w-[365px] flex-col overflow-hidden">
          {/* Header com filtros */}
          <div className="space-y-2 border-b border-[var(--app-border)] bg-[var(--app-surface)] p-2.5">
            <div className="flex items-center gap-2">
              <div data-tour="conversations-channel" className="flex min-w-0 flex-1 gap-1 rounded-[6px] bg-[var(--app-surface-soft)] p-0.5">
                <Button
                  variant={activePlatform === 'whatsapp' ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn("h-7 flex-1 gap-1.5 rounded-[6px] border-0 text-[11px] shadow-none", activePlatform === 'whatsapp' && "bg-[var(--app-surface-hover)] text-primary")}
                  onClick={() => setActivePlatform('whatsapp')}
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-medium">WhatsApp</span>
                </Button>
              </div>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    data-tour="conversations-filters"
                    variant="ghost"
                    className={cn(
                      "h-8 shrink-0 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-[12px] font-light text-foreground shadow-none hover:bg-[var(--app-surface-hover)]",
                      activeConversationFilterCount > 0 && "bg-[var(--app-surface-hover)] text-primary"
                    )}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span>Filtros</span>
                    {activeConversationFilterCount > 0 && (
                      <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] leading-none text-primary-foreground">
                        {activeConversationFilterCount}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" side="right" sideOffset={10} className="w-[260px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-2.5 text-[var(--app-text-primary)] shadow-none">
                  <div className="space-y-2">
                    {activePlatform === 'whatsapp' && sessions && sessions.length > 1 && (
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-medium text-muted-foreground">Conta</span>
                        <Select value={currentChannelValue} onValueChange={handleChannelChange}>
                          <SelectTrigger className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] shadow-none focus:ring-0">
                            <SelectValue placeholder="Selecione a conta WhatsApp" />
                          </SelectTrigger>
                          <SelectContent className="z-[70] bg-popover">
                            <SelectGroup>
                              <SelectItem value="whatsapp-all">Todas as contas</SelectItem>
                              {sessions.map(session => (
                                <SelectItem key={session.id} value={`whatsapp-${session.id}`}>
                                  {session.display_name || session.instance_name || session.phone_number}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {activePlatform === 'whatsapp' && (
                      <div className="grid gap-2">
                        <label data-tour="conversations-hide-groups" className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                          <span>Ocultar grupos</span>
                          <Checkbox className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3" checked={hideGroups} onCheckedChange={checked => setHideGroups(checked === true)} />
                        </label>
                        <label data-tour="conversations-archived" className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                          <span>Arquivadas</span>
                          <Checkbox className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3" checked={showArchived} onCheckedChange={checked => setShowArchived(checked === true)} />
                        </label>
                        <label className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                          <span>Somente leads</span>
                          <Checkbox className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3" checked={onlyLeads} onCheckedChange={checked => {
                            const next = checked === true;
                            setOnlyLeads(next);
                            if (next) setWithoutLeadOnly(false);
                          }} />
                        </label>
                        <label className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                          <span>Sem lead</span>
                          <Checkbox className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3" checked={withoutLeadOnly} onCheckedChange={checked => {
                            const next = checked === true;
                            setWithoutLeadOnly(next);
                            if (next) setOnlyLeads(false);
                          }} />
                        </label>
                        <label className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[11px]">
                          <span>Sem resposta</span>
                          <Checkbox className="h-3.5 w-3.5 rounded-[4px] border-primary/70 [&_svg]:h-3 [&_svg]:w-3" checked={pendingReplyOnly} onCheckedChange={checked => setPendingReplyOnly(checked === true)} />
                        </label>
                      </div>
                    )}

                    {activeConversationFilterCount > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-full rounded-[6px] border-0 bg-primary/10 px-2 text-[11px] font-medium text-primary shadow-none hover:bg-primary/15 hover:text-primary"
                        onClick={() => {
                          setSelectedSessionId("all");
                          setHideGroups(false);
                          setShowArchived(false);
                          setOnlyLeads(false);
                          setWithoutLeadOnly(false);
                          setPendingReplyOnly(false);
                        }}
                      >
                        Limpar filtros
                      </Button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              {false && activePlatform === 'whatsapp' && (sessions?.length ?? 0) > 1 && (
                <Select value={currentChannelValue} onValueChange={handleChannelChange}>
                  <SelectTrigger className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light focus:ring-0">
                    <SelectValue placeholder="Selecione a conta WhatsApp" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    <SelectGroup>
                      <SelectItem value="whatsapp-all">Todas as contas WhatsApp</SelectItem>
                      {(sessions ?? []).map(session => (
                        <SelectItem key={session.id} value={`whatsapp-${session.id}`}>
                          {session.display_name || session.instance_name || session.phone_number}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}

              {false && activePlatform !== 'whatsapp' && (metaIntegrations?.length ?? 0) > 1 && (
                <Select value={currentChannelValue} onValueChange={handleChannelChange}>
                  <SelectTrigger className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light focus:ring-0">
                    <SelectValue placeholder="Selecione a página" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    <SelectGroup>
                      <SelectItem value="meta-all">Todas as páginas</SelectItem>
                      {(metaIntegrations ?? []).map(integration => (
                        <SelectItem key={integration.id} value={`meta-${integration.page_id}`}>
                          {integration.page_name || integration.page_id}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            </div>

            <div data-tour="conversations-search" className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Buscar conversas"
                placeholder={activePlatform === 'whatsapp' ? "Buscar conversas..." : "Buscar no Instagram/Meta..."}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] py-0 pl-8 pr-3 text-xs shadow-none focus-visible:ring-1 focus-visible:ring-white/[0.09] focus-visible:ring-offset-0"
              />
            </div>

            {false && activePlatform === 'whatsapp' && (
              <div className="flex items-center justify-between gap-2">
                <label data-tour="conversations-hide-groups" className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <Checkbox checked={hideGroups} onCheckedChange={checked => setHideGroups(checked === true)} />
                  <span>Ocultar grupos</span>
                </label>
                <label data-tour="conversations-archived" className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <Checkbox checked={showArchived} onCheckedChange={checked => setShowArchived(checked === true)} />
                  <span>Arquivadas</span>
                </label>
              </div>
            )}
          </div>
          {/* Lista de conversas */}
          <ScrollArea data-tour="conversations-list" className="flex-1">
            <div className="divide-y divide-white/[0.045]">
              {activePlatform === 'whatsapp' ? (
                conversationsFailed ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <MessageSquare className="w-8 h-8 text-muted-foreground mb-2" />
                    <p className="text-sm font-medium mb-1">Não foi possível carregar as conversas</p>
                    <p className="text-xs text-muted-foreground mb-4">Verifique a conexão do WhatsApp e tente novamente.</p>
                    <Button size="sm" variant="secondary" onClick={() => void refetchConversations()}>
                      Tentar novamente
                    </Button>
                  </div>
                ) : loadingConversations ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredConversations?.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4">
                    <MessageSquare className="w-8 h-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">Nenhuma conversa no WhatsApp</p>
                  </div>
                ) : (
                  filteredConversations?.map(conv => (
                    <ConversationItem
                      key={conv.id}
                      conversation={conv}
                      isSelected={selectedConversation?.id === conv.id}
                      currentUserId={currentUserId}
                      onClick={() => setSelectedConversation(conv)}
                      formatTime={formatConversationTime}
                      onArchive={() => handleArchive(conv)}
                      onDelete={() => handleDelete(conv)}
                      canOperate={canOperateWhatsApp}
                      canCreateLead={canCreateLeads}
                      availableTags={availableTags || []}
                      onAddTag={tagId => conv.lead && addLeadTag.mutate({
                        leadId: conv.lead.id,
                        tagId
                      })}
                      onRemoveTag={tagId => conv.lead && removeLeadTag.mutate({
                        leadId: conv.lead.id,
                        tagId
                      })}
                      onCreateLead={() => {
                        setCreateLeadContact({
                          phone: normalizeWhatsAppContactPhoneToE164(
                            conv.contact_phone,
                            conv.remote_jid,
                          ) || undefined,
                          name: conv.contact_name || undefined,
                          conversationId: conv.id,
                        });
                        setCreateLeadOpen(true);
                      }}
                    />
                  ))
                )
              ) : (
                loadingMetaConversations ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : metaConversations?.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <MessageSquare className="w-8 h-8 text-muted-foreground mb-2 opacity-20" />
                    <p className="text-sm text-muted-foreground">Nenhuma conversa no Instagram/Meta</p>
                    <p className="text-xs text-muted-foreground mt-1">Conecte sua conta nas configurações para começar.</p>
                  </div>
                ) : (
                  metaConversations?.map((conv) => {
                    const screenConversation = toScreenConversation(conv);
                    return (
                      <ConversationItem
                        key={conv.id}
                        conversation={screenConversation}
                        isSelected={selectedConversation?.id === conv.id}
                        currentUserId={currentUserId}
                        onClick={() => setSelectedConversation(screenConversation)}
                        formatTime={formatConversationTime}
                        onArchive={() => {}}
                        onDelete={() => {}}
                        availableTags={availableTags || []}
                        onAddTag={() => {}}
                        onRemoveTag={() => {}}
                        onCreateLead={() => {}}
                        canOperate={false}
                        canCreateLead={false}
                      />
                    );
                  })
                  )
              )}
              {activePlatform === 'whatsapp' && !loadingConversations && !conversationsFailed && hasMoreConversations && (
                <div className="flex justify-center p-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isLoadingMoreConversations}
                    onClick={() => void loadMoreConversations()}
                  >
                    {isLoadingMoreConversations && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                    Carregar mais conversas
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </aside>

        {/* Chat Area */}
        <main data-tour="conversations-chat" className="app-card flex min-w-0 flex-1 flex-col overflow-hidden">
          {selectedConversation ? <>
              {/* Header do chat */}
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
                canOperate={canOperateWhatsApp}
                onCreateLead={canCreateLeads ? () => {
                  setCreateLeadContact({
                    phone: normalizeWhatsAppContactPhoneToE164(
                      selectedConversation.contact_phone,
                      selectedConversation.remote_jid,
                    ) || undefined,
                    name: selectedConversation.contact_name || undefined,
                    conversationId: selectedConversation.id,
                  });
                  setCreateLeadOpen(true);
                } : undefined}
                onToggleLeadPanel={() => setShowLeadPanel(prev => !prev)}
                showLeadPanel={showLeadPanel}
              />

              {/* Mensagens */}
              <div data-tour="conversations-messages" className="flex-1 overflow-hidden min-h-0">
                <ScrollArea className="h-full" onScrollCapture={(e: React.UIEvent<HTMLDivElement>) => {
                  const target = e.currentTarget.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]') || e.currentTarget;
                  if (target) {
                    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 50;
                    isUserScrollingRef.current = !isAtBottom;
                  }
                }}>
                  <div className="space-y-2 bg-[var(--app-surface-soft)] p-4">
                    {activePlatform === 'whatsapp' && hasOlderMessages && (
                      <div className="flex justify-center py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-muted-foreground"
                          onClick={() => void loadOlderMessages()}
                          disabled={isLoadingOlder}
                        >
                          {isLoadingOlder ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                          Carregar mensagens anteriores
                        </Button>
                      </div>
                    )}
                    {(loadingMessages || (fetchingMessages && visibleMessages.length === 0)) ? <div className="flex flex-col items-center justify-center gap-2 py-12" role="status" aria-live="polite">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Carregando mensagens...</span>
                      </div> : messagesFailed ? <div className="flex flex-col items-center justify-center gap-3 py-12 text-center" role="alert">
                        <MessageSquare className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                        <div>
                          <p className="text-sm font-medium">Não foi possível carregar as mensagens</p>
                          <p className="mt-1 text-xs text-muted-foreground">Tente novamente sem sair da conversa.</p>
                        </div>
                        <Button size="sm" variant="secondary" onClick={() => void refetchMessages()}>Tentar novamente</Button>
                      </div> : visibleMessages.length === 0 ? <div className="flex flex-col items-center justify-center py-12">
                        <MessageSquare className="w-8 h-8 text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">Nenhuma mensagem</p>
                      </div> : visibleMessages.map((msg, index) => {
                        const previousMsg = index > 0 ? visibleMessages[index - 1] : null;
                        const showSeparator = shouldShowDateSeparator(msg.sent_at, previousMsg?.sent_at || null);
                        return (
                          <MessageErrorBoundary key={msg.id} messageId={msg.id}>
                            {showSeparator && <DateSeparator date={new Date(msg.sent_at)} />}
                            <MessageBubble
                              content={msg.content}
                              messageType={msg.message_type}
                              mediaUrl={msg.media_url}
                              mediaMimeType={msg.media_mime_type}
                              mediaStatus={msg.media_status ?? null}
                              mediaError={msg.media_error ?? null}
                              fromMe={msg.from_me}
                              status={msg.status ?? "sent"}
                              sentAt={msg.sent_at}
                              senderName={msg.sender_name ?? null}
                              isGroup={selectedConversation.is_group}
                              onRetryMedia={canOperateWhatsApp ? () => retryMediaDownload(msg.id) : undefined}
                              messageId={msg.id}
                              leadId={canOperateLeads ? selectedLeadId || "" : ""}
                              leadName={selectedConversation.lead?.name || selectedConversation.contact_name || "Contato"}
                              contactAvatarUrl={getConversationAvatarUrl(selectedConversation)}
                              conversationRemoteJid={selectedConversation.remote_jid}
                              conversationSessionId={selectedConversation.session_id}
                              reactions={(msg.message_id ? reactionsByMessageId.get(msg.message_id) : undefined) || reactionsByMessageId.get(msg.id) || []}
                              onReact={activePlatform === 'whatsapp' && canOperateWhatsApp
                                ? (emoji) => reactToMessage.mutateAsync({
                                    conversation: selectedConversation,
                                    targetMessage: msg as WhatsAppMessage,
                                    emoji,
                                  })
                                : undefined}
                              isReacting={reactToMessage.isPending}
                            />
                          </MessageErrorBoundary>
                        );
                      })}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>
              </div>

              {/* Input de mensagem */}
              <footer data-tour="conversations-composer" className="shrink-0 bg-[var(--app-surface-soft)] px-3 pb-3 pt-2">
                <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" />
                <MessageBox
                  value={messageText}
                  onChange={setMessageText}
                  onSend={handleSendMessage}
                  onKeyDown={handleKeyPress}
                  placeholder={messageInputPlaceholder}
                  disabled={messageInputDisabled}
                  isSending={sendMessage.isPending}
                  multiline
                  showRightActionsWhenEmpty
                  leftActions={
                    <>
                      <button aria-label="Anexar arquivo" type="button" onClick={() => fileInputRef.current?.click()} disabled={messageInputDisabled}>
                        <Paperclip className="w-5 h-5" />
                      </button>
                      {selectedLeadId && canStartAutomations && (
                        <button aria-label="Iniciar automação" type="button" onClick={() => setShowAutomationDialog(true)} title="Iniciar Automação">
                          <Zap className="w-5 h-5" />
                        </button>
                      )}
                      {selectedLeadId && canStartAutomations && (
                        <button
                          type="button"
                          onClick={() => cancelLeadExecutions.mutate(selectedLeadId)}
                          disabled={cancelLeadExecutions.isPending}
                          aria-label="Parar automação"
                          title="Parar automação"
                        >
                          {cancelLeadExecutions.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Square className="w-5 h-5" />}
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
              </footer>
            </> : (
              <div className="flex flex-1 flex-col items-center justify-center bg-[var(--app-surface-soft)] p-6 text-center text-muted-foreground">
                <MessageCircle className="mb-4 h-24 w-24 opacity-30" />
                {!loadingSessions && sessions?.length === 0 ? (
                  <>
                    <p className="mb-2 text-[14px] font-normal text-foreground">WhatsApp ainda não conectado</p>
                    <p className="mb-4 max-w-sm text-[12px] font-light">
                      Para começar a receber e enviar mensagens, conecte sua conta do WhatsApp escaneando o QR Code.
                    </p>
                    <ol className="text-xs text-left max-w-sm mb-6 space-y-1.5 list-decimal list-inside text-muted-foreground">
                      <li>Clique no botão abaixo para abrir as configurações.</li>
                      <li>Crie uma nova sessão e escaneie o QR Code com seu celular.</li>
                      <li>Aguarde alguns segundos até o status ficar como &quot;Conectado&quot;.</li>
                    </ol>
                    {canManageWhatsApp && <Button onClick={() => router.push('/settings?tab=whatsapp')}>
                      <Plus className="w-4 h-4 mr-2" />
                      Conectar WhatsApp agora
                    </Button>}
                    <button
                      type="button"
                      onClick={() => router.push('/suporte')}
                      className="text-xs text-muted-foreground underline mt-3 hover:text-foreground"
                    >
                      Preciso de ajuda para conectar
                    </button>
                  </>
                ) : (
                  <>
                    <p className="font-medium">Selecione uma conversa</p>
                    <p className="text-sm">para começar a enviar mensagens</p>
                  </>
                )}
              </div>
            )}
        </main>

        {/* Lead Side Panel - Desktop only */}
        {selectedConversation && showLeadPanel && (
          selectedLeadId ? (
            <ConversationLeadPanel
              leadId={selectedLeadId}
              onClose={() => setShowLeadPanel(false)}
              contactPicture={getConversationAvatarUrl(selectedConversation)}
              className="absolute inset-y-0 right-0 z-30 w-[330px] min-w-[330px] max-w-[330px] shrink-0 animate-in slide-in-from-right-5 duration-300 xl:static xl:z-auto"
            />
          ) : !selectedConversation.is_group && canCreateLeads ? (
            <ConversationUnregisteredPanel
              contactName={selectedConversation.contact_name}
              contactPhone={normalizeWhatsAppContactPhoneToE164(
                selectedConversation.contact_phone,
                selectedConversation.remote_jid,
              )}
              contactPicture={getConversationAvatarUrl(selectedConversation)}
              onClose={() => setShowLeadPanel(false)}
              onCreateLead={() => {
                setCreateLeadContact({
                  phone: normalizeWhatsAppContactPhoneToE164(
                    selectedConversation.contact_phone,
                    selectedConversation.remote_jid,
                  ) || undefined,
                  name: selectedConversation.contact_name || undefined,
                  conversationId: selectedConversation.id,
                });
                setCreateLeadOpen(true);
              }}
              className="absolute inset-y-0 right-0 z-30 w-[330px] min-w-[330px] max-w-[330px] shrink-0 animate-in slide-in-from-right-5 duration-300 xl:static xl:z-auto"
            />
          ) : null
        )}
      </div>

      {canCreateLeads && <CreateLeadDialog open={createLeadOpen} onOpenChange={setCreateLeadOpen} contactPhone={createLeadContact.phone} contactName={createLeadContact.name} conversationId={createLeadContact.conversationId} />}
      {selectedLeadId && selectedConversation && (
        <StartAutomationDialog
          open={showAutomationDialog}
          onOpenChange={setShowAutomationDialog}
          leadId={selectedLeadId}
          conversationId={selectedConversation.id}
          contactName={selectedConversation.lead?.name || selectedConversation.contact_name || "Contato"}
        />
      )}
      {deleteConversationDialog}
    </AppLayout>;
}
const ConversationChip = forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ children, className, title, style, ...props }, ref) => (
    <span
      ref={ref}
      title={title}
      className={cn(
        "inline-flex h-[17px] shrink-0 items-center justify-center rounded-[4px] border-0 px-1.5 text-[9px] font-medium leading-none shadow-none",
        className
      )}
      style={style}
      {...props}
    >
      {children}
    </span>
  )
);
ConversationChip.displayName = "ConversationChip";

function ConversationItem({
  conversation,
  isSelected,
  currentUserId,
  onClick,
  formatTime,
  onArchive,
  onDelete,
  availableTags,
  onAddTag,
  onRemoveTag,
  onCreateLead,
  canOperate,
  canCreateLead,
}: {
  conversation: WhatsAppConversation;
  isSelected: boolean;
  currentUserId?: string | null;
  onClick: () => void;
  formatTime: (date: string | null) => string;
  onArchive: () => void;
  onDelete: () => void;
  availableTags: TagType[];
  onAddTag: (tagId: string) => void;
  onRemoveTag: (tagId: string) => void;
  onCreateLead: () => void;
  canOperate: boolean;
  canCreateLead: boolean;
}) {
  const hasLead = Boolean(conversation.lead_id || conversation.lead?.id);
  const leadTags = conversation.lead?.tags || [];
  const leadTagIds = leadTags.map(lt => lt.tag.id);
  const unassignedTags = availableTags.filter(t => !leadTagIds.includes(t.id));
  const displayName = conversation.lead?.name || formatWhatsAppContactLabel(
    conversation.contact_name,
    conversation.contact_phone,
    conversation.remote_jid,
  );
  const otherAssignee = currentUserId && conversation.lead?.assignee?.id && conversation.lead.assignee.id !== currentUserId
    ? conversation.lead.assignee
    : null;
  const otherAssigneeName = otherAssignee?.name || null;
  const formatPreviewMessage = (message: string | null) => {
    if (!message) return "Sem mensagens";
    const trimmed = message.trim();
    if (/^[a-f0-9-]{36}\.(png|jpg|jpeg|gif|webp|mp4|mp3|ogg|opus|pdf|doc|docx|xls|xlsx|csv|avi|mov|aac|m4a|wav|heic)$/i.test(trimmed) || /^\S+\.(png|jpg|jpeg|gif|webp|mp4|mp3|ogg|opus|pdf|doc|docx|xls|xlsx|csv|avi|mov|aac|m4a|wav|heic)$/i.test(trimmed)) {
      const ext = trimmed.split('.').pop()?.toLowerCase() || '';
      if (['png','jpg','jpeg','gif','webp','heic'].includes(ext)) return 'Foto';
      if (['mp4','avi','mov'].includes(ext)) return 'Vídeo';
      if (['mp3','ogg','opus','aac','m4a','wav'].includes(ext)) return 'Áudio';
      return 'Documento';
    }
    return message;
  };
  const previewMessage = formatPreviewMessage(conversation.last_message);
  const previewMentionDigits = (previewMessage.match(/@\d{7,}/g) || []).map((mention) => mention.slice(1));
  const previewMentionNames = useMentionNames(previewMentionDigits, {
    groupJid: conversation.is_group ? conversation.remote_jid : null,
    sessionId: conversation.is_group ? conversation.session_id : null,
  });
  const previewMessageWithNames = previewMentionDigits.reduce(
    (text, digits) => text.replaceAll(`@${digits}`, `@${previewMentionNames[digits] || digits}`),
    previewMessage,
  );

  return <div data-tour="conversations-item" className={cn("group grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 overflow-hidden p-2 text-left transition-colors hover:bg-[var(--app-surface-hover)]", isSelected && "bg-[var(--app-surface-soft)]")}>
      <button type="button" onClick={onClick} aria-current={isSelected ? "true" : undefined} className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
        <Avatar className="h-9 w-9 shrink-0 relative">
          <AvatarImage src={getConversationAvatarUrl(conversation)} />
          <AvatarFallback className="bg-[var(--app-surface-soft)] text-[12px] font-light text-muted-foreground">
            {conversation.is_group ? <Users className="w-4 h-4" /> : displayName?.[0]?.toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>

        <div className="w-0 min-w-0 flex-1">
          <div className="flex min-w-0 items-center">
            <span className="block min-w-0 truncate text-left font-sans text-[12px] font-normal leading-[17px] text-foreground" title={displayName}>
              {displayName}
            </span>
          </div>

          {/* Mensagem ou Presença */}
          <div className="mt-0 flex min-w-0 items-center">
            {conversation.contact_presence === 'composing' ? <span className="text-[11px] text-primary truncate flex-1 text-left animate-pulse">
                digitando...
              </span> : conversation.contact_presence === 'recording' ? <span className="text-[11px] text-primary truncate flex-1 text-left animate-pulse">
                Gravando áudio...
              </span> : <span className="text-[11px] text-muted-foreground truncate flex-1 text-left">
                {previewMessageWithNames}
              </span>}
          </div>

        </div>
      </button>

      <div className="flex max-w-[176px] shrink-0 flex-col items-end justify-center gap-1 overflow-hidden">
        <div className="flex max-w-full items-center justify-end gap-1 overflow-hidden">
          {hasLead && (
            <ConversationChip className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" title="Lead">
              Lead
            </ConversationChip>
          )}
          {otherAssigneeName && (
            <TooltipProvider delayDuration={120}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ConversationChip className="max-w-[90px] bg-amber-500/15 text-amber-700 dark:text-amber-300">
                    <span className="truncate">{otherAssigneeName}</span>
                  </ConversationChip>
                </TooltipTrigger>
                <TooltipContent side="top" align="end" className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-2 shadow-none">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={otherAssignee?.avatar_url || undefined} />
                      <AvatarFallback className="bg-amber-500/15 text-[10px] text-amber-700 dark:text-amber-300">
                        {otherAssigneeName[0]?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="max-w-[150px] truncate text-xs font-medium">{otherAssigneeName}</p>
                      <p className="text-[10px] text-muted-foreground">Responsavel pelo lead</p>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {leadTags.slice(0, 1).map(lt => (
            <ConversationChip
              key={lt.tag.id}
              className="max-w-[62px]"
              title={lt.tag.name}
              style={getTagColorStyle(lt.tag.color)}
            >
              <span className="truncate">{lt.tag.name}</span>
            </ConversationChip>
          ))}
          {leadTags.length > 1 && (
            <span className="inline-flex h-[18px] shrink-0 items-center text-[9px] leading-none text-muted-foreground">
              +{leadTags.length - 1}
            </span>
          )}
          {conversation.unread_count > 0 && <span className="inline-flex h-[19px] min-w-[22px] items-center justify-center rounded-[6px] bg-primary/50 px-1.5 text-[10px] font-normal leading-none text-primary-foreground">
              {conversation.unread_count}
            </span>}
        </div>
        <span className="whitespace-nowrap text-[10px] leading-none text-muted-foreground">
          {formatTime(conversation.last_message_at)}
        </span>
      </div>

      {canOperate && <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label={`Mais ações de ${displayName || "conversa"}`} variant="ghost" size="icon" className="h-7 w-7 shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100">
            <MoreVertical className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-popover">
          {/* Tag submenu - only show if conversation has a lead */}
          {conversation.lead && <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Tag className="w-4 h-4 mr-2" />
                Tag
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="bg-popover">
                {leadTags.length > 0 && <>
                    <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Tags atuais</div>
                    {leadTags.map(lt => <DropdownMenuItem key={lt.tag.id} onClick={() => onRemoveTag(lt.tag.id)} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{
                  backgroundColor: lt.tag.color
                }} />
                        <span>{lt.tag.name}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">remover</span>
                      </DropdownMenuItem>)}
                    <DropdownMenuSeparator />
                  </>}
                {unassignedTags.length > 0 ? <>
                    <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Adicionar tag</div>
                    {unassignedTags.map(tag => <DropdownMenuItem key={tag.id} onClick={() => onAddTag(tag.id)} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{
                  backgroundColor: tag.color
                }} />
                        <span>{tag.name}</span>
                      </DropdownMenuItem>)}
                  </> : <div className="px-2 py-1 text-xs text-muted-foreground">
                    Nenhuma tag disponível
                  </div>}
              </DropdownMenuSubContent>
            </DropdownMenuSub>}
          {/* Create Lead option - only show if no lead associated */}
          {!hasLead && canCreateLead && <DropdownMenuItem onClick={onCreateLead}>
              <UserPlus className="w-4 h-4 mr-2" />
              Criar Lead
            </DropdownMenuItem>}
          <DropdownMenuItem onClick={onArchive}>
            <Archive className="w-4 h-4 mr-2" />
            {conversation.archived_at ? "Desarquivar" : "Arquivar"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} className="text-destructive">
            <Trash2 className="w-4 h-4 mr-2" />
            Remover
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>}
    </div>;
}
