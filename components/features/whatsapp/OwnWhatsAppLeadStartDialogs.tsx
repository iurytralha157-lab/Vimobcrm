"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog";
import { ConfirmConversationLeadLinkDialog } from "@/components/features/whatsapp/ConfirmConversationLeadLinkDialog";
import type { OwnWhatsAppLeadStart } from "@/hooks/whatsapp/use-own-whatsapp-lead-start";

export function OwnWhatsAppLeadStartDialogs({ start }: { start: OwnWhatsAppLeadStart }) {
  const pending = start.pending;
  return <>
    <Dialog open={pending?.kind === "select"} onOpenChange={open => { if (!open) start.cancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Escolha seu WhatsApp</DialogTitle>
          <DialogDescription>Selecione o número que vai usar neste atendimento.</DialogDescription></DialogHeader>
        <div className="space-y-2">{start.ownSessions.map(session => <Button key={session.id} type="button" variant="outline"
          className="h-auto w-full justify-start px-3 py-2" onClick={() => start.chooseSession(session.id)} disabled={start.busy}>
          <span className="text-left"><span className="block">{session.instance_name || "Meu WhatsApp"}</span>
            {session.phone_number && <span className="block text-xs text-muted-foreground">{session.phone_number}</span>}</span>
        </Button>)}</div>
      </DialogContent>
    </Dialog>
    <ConfirmConversationLeadLinkDialog open={pending?.kind === "link"} mode="existing" leadName={pending?.target.leadName}
      preview={start.preview} isLoading={start.busy && !start.preview} isConfirming={start.busy && Boolean(start.preview)}
      hasError={Boolean(start.error)} onOpenChange={open => { if (!open && !start.busy) start.cancel(); }}
      onRetry={start.retryPreview} onConfirm={() => void start.confirm()} />
    <AlertDialog open={pending?.kind === "phone"} onOpenChange={open => { if (!open && !start.busy) start.cancel(); }}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader><AlertDialogTitle>Confirmar o telefone atual?</AlertDialogTitle>
          <AlertDialogDescription>O telefone deste lead mudou. Uma nova conversa será aberta para {pending?.target.phone}.
            O histórico anterior continuará no lead.
          </AlertDialogDescription></AlertDialogHeader>
        {pending?.kind === "phone" && pending.confirmation.requiresDestinationHistoryConfirmation && (
          start.busy && !start.preview ? <p className="text-sm" role="status">Conferindo histórico disponível...</p>
            : !start.preview || start.error ? <div className="text-sm" role="alert">
              Não foi possível conferir o histórico do novo telefone.
              <Button type="button" variant="ghost" onClick={start.retryPreview} disabled={start.busy}>Conferir novamente</Button>
            </div> : <div className="rounded-md bg-muted p-3 text-xs space-y-1">
              <p>{start.preview.sessionDisplayName} · {start.preview.contactDisplayName}</p>
              <p>{start.preview.eligibleMessageCount} mensagens preservadas serão anexadas ao lead.</p>
            </div>
        )}
        {start.error && <p role="alert" className="text-xs text-destructive">{start.error}</p>}
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={start.cancel} disabled={start.busy}>Cancelar</Button>
          <Button type="button" onClick={() => void start.confirm()} disabled={start.busy || Boolean(start.error)
            || Boolean(pending?.kind === "phone" && pending.confirmation.requiresDestinationHistoryConfirmation && !start.preview)}>
            {start.busy && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {pending?.kind === "phone" && pending.confirmation.requiresDestinationHistoryConfirmation
              ? "Confirmar e anexar histórico" : "Confirmar telefone"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
