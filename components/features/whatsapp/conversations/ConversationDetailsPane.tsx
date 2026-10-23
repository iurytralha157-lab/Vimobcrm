import type { ReactNode, RefObject } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

type ConversationDetailsPaneProps = {
  open: boolean;
  docked: boolean;
  onClose: () => void;
  actionsRef: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
};

export function ConversationDetailsPane({ open, docked, onClose, actionsRef, children }: ConversationDetailsPaneProps) {
  if (!open) return null;
  if (docked) return (
    <aside aria-label="Dados do contato" data-conversation-details="docked" className="app-card flex h-full min-h-0 w-[330px] shrink-0 flex-col overflow-hidden">
      {children}
    </aside>
  );
  return (
    <Sheet open onOpenChange={(value) => { if (!value) onClose(); }}>
      <SheetContent
        side="right"
        data-conversation-details="sheet"
        className="flex w-[min(100vw,360px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-[360px] [&>button]:hidden [&_[data-conversation-panel-close]]:hidden"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          actionsRef.current?.focus({ preventScroll: true });
        }}
      >
        <SheetTitle className="sr-only">Dados do contato</SheetTitle>
        <SheetDescription className="sr-only">Dados e ações do lead vinculado à conversa.</SheetDescription>
        <div className="absolute right-2 top-2 z-10"><Button type="button" variant="ghost" size="icon" className="h-7 w-7 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text-primary)]" onClick={onClose} aria-label="Fechar dados do contato"><X className="h-3.5 w-3.5" aria-hidden="true" /></Button></div>
        {children}
      </SheetContent>
    </Sheet>
  );
}
