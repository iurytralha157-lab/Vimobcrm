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
          <AlertDialogTitle>Entrar no atendimento?</AlertDialogTitle>
          <AlertDialogDescription>
            {contactName
              ? `Confirme para entrar no atendimento de ${contactName}.`
              : "Confirme para entrar neste atendimento."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-left">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="space-y-2 text-xs leading-relaxed text-[var(--app-text-secondary)]">
              <p>
                Ao confirmar, as mensagens enviadas e recebidas pelo WhatsApp selecionado,
                a partir da sua entrada, serão registradas neste card e ficarão visíveis
                para quem tem acesso ao lead.
              </p>
              <p className="font-medium text-[var(--app-text-primary)]">
                Mensagens anteriores a esta entrada não serão acrescentadas ao histórico;
                registros antigos do card permanecem.
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
            Entrar no atendimento
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
