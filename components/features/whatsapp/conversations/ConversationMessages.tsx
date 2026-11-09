import { useMemo, useState, type RefObject, type UIEventHandler } from "react";
import { Loader2, MessageSquare } from "lucide-react";

import { DateSeparator, shouldShowDateSeparator } from "@/components/features/whatsapp/DateSeparator";
import { MessageBubble } from "@/components/features/whatsapp/MessageBubble";
import { ScrollToLatestButton } from "@/components/features/whatsapp/ScrollToLatestButton";
import { LoadOlderMessagesButton } from "@/components/features/whatsapp/LoadOlderMessagesButton";
import { MessageErrorBoundary } from "@/components/features/whatsapp/MessageErrorBoundary";
import { AttendanceTimelineEvents } from "@/components/features/whatsapp/AttendanceTimelineEvents";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { WhatsAppMessage } from "@/hooks/use-whatsapp-conversations";
import type { WhatsAppAttendanceEntry } from "@/lib/api/whatsapp";
import { canReactToWhatsAppMessage, type GroupedWhatsAppReaction } from "@/lib/whatsapp-reactions";
import type { WhatsAppSenderAvatar } from "@/lib/whatsapp-avatar";
import { cn } from "@/lib/utils";
import { sortWhatsAppTimelineItems } from "@/lib/whatsapp-message-order";
import { getWhatsAppMessageGrouping, isWhatsAppMessageBlockStart } from "@/lib/whatsapp-message-grouping";
import type { MessageMediaGalleryItem } from "@/components/features/whatsapp/message-bubble/media-gallery-model";

import { canQuoteWhatsAppMessage } from "@/components/features/whatsapp/conversations/message-actions";
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
  senderAvatars?: ReadonlyMap<string, WhatsAppSenderAvatar>;
  viewerUserId?: string | null;
  viewerAvatarUrl?: string | null;
  viewerAvatarName?: string | null;
  isLoading: boolean;
  isError: boolean;
  onRetryMessages: () => void;
  hasOlderMessages: boolean;
  isLoadingOlder: boolean;
  olderMessagesFailed?: boolean;
  onLoadOlderMessages: () => void;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onScrollCapture?: UIEventHandler<HTMLDivElement>;
  onScrollToLatest?: () => void;
  atBottom?: boolean;
  canOperateWhatsApp: boolean;
  canOperateLeads: boolean;
  selectedLeadId: string | null;
  onRetryMedia: (messageId: string) => Promise<void>;
  reactionsByMessageId: Map<string, GroupedWhatsAppReaction[]>;
  onReact: (message: WhatsAppMessage, emoji: string) => Promise<unknown>;
  reactingMessageId?: string | null;
  attendanceEntries?: WhatsAppAttendanceEntry[];
  onReply?: (message: WhatsAppMessage) => void;
  onRecoverText?: (message: WhatsAppMessage) => void;
  onCheckSend?: (message: WhatsAppMessage) => Promise<unknown>;
  onOpenLead?: () => void;
  onDiscardLocal?: (message: WhatsAppMessage) => void;
  mediaGallery?: readonly MessageMediaGalleryItem[];
  mediaGalleryScopeKey?: string;
  onNavigateQuoted?: (message: WhatsAppMessage, id: string) => Promise<void> | void;
  firstUnreadMessageId?: string | null;
  unreadCount?: number;
};

type ConversationTimelineItem =
  | { kind: "message"; id: string; timestamp: string; message: DisplayMessage }
  | { kind: "attendance"; id: string; timestamp: string; entry: WhatsAppAttendanceEntry };

export function ConversationMessages({
  layout,
  activePlatform,
  conversation,
  messages,
  senderAvatars,
  viewerUserId,
  viewerAvatarUrl,
  viewerAvatarName,
  isLoading,
  isError,
  onRetryMessages,
  hasOlderMessages,
  isLoadingOlder,
  olderMessagesFailed = false,
  onLoadOlderMessages,
  messagesEndRef,
  onScrollCapture,
  onScrollToLatest,
  atBottom,
  canOperateWhatsApp,
  canOperateLeads,
  selectedLeadId,
  onRetryMedia,
  reactionsByMessageId,
  onReact,
  reactingMessageId,
  attendanceEntries = [],
  onReply,
  onRecoverText,
  onCheckSend,
  onOpenLead,
  onDiscardLocal,
  mediaGallery,
  mediaGalleryScopeKey,
  onNavigateQuoted,
  firstUnreadMessageId,
  unreadCount = 0,
}: ConversationMessagesProps) {
  const isMobile = layout === "mobile";
  const [scrollState, setScrollState] = useState({
    conversationId: conversation.id,
    awayFromBottom: false,
  });
  const showScrollToLatest = atBottom === undefined
    ? scrollState.conversationId === conversation.id && scrollState.awayFromBottom
    : !atBottom;
  const timelineItems = useMemo<ConversationTimelineItem[]>(() => {
    const messageItems: ConversationTimelineItem[] = messages.map((message) => ({
      kind: "message",
      id: `message-${message.id}`,
      timestamp: message.sent_at,
      message,
    }));
    if (activePlatform !== "whatsapp") return messageItems;

    return sortWhatsAppTimelineItems([
      ...messageItems,
      ...attendanceEntries.map((entry): ConversationTimelineItem => ({
        kind: "attendance",
        id: `attendance-${entry.id}`,
        timestamp: entry.markerAt ?? entry.joinedAt,
        entry,
      })),
    ]);
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
    if (onScrollToLatest) onScrollToLatest();
    else messagesEndRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  };

  return (
    <div
      {...(!isMobile ? { "data-tour": "conversations-messages" } : {})}
      className="relative min-h-0 flex-1 overflow-hidden bg-[var(--app-surface-soft)]"
    >
      <ScrollArea className="h-full [&_[data-radix-scroll-area-viewport]>div]:block! [&_[data-radix-scroll-area-viewport]>div]:min-w-0! [&_[data-radix-scroll-area-viewport]>div]:w-full" onScrollCapture={handleScrollCapture}>
        <div role="log" data-whatsapp-message-log aria-live="polite" aria-relevant="additions" className={cn(
          "min-h-full", isMobile ? "p-3" : "p-4",
        )}>
          {activePlatform === "whatsapp" && hasOlderMessages && (
            <div className="flex flex-col items-center justify-center gap-1.5 py-2">
              <LoadOlderMessagesButton
                onClick={onLoadOlderMessages}
                loading={isLoadingOlder}
                error={olderMessagesFailed}
              />
              {olderMessagesFailed && <p className="text-center text-[11px] text-destructive" role="alert">Não foi possível carregar mensagens anteriores. O histórico atual foi mantido.</p>}
            </div>
          )}
          {isError && timelineItems.length > 0 && (
            <div className="flex items-center justify-between gap-2 bg-muted/60 px-3 py-2 text-xs text-muted-foreground" role="status">
              <span>Não foi possível atualizar. Exibindo mensagens já carregadas.</span>
              <Button size="sm" variant="ghost" onClick={onRetryMessages}>Tentar novamente</Button>
            </div>
          )}
          {isLoading && timelineItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12" role="status" aria-live="polite">
              <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Carregando mensagens...</span>
            </div>
          ) : isError && timelineItems.length === 0 ? (
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
            const nextItem = timelineItems[index + 1];
            const grouping = item.kind === 'message'
              ? getWhatsAppMessageGrouping(previousItem?.kind === 'message' && item.message.id !== firstUnreadMessageId ? previousItem.message : null,
                item.message, nextItem?.kind === 'message' && nextItem.message.id !== firstUnreadMessageId ? nextItem.message : null)
              : 'single';
            const showSeparator = shouldShowDateSeparator(item.timestamp, previousItem?.timestamp || null);
            return (
              <div key={item.id} className={isWhatsAppMessageBlockStart(grouping) ? 'mt-2 first:mt-0' : 'mt-0.5'}>
                {showSeparator && <DateSeparator date={new Date(item.timestamp)} />}
                {item.kind === 'message' && item.message.id === firstUnreadMessageId && <div role="separator" aria-label="Mensagens não lidas" className="my-3 rounded-[6px] bg-[var(--app-surface-muted)] px-3 py-1.5 text-center text-xs font-light text-muted-foreground">Mensagens não lidas</div>}
                {item.kind === "attendance" ? (
                  <AttendanceTimelineEvents entries={[item.entry]} />
                ) : (
                  <MessageErrorBoundary messageId={item.message.id}>
                    <MessageBubble
                      content={item.message.content}
                      messageType={item.message.message_type}
                      mediaUrl={item.message.media_url}
                      mediaMimeType={item.message.media_mime_type}
                      mediaFilename={item.message.media_filename}
                      mediaSize={item.message.media_size}
                      mediaGallery={mediaGallery}
                      mediaGalleryScopeKey={mediaGalleryScopeKey}
                      onNavigateQuoted={onNavigateQuoted ? id => onNavigateQuoted(item.message as WhatsAppMessage, id) : undefined}
                      grouping={grouping}
                      showSenderName={conversation.is_group && isWhatsAppMessageBlockStart(grouping)}
                      contacts={item.message.contacts}
                      location={item.message.location}
                      quotedMessage={item.message.quoted_message}
                      canAttachToLead={canOperateLeads && !conversation.supervisory_lead_view}
                      onReply={onReply && canQuoteWhatsAppMessage(item.message as WhatsAppMessage)
                        ? () => onReply(item.message as WhatsAppMessage) : undefined}
                      onRecoverText={onRecoverText && item.message.content ? () => onRecoverText(item.message as WhatsAppMessage) : undefined}
                      onCheckSend={!conversation.supervisory_lead_view && onCheckSend && item.message.from_me ? () => onCheckSend(item.message as WhatsAppMessage) : undefined}
                      onOpenLead={canOperateLeads ? onOpenLead : undefined}
                      onDiscardLocal={!conversation.supervisory_lead_view && item.message.metadata?.local_delivery_state === "failed" && onDiscardLocal ? () => onDiscardLocal(item.message as WhatsAppMessage) : undefined}
                      mediaStatus={item.message.media_status ?? null}
                      mediaError={item.message.media_error ?? null}
                      storedMedia={Boolean(item.message.media_storage_path)}
                      fromMe={item.message.from_me}
                      status={item.message.status ?? ""}
                      sentAt={item.message.sent_at}
                      deliveryErrorCode={item.message.delivery_error_code ?? null}
                      deliveryErrorReason={item.message.delivery_error_reason}
                      deliveryFailedAt={item.message.delivery_failed_at ?? null}
                      senderName={item.message.sender_name ?? null}
                      senderUserId={item.message.sender_user_id}
                      senderAvatarUrl={senderAvatars?.get(item.message.sender_user_id?.trim().toLowerCase() || "")?.url}
                      senderAvatarUserId={senderAvatars?.get(item.message.sender_user_id?.trim().toLowerCase() || "")?.userId}
                      viewerUserId={viewerUserId}
                      viewerAvatarUrl={viewerAvatarUrl}
                      viewerAvatarName={viewerAvatarName}
                      isGroup={conversation.is_group}
                      onRetryMedia={!item.message.media_storage_path && canOperateWhatsApp ? () => onRetryMedia(item.message.id) : undefined}
                      messageId={item.message.id}
                      leadId={selectedLeadId || ""}
                      leadName={conversation.lead?.name || conversation.contact_name || "Contato"}
                      contactAvatarUrl={getConversationAvatarUrl(conversation)}
                      contactAvatarFallbackUrl={conversation.contact_picture}
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
        <ScrollToLatestButton onClick={handleScrollToLatest} unreadCount={unreadCount} />
      )}
    </div>
  );
}
