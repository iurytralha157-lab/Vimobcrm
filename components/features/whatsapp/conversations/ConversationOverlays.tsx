import { Loader2 } from "lucide-react";

import { CreateLeadDialog } from "@/components/features/leads/CreateLeadDialog";
import { StartAutomationDialog } from "@/components/features/whatsapp/StartAutomationDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatWhatsAppContactLabel } from "@/lib/phone-utils";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import { useAuth } from "@/contexts/AuthContext";

import type { ScreenConversation } from "./conversation-model";

export type CreateLeadContact = {
  phone?: string;
  name?: string;
  conversationId?: string;
  expectedPreviousLeadId?: string;
  confirmHistoryLink?: true;
};

type ConversationOverlaysProps = {
  ownerScopeKey: string;
  canCreateLeads: boolean;
  createLeadOpen: boolean;
  onCreateLeadOpenChange: (open: boolean) => void;
  createLeadContact: CreateLeadContact;
  onLeadSaved: (leadId: string) => void;
  selectedLeadId: string | null;
  selectedConversation: ScreenConversation | null;
  showAutomationDialog: boolean;
  onAutomationDialogOpenChange: (open: boolean) => void;
  pendingDeleteConversation: ScreenConversation | null;
  isDeletingConversation: boolean;
  onDeleteDialogOpenChange: (open: boolean) => void;
  onConfirmDeleteConversation: () => void;
};

export function ConversationOverlays({
  ownerScopeKey,
  canCreateLeads,
  createLeadOpen,
  onCreateLeadOpenChange,
  createLeadContact,
  onLeadSaved,
  selectedLeadId,
  selectedConversation,
  showAutomationDialog,
  onAutomationDialogOpenChange,
  pendingDeleteConversation,
  isDeletingConversation,
  onDeleteDialogOpenChange,
  onConfirmDeleteConversation,
}: ConversationOverlaysProps) {
  const scope = useWhatsAppQueryScope();
  const { profile } = useAuth();
  if (profile?.organization_id !== scope.organizationId
    || ownerScopeKey !== JSON.stringify([scope.userId, scope.organizationId, scope.accessScope, profile?.organization_id])) return null;
  const pendingDeleteName = pendingDeleteConversation?.lead?.name
    || formatWhatsAppContactLabel(
      pendingDeleteConversation?.contact_name,
      pendingDeleteConversation?.contact_phone,
      pendingDeleteConversation?.remote_jid,
    )
    || "esta conversa";

  return (
    <>
      {canCreateLeads && (
        <CreateLeadDialog
          open={createLeadOpen}
          onOpenChange={onCreateLeadOpenChange}
          contactPhone={createLeadContact.phone}
          contactName={createLeadContact.name}
          conversationId={createLeadContact.conversationId}
          expectedPreviousLeadId={createLeadContact.expectedPreviousLeadId}
          confirmHistoryLink={createLeadContact.confirmHistoryLink}
          onCreated={onLeadSaved}
        />
      )}
      {selectedLeadId && selectedConversation && (
        <StartAutomationDialog
          open={showAutomationDialog}
          onOpenChange={onAutomationDialogOpenChange}
          leadId={selectedLeadId}
          conversationId={selectedConversation.id}
          contactName={selectedConversation.lead?.name || selectedConversation.contact_name || "Contato"}
        />
      )}
      <AlertDialog open={!!pendingDeleteConversation} onOpenChange={onDeleteDialogOpenChange}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 shadow-none">
          <AlertDialogHeader>
            <AlertDialogTitle>Remover conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              {`A conversa com ${pendingDeleteName} sairá da caixa de entrada. O histórico já vinculado ao lead será preservado.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingConversation}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeletingConversation}
              onClick={(event) => {
                event.preventDefault();
                onConfirmDeleteConversation();
              }}
            >
              {isDeletingConversation && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              Remover conversa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
