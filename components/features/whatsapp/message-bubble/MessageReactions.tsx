import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Loader2, SmilePlus } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { GroupedWhatsAppReaction } from "@/lib/whatsapp-reactions";
import { cn } from "@/lib/utils";

import { getNextReactionEmoji, toSafeMessageText } from "./model";

const REACTION_OPTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

interface BaseMessageReactionsProps {
  fromMe: boolean;
  reactions: GroupedWhatsAppReaction[];
}

export interface MessageReactionPickerProps extends BaseMessageReactionsProps {
  onReact?: (emoji: string) => unknown | Promise<unknown>;
  isReacting?: boolean;
}

export function MessageReactionPicker({
  fromMe,
  reactions,
  onReact,
  isReacting = false,
}: MessageReactionPickerProps) {
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const ownReactionEmoji = reactions.find((reaction) => reaction.fromMe)?.emoji || null;

  const handleReaction = async (emoji: string) => {
    if (!onReact || isReacting) return;
    setReactionPickerOpen(false);
    try {
      await onReact(getNextReactionEmoji(ownReactionEmoji, emoji));
    } catch {
      // The mutation owns the user-facing error and cache reconciliation.
    }
  };

  const handleEscapeBeforeDocument = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !reactionPickerOpen) return;
    event.preventDefault();
    event.stopPropagation();
    setReactionPickerOpen(false);
  };

  if (!onReact) return null;

  return (
    <Popover
      open={reactionPickerOpen}
      onOpenChange={(open) => {
        if (open && isReacting) return;
        setReactionPickerOpen(open);
      }}
    >
      <div className="relative z-20 inline-flex shrink-0">
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-[6px] border-0 shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50",
              fromMe
                ? "bg-primary-foreground/15 text-primary-foreground/75 hover:bg-primary-foreground/25 hover:text-primary-foreground"
                : "bg-[var(--app-surface-hover)] text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            disabled={isReacting}
            aria-label={isReacting ? "Aplicando reação" : "Reagir à mensagem"}
            onKeyDownCapture={handleEscapeBeforeDocument}
          >
            {isReacting
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              : <SmilePlus className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side={fromMe ? "left" : "right"}
          align="center"
          sideOffset={6}
          collisionPadding={12}
          className="z-[160] w-auto max-w-[calc(100vw-24px)] rounded-[8px] border border-border bg-[var(--app-surface-solid)] p-1 shadow-md"
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setReactionPickerOpen(false);
          }}
          onKeyDownCapture={handleEscapeBeforeDocument}
        >
          <div className="flex items-center gap-0.5" role="group" aria-label="Escolha uma reação">
            {REACTION_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-[6px] text-base transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  ownReactionEmoji === emoji && "bg-muted ring-1 ring-primary/40",
                )}
                onClick={() => void handleReaction(emoji)}
                aria-label={ownReactionEmoji === emoji ? `Remover reação ${emoji}` : `Reagir com ${emoji}`}
                aria-pressed={ownReactionEmoji === emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </div>
    </Popover>
  );
}

export function MessageReactionBadges({ fromMe, reactions }: BaseMessageReactionsProps) {
  if (reactions.length === 0) return null;

  return (
    <div className={cn(
      "absolute -bottom-3 z-10 flex",
      fromMe ? "right-2" : "left-2",
    )}>
          <div className={cn(
            "inline-flex items-center gap-0.5 rounded-[8px] border px-1.5 py-0.5 text-sm leading-none shadow-none",
            fromMe
              ? "border-primary-foreground/20 bg-background/95 text-foreground"
              : "border-white/10 bg-background/95 text-foreground",
          )}>
            {reactions.slice(0, 4).map((reaction, index) => (
              <span
                key={`${toSafeMessageText(reaction.emoji)}-${index}`}
                title={toSafeMessageText(reaction.senderName) || undefined}
              >
                {toSafeMessageText(reaction.emoji)}
              </span>
            ))}
            {reactions.length > 4 && (
              <span className="text-[10px] text-muted-foreground">+{reactions.length - 4}</span>
            )}
          </div>
    </div>
  );
}
