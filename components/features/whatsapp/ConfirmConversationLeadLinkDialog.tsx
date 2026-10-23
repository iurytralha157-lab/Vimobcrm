"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { WhatsAppConversationLinkPreview } from "@/lib/api/whatsapp";

type ConfirmConversationLeadLinkDialogProps = {
  open: boolean;
  mode: "existing" | "new";
  leadName?: string;
  preview: WhatsAppConversationLinkPreview | null;
  isLoading: boolean;
  isConfirming: boolean;
  hasError: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  onConfirm: () => void;
};

function formatHistoryDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

export function ConfirmConversationLeadLinkDialog({
  open,
  mode,
  leadName,
  preview,
  isLoading,
  isConfirming,
  hasError,
  onOpenChange,
  onRetry,
  onConfirm,
}: ConfirmConversationLeadLinkDialogProps) {
  const firstAt = formatHistoryDate(preview?.firstEligibleAt ?? null);
  const lastAt = formatHistoryDate(preview?.lastEligibleAt ?? null);
  const expiresAt = formatHistoryDate(preview?.expiresAt ?? null);
  const isReassignment = preview?.expectedPreviousLeadId !== undefined
    && preview.expectedPreviousLeadId !== "unlinked";
  const canConfirm = Boolean(preview) && !isLoading && !isConfirming && !hasError;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 shadow-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {mode === "new" ? "Cadastrar e vincular conversa?" : "Vincular conversa ao lead?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {mode === "new"
              ? "Confira o histórico antes de cadastrar o lead. Ao salvar, o histórico elegível será anexado automaticamente."
              : isReassignment
                ? `Confirme a mudança desta conversa${leadName ? ` para ${leadName}` : " para outro lead"}. O histórico anterior continuará no lead de origem.`
              : `Confira o histórico antes de vincular esta conversa${leadName ? ` a ${leadName}` : " ao lead"}.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-[var(--app-text-secondary)]" role="status">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Conferindo histórico disponível...
          </div>
        ) : hasError || !preview ? (
          <div className="rounded-[8px] bg-destructive/8 p-3 text-sm" role="alert">
            <p>Não foi possível conferir o histórico desta conversa. Ele pode ter expirado, pertencer a outro WhatsApp ou ser anterior ao registro temporário. O vínculo não será feito.</p>
            <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={onRetry}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          <div className="space-y-2 rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-left text-xs text-[var(--app-text-secondary)]">
            <p><span className="font-medium text-[var(--app-text-primary)]">WhatsApp:</span> {preview.sessionDisplayName}</p>
            <p><span className="font-medium text-[var(--app-text-primary)]">Contato:</span> {preview.contactDisplayName}</p>
            <p><span className="font-medium text-[var(--app-text-primary)]">Mensagens preservadas:</span> {preview.eligibleMessageCount}</p>
            {firstAt && lastAt ? (
              <p><span className="font-medium text-[var(--app-text-primary)]">Período:</span> {firstAt} até {lastAt}</p>
            ) : (
              <p>Não há mensagens preservadas para anexar neste momento.</p>
            )}
            {expiresAt && (
              <p><span className="font-medium text-[var(--app-text-primary)]">Prazo do histórico sem lead:</span> {expiresAt}</p>
            )}
            <p className="border-t border-[var(--app-border)] pt-2 leading-relaxed">
              {isReassignment
                ? "As mensagens já atribuídas ao lead de origem permanecerão nele. As próximas mensagens desta conversa seguirão o novo lead."
                : "Após o vínculo, este histórico ficará visível às pessoas com acesso ao lead."}
              {" "}Entrar no atendimento é uma ação separada e será necessário para enviar pelo CRM.
            </p>
            {preview.bindingMode === "history_only" && (
              <p className="leading-relaxed">
                Esta conversa anterior será anexada somente como histórico. O chat atual do lead continuará separado.
              </p>
            )}
          </div>
        )}

        <AlertDialogFooter>
          <Button type="button" variant="outline" disabled={isConfirming} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={!canConfirm} onClick={onConfirm}>
            {isConfirming && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {mode === "new" ? "Continuar para cadastro" : isReassignment ? "Mudar vínculo da conversa" : "Vincular e anexar histórico"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
