"use client";

import { Loader2, MessageCircle, ShieldCheck } from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type EnterAttendanceDialogProps = {
  open: boolean;
  contactName?: string | null;
  isJoining: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  onOpenChange: (open: boolean) => void;
};

export function EnterAttendanceDialog({
  open,
  contactName,
  isJoining,
  onConfirm,
  onCancel,
  onOpenChange,
}: EnterAttendanceDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 shadow-lg">
        <AlertDialogHeader>
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
          </div>
          <AlertDialogTitle>Compartilhar o histórico deste atendimento?</AlertDialogTitle>
          <AlertDialogDescription>
            {contactName
              ? `Confirme antes de enviar pelo seu WhatsApp para ${contactName}.`
              : "Confirme antes de enviar pelo seu WhatsApp."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-left">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="space-y-2 text-xs leading-relaxed text-[var(--app-text-secondary)]">
              <p>
                Este lead chegou por outro WhatsApp. Seus envios e sua participação
                ficarão no histórico do card, visíveis para quem tem acesso ao lead.
              </p>
              <p className="font-medium text-[var(--app-text-primary)]">
                Esta confirmação vale uma vez para você, este WhatsApp e este lead.
                Ela não limita o recebimento de mensagens.
              </p>
            </div>
          </div>
        </div>

        <AlertDialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isJoining}
            onClick={onCancel}
          >
            Agora não
          </Button>
          <Button
            type="button"
            disabled={isJoining}
            onClick={() => void onConfirm()}
          >
            {isJoining && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Confirmar e enviar
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
