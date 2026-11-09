import { useEffect, useRef, type RefCallback } from "react";
import { Loader2, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CONVERSATION_LIST_UI } from "@/components/features/whatsapp/conversation-list-ui";
import type { Tag as TagType } from "@/hooks/use-tags";
import { cn } from "@/lib/utils";

import { ConversationListItem } from "./ConversationListItem";
import {
  captureConversationListReturnPosition,
  restoreConversationListReturnPosition,
  type ConversationListReturnPosition,
} from "./conversation-list-position";
import type { ScreenConversation } from "./conversation-model";

type ConversationListProps = {
  layout: "mobile" | "desktop";
  channel: "whatsapp" | "meta";
  conversations: ScreenConversation[];
  selectedConversationId?: string | null;
  currentUserId?: string | null;
  isLoading: boolean;
  isSearching?: boolean;
  isError?: boolean;
  onRetry: () => void;
  sessionsDisconnected?: boolean;
  canManageWhatsApp: boolean;
  onConnectWhatsApp: () => void;
  canOperate: boolean;
  canManageTags: boolean;
  canCreateLead: boolean;
  availableTags: Pick<TagType, 'id' | 'name' | 'color'>[];
  isTagsLoading?: boolean;
  isTagsError?: boolean;
  onRetryTags?: () => void;
  isArchiving?: (conversation: ScreenConversation) => boolean;
  isTagUpdating?: (conversation: ScreenConversation) => boolean;
  onSelect: (conversation: ScreenConversation) => void;
  onArchive: (conversation: ScreenConversation) => void;
  onDelete: (conversation: ScreenConversation) => void;
  onAddTag: (conversation: ScreenConversation, tagId: string) => void;
  onRemoveTag: (conversation: ScreenConversation, tagId: string) => void;
  onCreateLead: (conversation: ScreenConversation) => void;
  onViewLead?: (leadId: string) => void;
  formatTime: (date: string | null) => string;
  hasMoreConversations: boolean;
  isLoadingMoreConversations: boolean;
  onLoadMoreConversations: () => void;
  returnPositionKey?: string;
  returnPosition?: ConversationListReturnPosition | null;
  onReturnPositionChange?: (position: ConversationListReturnPosition) => void;
  getDraftText?: (conversation: ScreenConversation) => string;
  previewCardRef?: RefCallback<HTMLDivElement>;
};

export function ConversationList({
  layout,
  channel,
  conversations,
  selectedConversationId,
  currentUserId,
  isLoading,
  isSearching = false,
  isError = false,
  onRetry,
  sessionsDisconnected = false,
  canManageWhatsApp,
  onConnectWhatsApp,
  canOperate,
  canManageTags,
  canCreateLead,
  availableTags,
  isTagsLoading,
  isTagsError,
  onRetryTags,
  isArchiving,
  isTagUpdating,
  onSelect,
  onArchive,
  onDelete,
  onAddTag,
  onRemoveTag,
  onCreateLead,
  onViewLead,
  formatTime,
  hasMoreConversations,
  isLoadingMoreConversations,
  onLoadMoreConversations,
  returnPositionKey,
  returnPosition,
  onReturnPositionChange,
  getDraftText,
  previewCardRef,
}: ConversationListProps) {
  const isMobile = layout === "mobile";
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLoading || !returnPositionKey || returnPosition?.key !== returnPositionKey) return undefined;

    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        restoreConversationListReturnPosition(
          scrollAreaRef.current,
          returnPositionKey,
          returnPosition,
        );
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isLoading, returnPosition, returnPositionKey]);

  const handleSelect = (conversation: ScreenConversation) => {
    if (returnPositionKey && onReturnPositionChange) {
      const position = captureConversationListReturnPosition(
        scrollAreaRef.current,
        returnPositionKey,
        conversation.id,
      );
      if (position) onReturnPositionChange(position);
    }
    onSelect(conversation);
  };

  return (
    <ScrollArea ref={scrollAreaRef} data-tour="conversations-list" className="flex-1">
      <div className="divide-y divide-[var(--app-border)]">
        {isSearching && conversations.length > 0 && (
          <div role="status" className="flex items-center gap-2 bg-[var(--app-surface-soft)] px-3 py-2 text-[11px] font-light text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Buscando conversas...
          </div>
        )}
        {isError && conversations.length > 0 && (
          <div className="flex items-center justify-between gap-2 bg-muted/60 px-3 py-2 text-xs text-muted-foreground" role="status">
            <span>Não foi possível atualizar. Exibindo conversas já carregadas.</span>
            <Button size="sm" variant="ghost" onClick={onRetry}>Tentar novamente</Button>
          </div>
        )}
        {isError && conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <MessageSquare className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm font-medium mb-1">Não foi possível carregar as conversas</p>
            <p className="text-xs text-muted-foreground mb-4">Verifique a conexão do WhatsApp e tente novamente.</p>
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Tentar novamente
            </Button>
          </div>
        ) : isLoading && conversations.length === 0 ? (
          <div className="flex items-center justify-center py-12" role="status" aria-label={isSearching ? "Buscando conversas" : "Carregando conversas"} aria-busy="true">
            <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none text-muted-foreground" aria-hidden="true" />
          </div>
        ) : conversations.length === 0 && isSearching ? (
          <div role="status" className="flex items-center justify-center gap-2 px-3 py-6 text-[11px] font-light text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Buscando conversas...
          </div>
        ) : conversations.length === 0 ? (
          <div className={cn(
            "flex flex-col items-center justify-center py-12 px-4",
            (isMobile || channel === "meta") && "text-center",
          )}>
            <MessageSquare className={channel === "meta" && !isMobile
              ? "w-8 h-8 text-muted-foreground mb-2 opacity-20"
              : "w-8 h-8 text-muted-foreground mb-2"}
            />
            {isMobile && sessionsDisconnected ? (
              <>
                <p className="text-sm font-medium mb-1">WhatsApp não conectado</p>
                <p className="text-xs text-muted-foreground mb-4">Conecte sua conta para ver suas conversas.</p>
                {canManageWhatsApp && (
                  <Button size="sm" onClick={onConnectWhatsApp}>
                    Conectar WhatsApp
                  </Button>
                )}
              </>
            ) : isMobile ? (
              <p className="text-sm text-muted-foreground">Nenhuma conversa encontrada</p>
            ) : channel === "whatsapp" ? (
              <p className="text-sm text-muted-foreground">Nenhuma conversa no WhatsApp</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Nenhuma conversa no Instagram/Meta</p>
                <p className="text-xs text-muted-foreground mt-1">Conecte sua conta nas configurações para começar.</p>
              </>
            )}
          </div>
        ) : (
          conversations.map((conversation) => {
            const supervisoryLeadId = conversation.supervisory_lead_view ? conversation.lead_id : null;
            return <ConversationListItem
              key={conversation.id}
              conversation={conversation}
              previewCardRef={previewCardRef}
              draftText={getDraftText?.(conversation)}
              isSelected={isMobile ? false : selectedConversationId === conversation.id}
              currentUserId={currentUserId}
              onClick={() => handleSelect(conversation)}
              formatTime={formatTime}
              onArchive={() => onArchive(conversation)}
              isArchiving={isArchiving?.(conversation)}
              isTagUpdating={isTagUpdating?.(conversation)}
              onDelete={() => onDelete(conversation)}
              canOperate={canOperate}
              canManageTags={canManageTags}
              canCreateLead={canCreateLead}
              availableTags={availableTags}
              isTagsLoading={isTagsLoading}
              isTagsError={isTagsError}
              onRetryTags={onRetryTags}
              onAddTag={(tagId) => onAddTag(conversation, tagId)}
              onRemoveTag={(tagId) => onRemoveTag(conversation, tagId)}
              onCreateLead={() => onCreateLead(conversation)}
              onViewLead={onViewLead && supervisoryLeadId ? () => onViewLead(supervisoryLeadId) : undefined}
            />;
          })
        )}
        {channel === "whatsapp" && !isLoading && !isError && hasMoreConversations && (
          <div className="flex justify-center p-3">
            <Button
              size="sm"
              variant="secondary"
              className={CONVERSATION_LIST_UI.pagination}
              disabled={isLoadingMoreConversations}
              aria-busy={isLoadingMoreConversations}
              onClick={onLoadMoreConversations}
            >
              {isLoadingMoreConversations && (
                <Loader2
                  className="mr-2 h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              Carregar mais conversas
            </Button>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
