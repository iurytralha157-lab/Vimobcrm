"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useStartConversation, getWhatsAppStartErrorMessage } from "@/hooks/use-start-conversation";
import type { WhatsAppConversation } from "@/hooks/use-whatsapp-conversations";
import type { WhatsAppSession } from "@/hooks/use-whatsapp-sessions";
import { toast } from "@/hooks/use-toast";
import { whatsappAPI } from "@/lib/api/whatsapp";
import { normalizePhoneToE164 } from "@/lib/phone-utils";
import { WHATSAPP_UNLINKED_LEAD_SNAPSHOT } from "@/lib/whatsapp-message-input";
import {
  getWhatsAppReplacementCandidateDecision,
  type WhatsAppReplacementPlan,
} from "@/lib/whatsapp-replacement-flow";

type WhatsAppOwnLineActionProps = {
  plan: WhatsAppReplacementPlan | null;
  sessions: WhatsAppSession[];
  canOperate: boolean;
  organizationId?: string | null;
  onOpen: (conversation: WhatsAppConversation) => void;
};

export function WhatsAppOwnLineAction({
  plan,
  sessions,
  canOperate,
  organizationId,
  onOpen,
}: WhatsAppOwnLineActionProps) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const sourceRef = useRef(plan?.sourceConversationId || null);
  useEffect(() => {
    sourceRef.current = plan?.sourceConversationId || null;
    return () => {
      sourceRef.current = null;
    };
  }, [plan?.sourceConversationId]);
  const startConversation = useStartConversation();

  if (!canOperate || plan?.reason !== "other-owner") return null;

  const ownLines = sessions.filter((session) =>
    plan.connectedSessionIds.includes(session.id)
    && session.status === "connected"
    && session.provider === "evolution_go",
  );

  async function openOnLine(sessionId: string) {
    const request = plan;
    if (!request?.phone || busyRef.current || !ownLines.some((session) => session.id === sessionId)) return;
    busyRef.current = true;
    setBusy(true);
    let startMutationFailed = false;
    try {
      // Search the exact physical line. A lead-wide lookup could reopen the
      // read-only conversation on somebody else's WhatsApp.
      const existing = await whatsappAPI.findConversation({
        phone: request.phone,
        sessionId,
        organizationId,
      });
      if (sourceRef.current !== request.sourceConversationId) return;
      const decision = getWhatsAppReplacementCandidateDecision(existing, {
        leadId: request.leadId,
        phone: request.phone,
        sourceConversationId: request.sourceConversationId,
        sessionId,
      });
      if (decision.action === "blocked") {
        throw new Error(decision.reason === "another-lead"
          ? "Esta linha já tem uma conversa com o número vinculada a outro lead. Revise o vínculo antes de continuar."
          : "Não foi possível confirmar o telefone e a linha para este lead.");
      }

      let conversationId = decision.action === "open" ? decision.conversationId : null;
      if (!conversationId) {
        try {
          const started = await startConversation.mutateAsync({
            phone: request.phone,
            sessionId,
            leadId: request.leadId,
            expectedPreviousLeadId: WHATSAPP_UNLINKED_LEAD_SNAPSHOT,
          });
          conversationId = started.id;
        } catch (error) {
          startMutationFailed = true;
          throw error;
        }
      }
      if (conversationId === request.sourceConversationId) {
        throw new Error("A conversa antiga não pode ser reutilizada para este atendimento.");
      }

      const verified = await whatsappAPI.getConversation(conversationId, request.leadId, organizationId);
      if (verified.lead_id !== request.leadId
        || verified.session_id !== sessionId
        || verified.historical_lead_view
        || normalizePhoneToE164(verified.contact_phone) !== request.phone) {
        throw new Error("A nova conversa não foi confirmada para este lead e WhatsApp.");
      }
      if (sourceRef.current !== request.sourceConversationId) return;
      setSelectorOpen(false);
      onOpen(verified);
    } catch (error) {
      if (!startMutationFailed) {
        toast({
          title: "Não foi possível iniciar nova conversa",
          description: getWhatsAppStartErrorMessage(error),
          variant: "destructive",
        });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-[var(--app-border)] bg-[var(--app-surface-soft)] px-3 py-2.5 text-xs text-[var(--app-text-secondary)]">
      <p>Esta conversa usa o WhatsApp de outra pessoa. Para responder por sua linha, inicie uma nova conversa. O histórico continua aqui.</p>
      {!plan.phone ? (
        <p>Confira o telefone do lead antes de iniciar uma nova conversa.</p>
      ) : ownLines.length === 0 ? (
        <p>Você não tem outro WhatsApp conectado. Conecte sua linha em Integrações para responder.</p>
      ) : (
        <Button type="button" variant="outline" size="sm" disabled={busy}
          onClick={() => {
            if (ownLines.length === 1) void openOnLine(ownLines[0].id);
            else setSelectorOpen(true);
          }}>
          {busy ? "Abrindo conversa..." : "Iniciar conversa pela minha linha"}
        </Button>
      )}
      <Dialog open={selectorOpen} onOpenChange={setSelectorOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Escolher meu WhatsApp</DialogTitle>
            <DialogDescription>Selecione a linha conectada para iniciar uma conversa separada com este lead.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {ownLines.map((session) => (
              <Button key={session.id} type="button" variant="outline" className="h-auto w-full justify-start text-left"
                disabled={busy} onClick={() => void openOnLine(session.id)}>
                {session.instance_name}{session.phone_number ? ` · ${session.phone_number}` : ""}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
