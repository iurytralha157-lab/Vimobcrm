import { Archive, ArrowLeft, MoreVertical, Trash2, User, Users } from "lucide-react";
import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatWhatsAppContactLabel } from "@/lib/phone-utils";

import { getConversationAvatarUrl, type ScreenConversation } from "./conversation-model";

type MobileConversationHeaderProps = {
  conversation: ScreenConversation;
  selectedLeadId: string | null;
  canOperateWhatsApp: boolean;
  onBack: () => void;
  onArchive: () => void;
  onDelete: () => void;
};

export function MobileConversationHeader({
  conversation,
  selectedLeadId,
  canOperateWhatsApp,
  onBack,
  onArchive,
  onDelete,
}: MobileConversationHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--app-border)] bg-[var(--app-surface)] px-3">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Button aria-label="Voltar para a lista de conversas" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onBack}>
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
        </Button>
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={getConversationAvatarUrl(conversation)} />
          <AvatarFallback className="bg-[var(--app-surface-soft)] text-[12px] font-light text-muted-foreground">
            {conversation.is_group
              ? <Users className="w-4 h-4" />
              : (conversation.contact_name || conversation.contact_phone)?.[0] || "?"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate text-foreground">
            {conversation.lead?.name || formatWhatsAppContactLabel(
              conversation.contact_name,
              conversation.contact_phone,
              conversation.remote_jid,
            )}
          </p>
          {conversation.contact_presence === "composing" ? (
            <p className="text-xs text-primary animate-pulse">digitando...</p>
          ) : conversation.contact_presence === "recording" ? (
            <p className="text-xs text-primary animate-pulse">gravando...</p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {selectedLeadId && (
          <Button variant="ghost" size="sm" className="h-8 text-xs px-2" asChild>
            <Link href={`/crm/pipelines?lead=${selectedLeadId}`} aria-label="Abrir lead no pipeline">
              <User className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          </Button>
        )}
        {canOperateWhatsApp && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="Mais ações da conversa" variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="w-4 h-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover">
              <DropdownMenuItem onClick={onArchive}>
                <Archive className="w-4 h-4 mr-2" />
                {conversation.archived_at ? "Desarquivar" : "Arquivar"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDelete} className="text-destructive">
                <Trash2 className="w-4 h-4 mr-2" />
                Remover
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
