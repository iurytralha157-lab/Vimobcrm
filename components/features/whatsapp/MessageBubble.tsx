import { memo } from "react";
import { MessageCircleOff } from "lucide-react";

import type { GroupedWhatsAppReaction } from "@/lib/whatsapp-reactions";
import { cn } from "@/lib/utils";

import {
  formatMessageTime,
  getEffectiveMessageMediaKind,
  MessageMedia,
  MessageReactionBadges,
  MessageReactionPicker,
  MessageStatus,
  MessageText,
  toCanonicalMessageMediaKind,
  toSafeMessageText,
} from "./message-bubble";

export interface MessageBubbleProps {
  content: string | null;
  messageType: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaStatus: "pending" | "ready" | "failed" | null;
  mediaError: string | null;
  mediaSize?: number | null;
  fromMe: boolean;
  status: string;
  sentAt: string;
  senderName: string | null;
  isGroup: boolean;
  onRetryMedia?: () => void | Promise<void>;
  messageId: string;
  leadId: string;
  leadName: string;
  contactAvatarUrl?: string | null;
  conversationRemoteJid?: string | null;
  conversationSessionId?: string | null;
  compact?: boolean;
  reactionPickerPosition?: "inside" | "outside";
  reactions: GroupedWhatsAppReaction[];
  onReact?: (emoji: string) => unknown | Promise<unknown>;
  isReacting?: boolean;
}

const comparableMessageBubbleProps = [
  "content",
  "messageType",
  "mediaUrl",
  "mediaMimeType",
  "mediaStatus",
  "mediaError",
  "mediaSize",
  "fromMe",
  "status",
  "sentAt",
  "senderName",
  "isGroup",
  "messageId",
  "leadId",
  "leadName",
  "contactAvatarUrl",
  "conversationRemoteJid",
  "conversationSessionId",
  "compact",
  "reactionPickerPosition",
  "isReacting",
] as const satisfies readonly (keyof MessageBubbleProps)[];

function messageBubblePropsAreEqual(previous: MessageBubbleProps, next: MessageBubbleProps) {
  if (comparableMessageBubbleProps.some((key) => previous[key] !== next[key])) return false;
  if (Boolean(previous.onReact) !== Boolean(next.onReact)) return false;
  if (Boolean(previous.onRetryMedia) !== Boolean(next.onRetryMedia)) return false;
  if (previous.reactions === next.reactions) return true;
  if (previous.reactions.length !== next.reactions.length) return false;
  return previous.reactions.every((reaction, index) => {
    const nextReaction = next.reactions[index];
    return reaction.emoji === nextReaction?.emoji
      && reaction.senderName === nextReaction?.senderName
      && reaction.fromMe === nextReaction?.fromMe;
  });
}

export const MessageBubble = memo(function MessageBubble({
  content,
  messageType,
  mediaUrl,
  mediaMimeType,
  mediaStatus,
  mediaError,
  mediaSize,
  fromMe,
  status,
  sentAt,
  senderName,
  isGroup,
  onRetryMedia,
  messageId,
  leadId,
  leadName,
  contactAvatarUrl,
  conversationRemoteJid,
  conversationSessionId,
  compact = false,
  reactionPickerPosition = "inside",
  reactions = [],
  onReact,
  isReacting = false,
}: MessageBubbleProps) {
  const safeContent = toSafeMessageText(content);
  const mediaKind = getEffectiveMessageMediaKind(messageType, mediaMimeType, mediaUrl);
  const safeSenderName = toSafeMessageText(senderName).trim();
  const displaySenderName = safeSenderName || (fromMe ? "Você" : "");
  const audioAvatarName = fromMe
    ? displaySenderName
    : (toSafeMessageText(leadName).trim() || safeSenderName || "Contato");
  const audioAvatarInitial = audioAvatarName.charAt(0).toUpperCase() || (fromMe ? "V" : "C");
  const isMediaMessage = mediaKind !== "text" && mediaKind !== "reaction" && mediaKind !== "deleted";
  const isDeletedMessage = mediaKind === "deleted";
  const showInsideReactionPicker = reactionPickerPosition === "inside" && Boolean(onReact) && !isDeletedMessage;
  const showOutsideReactionPicker = reactionPickerPosition === "outside" && Boolean(onReact) && !isDeletedMessage;

  const outsideReactionPicker = showOutsideReactionPicker ? (
    <div
      data-message-reaction-outside
      className="relative z-30 flex shrink-0 self-center [&>div>button]:!rounded-full [&>div>button]:!bg-[var(--app-surface-soft)] [&>div>button]:!text-[var(--app-text-tertiary)] [&>div>button:hover]:!bg-[var(--app-surface-hover)] [&>div>button:hover]:!text-[var(--app-text-primary)]"
    >
      <MessageReactionPicker
        fromMe={fromMe}
        reactions={reactions}
        onReact={onReact}
        isReacting={isReacting}
      />
    </div>
  ) : null;

  if (mediaKind === "reaction") return null;

  return (
    <div
      className={cn(
        "flex w-full items-center gap-1 mb-1 animate-fade-in",
        fromMe ? "justify-end" : "justify-start",
      )}
    >
      {fromMe && outsideReactionPicker}
      <div className={cn(
        "max-w-[85%] sm:max-w-[75%] flex flex-col",
        fromMe ? "items-end" : "items-start",
      )}>
        <div className={cn(
          "relative overflow-visible rounded-[8px] border-0 shadow-none transition-colors duration-200",
          fromMe
            ? "rounded-tr-[4px] bg-primary text-primary-foreground"
            : "rounded-tl-[4px] bg-[var(--app-surface-soft)] text-[var(--app-text-primary)]",
          (mediaKind === "image" || mediaKind === "video") && !content ? "p-[3px]" : "px-3 py-2",
        )}>
          {isMediaMessage && (
            <>
              {!fromMe && displaySenderName && (
                <p className={cn(compact ? "text-[11px]" : "text-xs", "mb-0.5 font-normal text-primary")}>{displaySenderName}</p>
              )}
              {fromMe && displaySenderName && (
                <p className="mb-0.5 text-[11px] font-normal opacity-70">{displaySenderName}</p>
              )}
              <MessageMedia
                mediaKind={toCanonicalMessageMediaKind(mediaKind)}
                content={safeContent}
                mediaUrl={mediaUrl}
                mediaMimeType={mediaMimeType}
                mediaStatus={mediaStatus}
                mediaError={mediaError}
                mediaSize={mediaSize}
                fromMe={fromMe}
                status={status}
                sentAt={sentAt}
                onRetryMedia={onRetryMedia}
                messageId={messageId}
                leadId={leadId}
                leadName={leadName}
                contactAvatarUrl={contactAvatarUrl}
                audioAvatarName={audioAvatarName}
                audioAvatarInitial={audioAvatarInitial}
                compact={compact}
              />
              {reactionPickerPosition === "inside" && onReact && !isDeletedMessage && (
                <div className={cn("mt-1 flex px-0.5 pb-0.5", fromMe ? "justify-start" : "justify-end")}>
                  <MessageReactionPicker
                    fromMe={fromMe}
                    reactions={reactions}
                    onReact={onReact}
                    isReacting={isReacting}
                  />
                </div>
              )}
            </>
          )}

          {!isMediaMessage && (
            <div className="flex min-w-0 flex-col">
              <div className="min-w-0">
                {!fromMe && displaySenderName && (
                  <p className={cn(compact ? "text-[11px]" : "text-xs", "mb-0.5 font-normal text-primary")}>{displaySenderName}</p>
                )}
                {fromMe && displaySenderName && (
                  <p className="mb-0.5 text-[11px] font-normal opacity-70">{displaySenderName}</p>
                )}
                {isDeletedMessage && (
                  <div className="flex items-center gap-1.5 text-[13.5px] italic opacity-75">
                    <MessageCircleOff className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Esta mensagem foi apagada</span>
                  </div>
                )}
                {safeContent && mediaKind === "text" && (
                  <MessageText
                    content={safeContent}
                    fromMe={fromMe}
                    groupJid={isGroup ? conversationRemoteJid : null}
                    sessionId={isGroup ? conversationSessionId : null}
                    compact={compact}
                  />
                )}
              </div>

              <div
                data-message-metadata
                data-message-direction={fromMe ? "outgoing" : "incoming"}
                className="mt-1 flex min-h-4 w-full items-end gap-2"
              >
                {fromMe && (
                  <span
                    data-message-timestamp-position="bottom-left"
                    className="mr-auto flex items-center justify-start gap-0.5 whitespace-nowrap text-primary-foreground/60"
                  >
                    <span className="text-[11px] leading-none">{formatMessageTime(sentAt)}</span>
                    <MessageStatus fromMe={fromMe} status={status} />
                  </span>
                )}
                {showInsideReactionPicker && (
                  <MessageReactionPicker
                    fromMe={fromMe}
                    reactions={reactions}
                    onReact={isDeletedMessage ? undefined : onReact}
                    isReacting={isReacting}
                  />
                )}
                {!fromMe && (
                  <span
                    data-message-timestamp-position="bottom-right"
                    className="ml-auto flex items-center justify-end gap-0.5 whitespace-nowrap text-[var(--app-text-tertiary)]"
                  >
                    <span className="text-[11px] leading-none">{formatMessageTime(sentAt)}</span>
                  </span>
                )}
              </div>
            </div>
          )}

          <MessageReactionBadges fromMe={fromMe} reactions={reactions} />
        </div>
      </div>
      {!fromMe && outsideReactionPicker}
    </div>
  );
}, messageBubblePropsAreEqual);

MessageBubble.displayName = "MessageBubble";
