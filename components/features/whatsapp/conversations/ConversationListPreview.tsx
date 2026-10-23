import { MessageStatus } from "@/components/features/whatsapp/message-bubble/MessageStatus";
import { collectNumericMentions, parseMessageInline, type MessageInlineNode } from "@/components/features/whatsapp/message-bubble/message-text-model";
import { useMentionNames } from "@/hooks/use-mention-names";
import { useWhatsAppContactPresence } from "@/hooks/whatsapp/use-whatsapp-contact-presence";
import { formatConversationPreview, type ScreenConversation } from "@/components/features/whatsapp/conversations/conversation-model";

export function ConversationListPreview({ conversation, draftText }: {
  conversation: ScreenConversation;
  draftText?: string;
}) {
  const preview = formatConversationPreview(conversation.last_message);
  const nodes = parseMessageInline(preview);
  const mentionNames = useMentionNames(collectNumericMentions(nodes), {
    groupJid: conversation.is_group ? conversation.remote_jid : null,
    sessionId: conversation.is_group ? conversation.session_id : null,
    leadId: conversation.lead_id || conversation.lead?.id || null,
  });
  const renderPreview = (items: readonly MessageInlineNode[]): string => items.map(node => "children" in node
    ? renderPreview(node.children) : node.kind === "mention" && /^@\d{7,}$/.test(node.text)
      ? `@${mentionNames[node.text.slice(1)] || node.text.slice(1)}` : node.text).join("");

  const hasDraft = Boolean(draftText?.trim());
  const presence = useWhatsAppContactPresence(conversation.contact_presence, conversation.presence_updated_at, !conversation.platform && !hasDraft);
  const hasPresence = presence === "composing" || presence === "recording";
  // Direction comes from the authorized message projection, never the viewer
  // or a textual sender prefix. A missing direction has no delivery mark;
  // a known outgoing message with no receipt keeps the shared unknown clock.
  const status = !conversation.platform && !hasDraft && !hasPresence && conversation.last_message_from_me === true
    ? conversation.last_message_status?.trim() || "unknown"
    : null;
  return (
    <span data-conversation-preview className="flex min-w-0 flex-1 items-center text-left text-[11px] text-muted-foreground" title={hasDraft ? draftText : undefined}>
      {status && <span data-conversation-receipt-slot className="flex h-4 w-5 shrink-0 items-center text-foreground">
        <MessageStatus fromMe status={status} />
      </span>}
      <span data-conversation-preview-text className={`min-w-0 flex-1 truncate${hasPresence && !hasDraft ? " text-primary animate-pulse motion-reduce:animate-none" : ""}`}>
        {hasDraft ? <><span className="text-primary">Rascunho: </span>{draftText}</>
          : hasPresence ? presence === "composing" ? "digitando..." : "Gravando áudio..."
            : renderPreview(nodes)}
      </span>
    </span>
  );
}
