import { useSyncExternalStore, type Ref } from "react";
import { ArrowLeft, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { WhatsAppAvatarImage as AvatarImage } from "@/components/features/whatsapp/WhatsAppAvatarImage";
import { Button } from "@/components/ui/button";
import { ConversationHeaderActions } from "@/components/features/whatsapp/conversations/ConversationHeaderActions";
import { formatWhatsAppContactLabel } from "@/lib/phone-utils";
import { formatWhatsAppPersonName } from "@/lib/whatsapp-person-name";
import { getConversationAvatarUrl, type ScreenConversation } from "@/components/features/whatsapp/conversations/conversation-model";
import { useWhatsAppContactPresence } from "@/hooks/whatsapp/use-whatsapp-contact-presence";

const compactQuery = "(max-width: 360px)";
const compactSnapshot = () => window.matchMedia(compactQuery).matches;
const desktopSnapshot = () => false;
function subscribeCompactHeader(notify: () => void) {
  const query = window.matchMedia(compactQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

type MobileConversationHeaderProps = {
  conversation: ScreenConversation;
  selectedLeadId: string | null;
  canOperateWhatsApp: boolean;
  isArchiving?: boolean;
  onLinkLead?: () => void;
  onCreateLead?: () => void;
  onBack: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onSearch?: () => void;
  searchOpen?: boolean;
  onToggleLeadPanel?: () => void;
  showLeadPanel?: boolean;
  actionsButtonRef?: Ref<HTMLButtonElement>;
  searchButtonRef?: Ref<HTMLButtonElement>;
};

export function MobileConversationHeader({ conversation, selectedLeadId, canOperateWhatsApp, isArchiving, onLinkLead, onCreateLead, onBack, onArchive, onDelete, onSearch, searchOpen, onToggleLeadPanel, showLeadPanel, actionsButtonRef, searchButtonRef }: MobileConversationHeaderProps) {
  const name = formatWhatsAppPersonName(conversation.lead?.name) || formatWhatsAppContactLabel(conversation.is_group ? conversation.contact_name : formatWhatsAppPersonName(conversation.contact_name), conversation.contact_phone, conversation.remote_jid);
  const presence = useWhatsAppContactPresence(conversation.contact_presence, conversation.presence_updated_at, !conversation.platform);
  const compactLeadAction = useSyncExternalStore(subscribeCompactHeader, compactSnapshot, desktopSnapshot);
  return (
    <header aria-label="Cabeçalho da conversa" className="flex h-14 shrink-0 items-center justify-between gap-2 rounded-t-[8px] border-b border-[var(--app-border)] bg-[var(--app-surface)] px-3">
      <div data-conversation-identity className="flex min-w-0 flex-1 items-center gap-2 [@media(pointer:coarse)]:gap-1">
        <Button type="button" aria-label="Voltar para a lista de conversas" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onBack}><ArrowLeft className="h-5 w-5" aria-hidden="true" /></Button>
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={getConversationAvatarUrl(conversation)} fallbackSrc={conversation.contact_picture} alt={name} />
          <AvatarFallback className="bg-[var(--app-surface-soft)] text-[12px] font-light text-muted-foreground">{conversation.is_group ? <Users className="h-4 w-4" aria-hidden="true" /> : name?.[0]?.toUpperCase() || "?"}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p title={name} className="truncate text-[13px] font-light text-foreground">{name}</p>
          {presence === "composing" ? <p role="status" className="text-[11px] font-light text-primary">digitando...</p> : presence === "recording" ? <p role="status" className="text-[11px] font-light text-primary">gravando áudio...</p> : null}
        </div>
      </div>
      <ConversationHeaderActions leadId={selectedLeadId} compactLeadAction={compactLeadAction} isGroup={conversation.is_group} isArchived={Boolean(conversation.archived_at)} isArchiving={isArchiving} canOperate={canOperateWhatsApp} showLeadPanel={showLeadPanel} searchOpen={searchOpen} onToggleLeadPanel={onToggleLeadPanel} onReassignLead={onLinkLead} onSearch={onSearch} onCreateLead={onCreateLead} onArchive={onArchive} onDelete={onDelete} actionsButtonRef={actionsButtonRef} searchButtonRef={searchButtonRef} />
    </header>
  );
}
