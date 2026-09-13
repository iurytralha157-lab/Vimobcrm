import { useState, type RefObject, type UIEventHandler } from "react";
import { ArrowDown, Loader2, MessageSquare } from "lucide-react";

import { DateSeparator, shouldShowDateSeparator } from "@/components/features/whatsapp/DateSeparator";
import { MessageBubble } from "@/components/features/whatsapp/MessageBubble";
import { MessageErrorBoundary } from "@/components/features/whatsapp/MessageErrorBoundary";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { WhatsAppMessage } from "@/hooks/use-whatsapp-conversations";
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
};

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
}: ConversationMessagesProps) {
  const isMobile = layout === "mobile";
  const [scrollState, setScrollState] = useState({
    conversationId: conversation.id,
    awayFromBottom: false,
  });
  const showScrollToLatest = scrollState.conversationId === conversation.id
    && scrollState.awayFromBottom;

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
          ) : messages.length === 0 ? (
            <div className={cn("flex flex-col items-center justify-center py-12", isMobile && "text-center")}>
              <MessageSquare className="w-8 h-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Nenhuma mensagem</p>
            </div>
          ) : messages.map((message, index) => {
            const previousMessage = index > 0 ? messages[index - 1] : null;
            const showSeparator = shouldShowDateSeparator(message.sent_at, previousMessage?.sent_at || null);
            return (
              <MessageErrorBoundary key={message.id} messageId={message.id}>
                {showSeparator && <DateSeparator date={new Date(message.sent_at)} />}
                <MessageBubble
                  content={message.content}
                  messageType={message.message_type}
                  mediaUrl={message.media_url}
                  mediaMimeType={message.media_mime_type}
                  mediaStatus={message.media_status ?? null}
                  mediaError={message.media_error ?? null}
                  fromMe={message.from_me}
                  status={message.status ?? "sent"}
                  sentAt={message.sent_at}
                  senderName={message.sender_name ?? null}
                  isGroup={conversation.is_group}
                  onRetryMedia={canOperateWhatsApp ? () => onRetryMedia(message.id) : undefined}
                  messageId={message.id}
                  leadId={canOperateLeads ? selectedLeadId || "" : ""}
                  leadName={conversation.lead?.name || conversation.contact_name || "Contato"}
                  contactAvatarUrl={getConversationAvatarUrl(conversation)}
                  conversationRemoteJid={conversation.remote_jid}
                  conversationSessionId={conversation.session_id}
                  reactionPickerPosition="outside"
                  reactions={(message.message_id ? reactionsByMessageId.get(message.message_id) : undefined)
                    || reactionsByMessageId.get(message.id)
                    || []}
                  onReact={activePlatform === "whatsapp"
                    && canOperateWhatsApp
                    && Boolean(conversation.session_id)
                    && Boolean(message.session_id)
                    && canReactToWhatsAppMessage(message)
                    ? (emoji) => onReact(message as WhatsAppMessage, emoji)
                    : undefined}
                  isReacting={reactingMessageId === message.id}
                />
              </MessageErrorBoundary>
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
