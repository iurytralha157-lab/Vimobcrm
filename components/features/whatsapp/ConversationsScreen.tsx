"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { MessageBox } from "@/components/ui/message-box";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "@/components/ui/dropdown-menu";
import { Search, MessageSquare, MessageCircle, User, Loader2, MoreVertical, Archive, Trash2, Users, Paperclip, Tag, UserPlus, ArrowLeft, ExternalLink, Zap, Plus } from "lucide-react";
import { StartAutomationDialog } from "@/components/features/whatsapp/StartAutomationDialog";
import { MessageBubble } from "@/components/features/whatsapp/MessageBubble";
import { MessageErrorBoundary } from "@/components/features/whatsapp/MessageErrorBoundary";
import { DateSeparator, shouldShowDateSeparator } from "@/components/features/whatsapp/DateSeparator";
import { CreateLeadDialog } from "@/components/features/conversations/CreateLeadDialog";
import { ConversationHeader } from "@/components/features/whatsapp/ConversationHeader";
import { ConversationLeadPanel } from "@/components/features/whatsapp/ConversationLeadPanel";
import { cn } from "@/lib/utils";
import { format, isToday, isYesterday } from "date-fns";
import { useWhatsAppConversations, useWhatsAppMessages, useSendWhatsAppMessage, useMarkConversationAsRead, useWhatsAppRealtimeConversations, useArchiveConversation, useDeleteConversation, type WhatsAppConversation, type WhatsAppMessage } from "@/hooks/use-whatsapp-conversations";
import { useAccessibleSessions } from "@/hooks/use-accessible-sessions";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { formatPhoneForDisplay } from "@/lib/phone-utils";
import { useTags, Tag as TagType } from "@/hooks/use-tags";
import { useAddLeadTag, useRemoveLeadTag } from "@/hooks/use-leads";
import { useIsMobile } from "@/hooks/use-mobile";
import { AudioRecorderButton } from "@/components/features/whatsapp/AudioRecorderButton";
import { useMetaConversations, useMetaMessages, useSendMetaMessage, type MetaConversation } from "@/hooks/use-meta-conversations";
import { useMetaIntegrations } from "@/hooks/use-meta-integration";
import { useMentionNames } from "@/hooks/use-mention-names";
import { whatsappAPI } from "@/lib/api/whatsapp";

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
      | "reaction_sender_name"
      | "reaction_to_message_id"
      | "sender_name"
    >
  > & {
    metadata?: Record<string, unknown>;
    status: string | null;
  };

const getMetadataString = (metadata: Record<string, unknown> | undefined, key: string) => {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
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

export default function Conversations() {
  const isMobile = useIsMobile();
  const router = useRouter();
  const [activePlatform, setActivePlatform] = useState<'whatsapp' | 'instagram' | 'facebook'>('whatsapp');
  const [selectedSessionId, setSelectedSessionId] = useState<string>("all");
  const [selectedPageId, setSelectedPageId] = useState<string>("all");
  const [selectedConversation, setSelectedConversation] = useState<ScreenConversation | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [messageLimit, setMessageLimit] = useState(50);
  const [messageText, setMessageText] = useState("");
  const [hideGroups, setHideGroups] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("whatsapp-hide-groups") === "true";
  });
  const [showArchived, setShowArchived] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("whatsapp-show-archived") === "true";
  });
  const [showAutomationDialog, setShowAutomationDialog] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previousMessagesLengthRef = useRef<number>(0);
  const isUserScrollingRef = useRef<boolean>(false);
  const {
    data: sessions,
    isLoading: loadingSessions,
  } = useAccessibleSessions();

  // Extract accessible session IDs for filtering
  const accessibleSessionIds = sessions?.map(s => s.id) || [];

  const {
    data: conversations,
    isLoading: loadingConversations
  } = useWhatsAppConversations(
    selectedSessionId === "all" ? undefined : selectedSessionId,
    { hideGroups, showArchived },
    selectedSessionId === "all" ? (loadingSessions ? undefined : accessibleSessionIds) : undefined
  );

  const {
    data: metaConversations,
    isLoading: loadingMetaConversations
  } = useMetaConversations(selectedPageId);

  const {
    data: metaIntegrations
  } = useMetaIntegrations();

  const selectedLeadId = activePlatform === "whatsapp"
    ? selectedConversation?.lead_id || selectedConversation?.lead?.id || null
    : selectedConversation?.lead?.id || null;

  const {
    data: whatsappMessages,
    isLoading: loadingWhatsAppMessages,
    isFetching: fetchingWhatsAppMessages
  } = useWhatsAppMessages(
    activePlatform === 'whatsapp' ? selectedConversation?.id || null : null,
    activePlatform === 'whatsapp' ? selectedLeadId : null,
    messageLimit
  );

  const {
    data: metaMessages,
    isLoading: loadingMetaMessages
  } = useMetaMessages(activePlatform !== 'whatsapp' ? selectedConversation?.id || null : null);

  const messages = activePlatform === 'whatsapp' ? whatsappMessages : metaMessages;
  const loadingMessages = activePlatform === 'whatsapp' ? loadingWhatsAppMessages : loadingMetaMessages;
  const fetchingMessages = activePlatform === 'whatsapp' ? fetchingWhatsAppMessages : false;
  const reactionMessages = useMemo<DisplayMessage[]>(() => {
    if (activePlatform !== "whatsapp") return [];
    return ((messages || []) as DisplayMessage[]).filter((message) => message.message_type === "reaction");
  }, [activePlatform, messages]);
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, Array<{ emoji: string; senderName: string | null; fromMe: boolean }>>();
    for (const message of reactionMessages) {
      const targetId =
        message.reaction_to_message_id ||
        getMetadataString(message.metadata, "reaction_to_message_id") ||
        getMetadataString(message.metadata, "target_message_id") ||
        getMetadataString(message.metadata, "targetMessageId");
      const emoji = message.reaction_emoji || message.content;
      if (!targetId || !emoji) continue;
      const list = map.get(targetId) || [];
      list.push({
        emoji,
        senderName: message.reaction_sender_name || message.sender_name || null,
        fromMe: Boolean(message.from_me),
      });
      map.set(targetId, list);
    }
    return map;
  }, [reactionMessages]);
  const visibleMessages = useMemo<DisplayMessage[]>(() => {
    if (activePlatform !== "whatsapp") return (messages || []) as DisplayMessage[];
    return ((messages || []) as DisplayMessage[]).filter((message) => message.message_type !== "reaction");
  }, [activePlatform, messages]);

  const sendMessage = useSendWhatsAppMessage();
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
  useWhatsAppRealtimeConversations();

  const handleChannelChange = (value: string) => {
    if (value === 'meta-all') {
      setSelectedPageId('all');
    } else if (value.startsWith('meta-')) {
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

  // Save hide groups preference
  useEffect(() => {
    localStorage.setItem("whatsapp-hide-groups", String(hideGroups));
  }, [hideGroups]);

  useEffect(() => {
    localStorage.setItem("whatsapp-show-archived", String(showArchived));
  }, [showArchived]);
  // Scroll to bottom only when new messages arrive (not on every re-render)
  useEffect(() => {
    const currentLength = messages?.length || 0;
    const previousLength = previousMessagesLengthRef.current;

    if (currentLength > previousLength || previousLength === 0) {
      const isFirstLoad = previousLength === 0;
      if (isFirstLoad || !isUserScrollingRef.current) {
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({
            behavior: isFirstLoad ? "instant" : "smooth"
          });
          if (isFirstLoad) {
            isUserScrollingRef.current = false;
          }
        }, 50);
      }
    }

    previousMessagesLengthRef.current = currentLength;
  }, [messages?.length]);

  // Reset scroll state when changing conversations
  useEffect(() => {
    previousMessagesLengthRef.current = 0;
    isUserScrollingRef.current = false;
    queueMicrotask(() => {
      setMessageLimit(50);
    });
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

    if (selectedConversationId && selectedConversationSessionId && selectedConversationRemoteJid && selectedConversationUnreadCount > 0) {
      markConversationAsRead({
        id: selectedConversationId,
        session_id: selectedConversationSessionId,
        remote_jid: selectedConversationRemoteJid,
        is_group: selectedConversationIsGroup
      });
    }
  }, [markConversationAsRead, selectedConversation]);
  const filteredConversations = useMemo(() => {
    let source: ScreenConversation[] = [];
    if (activePlatform === 'whatsapp') {
      source = (conversations || []) as ScreenConversation[];
    } else {
      source = (metaConversations || [])
        .filter((conv) => activePlatform === 'instagram' ? conv.platform === 'instagram' : conv.platform === 'messenger')
        .map(toScreenConversation);
    }

    if (!searchTerm) return source;
    const search = searchTerm.toLowerCase();
    return source.filter(conv =>
      conv.contact_name?.toLowerCase().includes(search) ||
      conv.contact_phone?.includes(search) ||
      conv.lead?.name?.toLowerCase().includes(search)
    );
  }, [conversations, metaConversations, activePlatform, searchTerm]);
  const handleSendMessage = async () => {
    if (!messageText.trim() || !selectedConversation) return;
    const textToSend = messageText.trim();
    setMessageText("");

    if (activePlatform === 'whatsapp') {
      await sendMessage.mutateAsync({
        conversation: selectedConversation,
        text: textToSend,
        sendSessionId: selectedSessionId === "all" ? undefined : selectedSessionId,
      });
    } else {
      await sendMetaMessage.mutateAsync({
        conversationId: selectedConversation.id,
        text: textToSend,
        platform: selectedConversation.platform || 'instagram',
        recipientExternalId: selectedConversation.external_id || selectedConversation.remote_jid
      });
    }
  };
  const handleKeyPress = (e: React.KeyboardEvent<Element>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleSendAudio = async (base64: string, mimetype: string) => {
    if (!selectedConversation) return;

    await sendMessage.mutateAsync({
      conversation: selectedConversation,
      text: "",
      mediaType: "audio",
      base64,
      mimetype,
      filename: `audio.${mimeExtension(mimetype, "webm")}`,
      previewMediaUrl: `data:${mimetype || "audio/webm"};base64,${base64}`,
      sendSessionId: selectedSessionId === "all" ? undefined : selectedSessionId,
    });

    toast({
      title: "Áudio enviado",
      description: "Sua mensagem de voz foi enviada"
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedConversation) return;
    try {
      const processedFile = await compressImageFile(file);
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
        sendSessionId: selectedSessionId === "all" ? undefined : selectedSessionId,
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
    archiveConversation.mutate({
      conversationId: conv.id,
      archive: !conv.archived_at
    });
    if (selectedConversation?.id === conv.id) {
      setSelectedConversation(null);
    }
  };
  const handleDelete = (conv: WhatsAppConversation) => {
    deleteConversation.mutate(conv.id);
    if (selectedConversation?.id === conv.id) {
      setSelectedConversation(null);
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
      await whatsappAPI.retryMediaDownload(messageId, selectedConversation?.session?.organization_id);
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

  // Mobile: Show either conversation list OR chat (not both)
  if (isMobile) {
    return <AppLayout title="Conversas">
        <div className="flex h-[calc(100vh-8rem)] -mb-20 flex-col overflow-hidden bg-transparent">
          {selectedConversation ?
        // Mobile Chat View
        <div className="flex flex-col h-full overflow-hidden">
              {/* Mobile Chat Header */}
              <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.045] bg-[var(--app-surface)] px-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={handleBackToList}>
                    <ArrowLeft className="w-5 h-5" />
                  </Button>
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarImage src={getConversationAvatarUrl(selectedConversation)} />
                    <AvatarFallback className="text-sm bg-white/[0.06] text-muted-foreground">
                      {selectedConversation.is_group ? <Users className="w-4 h-4" /> : (selectedConversation.contact_name || selectedConversation.contact_phone)?.[0] || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate text-foreground">
                      {selectedConversation.lead?.name || (selectedConversation.contact_name && selectedConversation.contact_name !== selectedConversation.contact_phone ? selectedConversation.contact_name : formatPhoneForDisplay(selectedConversation.contact_phone || ""))}
                    </p>
                    {selectedConversation.contact_presence === 'composing' ? <p className="text-xs text-primary animate-pulse">digitando...</p> : selectedConversation.contact_presence === 'recording' ? <p className="text-xs text-primary animate-pulse">gravando...</p> : null}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {selectedLeadId && <Button variant="ghost" size="sm" className="h-8 text-xs px-2" asChild>
                      <Link href={`/crm/pipelines?lead=${selectedLeadId}`}>
                        <User className="w-3.5 h-3.5" />
                      </Link>
                    </Button>}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="w-4 h-4" />
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
                  </DropdownMenu>
                </div>
              </header>

              {/* Mobile Messages */}
              <div className="flex-1 overflow-hidden min-h-0">
                <ScrollArea className="h-full">
                  <div className="p-3 space-y-2 bg-[var(--app-background)] min-h-full">
                    {messages && messages.length >= messageLimit && (
                      <div className="flex justify-center py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-muted-foreground"
                          onClick={() => setMessageLimit(prev => prev + 50)}
                          disabled={fetchingMessages}
                        >
                          {fetchingMessages ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : null}
                          Carregar mensagens anteriores
                        </Button>
                      </div>
                    )}
                    {loadingMessages ? <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
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
                              onRetryMedia={() => retryMediaDownload(msg.id)}
                              messageId={msg.id}
                              leadId={selectedLeadId || ""}
                              leadName={selectedConversation.lead?.name || selectedConversation.contact_name || "Contato"}
                              conversationRemoteJid={selectedConversation.remote_jid}
                              conversationSessionId={selectedConversation.session_id}
                              reactions={(msg.message_id ? reactionsByMessageId.get(msg.message_id) : undefined) || reactionsByMessageId.get(msg.id) || []}
                            />
                          </MessageErrorBoundary>
                        );
                      })}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>
              </div>

              {/* Mobile Message Input */}
              <footer className="shrink-0 border-t border-white/[0.045] bg-[var(--app-surface)] p-3">
                <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" />
                <MessageBox
                  value={messageText}
                  onChange={setMessageText}
                  onSend={handleSendMessage}
                  onKeyDown={handleKeyPress}
                  placeholder="Digite sua mensagem..."
                  isSending={sendMessage.isPending}
                  multiline
                  leftActions={
                    <>
                      <button type="button" onClick={() => fileInputRef.current?.click()}>
                        <Paperclip className="w-5 h-5" />
                      </button>
                      {selectedLeadId && (
                        <button type="button" onClick={() => setShowAutomationDialog(true)} title="Iniciar Automação">
                          <Zap className="w-5 h-5" />
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
              <div className="shrink-0 space-y-2 border-b border-white/[0.045] bg-[var(--app-surface)] p-3">
                <div className="flex flex-col gap-2">
                  <div data-tour="conversations-channel" className="flex gap-1 bg-white/[0.045] p-1 rounded-lg">
                    <Button
                      variant={activePlatform === 'whatsapp' ? 'secondary' : 'ghost'}
                      size="sm"
                      className={cn("h-8 flex-1 gap-1.5", activePlatform === 'whatsapp' && "bg-white/[0.07] shadow-sm")}
                      onClick={() => setActivePlatform('whatsapp')}
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-medium">WhatsApp</span>
                    </Button>
                  </div>

                  {activePlatform === 'whatsapp' && sessions && sessions.length > 1 && (
                    <Select value={currentChannelValue} onValueChange={handleChannelChange}>
                      <SelectTrigger className="h-8 border-0 bg-white/[0.045] text-xs focus:ring-0">
                        <SelectValue placeholder="Selecione a conta WhatsApp" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        <SelectGroup>
                          <SelectItem value="whatsapp-all">Todas as contas WhatsApp</SelectItem>
                          {sessions.map(session => (
                            <SelectItem key={session.id} value={`whatsapp-${session.id}`}>
                              {session.display_name || session.instance_name || session.phone_number}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}

                  {activePlatform !== 'whatsapp' && metaIntegrations && metaIntegrations.length > 1 && (
                    <Select value={currentChannelValue} onValueChange={handleChannelChange}>
                      <SelectTrigger className="h-8 border-0 bg-white/[0.045] text-xs focus:ring-0">
                        <SelectValue placeholder="Selecione a página" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        <SelectGroup>
                          <SelectItem value="meta-all">Todas as páginas</SelectItem>
                          {metaIntegrations.map(integration => (
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
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder={activePlatform === 'whatsapp' ? "Buscar conversas..." : "Buscar no Instagram/Meta..."}
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="h-9 border-white/[0.055] bg-white/[0.035] pl-8"
                  />
                </div>

                {activePlatform === 'whatsapp' && (
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

              {/* Mobile Conversation List */}
              <ScrollArea data-tour="conversations-list" className="flex-1">
                <div className="divide-y">
                  {loadingConversations ? (
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
                          <Button size="sm" onClick={() => router.push('/settings?tab=whatsapp')}>
                            Conectar WhatsApp
                          </Button>
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
                        onClick={() => setSelectedConversation(conv)}
                        formatTime={formatConversationTime}
                        onArchive={() => handleArchive(conv)}
                        onDelete={() => handleDelete(conv)}
                        availableTags={availableTags || []}
                        onAddTag={tagId => conv.lead && addLeadTag.mutate({
                          leadId: conv.lead.id,
                          tagId
                        })}
                        onRemoveTag={tagId => conv.lead && removeLeadTag.mutate({
                          leadId: conv.lead.id,
                          tagId
                        })}
                        onViewLead={conv.lead ? () => router.push(`/crm/pipelines?lead=${conv.lead!.id}`) : undefined}
                        onCreateLead={() => {
                          setCreateLeadContact({
                            phone: conv.contact_phone || undefined,
                            name: conv.contact_name || undefined,
                            conversationId: conv.id,
                          });
                          setCreateLeadOpen(true);
                        }}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>}
        </div>

        <CreateLeadDialog open={createLeadOpen} onOpenChange={setCreateLeadOpen} contactPhone={createLeadContact.phone} contactName={createLeadContact.name} conversationId={createLeadContact.conversationId} />
        {selectedLeadId && selectedConversation && (
          <StartAutomationDialog
            open={showAutomationDialog}
            onOpenChange={setShowAutomationDialog}
            leadId={selectedLeadId}
            conversationId={selectedConversation.id}
            contactName={selectedConversation.lead?.name || selectedConversation.contact_name || "Contato"}
          />
        )}
      </AppLayout>;
  }

  // Desktop Layout
  return <AppLayout title="Conversas">
      <div className="flex h-[calc(100vh-7rem)] gap-3 overflow-hidden">
        {/* Sidebar */}
        <aside data-tour="conversations-overview" className="app-card flex w-[350px] min-w-[350px] max-w-[350px] flex-col overflow-hidden">
          {/* Header com filtros */}
          <div className="space-y-2 border-b border-white/[0.045] bg-[var(--app-surface)] p-3">
            <div className="flex flex-col gap-2">
              <div data-tour="conversations-channel" className="flex gap-1 rounded-lg bg-white/[0.045] p-1">
                <Button
                  variant={activePlatform === 'whatsapp' ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn("h-8 flex-1 gap-1.5", activePlatform === 'whatsapp' && "bg-white/[0.07] shadow-sm")}
                  onClick={() => setActivePlatform('whatsapp')}
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-medium">WhatsApp</span>
                </Button>
              </div>

              {activePlatform === 'whatsapp' && sessions && sessions.length > 1 && (
                <Select value={currentChannelValue} onValueChange={handleChannelChange}>
                  <SelectTrigger className="h-8 border-0 bg-white/[0.045] text-xs focus:ring-0">
                    <SelectValue placeholder="Selecione a conta WhatsApp" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    <SelectGroup>
                      <SelectItem value="whatsapp-all">Todas as contas WhatsApp</SelectItem>
                      {sessions.map(session => (
                        <SelectItem key={session.id} value={`whatsapp-${session.id}`}>
                          {session.display_name || session.instance_name || session.phone_number}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}

              {activePlatform !== 'whatsapp' && metaIntegrations && metaIntegrations.length > 1 && (
                <Select value={currentChannelValue} onValueChange={handleChannelChange}>
                  <SelectTrigger className="h-8 border-0 bg-white/[0.045] text-xs focus:ring-0">
                    <SelectValue placeholder="Selecione a página" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    <SelectGroup>
                      <SelectItem value="meta-all">Todas as páginas</SelectItem>
                      {metaIntegrations.map(integration => (
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
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={activePlatform === 'whatsapp' ? "Buscar conversas..." : "Buscar no Instagram/Meta..."}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="h-9 border-white/[0.055] bg-white/[0.035] pl-8"
              />
            </div>

            {activePlatform === 'whatsapp' && (
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
                loadingConversations ? (
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
                      onClick={() => setSelectedConversation(conv)}
                      formatTime={formatConversationTime}
                      onArchive={() => handleArchive(conv)}
                      onDelete={() => handleDelete(conv)}
                      availableTags={availableTags || []}
                      onAddTag={tagId => conv.lead && addLeadTag.mutate({
                        leadId: conv.lead.id,
                        tagId
                      })}
                      onRemoveTag={tagId => conv.lead && removeLeadTag.mutate({
                        leadId: conv.lead.id,
                        tagId
                      })}
                      onViewLead={conv.lead ? () => router.push(`/crm/pipelines?lead=${conv.lead!.id}`) : undefined}
                      onCreateLead={() => {
                        setCreateLeadContact({
                          phone: conv.contact_phone || undefined,
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
                        onClick={() => setSelectedConversation(screenConversation)}
                        formatTime={formatConversationTime}
                        onArchive={() => {}}
                        onDelete={() => {}}
                        availableTags={availableTags || []}
                        onAddTag={() => {}}
                        onRemoveTag={() => {}}
                        onCreateLead={() => {}}
                      />
                    );
                  })
                )
              )}
            </div>
          </ScrollArea>
        </aside>

        {/* Chat Area */}
        <main className="app-card flex min-w-0 flex-1 flex-col overflow-hidden">
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
                pipelineName={selectedConversation.lead?.pipeline?.name}
                stageName={selectedConversation.lead?.stage?.name}
                stageColor={selectedConversation.lead?.stage?.color}
                conversationId={selectedConversation.id}
                sessionId={selectedConversation.session_id}
                remoteJid={selectedConversation.remote_jid}
                onArchive={() => handleArchive(selectedConversation)}
                onDelete={() => handleDelete(selectedConversation)}
                onCreateLead={() => {
                  setCreateLeadContact({
                    phone: selectedConversation.contact_phone || undefined,
                    name: selectedConversation.contact_name || undefined,
                    conversationId: selectedConversation.id,
                  });
                  setCreateLeadOpen(true);
                }}
                onToggleLeadPanel={() => setShowLeadPanel(prev => !prev)}
                showLeadPanel={showLeadPanel}
              />

              {/* Mensagens */}
              <div className="flex-1 overflow-hidden min-h-0">
                <ScrollArea className="h-full" onScrollCapture={(e: React.UIEvent<HTMLDivElement>) => {
                  const target = e.currentTarget.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]') || e.currentTarget;
                  if (target) {
                    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 50;
                    isUserScrollingRef.current = !isAtBottom;
                  }
                }}>
                  <div className="space-y-2 bg-white/[0.025] p-4">
                    {loadingMessages ? <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
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
                              onRetryMedia={() => retryMediaDownload(msg.id)}
                              messageId={msg.id}
                              leadId={selectedLeadId || ""}
                              leadName={selectedConversation.lead?.name || selectedConversation.contact_name || "Contato"}
                              conversationRemoteJid={selectedConversation.remote_jid}
                              conversationSessionId={selectedConversation.session_id}
                              reactions={(msg.message_id ? reactionsByMessageId.get(msg.message_id) : undefined) || reactionsByMessageId.get(msg.id) || []}
                            />
                          </MessageErrorBoundary>
                        );
                      })}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>
              </div>

              {/* Input de mensagem */}
              <footer className="shrink-0 border-t border-white/[0.045] bg-[var(--app-surface)] p-3">
                <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" />
                <MessageBox
                  value={messageText}
                  onChange={setMessageText}
                  onSend={handleSendMessage}
                  onKeyDown={handleKeyPress}
                  placeholder="Digite sua mensagem..."
                  isSending={sendMessage.isPending}
                  multiline
                  showRightActionsWhenEmpty
                  leftActions={
                    <>
                      <button type="button" onClick={() => fileInputRef.current?.click()}>
                        <Paperclip className="w-5 h-5" />
                      </button>
                      {selectedLeadId && (
                        <button type="button" onClick={() => setShowAutomationDialog(true)} title="Iniciar Automação">
                          <Zap className="w-5 h-5" />
                        </button>
                      )}
                    </>
                  }
                  rightActions={
                    <AudioRecorderButton
                      onSend={handleSendAudio}
                      disabled={sendMessage.isPending}
                    />
                  }
                />
              </footer>
            </> : (
              <div className="flex flex-1 flex-col items-center justify-center bg-white/[0.025] p-6 text-center text-muted-foreground">
                <MessageCircle className="mb-4 h-24 w-24 opacity-30" />
                {!loadingSessions && sessions?.length === 0 ? (
                  <>
                    <p className="font-semibold text-lg text-foreground mb-2">WhatsApp ainda não conectado</p>
                    <p className="text-sm max-w-sm mb-4">
                      Para começar a receber e enviar mensagens, conecte sua conta do WhatsApp escaneando o QR Code.
                    </p>
                    <ol className="text-xs text-left max-w-sm mb-6 space-y-1.5 list-decimal list-inside text-muted-foreground">
                      <li>Clique no botão abaixo para abrir as configurações.</li>
                      <li>Crie uma nova sessão e escaneie o QR Code com seu celular.</li>
                      <li>Aguarde alguns segundos até o status ficar como &quot;Conectado&quot;.</li>
                    </ol>
                    <Button onClick={() => router.push('/settings?tab=whatsapp')}>
                      <Plus className="w-4 h-4 mr-2" />
                      Conectar WhatsApp agora
                    </Button>
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
        {selectedLeadId && showLeadPanel && (
          <ConversationLeadPanel
            leadId={selectedLeadId}
            onClose={() => setShowLeadPanel(false)}
            contactPicture={getConversationAvatarUrl(selectedConversation)}
            className="w-[300px] min-w-[300px] max-w-[300px] shrink-0 animate-in slide-in-from-right-5 duration-300"
          />
        )}
      </div>

      <CreateLeadDialog open={createLeadOpen} onOpenChange={setCreateLeadOpen} contactPhone={createLeadContact.phone} contactName={createLeadContact.name} conversationId={createLeadContact.conversationId} />
      {selectedLeadId && selectedConversation && (
        <StartAutomationDialog
          open={showAutomationDialog}
          onOpenChange={setShowAutomationDialog}
          leadId={selectedLeadId}
          conversationId={selectedConversation.id}
          contactName={selectedConversation.lead?.name || selectedConversation.contact_name || "Contato"}
        />
      )}
    </AppLayout>;
}
function ConversationItem({
  conversation,
  isSelected,
  onClick,
  formatTime,
  onArchive,
  onDelete,
  availableTags,
  onAddTag,
  onRemoveTag,
  onViewLead,
  onCreateLead
}: {
  conversation: WhatsAppConversation;
  isSelected: boolean;
  onClick: () => void;
  formatTime: (date: string | null) => string;
  onArchive: () => void;
  onDelete: () => void;
  availableTags: TagType[];
  onAddTag: (tagId: string) => void;
  onRemoveTag: (tagId: string) => void;
  onViewLead?: () => void;
  onCreateLead: () => void;
}) {
  const leadTags = conversation.lead?.tags || [];
  const leadTagIds = leadTags.map(lt => lt.tag.id);
  const unassignedTags = availableTags.filter(t => !leadTagIds.includes(t.id));
  const displayName = conversation.lead?.name || (conversation.contact_name && conversation.contact_name !== conversation.contact_phone ? conversation.contact_name : formatPhoneForDisplay(conversation.contact_phone || ""));
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

  return <div className={cn("w-full text-left p-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 hover:bg-white/[0.045] transition-colors group overflow-hidden", isSelected && "bg-white/[0.07]")}>
      <button type="button" onClick={onClick} className="flex items-center gap-2.5 flex-1 min-w-0">
        <Avatar className="h-9 w-9 shrink-0 relative">
          <AvatarImage src={getConversationAvatarUrl(conversation)} />
          <AvatarFallback className="text-xs bg-white/[0.06] text-muted-foreground">
            {conversation.is_group ? <Users className="w-4 h-4" /> : displayName?.[0]?.toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 w-0 min-w-0">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
              <span className="truncate font-sans font-semibold text-xs text-foreground">
                {displayName}
              </span>
              {conversation.is_group && <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">
                  Grupo
                </Badge>}
              {leadTags.slice(0, 2).map(lt => (
                <Badge
                  key={lt.tag.id}
                  variant="secondary"
                  className="text-[8px] px-1.5 py-0 h-4 font-medium border-0 truncate max-w-[54px] shrink-0"
                  style={{
                    backgroundColor: lt.tag.color,
                    color: '#FFFFFF',
                  }}
                >
                  {lt.tag.name}
                </Badge>
              ))}
              {leadTags.length > 2 && (
                <span className="text-[9px] text-muted-foreground shrink-0">
                  +{leadTags.length - 2}
                </span>
              )}
            </div>
          </div>

          {/* Mensagem ou Presença */}
          <div className="flex items-center justify-between mt-0">
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

      <div className="flex items-center justify-end gap-1.5 shrink-0 self-center min-w-[54px] max-w-[104px] overflow-hidden">
        {conversation.unread_count > 0 && <Badge className="h-5 min-w-5 px-1.5 text-[10px]">
            {conversation.unread_count}
          </Badge>}
        {onViewLead && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onViewLead();
            }}
            title="Ver lead no pipeline"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
        )}
        <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
          {formatTime(conversation.last_message_at)}
        </span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <MoreVertical className="w-3.5 h-3.5" />
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
          {!conversation.lead && <DropdownMenuItem onClick={onCreateLead}>
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
      </DropdownMenu>
    </div>;
}
