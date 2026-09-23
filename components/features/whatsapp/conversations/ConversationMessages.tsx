import { useMemo, useState, type RefObject, type UIEventHandler } from "react";
import { ArrowDown, Loader2, MessageSquare } from "lucide-react";

import { DateSeparator, shouldShowDateSeparator } from "@/components/features/whatsapp/DateSeparator";
import { MessageBubble } from "@/components/features/whatsapp/MessageBubble";
import { MessageErrorBoundary } from "@/components/features/whatsapp/MessageErrorBoundary";
import { AttendanceTimelineEvents } from "@/components/features/whatsapp/AttendanceTimelineEvents";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { WhatsAppMessage } from "@/hooks/use-whatsapp-conversations";
import type { WhatsAppAttendanceEntry } from "@/lib/api/whatsapp";
import { canReactToWhatsAppMessage, type GroupedWhatsAppReaction } from "@/lib/whatsapp-reactions";
import { cn } from "@/lib/utils";

import {
  getConversationAvatarUrl,
  type ConversationPlatform,
  type DisplayMessage,
  type ScreenConversation,
} from "./conversation-model";

type ConversationMessagesProps = {
  layout: "mobile" | "desktop";
  activePlatform: ConversationPlatform;
  conversation: ScreenConversation;
  messages: DisplayMessage[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  onRetryMessages: () => void;
  hasOlderMessages: boolean;
  isLoadingOlder: boolean;
  onLoadOlderMessages: () => void;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onScrollCapture?: UIEventHandler<HTMLDivElement>;
  canOperateWhatsApp: boolean;
  canOperateLeads: boolean;
  selectedLeadId: string | null;
  onRetryMedia: (messageId: string) => Promise<void>;
  reactionsByMessageId: Map<string, GroupedWhatsAppReaction[]>;
  onReact: (message: WhatsAppMessage, emoji: string) => Promise<unknown>;
  reactingMessageId?: string | null;
  attendanceEntries?: WhatsAppAttendanceEntry[];
};

type ConversationTimelineItem =
  | { kind: "message"; id: string; timestamp: string; message: DisplayMessage }
  | { kind: "attendance"; id: string; timestamp: string; entry: WhatsAppAttendanceEntry };

export function ConversationMessages({
  layout,
  activePlatform,
  conversation,
  messages,
  isLoading,
  isFetching,
  isError,
  onRetryMessages,
  hasOlderMessages,
  isLoadingOlder,
  onLoadOlderMessages,
  messagesEndRef,
  onScrollCapture,
  canOperateWhatsApp,
  canOperateLeads,
  selectedLeadId,
  onRetryMedia,
  reactionsByMessageId,
  onReact,
  reactingMessageId,
  attendanceEntries = [],
}: ConversationMessagesProps) {
  const isMobile = layout === "mobile";
  const [scrollState, setScrollState] = useState({
    conversationId: conversation.id,
    awayFromBottom: false,
  });
  const showScrollToLatest = scrollState.conversationId === conversation.id
    && scrollState.awayFromBottom;
  const timelineItems = useMemo<ConversationTimelineItem[]>(() => {
    const messageItems: ConversationTimelineItem[] = messages.map((message) => ({
      kind: "message",
      id: `message-${message.id}`,
      timestamp: message.sent_at,
      message,
    }));
    if (activePlatform !== "whatsapp") return messageItems;

    return [
      ...messageItems,
      ...attendanceEntries.map((entry): ConversationTimelineItem => ({
        kind: "attendance",
        id: `attendance-${entry.id}`,
        timestamp: entry.joinedAt,
        entry,
      })),
    ].sort((left, right) => (
      new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
    ));
  }, [activePlatform, attendanceEntries, messages]);

  const handleScrollCapture: UIEventHandler<HTMLDivElement> = (event) => {
    const target = event.currentTarget.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]")
      || event.currentTarget;
    const awayFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight >= 50;
    setScrollState((current) => (
      current.conversationId === conversation.id && current.awayFromBottom === awayFromBottom
        ? current
        : { conversationId: conversation.id, awayFromBottom }
    ));
    onScrollCapture?.(event);
  };

  const handleScrollToLatest = () => {
    setScrollState({ conversationId: conversation.id, awayFromBottom: false });
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div
      {...(!isMobile ? { "data-tour": "conversations-messages" } : {})}
      className="relative flex-1 overflow-hidden min-h-0"
    >
      <ScrollArea className="h-full" onScrollCapture={handleScrollCapture}>
        <div className={cn(
          "space-y-2",
          isMobile
            ? "p-3 bg-[var(--app-background)] min-h-full"
            : "bg-[var(--app-surface-soft)] p-4",
        )}>
          {activePlatform === "whatsapp" && hasOlderMessages && (
            <div className="flex justify-center py-2">
              <Button
                type="button"
                data-load-older-messages
                variant="default"
                size="sm"
                className="h-8 rounded-[6px] bg-primary px-3 text-[11px] font-medium text-primary-foreground shadow-none hover:bg-primary/90 hover:text-primary-foreground"
                onClick={onLoadOlderMessages}
                disabled={isLoadingOlder}
              >
                {isLoadingOlder ? (
                  <Loader2 className={isMobile ? "w-3 h-3 animate-spin mr-2" : "mr-2 h-3 w-3 animate-spin"} />
                ) : null}
                Carregar mensagens anteriores
              </Button>
            </div>
          )}
          {isLoading || (isFetching && messages.length === 0) ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12" role="status" aria-live="polite">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Carregando mensagens...</span>
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center" role="alert">
              <MessageSquare className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">Não foi possível carregar as mensagens</p>
                <p className="mt-1 text-xs text-muted-foreground">Tente novamente sem sair da conversa.</p>
              </div>
              <Button size="sm" variant="secondary" onClick={onRetryMessages}>Tentar novamente</Button>
            </div>
          ) : timelineItems.length === 0 ? (
            <div className={cn("flex flex-col items-center justify-center py-12", isMobile && "text-center")}>
              <MessageSquare className="w-8 h-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Nenhuma mensagem</p>
            </div>
          ) : timelineItems.map((item, index) => {
            const previousItem = index > 0 ? timelineItems[index - 1] : null;
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
                      mediaUrl={item.message.media_url}
                      mediaMimeType={item.message.media_mime_type}
                      mediaStatus={item.message.media_status ?? null}
                      mediaError={item.message.media_error ?? null}
                      fromMe={item.message.from_me}
                      status={item.message.status ?? "sent"}
                      sentAt={item.message.sent_at}
                      senderName={item.message.sender_name ?? null}
                      isGroup={conversation.is_group}
                      onRetryMedia={canOperateWhatsApp ? () => onRetryMedia(item.message.id) : undefined}
                      messageId={item.message.id}
                      leadId={canOperateLeads ? selectedLeadId || "" : ""}
                      leadName={conversation.lead?.name || conversation.contact_name || "Contato"}
                      contactAvatarUrl={getConversationAvatarUrl(conversation)}
                      conversationRemoteJid={conversation.remote_jid}
                      conversationSessionId={conversation.session_id}
                      reactionPickerPosition="outside"
                      reactions={(item.message.message_id ? reactionsByMessageId.get(item.message.message_id) : undefined)
                        || reactionsByMessageId.get(item.message.id)
                        || []}
                      onReact={activePlatform === "whatsapp"
                        && canOperateWhatsApp
                        && Boolean(conversation.session_id)
                        && Boolean(item.message.session_id)
                        && canReactToWhatsAppMessage(item.message)
                        ? (emoji) => onReact(item.message as WhatsAppMessage, emoji)
                        : undefined}
                      isReacting={reactingMessageId === item.message.id}
                    />
                  </MessageErrorBoundary>
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
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
}
