import { useRef, useState, type Ref } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, MessageCircle, Search, Users, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { WhatsAppAvatarImage as AvatarImage } from "@/components/features/whatsapp/WhatsAppAvatarImage";
import { getConversationAvatarUrl } from "@/components/features/whatsapp/conversations";
import type { WhatsAppConversation } from "@/hooks/use-whatsapp-conversations";
import { formatWhatsAppContactLabel, formatWhatsAppContactPhoneForDisplay } from "@/lib/phone-utils";
import { getTagColorStyleWithWhiteText } from "@/lib/tag-color";
import { cn } from "@/lib/utils";
import { formatWhatsAppPersonName } from "@/lib/whatsapp-person-name";

function FloatingChatExtraTags({
  tags,
  chipClassName,
}: {
  tags: NonNullable<NonNullable<WhatsAppConversation["lead"]>["tags"]>;
  chipClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={`Ver mais ${tags.length} tags`}
          aria-expanded={open}
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            // Radix dismisses on click by default; keep touch and keyboard toggles explicit.
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            setOpen(!open);
          }}
          className={cn(badgeVariants(), chipClassName, "shrink-0 cursor-help bg-primary px-1.5")}
        >
          +{tags.length}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="max-w-[200px]"
        onPointerDownOutside={(event) => {
          if (event.detail.originalEvent.target instanceof Node
            && triggerRef.current?.contains(event.detail.originalEvent.target)) event.preventDefault();
        }}
      >
        <div className="flex flex-wrap gap-1">
          {tags.map((lt) => (
            <Badge
              key={lt.tag.id}
              variant="secondary"
              className={chipClassName}
              style={getTagColorStyleWithWhiteText(lt.tag.color)}
            >
              {lt.tag.name}
            </Badge>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

type FloatingChatHeaderProps = {
  activeConversation: WhatsAppConversation | null;
  closeChat: () => void;
  clearActiveConversation: () => void;
  conversationSearchRef: Ref<HTMLButtonElement>;
  handleViewLead: (leadId: string) => void;
  isStartingConversation: boolean;
  mobile: boolean;
  onToggleSearch: () => void;
  startupScope: string;
  unreadCount: number;
};

export function FloatingChatHeader({
  activeConversation,
  closeChat,
  clearActiveConversation,
  conversationSearchRef,
  handleViewLead,
  isStartingConversation,
  mobile,
  onToggleSearch,
  startupScope,
  unreadCount,
}: FloatingChatHeaderProps) {
  // Header padrao quando nao ha conversa ativa (lista de conversas)
  if (!activeConversation) {
    return (
      <div className={cn(
        "relative flex shrink-0 items-center justify-between bg-primary text-white",
        mobile
          ? "px-4 py-3"
          : "z-10 h-12 px-3.5 shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
      )} style={{ zIndex: isStartingConversation ? 60 : undefined }}>
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          <span className="text-[length:var(--app-font-size-caption)] font-semibold text-neutral-950">WhatsApp</span>
          {unreadCount > 0 && (
            <Badge variant="secondary" className="flex h-5 min-w-5 items-center justify-center px-1.5 text-[10px]">
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Fechar chat do WhatsApp"
            className={cn(
              "rounded-[6px] bg-black/15 text-white hover:bg-black/25 hover:text-white [&_svg]:size-3.5",
              mobile
                ? "h-11 w-11"
                : "h-8 w-8"
            )}
            onClick={closeChat}
          >
            <X />
          </Button>
        </div>
      </div>
    );
  }

  // Header compacto e organizado para o FloatingChat
  const displayName = formatWhatsAppPersonName(activeConversation.lead?.name) || formatWhatsAppContactLabel(
    activeConversation.is_group ? activeConversation.contact_name : formatWhatsAppPersonName(activeConversation.contact_name),
    activeConversation.contact_phone,
    activeConversation.remote_jid,
  );

  const phone = formatWhatsAppContactPhoneForDisplay(
    activeConversation.contact_phone,
    activeConversation.remote_jid,
  );
  const leadId = activeConversation.lead?.id;
  const tags = activeConversation.lead?.tags || [];
  const pipelineName = activeConversation.lead?.pipeline?.name;
  const stageName = activeConversation.lead?.stage?.name;
  const stageColor = activeConversation.lead?.stage?.color;
  const visibleTags = tags.slice(0, 1);
  const remainingTags = tags.slice(1);
  const contextChipClassName = "min-h-[18px] max-w-full min-w-0 whitespace-normal [overflow-wrap:anywhere] rounded-[4px] border-0 px-1.5 py-0.5 text-[9px] font-medium leading-[12px] text-white shadow-none";

  return (
    <TooltipProvider>
      <div className="relative shrink-0 border-b border-[var(--app-border)] bg-[var(--app-surface-solid)]" style={{ zIndex: isStartingConversation ? 60 : undefined }}>
        {/* Linha 1: Navegacao e info principal */}
        <div className="flex items-center gap-2 px-3 py-2">
          {/* Botao Voltar */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Voltar à lista de conversas"
                disabled={isStartingConversation}
                className={cn(
                  "shrink-0 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text-primary)]",
                  mobile ? "h-11 w-11" : "h-9 w-9",
                )}
                onClick={() => clearActiveConversation()}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Voltar</TooltipContent>
          </Tooltip>

          {/* Avatar */}
          <Avatar className="h-8 w-8 shrink-0 border border-primary/20">
            <AvatarImage src={getConversationAvatarUrl(activeConversation)} fallbackSrc={activeConversation.contact_picture} alt={displayName} />
            <AvatarFallback className="bg-primary/50 text-[12px] font-light text-primary-foreground">
              {activeConversation.is_group ? (
                <Users className="h-4 w-4" />
              ) : (
                displayName?.[0]?.toUpperCase() || "?"
              )}
            </AvatarFallback>
          </Avatar>

          {/* Nome */}
          <div className="flex-1 min-w-0">
            <p className="font-light text-[13px] leading-4 truncate">{displayName}</p>
            {activeConversation.lead?.name && phone && (
              <p className="text-[10px] font-light text-muted-foreground truncate">{phone}</p>
            )}
          </div>

          {/* Acoes */}
          <div className="flex min-w-fit shrink-0 items-center justify-end gap-1 pr-0.5">
            <Button ref={conversationSearchRef} type="button" variant="ghost" size="icon" aria-label="Buscar nesta conversa" disabled={isStartingConversation} className={mobile ? "h-11 w-11" : "h-9 w-9"} onClick={onToggleSearch}>
              <Search className="h-4 w-4" aria-hidden="true" />
            </Button>
            {leadId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Ver lead no funil"
                    disabled={isStartingConversation}
                    className={cn(
                      "rounded-[6px] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-soft)] hover:text-[var(--app-text-primary)]",
                      mobile ? "h-11 w-11" : "h-9 w-9",
                    )}
                    onClick={() => handleViewLead(leadId)}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Ver Lead</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Fechar chat do WhatsApp"
                  className={cn(
                    "rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text-primary)]",
                    mobile ? "h-11 w-11" : "h-9 w-9",
                  )}
                  onClick={closeChat}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Fechar</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Linha 2: Tags e Pipeline (se houver) */}
        {(visibleTags.length > 0 || pipelineName) && (
          <div data-floating-chat-context className="flex w-full min-w-0 flex-wrap items-start gap-1.5 px-3 pb-2.5 pt-0.5">
            {/* Tags */}
            {visibleTags.map((lt) => (
              <Badge
                key={lt.tag.id}
                variant="secondary"
                className={cn(contextChipClassName, "shrink-0")}
                style={getTagColorStyleWithWhiteText(lt.tag.color)}
                title={lt.tag.name}
              >
                {lt.tag.name}
              </Badge>
            ))}
            {remainingTags.length > 0 && (
              <FloatingChatExtraTags
                key={JSON.stringify([startupScope, activeConversation.id, mobile])}
                tags={remainingTags}
                chipClassName={contextChipClassName}
              />
            )}

            {/* Separador */}
            {visibleTags.length > 0 && pipelineName && <span className="shrink-0 text-[9px] text-muted-foreground/70">•</span>}

            {/* Pipeline > Stage */}
            {pipelineName && (
              <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-muted-foreground">
                <Badge className={cn(contextChipClassName, "shrink-0 bg-primary/10 text-primary")} title={pipelineName}>
                  {pipelineName}
                </Badge>
                {stageName && (
                  <>
                    <ArrowRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/70" />
                    <Badge
                      className={cn(contextChipClassName, "shrink-0")}
                      style={getTagColorStyleWithWhiteText(stageColor)}
                      title={stageName}
                    >
                      {stageName}
                    </Badge>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
