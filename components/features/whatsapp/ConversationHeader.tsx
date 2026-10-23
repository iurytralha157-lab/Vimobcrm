import type { Ref } from "react";
import { Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { WhatsAppAvatarImage as AvatarImage } from "@/components/features/whatsapp/WhatsAppAvatarImage";
import { Badge } from "@/components/ui/badge";
import { ConversationHeaderActions } from "@/components/features/whatsapp/conversations/ConversationHeaderActions";
import { ConversationLeadBadges } from "@/components/features/whatsapp/conversations/ConversationLeadBadges";
import { formatWhatsAppContactLabel, formatWhatsAppContactPhoneForDisplay, normalizeWhatsAppContactPhoneToE164 } from "@/lib/phone-utils";
import { cn } from "@/lib/utils";
import { formatWhatsAppPersonName } from "@/lib/whatsapp-person-name";
import { useWhatsAppContactPresence } from "@/hooks/whatsapp/use-whatsapp-contact-presence";

interface ConversationHeaderProps {
  contactName?: string | null;
  contactPhone?: string | null;
  contactPicture?: string | null;
  contactPictureFallback?: string | null;
  contactPresence?: string | null;
  contactPresenceUpdatedAt?: string | null;
  isGroup?: boolean;
  isArchived?: boolean;
  isArchiving?: boolean;
  leadId?: string | null;
  leadTags?: Array<{ tag: { id: string; name: string; color: string } }>;
  leadAssigneeName?: string | null;
  leadAssigneeIsCurrentUser?: boolean;
  pipelineName?: string | null;
  stageName?: string | null;
  stageColor?: string | null;
  conversationId?: string | null;
  sessionId?: string | null;
  remoteJid?: string | null;
  onArchive?: () => void;
  onDelete?: () => void;
  onCreateLead?: () => void;
  onReassignLead?: () => void;
  onToggleLeadPanel?: () => void;
  onSearch?: () => void;
  searchOpen?: boolean;
  showLeadPanel?: boolean;
  canOperate?: boolean;
  actionsButtonRef?: Ref<HTMLButtonElement>;
  searchButtonRef?: Ref<HTMLButtonElement>;
  className?: string;
}

export function ConversationHeader({ contactName, contactPhone, contactPicture, contactPictureFallback, contactPresence, contactPresenceUpdatedAt, isGroup, isArchived, isArchiving, leadId, pipelineName, stageName, stageColor, remoteJid, onArchive, onDelete, onCreateLead, onReassignLead, onToggleLeadPanel, onSearch, searchOpen = false, showLeadPanel = false, canOperate = false, actionsButtonRef, searchButtonRef, className }: ConversationHeaderProps) {
  const phone = formatWhatsAppContactPhoneForDisplay(contactPhone, remoteJid);
  const name = formatWhatsAppContactLabel(isGroup ? contactName : formatWhatsAppPersonName(contactName), contactPhone, remoteJid);
  const presence = useWhatsAppContactPresence(contactPresence, contactPresenceUpdatedAt);
  const activePresence = presence === "composing" || presence === "recording";
  return (
    <header aria-label="Cabeçalho da conversa" className={cn("flex min-h-[3.25rem] shrink-0 items-center justify-between gap-3 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-2", className)}>
      <div className="min-w-0 flex-1">
        {!showLeadPanel && <div data-conversation-identity className="flex min-w-0 items-center gap-3">
          <div className="relative shrink-0">
            <Avatar className="h-10 w-10 ring-2 ring-background">
              <AvatarImage src={contactPicture || undefined} fallbackSrc={contactPictureFallback} alt={name || "Contato"} />
              <AvatarFallback className="bg-primary text-primary-foreground">{isGroup ? <Users className="h-5 w-5" /> : name?.[0]?.toUpperCase() || "?"}</AvatarFallback>
            </Avatar>
            {presence === "available" && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background bg-green-500" aria-label="Contato online" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><h2 className="truncate" style={{ fontSize: "var(--app-font-size-card-title)", fontWeight: "var(--app-font-weight-body)" }}>{name}</h2>{isGroup && <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px]">Grupo</Badge>}</div>
            {activePresence && <p role="status" className="truncate text-[11px] font-light text-primary">{presence === "composing" ? "digitando..." : "gravando áudio..."}</p>}
            {!activePresence && contactName?.trim() && name !== phone && phone && <p className="truncate text-[11px] font-light text-muted-foreground">{phone}</p>}
            {!activePresence && <ConversationLeadBadges pipelineName={pipelineName} stageName={stageName} stageColor={stageColor} />}
          </div>
        </div>}
        {showLeadPanel && <ConversationLeadBadges pipelineName={pipelineName} stageName={stageName} stageColor={stageColor} />}
        {showLeadPanel && activePresence && <p role="status" className="truncate text-[11px] font-light text-primary">{presence === "composing" ? "digitando..." : "gravando áudio..."}</p>}
      </div>
      <ConversationHeaderActions leadId={leadId} isGroup={isGroup} isArchived={isArchived} isArchiving={isArchiving} canOperate={canOperate} showLeadPanel={showLeadPanel} searchOpen={searchOpen} phoneHref={normalizeWhatsAppContactPhoneToE164(contactPhone, remoteJid) || ""} onToggleLeadPanel={onToggleLeadPanel} onReassignLead={onReassignLead} onSearch={onSearch} onCreateLead={onCreateLead} onArchive={onArchive} onDelete={onDelete} actionsButtonRef={actionsButtonRef} searchButtonRef={searchButtonRef} />
    </header>
  );
}
