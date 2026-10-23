import { Reply } from "lucide-react";
import type { GroupedWhatsAppReaction } from "@/lib/whatsapp-reactions";
import { MessageReactionPicker } from "./MessageReactions";
import { MessageActionMenu, type MessageActionMenuProps } from "./MessageActionMenu";

// Touch targets grow around the existing 28px surfaces. A 32px horizontal
// footprint preserves room for the audio clock and waveform on 320px screens.
const touchActionClasses = "[@media(pointer:coarse)]:gap-0 [@media(pointer:coarse)]:[&_button]:relative [@media(pointer:coarse)]:[&_button]:h-11 [@media(pointer:coarse)]:[&_button]:w-8 [@media(pointer:coarse)]:[&_button]:bg-transparent! [@media(pointer:coarse)]:[&_button]:before:pointer-events-none [@media(pointer:coarse)]:[&_button]:before:absolute [@media(pointer:coarse)]:[&_button]:before:size-7 [@media(pointer:coarse)]:[&_button]:before:rounded-[6px] [@media(pointer:coarse)]:[&_button]:before:bg-[var(--app-surface-soft)] [@media(pointer:coarse)]:[&_button:hover]:before:bg-[var(--app-surface-hover)] [@media(pointer:coarse)]:[&_[data-message-reply-outside]]:before:rounded-full [@media(pointer:coarse)]:[&_[data-message-reaction-outside]_button]:before:rounded-full [@media(pointer:coarse)]:[&_svg]:relative [@media(pointer:coarse)]:[&_svg]:z-10";

export function MessageBubbleActions({ fromMe, reactions, onReact, isReacting, onReply, menu }: {
  fromMe: boolean;
  reactions: GroupedWhatsAppReaction[];
  onReact?: (emoji: string) => unknown | Promise<unknown>;
  isReacting: boolean;
  onReply?: () => void;
  menu: MessageActionMenuProps;
}) {
  const reaction = onReact ? <div data-message-reaction-outside className="relative z-30 flex shrink-0 self-center [&>div>button]:!rounded-full [&>div>button]:!bg-[var(--app-surface-soft)] [&>div>button]:!text-[var(--app-text-tertiary)] [&>div>button:hover]:!bg-[var(--app-surface-hover)] [@media(pointer:coarse)]:[&>div>button]:bg-transparent! [@media(pointer:coarse)]:[&>div>button:hover]:bg-transparent!">
    <MessageReactionPicker fromMe={fromMe} reactions={reactions} onReact={onReact} isReacting={isReacting} />
  </div> : null;
  const reply = onReply ? <button type="button" data-message-reply-outside onClick={onReply} aria-label="Responder citando esta mensagem" title="Responder"
    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)] hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><Reply className="h-3.5 w-3.5" aria-hidden="true" /></button> : null;
  return <div data-message-actions-outside className={`flex shrink-0 items-center gap-1 self-center opacity-100 transition-opacity [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover/message:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-focus-within/message:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:has-[[data-state=open]]:opacity-100 ${touchActionClasses}`}>
    {fromMe ? <>{reply}{reaction}</> : <>{reaction}{reply}</>}
    <MessageActionMenu {...menu} />
  </div>;
}
