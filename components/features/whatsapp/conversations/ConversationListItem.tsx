import { forwardRef } from "react";
import { Archive, ExternalLink, Loader2, MoreVertical, Tag, Trash2, UserPlus, Users } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMentionNames } from "@/hooks/use-mention-names";
import type { Tag as TagType } from "@/hooks/use-tags";
import { formatWhatsAppContactLabel } from "@/lib/phone-utils";
import { getTagColorStyleWithWhiteText } from "@/lib/tag-color";
import { cn } from "@/lib/utils";

import {
  formatConversationPreview,
  getConversationAvatarUrl,
  type ScreenConversation,
} from "./conversation-model";

const ConversationChip = forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ children, className, title, style, ...props }, ref) => (
    <span
      ref={ref}
      title={title}
      className={cn(
        "inline-flex h-[17px] shrink-0 items-center justify-center rounded-[4px] border-0 px-1.5 text-[9px] font-medium leading-none shadow-none",
        className,
      )}
      style={style}
      {...props}
    >
      {children}
    </span>
  ),
);
ConversationChip.displayName = "ConversationChip";

type ConversationListItemProps = {
  conversation: ScreenConversation;
  isSelected: boolean;
  currentUserId?: string | null;
  onClick: () => void;
  formatTime: (date: string | null) => string;
  onArchive: () => void;
  onDelete: () => void;
  availableTags: TagType[];
  isTagsLoading?: boolean;
  isTagsError?: boolean;
  onRetryTags?: () => void;
  onAddTag: (tagId: string) => void;
  onRemoveTag: (tagId: string) => void;
  onCreateLead: () => void;
  onViewLead?: () => void;
  onActionsOpenChange?: (open: boolean) => void;
  canOperate: boolean;
  canManageTags?: boolean;
  canCreateLead: boolean;
};

export function ConversationListItem({
  conversation,
  isSelected,
  currentUserId,
  onClick,
  formatTime,
  onArchive,
  onDelete,
  availableTags,
  isTagsLoading = false,
  isTagsError = false,
  onRetryTags,
  onAddTag,
  onRemoveTag,
  onCreateLead,
  onViewLead,
  onActionsOpenChange,
  canOperate,
  canManageTags = canOperate,
  canCreateLead,
}: ConversationListItemProps) {
  const hasLead = Boolean(conversation.lead_id || conversation.lead?.id);
  const leadTags = conversation.lead?.tags || [];
  const leadTagIds = leadTags.map((leadTag) => leadTag.tag.id);
  const unassignedTags = availableTags.filter((tag) => !leadTagIds.includes(tag.id));
  const displayName = conversation.lead?.name || formatWhatsAppContactLabel(
    conversation.contact_name,
    conversation.contact_phone,
    conversation.remote_jid,
  );
  const otherAssignee = currentUserId
    && conversation.lead?.assignee?.id
    && conversation.lead.assignee.id !== currentUserId
    ? conversation.lead.assignee
    : null;
  const otherAssigneeName = otherAssignee?.name || null;
  const previewMessage = formatConversationPreview(conversation.last_message);
  const previewMentionDigits = (previewMessage.match(/@\d{7,}/g) || []).map((mention) => mention.slice(1));
  const previewMentionNames = useMentionNames(previewMentionDigits, {
    groupJid: conversation.is_group ? conversation.remote_jid : null,
    sessionId: conversation.is_group ? conversation.session_id : null,
  });
  const previewMessageWithNames = previewMentionDigits.reduce(
    (text, digits) => text.replaceAll(`@${digits}`, `@${previewMentionNames[digits] || digits}`),
    previewMessage,
  );
  const canManageConversationTags = canManageTags && Boolean(conversation.lead);

  return (
    <div
      data-tour="conversations-item"
      data-conversation-id={conversation.id}
      className={cn(
        "group grid w-full grid-cols-[minmax(0,1fr)_auto_auto] grid-rows-[auto_auto] items-stretch gap-x-1.5 gap-y-1 overflow-hidden p-2 text-left transition-colors hover:bg-[var(--app-surface-hover)]",
        isSelected && "bg-[var(--app-surface-soft)]",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-current={isSelected ? "true" : undefined}
        className="col-start-1 row-start-1 flex min-w-0 items-center gap-2.5 overflow-hidden"
      >
        <Avatar className="h-9 w-9 shrink-0 relative">
          <AvatarImage src={getConversationAvatarUrl(conversation)} />
          <AvatarFallback className="bg-[var(--app-surface-soft)] text-[12px] font-light text-muted-foreground">
            {conversation.is_group ? <Users className="w-4 h-4" /> : displayName?.[0]?.toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>

        <div className="w-0 min-w-0 flex-1">
          <div className="flex min-w-0 items-center">
            <span className="block min-w-0 truncate text-left font-sans text-[12px] font-normal leading-[17px] text-foreground" title={displayName}>
              {displayName}
            </span>
          </div>

          <div className="mt-0 flex min-w-0 items-center">
            {conversation.contact_presence === "composing" ? (
              <span className="text-[11px] text-primary truncate flex-1 text-left animate-pulse">
                digitando...
              </span>
            ) : conversation.contact_presence === "recording" ? (
              <span className="text-[11px] text-primary truncate flex-1 text-left animate-pulse">
                Gravando áudio...
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground truncate flex-1 text-left">
                {previewMessageWithNames}
              </span>
            )}
          </div>
        </div>
      </button>

      <div className="col-start-2 row-span-2 row-start-1 flex min-w-[32px] shrink-0 self-stretch flex-col items-end justify-center gap-1">
        {conversation.unread_count > 0 && (
          <span className="inline-flex h-[19px] min-w-[22px] items-center justify-center rounded-[6px] bg-primary/50 px-1.5 text-[10px] font-normal leading-none text-primary-foreground">
            {conversation.unread_count}
          </span>
        )}
        <span className="whitespace-nowrap text-[10px] leading-none text-muted-foreground">
          {formatTime(conversation.last_message_at)}
        </span>
      </div>

      {(hasLead || otherAssigneeName || leadTags.length > 0) && (
        <div
          data-conversation-tags
          className="col-start-1 col-end-2 row-start-2 ml-[46px] flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden whitespace-nowrap"
        >
          {hasLead && (
            <ConversationChip className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" title="Lead">
              Lead
            </ConversationChip>
          )}
          {otherAssigneeName && (
            <TooltipProvider delayDuration={120}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ConversationChip className="max-w-[96px] bg-amber-500/15 text-amber-700 dark:text-amber-300">
                    <span className="truncate">{otherAssigneeName}</span>
                  </ConversationChip>
                </TooltipTrigger>
                <TooltipContent side="top" align="end" className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-2 shadow-none">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={otherAssignee?.avatar_url || undefined} />
                      <AvatarFallback className="bg-amber-500/15 text-[10px] text-amber-700 dark:text-amber-300">
                        {otherAssigneeName[0]?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="max-w-[150px] truncate text-xs font-medium">{otherAssigneeName}</p>
                      <p className="text-[10px] text-muted-foreground">Responsavel pelo lead</p>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {leadTags.slice(0, 1).map((leadTag) => (
            <div key={leadTag.tag.id} className="min-w-0 flex-1 overflow-hidden">
              <TooltipProvider delayDuration={120}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ConversationChip
                      className="max-w-full"
                      title={leadTag.tag.name}
                      style={getTagColorStyleWithWhiteText(leadTag.tag.color)}
                      tabIndex={0}
                      aria-label={`Tag ${leadTag.tag.name}`}
                    >
                      <span className="truncate">{leadTag.tag.name}</span>
                    </ConversationChip>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="end" className="max-w-[240px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-2 text-xs shadow-none">
                    <span className="break-words">{leadTag.tag.name}</span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          ))}
          {leadTags.length > 1 && (
            <TooltipProvider delayDuration={120}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex h-[18px] shrink-0 items-center rounded-[4px] px-1 text-[9px] leading-none text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    tabIndex={0}
                    aria-label={`Ver mais ${leadTags.length - 1} tags`}
                  >
                    +{leadTags.length - 1}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" align="end" className="max-w-[260px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-2 shadow-none">
                  <div className="space-y-1" role="list" aria-label="Outras tags do lead">
                    {leadTags.slice(1).map((leadTag) => (
                      <div key={leadTag.tag.id} className="flex min-w-0 items-center gap-1.5 text-xs" role="listitem">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: leadTag.tag.color }}
                          aria-hidden="true"
                        />
                        <span className="break-words">{leadTag.tag.name}</span>
                      </div>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      )}

      {(canOperate || canManageConversationTags || onViewLead) && (
        <DropdownMenu dir="rtl" onOpenChange={onActionsOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`Mais ações de ${displayName || "conversa"}`}
              variant="ghost"
              size="icon"
              className="col-start-3 row-span-2 row-start-1 h-7 w-7 shrink-0 self-center rounded-[7px] bg-transparent text-[var(--app-text-tertiary)] opacity-100 transition-[background-color,color,opacity] hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text-primary)] focus-visible:bg-[var(--app-surface-muted)] focus-visible:text-[var(--app-text-primary)] data-[state=open]:bg-[var(--app-surface-muted)] data-[state=open]:text-[var(--app-text-primary)] md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
            >
              <MoreVertical className="w-3.5 h-3.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className="w-[168px] min-w-[168px] rounded-[8px] bg-popover p-1 text-[12px] [direction:ltr]"
          >
            {onViewLead && (
              <>
                <DropdownMenuItem className="h-8 rounded-[6px] px-2 py-1 text-[12px]" onClick={onViewLead}>
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  Ver lead no funil
                </DropdownMenuItem>
                {(canOperate || canManageConversationTags) && <DropdownMenuSeparator />}
              </>
            )}
            {canManageConversationTags && conversation.lead && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="h-8 rounded-[6px] px-2 py-1 text-[12px] [&_svg:last-child]:rotate-180">
                  <Tag className="mr-2 h-3.5 w-3.5" />
                  Tag
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent
                    sideOffset={6}
                    collisionPadding={12}
                    avoidCollisions
                    sticky="always"
                    className="z-[120] max-h-[min(320px,var(--radix-dropdown-menu-content-available-height))] w-[220px] max-w-[calc(100vw-24px)] overflow-x-hidden overflow-y-auto rounded-[8px] bg-popover p-1 text-[12px] [direction:ltr]"
                  >
                  {leadTags.length > 0 && (
                    <>
                      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
                        Tags atuais
                      </div>
                      {leadTags.map((leadTag) => (
                        <DropdownMenuItem
                          key={leadTag.tag.id}
                          onClick={() => onRemoveTag(leadTag.tag.id)}
                          className="flex min-h-8 items-center gap-2 rounded-[6px] px-2 py-1 text-[12px]"
                        >
                          <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: leadTag.tag.color }} />
                          <span className="min-w-0 flex-1 truncate" title={leadTag.tag.name}>{leadTag.tag.name}</span>
                          <span className="shrink-0 text-[9px] text-muted-foreground">remover</span>
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {isTagsLoading && availableTags.length === 0 ? (
                    <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-muted-foreground" role="status">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      Carregando tags...
                    </div>
                  ) : isTagsError && availableTags.length === 0 ? (
                    <div className="space-y-1.5 px-2 py-2 text-[11px]" role="alert">
                      <p className="text-muted-foreground">Não foi possível carregar as tags.</p>
                      {onRetryTags && (
                        <button
                          type="button"
                          className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onRetryTags();
                          }}
                        >
                          Tentar novamente
                        </button>
                      )}
                    </div>
                  ) : unassignedTags.length > 0 ? (
                    <>
                      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
                        Adicionar tag
                      </div>
                      {unassignedTags.map((tag) => (
                        <DropdownMenuItem
                          key={tag.id}
                          onClick={() => onAddTag(tag.id)}
                          className="flex min-h-8 items-center gap-2 rounded-[6px] px-2 py-1 text-[12px]"
                        >
                          <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                          <span className="min-w-0 flex-1 truncate" title={tag.name}>{tag.name}</span>
                        </DropdownMenuItem>
                      ))}
                    </>
                  ) : (
                    <div className="px-2 py-2 text-[11px] text-muted-foreground">
                      Nenhuma tag disponível
                    </div>
                  )}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            )}
            {canOperate && !hasLead && canCreateLead && (
              <DropdownMenuItem className="h-8 rounded-[6px] px-2 py-1 text-[12px]" onClick={onCreateLead}>
                <UserPlus className="mr-2 h-3.5 w-3.5" />
                Criar Lead
              </DropdownMenuItem>
            )}
            {canOperate && (
              <>
                <DropdownMenuItem className="h-8 rounded-[6px] px-2 py-1 text-[12px]" onClick={onArchive}>
                  <Archive className="mr-2 h-3.5 w-3.5" />
                  {conversation.archived_at ? "Desarquivar" : "Arquivar"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="h-8 rounded-[6px] px-2 py-1 text-[12px] text-destructive focus:text-destructive">
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Remover
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
