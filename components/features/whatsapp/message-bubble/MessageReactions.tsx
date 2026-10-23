import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Loader2, Plus, SmilePlus } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { GroupedWhatsAppReaction } from "@/lib/whatsapp-reactions";
import { cn } from "@/lib/utils";
import { getMessageAuthorPresentation } from "@/components/features/whatsapp/message-bubble/message-author-model";
import { WHATSAPP_NEUTRAL_FOCUS_CLASS_NAME } from "@/components/features/whatsapp/conversation-list-ui";

import { getNextReactionEmoji, toSafeMessageText } from "./model";
import { isSingleReactionEmoji, summarizeMessageReactions } from "./reaction-model";
import { MESSAGE_REACTION_CATALOG } from "./reaction-catalog";

const REACTION_OPTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
const normalizeReactionSearch = (value: string) => value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

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
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [customEmoji, setCustomEmoji] = useState("");
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
        if (!open) { setExpanded(false); setSearch(""); setCustomEmoji(""); }
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
            aria-busy={isReacting}
            aria-label={isReacting ? "Aplicando reação" : "Reagir à mensagem"}
            onKeyDownCapture={handleEscapeBeforeDocument}
          >
            {isReacting
              ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              : <SmilePlus className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side={fromMe ? "left" : "right"}
          align="center"
          sideOffset={6}
          collisionPadding={12}
          className={cn("z-[160] max-w-[calc(100vw-24px)] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1 shadow-md", expanded ? "w-72" : "w-auto")}
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
            <button type="button" className="flex h-7 w-7 items-center justify-center rounded-[6px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={() => setExpanded((value) => !value)} aria-label="Mais emojis" aria-expanded={expanded}><Plus className="h-4 w-4" aria-hidden="true" /></button>
          </div>
          {expanded && <div className="mt-2 p-1">
            <label className="block text-xs text-muted-foreground">Buscar emoji<input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.stopPropagation()} className={`mt-1 h-8 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-xs font-light text-foreground ${WHATSAPP_NEUTRAL_FOCUS_CLASS_NAME}`} /></label>
            <div className="my-2 grid max-h-44 grid-cols-7 gap-1 overflow-y-auto" role="group" aria-label="Emojis disponíveis">
              {MESSAGE_REACTION_CATALOG.filter(([emoji, label]) => !search.trim() || normalizeReactionSearch(`${emoji} ${label}`).includes(normalizeReactionSearch(search))).map(([emoji, label]) => <button key={emoji} type="button" className="flex h-8 w-8 items-center justify-center rounded-[6px] text-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" title={label} aria-label={`Reagir com ${emoji}`} aria-pressed={ownReactionEmoji === emoji} disabled={isReacting} onClick={() => void handleReaction(emoji)}>{emoji}</button>)}
            </div>
            <div className="flex items-end gap-2"><label className="min-w-0 flex-1 text-xs text-muted-foreground">Outro emoji<input value={customEmoji} onChange={(event) => setCustomEmoji(event.target.value)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); if (isSingleReactionEmoji(customEmoji)) void handleReaction(customEmoji.trim()); } }} maxLength={64} placeholder="Cole um emoji" className={`mt-1 h-8 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-xs font-light text-foreground ${WHATSAPP_NEUTRAL_FOCUS_CLASS_NAME}`} /></label><button type="button" className="h-8 rounded-[6px] border-0 bg-primary/50 px-2 text-xs font-light text-primary-foreground hover:bg-primary/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 disabled:opacity-50" disabled={isReacting || !isSingleReactionEmoji(customEmoji)} onClick={() => void handleReaction(customEmoji.trim())}>Reagir</button></div>
          </div>}
        </PopoverContent>
      </div>
    </Popover>
  );
}

export function MessageReactionBadges({ fromMe, reactions }: BaseMessageReactionsProps) {
  if (reactions.length === 0) return null;
  const groups = summarizeMessageReactions(reactions);

  return (
    <div className={cn(
      "absolute -bottom-3 z-10 flex",
      fromMe ? "right-2" : "left-2",
    )} role="group" aria-label="Reações à mensagem">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={cn(
            "inline-flex items-center gap-0.5 rounded-[8px] border-0 px-1.5 py-0.5 text-sm leading-none shadow-none",
            fromMe
              ? "border-primary-foreground/20 bg-background/95 text-foreground"
              : "border-white/10 bg-background/95 text-foreground",
          )} aria-label={`Ver ${reactions.length} ${reactions.length === 1 ? "reação" : "reações"}`}>
            {groups.slice(0, 4).map((reaction, index) => (
              <span
                key={`${toSafeMessageText(reaction.emoji)}-${index}`}
                role="img"
                aria-label={`${toSafeMessageText(reaction.emoji)}: ${reaction.count}`}
              >
                {toSafeMessageText(reaction.emoji)}
                {reaction.count > 1 && <span className="ml-0.5 text-[10px]">{reaction.count}</span>}
              </span>
            ))}
            {groups.length > 4 && (
              <span className="text-[10px] text-muted-foreground">+{groups.length - 4}</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align={fromMe ? "end" : "start"} className="z-[160] w-64 max-w-[calc(100vw-24px)]" onEscapeKeyDown={(event) => event.stopPropagation()}>
          <p className="mb-2 text-xs font-medium">Reações</p>
          <ul className="max-h-52 space-y-2 overflow-y-auto text-xs font-light">{reactions.map((reaction, index) => <li key={index} className="flex min-w-0 items-center gap-2"><span role="img" aria-label={reaction.emoji}>{toSafeMessageText(reaction.emoji)}</span><span className="truncate">{getMessageAuthorPresentation({ fromMe: reaction.fromMe, senderName: reaction.senderName }).bubbleSenderLabel}</span></li>)}</ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
