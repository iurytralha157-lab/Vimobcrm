import { useState, useEffect, useRef, useMemo } from "react";
import { MessageBox } from "@/components/ui/message-box";
import { useFloatingChat } from "@/contexts/FloatingChatContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { MessageCircle, X, Minus, ArrowLeft, Search, Loader2, Phone, Users, Paperclip, ExternalLink, ArrowRight, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isToday, isYesterday } from "date-fns";
import { useWhatsAppConversations, useWhatsAppMessages, useSendWhatsAppMessage, useMarkConversationAsRead, useWhatsAppRealtimeConversations, WhatsAppConversation } from "@/hooks/use-whatsapp-conversations";
import { useAccessibleSessions } from "@/hooks/use-accessible-sessions";
import { WhatsAppSession } from "@/hooks/use-whatsapp-sessions";
import { getWhatsAppStartErrorMessage, useStartConversation, useFindConversationByPhone } from "@/hooks/use-start-conversation";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useHasWhatsAppAccess } from "@/hooks/use-whatsapp-access";
import { DateSeparator, shouldShowDateSeparator } from "@/components/features/whatsapp/DateSeparator";
import { AudioRecorderButton } from "@/components/features/whatsapp/AudioRecorderButton";
import { MessageBubble } from "@/components/features/whatsapp/MessageBubble";
import { MessageErrorBoundary } from "@/components/features/whatsapp/MessageErrorBoundary";
import { StartAutomationDialog } from "@/components/features/whatsapp/StartAutomationDialog";
import { useRouter } from 'next/navigation';
import { formatPhoneForDisplay, isValidWhatsAppPhone } from "@/lib/phone-utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
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

async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new window.Image();
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
    const targetType = file.type === "image/png" ? "image/png" : "image/webp";
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, targetType, IMAGE_QUALITY);
    });
    if (!blob) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "") || "imagem";
    return new File([blob], `${baseName}.${mimeExtension(targetType, "webp")}`, { type: targetType });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

type FloatingConversationFiltersProps = {
  connectedSessions: WhatsAppSession[];
  selectedSessionId: string;
  onSessionChange: (sessionId: string) => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  hideGroups: boolean;
  onHideGroupsChange: (value: boolean) => void;
  showArchived: boolean;
  onShowArchivedChange: (value: boolean) => void;
};

function FloatingConversationFilters({
  connectedSessions,
  selectedSessionId,
  onSessionChange,
  searchTerm,
  onSearchChange,
  hideGroups,
  onHideGroupsChange,
  showArchived,
  onShowArchivedChange
}: FloatingConversationFiltersProps) {
  return (
    <div className="p-4 space-y-3 border-b border-white/[0.055] shrink-0 bg-[var(--app-surface)]">
      {connectedSessions.length > 1 && (
        <Select value={selectedSessionId} onValueChange={onSessionChange}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Selecione canal" />
          </SelectTrigger>
          <SelectContent>
            {connectedSessions.map(session => (
              <SelectItem key={session.id} value={session.id}>
                {session.instance_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar conversas..."
          value={searchTerm}
          onChange={e => onSearchChange(e.target.value)}
          className="pl-8 h-9"
          autoComplete="off"
        />
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
          <Checkbox checked={hideGroups} onCheckedChange={checked => onHideGroupsChange(checked === true)} />
          <span>Ocultar grupos</span>
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
          <Checkbox checked={showArchived} onCheckedChange={checked => onShowArchivedChange(checked === true)} />
          <span>Arquivadas</span>
        </label>
      </div>
    </div>
  );
}

export function FloatingChat() {
  const {
    state,
    closeChat,
    minimizeChat,
    maximizeChat,
    openConversation,
    clearActiveConversation,
    clearPendingMessage
  } = useFloatingChat();
  const {
    isOpen,
    isMinimized,
    activeConversation,
    pendingPhone,
    pendingLeadName,
    pendingMessage,
    pendingLeadId
  } = state;
  const isMobile = useIsMobile();
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const { profile } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [messageText, setMessageText] = useState("");
  const [hideGroups, setHideGroups] = useState(() => {
    return localStorage.getItem("whatsapp-hide-groups-floating") === "true";
  });
  const [showArchived, setShowArchived] = useState(() => {
    return localStorage.getItem("whatsapp-show-archived-floating") === "true";
  });
  const [showAutomationDialog, setShowAutomationDialog] = useState(false);
  const [showSessionSelector, setShowSessionSelector] = useState(false);
  const [pendingStartData, setPendingStartData] = useState<{phone: string, leadName?: string, leadId?: string} | null>(null);
  const [isStartingConversation, setIsStartingConversation] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const previousMessagesLengthRef = useRef<number>(0);
  const isUserScrollingRef = useRef<boolean>(false);
  const navigationNonceRef = useRef(0);
  const activeConversationId = activeConversation?.id;
  const activeConversationLead = activeConversation?.lead;
  const activeConversationUnreadCount = activeConversation?.unread_count ?? 0;
  const activeConversationSessionId = activeConversation?.session_id;
  const activeConversationRemoteJid = activeConversation?.remote_jid;
  const activeConversationIsGroup = activeConversation?.is_group;
  const activeConversationReadTarget = useMemo(() => (
    activeConversationId && activeConversationSessionId && activeConversationRemoteJid
      ? {
          id: activeConversationId,
          unreadCount: activeConversationUnreadCount,
          sessionId: activeConversationSessionId,
          remoteJid: activeConversationRemoteJid,
          isGroup: Boolean(activeConversationIsGroup),
        }
      : null
  ), [
    activeConversationId,
    activeConversationUnreadCount,
    activeConversationSessionId,
    activeConversationRemoteJid,
    activeConversationIsGroup,
  ]);
  const {
    data: sessions,
    isLoading: loadingSessions
  } = useAccessibleSessions();
  const {
    data: conversations,
    isLoading: loadingConversations
  } = useWhatsAppConversations(selectedSessionId || undefined, {
    hideGroups,
    showArchived,
  }, loadingSessions ? undefined : sessions?.map(s => s.id));
  const {
    data: messages,
    isLoading: loadingMessages
  } = useWhatsAppMessages(
    activeConversationId || null,
    activeConversation?.lead_id || activeConversation?.lead?.id || null
  );
  const reactionMessages = useMemo(() => {
    return (messages || []).filter((message) => message.message_type === "reaction");
  }, [messages]);
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, Array<{ emoji: string; senderName?: string | null; fromMe?: boolean }>>();
    for (const message of reactionMessages) {
      const metadata = (
        message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
      ) ? message.metadata as Record<string, unknown> : {};
      const metadataTargetId =
        metadata.reaction_to_message_id ||
        metadata.target_message_id ||
        metadata.targetMessageId;
      const targetId =
        message.reaction_to_message_id ||
        (typeof metadataTargetId === "string" || typeof metadataTargetId === "number" ? String(metadataTargetId) : null);
      const emoji = message.reaction_emoji || message.content;
      if (!targetId || !emoji) continue;
      const list = map.get(targetId) || [];
      list.push({
        emoji,
        senderName: message.reaction_sender_name || message.sender_name,
        fromMe: message.from_me,
      });
      map.set(targetId, list);
    }
    return map;
  }, [reactionMessages]);
  const visibleMessages = useMemo(() => {
    return (messages || []).filter((message) => message.message_type !== "reaction");
  }, [messages]);
  const sendMessage = useSendWhatsAppMessage();
  const { mutate: markConversationAsRead } = useMarkConversationAsRead();
  const startConversation = useStartConversation();
  const findConversation = useFindConversationByPhone();
  const { data: hasWhatsAppAccess, isLoading: loadingWhatsAppAccess } = useHasWhatsAppAccess();
  const router = useRouter();

  useWhatsAppRealtimeConversations();

  const getLeadPipelineUrl = (leadId: string) => {
    navigationNonceRef.current += 1;
    return `/crm/pipelines?lead=${leadId}&t=${navigationNonceRef.current}`;
  };

  /* eslint-disable react-hooks/immutability -- Pending chat startup calls the existing hoisted conversation starter; keeping this legacy flow stable during lint cleanup. */
  useEffect(() => {
    if (activeConversationId && conversations) {
      const updatedConv = conversations.find(c => c.id === activeConversationId);
      if (updatedConv && updatedConv.lead && !activeConversationLead) {
        openConversation(updatedConv);
      }
    }
  }, [conversations, activeConversationId, activeConversationLead, openConversation]);

 const handleScrollArea = (e: React.UIEvent<HTMLDivElement>) => {
   const target = e.currentTarget;
   const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 50;
   isUserScrollingRef.current = !isAtBottom;
 };

  useEffect(() => {
    localStorage.setItem("whatsapp-hide-groups-floating", String(hideGroups));
  }, [hideGroups]);

  useEffect(() => {
    localStorage.setItem("whatsapp-show-archived-floating", String(showArchived));
  }, [showArchived]);

  useEffect(() => {
    if (!selectedSessionId && sessions?.length) {
      const connectedSession = sessions.find(s => s.status === "connected" || s.status === "connecting");
      const nextSessionId = connectedSession?.id || sessions[0]?.id;
      if (!nextSessionId) return;

      let isActive = true;
      queueMicrotask(() => {
        if (isActive) setSelectedSessionId(nextSessionId);
      });
      return () => {
        isActive = false;
      };
    }
  }, [sessions, selectedSessionId]);

  useEffect(() => {
    if (!pendingPhone) return;

    const openPendingConversation = async () => {
      const connected = sessions?.filter(s => s.status === "connected" || s.status === "connecting") || [];

      if (connected.length === 1) {
        setSelectedSessionId(connected[0].id);
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
  }, [pendingPhone, pendingLeadName, pendingLeadId, sessions, handleStartConversationWithSession]);
  /* eslint-enable react-hooks/immutability */

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

  useEffect(() => {
    previousMessagesLengthRef.current = 0;
    isUserScrollingRef.current = false;
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    }, 80);
  }, [activeConversation?.id]);

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
  }, [activeConversation, pendingMessage, clearPendingMessage]);

  useEffect(() => {
    if (activeConversationReadTarget && activeConversationReadTarget.unreadCount > 0) {
      markConversationAsRead({
        id: activeConversationReadTarget.id,
        session_id: activeConversationReadTarget.sessionId,
        remote_jid: activeConversationReadTarget.remoteJid,
        is_group: activeConversationReadTarget.isGroup
      });
    }
  }, [activeConversationReadTarget, markConversationAsRead]);

  const handleSessionSelect = (session: WhatsAppSession) => {
    setSelectedSessionId(session.id);
    setShowSessionSelector(false);
    if (pendingStartData) {
      handleStartConversationWithSession(pendingStartData.phone, session.id, pendingStartData.leadName, pendingStartData.leadId);
      setPendingStartData(null);
    }
  };

  const handleStartConversation = async (phone: string, leadName?: string, leadId?: string) => {
    if (!isValidWhatsAppPhone(phone)) {
      toast({
        title: "Lead sem WhatsApp",
        description: "Este lead não tem um WhatsApp válido cadastrado.",
        variant: "destructive"
      });
      clearActiveConversation();
      return;
    }

    if (!selectedSessionId && !leadId) {
      toast({
        title: "Nenhuma sessão WhatsApp",
        description: "Configure uma sessão WhatsApp primeiro",
        variant: "destructive"
      });
      return;
    }
    await handleStartConversationWithSession(phone, selectedSessionId || undefined, leadName, leadId);
  };
  void handleStartConversation;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- Existing startup effect depends on this legacy async flow; wrapping it would broaden this lint-only pass.
  async function handleStartConversationWithSession(phone: string, sessionId?: string, leadName?: string, leadId?: string) {
    if (!isValidWhatsAppPhone(phone)) {
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
      // 1) Se temos leadId, sempre tentar primeiro abrir conversa existente desse lead (qualquer sessao acessivel)
      if (leadId) {
        const anyExisting = await findConversation.mutateAsync({ phone, leadId });
        if (anyExisting) {
          openConversation(anyExisting);
          return;
        }
      }

      // 2) Se temos sessionId, tentar conversa existente na sessao especifica
      if (sessionId) {
        const existing = await findConversation.mutateAsync({ phone, leadId, sessionId });
        if (existing) {
          if (leadId && existing.lead_id !== leadId) {
            await whatsappAPI.linkConversationToLead(existing.id, leadId, profile?.organization_id);
          }
          openConversation(existing);
          return;
        }
      }

      // 3) Fallback: tentar historico via edge function (acesso restrito)
      // Adicionamos um timeout para nao travar o fluxo
      if (leadId) {
        try {
          const restrictedData = await Promise.race([
            whatsappAPI.getHistoryAccess({
              leadId,
              organizationId: profile?.organization_id,
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Timeout")), 5000)
            )
          ]);

          if (restrictedData?.conversation) {
            openConversation(restrictedData.conversation);
            return;
          }
        } catch {
          // Fallback silencioso: se o historico restrito falhar, o fluxo tenta seguir pela sessao selecionada.
        }
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
        phone,
        sessionId,
        leadId,
        leadName
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
    return conversations?.filter(conv => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return conv.contact_name?.toLowerCase().includes(search) || conv.contact_phone?.includes(search);
  });
  }, [conversations, searchTerm]);

  const handleViewLead = (leadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    closeChat();
    // Usar contador para forcar React Router a detectar mudanca mesmo na mesma pagina
    const url = getLeadPipelineUrl(leadId);
    router.push(url);
  };

  const handleSendMessage = async () => {
    const textToSend = messageText.trim();
    if (!textToSend || !activeConversation) return;


    // Limpa o campo IMEDIATAMENTE (UX otimista)
    setMessageText("");

    await sendMessage.mutateAsync({
      conversation: activeConversation,
      text: textToSend,
      sendSessionId: selectedSessionId || undefined,
    });
  };
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleSendAudio = async (base64: string, mimetype: string) => {
    if (!activeConversation) return;

    await sendMessage.mutateAsync({
      conversation: activeConversation,
      text: "",
      mediaType: "audio",
      base64,
      mimetype,
      filename: `audio.${mimeExtension(mimetype, "webm")}`,
      previewMediaUrl: `data:${mimetype || "audio/webm"};base64,${base64}`,
      sendSessionId: selectedSessionId || undefined,
    });

    toast({
      title: "Áudio enviado",
      description: "Sua mensagem de voz foi enviada"
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConversation) return;
    try {
      const processedFile = await compressImageFile(file);
      const base64Content = await fileToBase64(processedFile);

      // Determine media type
      let mediaType = "document";
      if (processedFile.type.startsWith("image/")) mediaType = "image";else if (processedFile.type.startsWith("video/")) mediaType = "video";else if (processedFile.type.startsWith("audio/")) mediaType = "audio";

      // Send message with media
      await sendMessage.mutateAsync({
        conversation: activeConversation,
        text: processedFile.name,
        mediaType,
        base64: base64Content,
        mimetype: processedFile.type || file.type || "application/octet-stream",
        filename: processedFile.name,
        previewMediaUrl: `data:${processedFile.type || file.type || "application/octet-stream"};base64,${base64Content}`,
        sendSessionId: selectedSessionId || undefined,
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
  const formatLastMessage = (msg: string | null): string => {
    if (!msg) return "Sem mensagens";
    // Detect file-like messages (UUIDs, file extensions, raw media)
    const isFilePattern = /^[a-f0-9-]{36}\.(png|jpg|jpeg|gif|webp|mp4|mp3|ogg|opus|pdf|doc|docx|xls|xlsx|csv|avi|mov|aac|m4a|wav|heic)$/i;
    const isExtOnly = /^\S+\.(png|jpg|jpeg|gif|webp|mp4|mp3|ogg|opus|pdf|doc|docx|xls|xlsx|csv|avi|mov|aac|m4a|wav|heic)$/i;

    if (isFilePattern.test(msg.trim()) || isExtOnly.test(msg.trim())) {
      const ext = msg.trim().split('.').pop()?.toLowerCase() || '';
      if (['png','jpg','jpeg','gif','webp','heic'].includes(ext)) return 'Foto';
      if (['mp4','avi','mov'].includes(ext)) return 'Vídeo';
      if (['mp3','ogg','opus','aac','m4a','wav'].includes(ext)) return 'Áudio';
      return 'Documento';
    }
    return msg;
  };

  const formatConversationTime = (date: string | null) => {
    if (!date) return "";
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    if (isToday(d)) return format(d, "HH:mm");
    if (isYesterday(d)) return "Ontem";
    return format(d, "dd/MM");
  };
  const unreadCount = conversations?.reduce((acc, c) => acc + (c.unread_count || 0), 0) || 0;
  const connectedSessions = sessions?.filter(s => s.status === "connected" || s.status === "connecting") || [];
  const hasConnectedSession = loadingSessions || connectedSessions.length > 0;

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
              className="w-full justify-start h-auto py-3 px-4 hover:bg-white/[0.055]"
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
  if (!isOpen) return null;

  // Modo somente leitura: usuario nao tem sessao propria/acesso, mas pode ver historico
  // de uma conversa ativa (ex.: clicou em "Ver Mensagens" num card de lead).
  const isReadOnlyMode = !loadingWhatsAppAccess && !hasWhatsAppAccess;

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
          "flex items-center justify-between shrink-0",
          mobile
            ? "px-4 py-3 bg-[var(--app-surface)] border-b border-white/[0.055]"
            : "h-16 bg-gradient-to-r from-primary via-primary to-primary/90 text-primary-foreground px-5 shadow-sm"
        )}>
          <div className="flex items-center gap-2">
            <MessageCircle className={cn("h-5 w-5", mobile && "text-primary")} />
            <span className={cn("font-medium", mobile ? "text-base" : "")}>WhatsApp</span>
            {!isMinimized && unreadCount > 0 && (
              <Badge variant="secondary" className="h-5 min-w-5 flex items-center justify-center text-xs">
                {unreadCount}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {!mobile && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/20"
                onClick={isMinimized ? maximizeChat : minimizeChat}
              >
                <Minus className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8",
                mobile ? "hover:bg-white/[0.055]" : "text-primary-foreground hover:bg-primary-foreground/20"
              )}
              onClick={closeChat}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      );
    }

    // Header compacto e organizado para o FloatingChat
    const displayName = activeConversation.lead?.name ||
      (activeConversation.contact_name && activeConversation.contact_name !== activeConversation.contact_phone
        ? activeConversation.contact_name
        : formatPhoneForDisplay(activeConversation.contact_phone || ""));

    const phone = formatPhoneForDisplay(activeConversation.contact_phone || "");
    const leadId = activeConversation.lead?.id;
    const tags = activeConversation.lead?.tags || [];
    const pipelineName = activeConversation.lead?.pipeline?.name;
    const stageName = activeConversation.lead?.stage?.name;
    const stageColor = activeConversation.lead?.stage?.color;
    const visibleTags = tags.slice(0, 2);
    const remainingTags = tags.slice(2);

    const handleViewLeadClick = () => {
      if (leadId) {
        closeChat();
        // Usar contador para forcar o React Router a detectar a mudanca
        // mesmo quando ja estamos na mesma pagina
        const url = getLeadPipelineUrl(leadId);
        router.push(url);
      }
    };

    return (
      <TooltipProvider>
        <div className="border-b border-white/[0.055] bg-[var(--app-surface)] shrink-0">
          {/* Linha 1: Navegacao e info principal */}
          <div className="flex items-center gap-2 px-3 py-2">
            {/* Botao Voltar */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={clearActiveConversation}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>

            {/* Avatar */}
            <Avatar className="h-8 w-8 shrink-0 border border-primary/20">
              <AvatarImage src={getConversationAvatarUrl(activeConversation)} />
              <AvatarFallback className="text-xs bg-primary text-primary-foreground font-bold">
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
              {activeConversation.lead?.name && activeConversation.contact_phone && (
                <p className="text-xs text-muted-foreground truncate">{phone}</p>
              )}
            </div>

            {/* Acoes */}
            <div className="flex items-center gap-1 shrink-0">
              {leadId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={handleViewLeadClick}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Ver Lead</TooltipContent>
                </Tooltip>
              )}
              {!mobile && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={minimizeChat}
                >
                  <Minus className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={closeChat}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Linha 2: Tags e Pipeline (se houver) */}
          {(visibleTags.length > 0 || pipelineName) && (
            <div className="flex items-center gap-1.5 px-3 pb-2 flex-wrap">
              {/* Tags */}
              {visibleTags.map((lt) => (
                <Badge
                  key={lt.tag.id}
                  variant="secondary"
                  className="text-[9px] px-1.5 py-0 h-4 font-medium"
                  style={{
                    backgroundColor: `${lt.tag.color}20`,
                    color: lt.tag.color,
                    borderColor: lt.tag.color,
                  }}
                >
                  {lt.tag.name}
                </Badge>
              ))}
              {remainingTags.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0 h-4 cursor-help"
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
                          className="text-[9px] px-1.5 py-0 h-4"
                          style={{
                            backgroundColor: `${lt.tag.color}20`,
                            color: lt.tag.color,
                          }}
                        >
                          {lt.tag.name}
                        </Badge>
                      ))}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Separador */}
              {visibleTags.length > 0 && pipelineName && (
                <span className="text-muted-foreground text-[10px]">•</span>
              )}

              {/* Pipeline > Stage */}
              {pipelineName && (
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="truncate max-w-[80px]">{pipelineName}</span>
                  {stageName && (
                    <>
                      <ArrowRight className="w-2.5 h-2.5" />
                      <Badge
                        variant="outline"
                        className="text-[9px] px-1 py-0 h-4"
                        style={stageColor ? {
                          borderColor: stageColor,
                          color: stageColor,
                        } : undefined}
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

  const DisconnectedState = () => <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-[var(--app-surface)]">
      <Phone className="h-12 w-12 text-muted-foreground mb-4" />
      <p className="text-muted-foreground mb-2">Nenhum WhatsApp conectado</p>
      <p className="text-sm text-muted-foreground">
        Acesse Configurações &gt; WhatsApp para conectar
      </p>
    </div>;
  const messagesViewJsx = (
    <div className="flex-1 overflow-hidden min-h-0 flex flex-col bg-[var(--app-surface)]">
      <ScrollArea className="flex-1" onScrollCapture={handleScrollArea}>
        <div className="px-3 py-3 w-full max-w-full min-w-0 overflow-hidden overflow-x-hidden">
          {loadingMessages ? <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div> : messages?.length === 0 ? <div className="flex flex-col items-center justify-center py-12">
              <MessageCircle className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">Nenhuma mensagem</p>
              <p className="text-xs text-muted-foreground">Envie uma mensagem para começar</p>
            </div> : <div className="flex flex-col gap-2">
              {visibleMessages?.map((msg, index) => {
                const previousMsg = index > 0 ? visibleMessages[index - 1] : null;
                const showSeparator = shouldShowDateSeparator(msg.sent_at, previousMsg?.sent_at || null);
                return (
                  <MessageErrorBoundary key={msg.id} messageId={msg.id}>
                    {showSeparator && <DateSeparator date={new Date(msg.sent_at)} />}
                    <MessageBubble
                      content={msg.content}
                      messageType={msg.message_type}
                      mediaUrl={msg.media_url ?? null}
                      mediaMimeType={msg.media_mime_type ?? null}
                      mediaStatus={msg.media_status as 'pending' | 'ready' | 'failed' | null}
                      mediaError={msg.media_error ?? null}
                      mediaSize={msg.media_size}
                      fromMe={msg.from_me}
                      status={msg.status ?? ''}
                      sentAt={msg.sent_at}
                      senderName={msg.sender_name ?? null}
                      isGroup={activeConversation!.is_group}
                      onRetryMedia={() => {}}
                      messageId={msg.id}
                      leadId={activeConversation!.lead?.id || activeConversation!.lead_id || ''}
                      leadName={activeConversation!.lead?.name || activeConversation!.contact_name || ''}
                      conversationRemoteJid={activeConversation!.remote_jid ?? null}
                      conversationSessionId={activeConversation!.session_id ?? null}
                      reactions={(reactionsByMessageId.get(msg.message_id) || reactionsByMessageId.get(msg.id) || []).map((reaction) => ({
                        emoji: reaction.emoji,
                        senderName: reaction.senderName ?? null,
                        fromMe: reaction.fromMe ?? false,
                      }))}
                    />
                  </MessageErrorBoundary>
                );
              })}
              <div ref={messagesEndRef} />
            </div>}
        </div>
      </ScrollArea>
    </div>
  );
  const renderMessageInput = (mobile = false) => {
    const activeLeadId = activeConversation?.lead?.id || activeConversation?.lead_id;

    return (
    <div className={cn("p-3 border-t border-white/[0.055] shrink-0 bg-[var(--app-surface)]", mobile && "pb-2")}>
      <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" />
      <MessageBox
        value={messageText}
        onChange={setMessageText}
        onSend={handleSendMessage}
        onKeyDown={handleKeyPress}
        placeholder="Digite sua mensagem..."
        isSending={sendMessage.isPending}
        multiline
        inputRef={messageInputRef}
        showRightActionsWhenEmpty
        leftActions={
          <>
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="w-5 h-5" />
            </button>
            {activeLeadId && (
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
    </div>
    );
  };
  const conversationFilters = (
    <FloatingConversationFilters
      connectedSessions={connectedSessions}
      selectedSessionId={selectedSessionId}
      onSessionChange={setSelectedSessionId}
      searchTerm={searchTerm}
      onSearchChange={setSearchTerm}
      hideGroups={hideGroups}
      onHideGroupsChange={setHideGroups}
      showArchived={showArchived}
      onShowArchivedChange={setShowArchived}
    />
  );
  const ConversationList = () => <div className="flex-1 overflow-hidden min-h-0 w-full max-w-full overflow-x-hidden bg-[var(--app-surface)]">
      <ScrollArea className="h-full w-full max-w-full">
        <div className="flex flex-col w-full max-w-full">
          {loadingConversations || loadingSessions ? <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div> : !filteredConversations || filteredConversations.length === 0 ? <div className="flex flex-col items-center justify-center py-12 px-4">
              <MessageCircle className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">Nenhuma conversa</p>
            </div> : filteredConversations.map(conv => {
              const conversationDisplayName = conv.lead?.name || (conv.contact_name && conv.contact_name !== conv.contact_phone ? conv.contact_name : formatPhoneForDisplay(conv.contact_phone || ""));
              return <div key={conv.id} className="group grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/[0.055] hover:shadow-sm transition-all duration-200 border-b border-white/[0.055] active:bg-white/[0.06] w-full max-w-full overflow-hidden box-border relative" onClick={() => openConversation(conv)}>
                <Avatar className="h-9 w-9 shrink-0 ring-1 ring-primary/20 shadow-sm">
                  <AvatarImage src={getConversationAvatarUrl(conv)} />
                  <AvatarFallback className="text-xs bg-primary text-primary-foreground font-bold">
                    {conv.is_group ? <Users className="w-4 h-4" /> : conversationDisplayName?.[0] || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 overflow-hidden">
                  <div className="flex items-center gap-1.5 w-full overflow-hidden">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                      <p className="font-medium text-sm truncate min-w-0 leading-5">
                        {conversationDisplayName}
                      </p>
                      {conv.is_group && <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">
                          Grupo
                        </Badge>}
                      {conv.lead?.tags?.slice(0, 2).map((lt, idx) => (
                        <Badge
                          key={idx}
                          variant="secondary"
                          className="text-[8px] px-1.5 py-0 h-4 font-medium truncate max-w-[54px] shrink-0"
                          style={{
                            backgroundColor: `${lt.tag.color}20`,
                            color: lt.tag.color,
                            borderColor: lt.tag.color
                          }}
                        >
                          {lt.tag.name}
                        </Badge>
                      ))}
                      {(conv.lead?.tags?.length || 0) > 2 && (
                        <span className="text-[9px] text-muted-foreground shrink-0">
                          +{(conv.lead?.tags?.length || 0) - 2}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5 w-full overflow-hidden">
                    <p className="text-xs text-muted-foreground truncate flex-1 min-w-0" style={{
                maxWidth: '285px'
              }}>
                      {formatLastMessage(conv.last_message)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1.5 shrink-0 self-center min-w-[58px] max-w-[104px] overflow-hidden">
                  {conv.unread_count > 0 && <Badge className="h-5 min-w-5 flex items-center justify-center px-1.5 text-[10px] shrink-0">
                    {conv.unread_count}
                  </Badge>}
                  {conv.lead && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => handleViewLead(conv.lead!.id, e)}
                      title="Ver lead no Pipeline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                    {formatConversationTime(conv.last_message_at)}
                  </span>
                </div>
              </div>;
            })}
        </div>
      </ScrollArea>
    </div>;

  const activeLeadId = activeConversation?.lead?.id || activeConversation?.lead_id;
  const activeContactName =
    activeConversation?.lead?.name ||
    activeConversation?.contact_name ||
    activeConversation?.contact_phone ||
    undefined;

  // Mobile version - fullscreen fixed container (stable bottom input)
  if (isMobile) {
    return (
      <>
        {SessionSelectorDialog()}
        {activeLeadId && (
          <StartAutomationDialog
            open={showAutomationDialog}
            onOpenChange={setShowAutomationDialog}
            leadId={activeLeadId}
            conversationId={activeConversation?.id}
            contactName={activeContactName}
          />
        )}
        <div className="fixed inset-0 z-50 bg-[var(--app-surface)] flex flex-col overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
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
                {!isReadOnlyMode && hasConnectedSession && renderMessageInput(true)}
              </>
            ) : !hasConnectedSession ? (
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
      {activeLeadId && (
        <StartAutomationDialog
          open={showAutomationDialog}
          onOpenChange={setShowAutomationDialog}
          leadId={activeLeadId}
          conversationId={activeConversation?.id}
          contactName={activeContactName}
        />
      )}
      <div className={cn("fixed bottom-4 right-4 z-50", "bg-[var(--app-surface)]", "border border-white/[0.055]", "rounded-2xl", "shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)]", "ring-1 ring-white/[0.055]", "transition-all duration-300 ease-out", "flex flex-col overflow-hidden", "animate-scale-in", isMinimized ? "w-80 h-14" : "w-[420px] h-[600px]")}>
        {/* Header */}
        {FloatingChatHeader()}

        {isStartingConversation && (
          <div className="absolute inset-0 bg-background/50 flex flex-col items-center justify-center z-50">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
            <p className="text-xs text-muted-foreground animate-pulse">Iniciando conversa...</p>
          </div>
        )}

        {!isMinimized && (
          <>
            {activeConversation ? (
              <>
                {messagesViewJsx}
                {!isReadOnlyMode && hasConnectedSession && renderMessageInput(false)}
              </>
            ) : !hasConnectedSession ? (
              DisconnectedState()
            ) : (
              <>
                {conversationFilters}
                {ConversationList()}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
