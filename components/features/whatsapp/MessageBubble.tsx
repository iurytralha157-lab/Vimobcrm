import { memo, useRef, useState } from "react";
import { AlertCircle, Copy, MessageCircleOff, RefreshCw } from "lucide-react";

import type { GroupedWhatsAppReaction } from "@/lib/whatsapp-reactions";
import { cn } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/clipboard";
import { formatWhatsAppPersonName } from "@/lib/whatsapp-person-name";
import { getWhatsAppAvatarCandidates } from "@/lib/whatsapp-avatar";
import { useWhatsAppMediaVisibility } from "@/hooks/whatsapp/use-whatsapp-media-visibility";
import { getAttachableMessageMediaUrl } from "@/components/features/whatsapp/message-media";
import { useWhatsAppMessageMediaURL } from "@/hooks/use-whatsapp-message-media-url";
import { MessageQuotePreview, MessageStructuredContent, type MessageContactCard, type MessageLocation, type MessageQuotedPreview } from "./message-bubble/MessageStructuredContent";
import { MessageBubbleActions } from "./message-bubble/MessageBubbleActions";
import type { MessageMediaGalleryItem } from "./message-bubble/media-gallery-model";
import { getMessageAuthorPresentation } from "@/components/features/whatsapp/message-bubble/message-author-model";

import {
  formatDeliveryFailureTime,
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
  mediaFilename?: string | null;
  mediaStatus: "pending" | "ready" | "failed" | null;
  mediaError: string | null;
  storedMedia?: boolean;
  mediaURLLoading?: boolean;
  mediaSize?: number | null;
  fromMe: boolean;
  status: string;
  sentAt: string;
  deliveryErrorCode?: "recipient_not_registered" | "outcome_unknown" | "send_failed" | null;
  deliveryErrorReason?: "media_integrity_unverified";
  deliveryFailedAt?: string | null;
  senderName: string | null;
  senderUserId?: string | null;
  viewerUserId?: string | null;
  viewerAvatarUrl?: string | null;
  viewerAvatarName?: string | null;
  senderAvatarUrl?: string | null;
  senderAvatarUserId?: string | null;
  isGroup: boolean;
  onRetryMedia?: () => void | Promise<void>;
  messageId: string;
  leadId: string;
  leadName: string;
  contactAvatarUrl?: string | null;
  contactAvatarFallbackUrl?: string | null;
  conversationRemoteJid?: string | null;
  conversationSessionId?: string | null;
  compact?: boolean;
  plainHistory?: boolean;
  leadHistory?: boolean;
  reactionPickerPosition?: "inside" | "outside";
  reactions: GroupedWhatsAppReaction[];
  onReact?: (emoji: string) => unknown | Promise<unknown>;
  isReacting?: boolean;
  contacts?: MessageContactCard[] | null;
  location?: MessageLocation | null;
  quotedMessage?: MessageQuotedPreview | null;
  onReply?: () => void;
  onRecoverText?: () => void;
  onCheckSend?: () => Promise<unknown>;
  onOpenLead?: () => void;
  onDiscardLocal?: () => void;
  canAttachToLead?: boolean;
  grouping?: "single" | "first" | "middle" | "last";
  showSenderName?: boolean;
  mediaGallery?: readonly MessageMediaGalleryItem[];
  mediaGalleryScopeKey?: string;
  onNavigateQuoted?: (messageId: string) => void | Promise<void>;
}

const comparableMessageBubbleProps = [
  "content",
  "messageType",
  "mediaUrl",
  "mediaMimeType",
  "mediaFilename",
  "mediaStatus",
  "mediaError",
  "storedMedia",
  "mediaURLLoading",
  "mediaSize",
  "fromMe",
  "status",
  "sentAt",
  "deliveryErrorCode",
  "deliveryErrorReason",
  "deliveryFailedAt",
  "senderName",
  "senderUserId", "viewerUserId",
  "viewerAvatarUrl", "viewerAvatarName", "senderAvatarUrl", "senderAvatarUserId",
  "isGroup",
  "messageId",
  "leadId",
  "leadName",
  "contactAvatarUrl", "contactAvatarFallbackUrl",
  "conversationRemoteJid",
  "conversationSessionId",
  "compact",
  "plainHistory",
  "leadHistory",
  "reactionPickerPosition",
  "isReacting",
  "contacts", "location", "quotedMessage",
  "canAttachToLead",
  "grouping", "showSenderName", "mediaGallery", "mediaGalleryScopeKey", "onNavigateQuoted",
] as const satisfies readonly (keyof MessageBubbleProps)[];

function messageBubblePropsAreEqual(previous: MessageBubbleProps, next: MessageBubbleProps) {
  if (comparableMessageBubbleProps.some((key) => previous[key] !== next[key])) return false;
  if (Boolean(previous.onReact) !== Boolean(next.onReact)) return false;
  if (Boolean(previous.onRetryMedia) !== Boolean(next.onRetryMedia)) return false;
  if (["onReply", "onRecoverText", "onCheckSend", "onOpenLead", "onDiscardLocal"].some((key) => previous[key as keyof MessageBubbleProps] !== next[key as keyof MessageBubbleProps])) return false;
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
  mediaFilename,
  mediaStatus,
  mediaError,
  mediaURLLoading,
  storedMedia,
  mediaSize,
  fromMe,
  status,
  sentAt,
  deliveryErrorCode,
  deliveryErrorReason,
  deliveryFailedAt,
  senderName,
  senderUserId, viewerUserId,
  viewerAvatarUrl, viewerAvatarName, senderAvatarUrl, senderAvatarUserId,
  isGroup,
  onRetryMedia,
  messageId,
  leadId,
  leadName,
  contactAvatarUrl, contactAvatarFallbackUrl,
  conversationRemoteJid,
  conversationSessionId,
  compact = false,
  plainHistory = false,
  leadHistory = false,
  reactionPickerPosition = "inside",
  reactions = [],
  onReact,
  isReacting = false,
  contacts, location, quotedMessage, onReply, onCheckSend,
  canAttachToLead = false,
  grouping = "single",
  showSenderName = true,
  mediaGallery,
  mediaGalleryScopeKey,
  onNavigateQuoted,
}: MessageBubbleProps) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const contextMenuPointerType = useRef<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionFeedback, setActionFeedback] = useState("");
  const [checkingSend, setCheckingSend] = useState(false);
  const mediaVisible = useWhatsAppMediaVisibility(bubbleRef, JSON.stringify([leadId, conversationSessionId, messageId]), Boolean(storedMedia));
  const storedSource = useWhatsAppMessageMediaURL({ messageId, leadId,
    sessionId: conversationSessionId, storedMedia, mediaUrl, enabled: mediaVisible, leadHistory });
  const safeContent = toSafeMessageText(content);
  const mediaKind = getEffectiveMessageMediaKind(messageType, mediaMimeType, storedSource.mediaUrl);
  const safeSenderName = toSafeMessageText(senderName).trim();
  const author = getMessageAuthorPresentation({ fromMe, senderName, senderUserId, viewerUserId });
  const avatarAuthor = getMessageAuthorPresentation({ fromMe, senderUserId, viewerUserId: senderAvatarUserId });
  const displaySenderName = fromMe ? author.bubbleSenderLabel : safeSenderName ? author.senderLabel : "";
  const audioAvatarCandidates = getWhatsAppAvatarCandidates(
    fromMe ? author.isViewerAuthor ? viewerAvatarUrl : null : contactAvatarUrl,
    fromMe && avatarAuthor.isViewerAuthor ? senderAvatarUrl : null,
  );
  const audioAvatarUrl = audioAvatarCandidates[0] ?? null;
  const audioAvatarName = fromMe
    ? author.isViewerAuthor ? formatWhatsAppPersonName(toSafeMessageText(viewerAvatarName)) || displaySenderName : displaySenderName
    : (formatWhatsAppPersonName(toSafeMessageText(leadName)) || formatWhatsAppPersonName(safeSenderName) || "Contato");
  const audioAvatarInitial = audioAvatarName.charAt(0).toUpperCase() || (fromMe ? "V" : "C");
  const isMediaMessage = mediaKind !== "text" && mediaKind !== "reaction" && mediaKind !== "deleted";
  const isDeletedMessage = mediaKind === "deleted";
  const canAttachMedia = Boolean(canAttachToLead && leadId && isMediaMessage
    && getAttachableMessageMediaUrl(storedSource.mediaUrl, toCanonicalMessageMediaKind(mediaKind)));
  const attachmentScope = JSON.stringify([messageId, leadId, conversationSessionId, canAttachMedia]);
  const [attachmentDialog, setAttachmentDialog] = useState({ scope: attachmentScope, open: false });
  const currentAttachmentDialog = attachmentDialog.scope === attachmentScope
    ? attachmentDialog : { scope: attachmentScope, open: false };
  if (attachmentDialog.scope !== attachmentScope) setAttachmentDialog(currentAttachmentDialog);
  const changeAttachmentDialog = (open: boolean) => setAttachmentDialog(current => current.scope === attachmentScope
    ? { scope: attachmentScope, open: open && canAttachMedia } : current);
  const restoreAttachmentFocus = () => {
    const row = bubbleRef.current;
    if (row?.dataset.messageId === messageId) row.querySelector<HTMLButtonElement>("[data-message-menu-outside]")?.focus({ preventScroll: true });
  };
  const isContentUnavailable = plainHistory && mediaKind === "text" && !safeContent.trim();
  const showInsideReactionPicker = reactionPickerPosition === "inside" && Boolean(onReact) && !isDeletedMessage;
  const showOutsideReactionPicker = reactionPickerPosition === "outside" && Boolean(onReact) && !isDeletedMessage;
  const unconfirmedOutgoing = fromMe && (status === "confirming" || status === "unconfirmed" ||
    (deliveryErrorCode === "outcome_unknown" && (status === "failed" || status === "error")));
  const failedOutgoing = fromMe && !unconfirmedOutgoing &&
    (status === "failed" || status === "error") && Boolean(deliveryErrorCode);
  const deliveryFailureText = deliveryErrorCode === "recipient_not_registered"
    ? "Não enviada: este número não possui WhatsApp. Confira o telefone do lead. Após corrigir, inicie uma conversa pelo lead; esta conversa mantém o número original."
    : deliveryErrorCode === "send_failed" && deliveryErrorReason === "media_integrity_unverified"
      ? "Não enviada: não foi possível confirmar o arquivo desta mensagem. Anexe o arquivo novamente para enviar."
      : "Não enviada. Houve uma falha no envio.";
  const deliveryFailureTime = deliveryFailedAt ? formatDeliveryFailureTime(deliveryFailedAt) : "";
  const canReply = Boolean(onReply) && !isDeletedMessage && ["sent", "delivered", "read", "played", "received"].includes(status);
  const copyContent = async () => {
    try {
      const copied = await copyTextToClipboard(safeContent, { preserveWhitespace: true });
      setActionFeedback(copied ? "Texto copiado." : "Não foi possível copiar. Selecione o texto para copiar.");
    }
    catch { setActionFeedback("Não foi possível copiar. Selecione o texto para copiar."); }
  };
  const checkSend = async () => {
    if (!onCheckSend || checkingSend) return;
    setCheckingSend(true);
    try {
      const resolution = await onCheckSend();
      if (resolution === "cancelled") return;
      setActionFeedback(resolution === "pending" ? "O envio continua aguardando confirmação."
        : resolution === "accepted" ? "O envio está registrado na conversa."
          : resolution === "failed" ? "A tentativa de envio falhou." : "Estado do envio atualizado.");
    }
    catch { setActionFeedback("Não foi possível verificar o envio agora."); }
    finally { setCheckingSend(false); }
  };
  const navigateToQuoted = async (id: string) => {
    const log = bubbleRef.current?.closest('[role="log"]');
    const target = log?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
    if (target) { target.scrollIntoView({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); target.focus({ preventScroll: true }); }
    else if (onNavigateQuoted) {
      try { await onNavigateQuoted(id); } catch { setActionFeedback("Não foi possível localizar a mensagem citada agora."); }
    } else setActionFeedback("A mensagem citada não está carregada. Consulte as mensagens anteriores.");
  };

  const outsideActions = <MessageBubbleActions fromMe={fromMe} reactions={reactions}
    onReact={showOutsideReactionPicker ? onReact : undefined} isReacting={isReacting} onReply={canReply ? onReply : undefined}
    menu={{ content: isDeletedMessage ? "" : safeContent, status: unconfirmedOutgoing ? "unconfirmed" : status, sentAt, fromMe, senderName, senderUserId, viewerUserId, messageType: mediaKind, mediaFilename, mediaSize, onCopy: copyContent, onReply: canReply ? onReply : undefined, onAttach: canAttachMedia ? () => changeAttachmentDialog(true) : undefined, open: menuOpen, onOpenChange: setMenuOpen }} />;

  if (mediaKind === "reaction") return null;

  return (
    <div
      ref={bubbleRef}
      data-message-id={messageId}
      data-message-group={grouping}
      tabIndex={-1}
      onPointerDownCapture={event => { contextMenuPointerType.current = event.pointerType || null; }}
      onKeyDownCapture={() => { contextMenuPointerType.current = null; }}
      className={cn(
        "group/message flex w-full items-center gap-1 rounded-[8px] outline-none focus-visible:outline-none focus-visible:bg-[var(--app-surface-hover)] animate-fade-in motion-reduce:animate-none",
        grouping === "first" || grouping === "middle" ? "mb-0.5" : "mb-2",
        fromMe ? "justify-end" : "justify-start",
      )}
    >
      {fromMe && outsideActions}
      <div className={cn(
        "min-w-0 max-w-[85%] sm:max-w-[75%] flex flex-col",
        fromMe ? "items-end" : "items-start",
      )}>
        <div data-message-bubble className={cn(
          "relative min-w-0 max-w-full overflow-visible rounded-[8px] border-0 shadow-none transition-colors duration-200",
          fromMe
            ? "rounded-tr-[4px] bg-primary text-primary-foreground"
            : cn("rounded-tl-[4px] text-[var(--app-text-primary)]", plainHistory ? "bg-[var(--lead-history-message-bg)]" : "bg-[var(--app-surface-soft)]"),
          grouping === "middle" && (fromMe ? "rounded-tr-[4px] rounded-br-[4px]" : "rounded-tl-[4px] rounded-bl-[4px]"),
          grouping === "last" && (fromMe ? "rounded-tr-[4px]" : "rounded-tl-[4px]"),
          grouping === "first" && (fromMe ? "rounded-br-[4px]" : "rounded-bl-[4px]"),
          (mediaKind === "image" || mediaKind === "video") && !content ? "p-[3px]" : "px-3 py-2",
        )} onContextMenu={(event) => {
          if (event.target instanceof Element && event.target.closest("a,button,input,textarea,video,audio")) return;
          const pointerType = "pointerType" in event.nativeEvent && typeof event.nativeEvent.pointerType === "string" && event.nativeEvent.pointerType
            ? event.nativeEvent.pointerType : contextMenuPointerType.current;
          // Touch/pen long presses keep native selection, including legacy
          // compatibility mouse events. A new mouse/keyboard input resets it.
          if (pointerType === "touch" || pointerType === "pen") return;
          event.preventDefault(); setMenuOpen(true);
        }}>
          {quotedMessage && <MessageQuotePreview quote={quotedMessage} viewerUserId={viewerUserId} onNavigate={navigateToQuoted} />}
          <MessageStructuredContent contacts={contacts} location={location} />
          {isMediaMessage && (
            <>
              {showSenderName && !fromMe && displaySenderName && (
                <p className={cn(compact ? "text-[11px]" : "text-xs", "mb-0.5 font-normal text-primary")}>{displaySenderName}</p>
              )}
              {showSenderName && fromMe && displaySenderName && (
                <p className="mb-0.5 text-[11px] font-normal opacity-70">{displaySenderName}</p>
              )}
              <MessageMedia
                mediaKind={toCanonicalMessageMediaKind(mediaKind)}
                content={safeContent}
                mediaUrl={storedSource.mediaUrl}
                playbackIdentity={storedSource.playbackIdentity}
                mediaMimeType={mediaMimeType}
                mediaFilename={mediaFilename}
                mediaStatus={storedSource.failed ? "failed" : mediaStatus}
                mediaError={storedSource.failed ? "Não foi possível abrir a mídia. Tente atualizar o link." : mediaError}
                mediaURLLoading={storedSource.isLoading || Boolean(storedMedia && !storedSource.mediaUrl && !storedSource.failed && mediaStatus !== "failed") || mediaURLLoading}
                mediaSize={mediaSize}
                fromMe={fromMe}
                status={unconfirmedOutgoing ? "unconfirmed" : status}
                sentAt={sentAt}
                onRetryMedia={onRetryMedia}
                onRefreshMedia={storedSource.refresh}
                messageId={messageId}
                leadId={canAttachToLead ? leadId : ""}
                leadName={leadName}
                attachConfirmOpen={canAttachMedia && currentAttachmentDialog.open}
                onAttachConfirmOpenChange={changeAttachmentDialog}
                onAttachDialogClose={restoreAttachmentFocus}
                contactAvatarUrl={mediaKind === "audio" ? audioAvatarUrl : contactAvatarUrl}
                contactAvatarFallbackUrl={!fromMe ? contactAvatarFallbackUrl : null}
                audioAvatarFallbackUrl={fromMe ? audioAvatarCandidates[1] : null}
                audioAvatarName={audioAvatarName}
                audioAvatarInitial={audioAvatarInitial}
                compact={compact}
                mediaGallery={mediaGallery}
                mediaGalleryScopeKey={mediaGalleryScopeKey}
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
                {showSenderName && !fromMe && displaySenderName && (
                  <p className={cn(compact ? "text-[11px]" : "text-xs", "mb-0.5 font-normal text-primary")}>{displaySenderName}</p>
                )}
                {showSenderName && fromMe && displaySenderName && (
                  <p className="mb-0.5 text-[11px] font-normal opacity-70">{displaySenderName}</p>
                )}
                {isDeletedMessage && (
                  <div className="flex items-center gap-1.5 text-[12px] font-[200] italic opacity-75">
                    <MessageCircleOff className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Esta mensagem foi apagada</span>
                  </div>
                )}
                {isContentUnavailable && (
                  <span className="text-[11px] italic opacity-75">Conteúdo indisponível</span>
                )}
                {!isContentUnavailable && safeContent && mediaKind === "text" && (
                  <MessageText
                    content={safeContent}
                    fromMe={fromMe}
                    groupJid={isGroup ? conversationRemoteJid : null}
                    sessionId={isGroup ? conversationSessionId : null}
                    leadId={leadId || null}
                    compact={compact}
                  />
                )}
              </div>

              <div
                data-message-metadata
                data-message-direction={fromMe ? "outgoing" : "incoming"}
                className="mt-1 flex min-h-4 w-full items-end gap-2"
              >
                {!fromMe && (
                  <span
                    data-message-timestamp-position="bottom-left"
                    className="mr-auto flex items-center justify-start gap-0.5 whitespace-nowrap text-[var(--app-text-tertiary)]"
                  >
                    <span className="text-[10px] leading-none">{formatMessageTime(sentAt)}</span>
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
                {fromMe && (
                  <span
                    data-message-timestamp-position="bottom-right"
                    className="ml-auto flex items-center justify-end gap-0.5 whitespace-nowrap text-primary-foreground/60"
                  >
                    <span className="text-[10px] leading-none">{formatMessageTime(sentAt)}</span>
                    <MessageStatus compact fromMe={fromMe} status={unconfirmedOutgoing ? "unconfirmed" : status} />
                  </span>
                )}
              </div>
            </div>
          )}

          <MessageReactionBadges fromMe={fromMe} reactions={reactions} />
        </div>
        {(failedOutgoing || unconfirmedOutgoing) && (
          <div role="status" className={cn(
            "mt-1 flex max-w-full items-start gap-1",
            unconfirmedOutgoing ? "text-xs text-amber-600" : "text-[10px] font-light leading-[14px] text-destructive",
          )}>
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {unconfirmedOutgoing
                ? "Envio não confirmado. Não reenvie até confirmar o estado."
                : deliveryFailureText}
              {deliveryFailureTime && (
                <> {unconfirmedOutgoing ? "Estado registrado" : "Falha registrada"} em {deliveryFailureTime}.</>
              )}
            </span>
          </div>
        )}
        {unconfirmedOutgoing && <div className="mt-1 flex flex-wrap gap-2 text-xs">
          {safeContent.trim() && <button type="button" className="inline-flex items-center gap-1 underline" onClick={() => void copyContent()}><Copy className="h-3 w-3" aria-hidden="true" />Copiar texto</button>}
          {onCheckSend && <button type="button" className="inline-flex items-center gap-1 underline" disabled={checkingSend} onClick={() => void checkSend()}><RefreshCw className="h-3 w-3" aria-hidden="true" />{checkingSend ? "Verificando..." : "Verificar envio"}</button>}
        </div>}
        {actionFeedback && <p role="status" className="mt-1 text-xs text-muted-foreground">{actionFeedback}</p>}
      </div>
      {!fromMe && outsideActions}
    </div>
  );
}, messageBubblePropsAreEqual);

MessageBubble.displayName = "MessageBubble";
