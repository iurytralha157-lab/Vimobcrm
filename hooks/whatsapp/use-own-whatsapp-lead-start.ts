"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getWhatsAppStartErrorMessage } from "@/hooks/use-start-conversation";
import { leadsAPI } from "@/lib/api/leads";
import { whatsappAPI, type WhatsAppConversation, type WhatsAppConversationLinkPreview } from "@/lib/api/whatsapp";
import { getWhatsAppPhoneChangeConfirmation, type WhatsAppPhoneChangeConfirmation } from "@/lib/whatsapp-phone-change";
import { VimobAPIError } from "@/lib/api/vimob-error";
import { normalizePhoneToE164 } from "@/lib/phone-utils";
import { abortWhatsAppRequestIntents, runWhatsAppRequestIntent } from "@/lib/whatsapp-request-intent";
import { whatsappQueryKeys, type WhatsAppQueryScope } from "@/lib/whatsapp-query-cache";
import { getOwnWhatsAppStartNotice } from "@/lib/whatsapp-own-start";

type Session = NonNullable<Parameters<typeof getOwnWhatsAppStartNotice>[0]["sessions"]>[number] & {
  instance_name?: string | null; phone_number?: string | null;
};
type Target = { key: string; owner: object; generation: number; request: number; leadId: string; sessionId?: string; phone?: string; leadName?: string };
type Pending =
  | { kind: "select"; target: Target }
  | { kind: "link"; target: Target; conversationId: string }
  | { kind: "phone"; target: Target; confirmation: WhatsAppPhoneChangeConfirmation };
type State = { target: Target; busy: boolean; pending?: Pending; preview?: WhatsAppConversationLinkPreview; error?: string };

/** Prepares an owned route only. Sending and entering attendance remain separate. */
export function useOwnWhatsAppLeadStart({ scope, selectionKey, conversation, sessions, canOperate, loadingSessions, onReady }: {
  scope: WhatsAppQueryScope;
  selectionKey: string;
  conversation: Parameters<typeof getOwnWhatsAppStartNotice>[0]["conversation"];
  sessions: Session[] | undefined;
  canOperate: boolean;
  loadingSessions: boolean;
  onReady: (conversation: WhatsAppConversation) => void;
}) {
  const notice = getOwnWhatsAppStartNotice({ conversation, sessions, currentUserId: scope.userId, canOperate, loadingSessions });
  const ownSessions = (sessions || []).filter(s => notice?.ownConnectedSessionIds.includes(s.id));
  const key = JSON.stringify([scope.userId, scope.organizationId, scope.accessScope, selectionKey, canOperate, loadingSessions,
    ownSessions.map(s => s.id).sort()]);
  const [owner, setOwner] = useState({ key, token: {} });
  const renderOwner = owner.key === key ? owner : { key, token: {} };
  if (owner.key !== key) setOwner(renderOwner);
  const latest = useRef({ key, owner: renderOwner.token, generation: 0, request: 0, mounted: false, busy: false, onReady, ownSessions, scope, conversation });
  const controllers = useRef(new Set<AbortController>());
  const [state, setState] = useState<State | null>(null);
  const queryClient = useQueryClient();
  useLayoutEffect(() => {
    const ref = latest.current, requests = controllers.current;
    ref.mounted = true;
    return () => { ref.mounted = false; ref.generation++; abortWhatsAppRequestIntents(requests); };
  }, []);
  useLayoutEffect(() => {
    if (latest.current.key !== key) {
      latest.current.generation++;
      latest.current.busy = false;
      abortWhatsAppRequestIntents(controllers.current);
    }
    Object.assign(latest.current, { key, owner: renderOwner.token, onReady, ownSessions, scope, conversation });
  });
  const current = (target: Target) => {
    const ref = latest.current;
    return ref.mounted && ref.key === target.key && ref.owner === target.owner && ref.generation === target.generation && ref.request === target.request
      && Boolean(ref.scope.userId && ref.scope.organizationId)
      && (ref.conversation?.lead_id || ref.conversation?.lead?.id) === target.leadId
      && (!target.sessionId || ref.ownSessions.some(s => s.id === target.sessionId));
  };
  const visible = state && state.target.key === key && state.target.owner === renderOwner.token ? state : null;
  const update = (target: Target, value: Omit<State, "target">) => {
    if (current(target)) { latest.current.busy = value.busy; setState({ target, ...value }); }
  };
  const request = <T,>(target: Target, callback: Parameters<typeof runWhatsAppRequestIntent<T>>[2]) => {
    if (!current(target)) throw Error("O contexto do atendimento mudou. Reabra o lead.");
    return runWhatsAppRequestIntent(latest.current.scope, controllers.current, callback);
  };
  const freshLead = async (target: Target) => {
    const scope = latest.current.scope;
    const { data: lead } = await request(target, intent => leadsAPI.getLead(target.leadId, scope.organizationId!, intent.signal, intent));
    if (!current(target)) return null;
    if (lead.id !== target.leadId || lead.organization_id !== scope.organizationId) throw Error("O lead mudou. Atualize antes de iniciar.");
    const session = await request(target, intent => whatsappAPI.getSession(target.sessionId!, scope.organizationId, intent));
    if (!current(target)) return null;
    if (session.id !== target.sessionId || session.organization_id !== scope.organizationId || session.owner_user_id !== scope.userId
      || session.status !== "connected" || session.provider !== "evolution_go" || session.is_active === false || session.can_send === false)
      throw Error("Seu WhatsApp não está disponível para este atendimento. Confira a conexão e tente novamente.");
    const phone = normalizePhoneToE164(lead.phone);
    if (!phone) throw Error("Cadastre um telefone válido no lead para iniciar a conversa.");
    if (target.phone && target.phone !== phone) throw Error("O telefone do lead mudou. Inicie novamente para conferir o destino.");
    return { ...target, phone, leadName: lead.name };
  };
  const finish = (target: Target, result: WhatsAppConversation) => {
    if (!current(target)) return;
    if (result.historical_lead_view || result.session_id !== target.sessionId
      || (result.lead_id || result.lead?.id) !== target.leadId) throw Error("A conversa mudou. Atualize antes de iniciar o atendimento.");
    setState(null);
    latest.current.busy = false;
    latest.current.onReady(result);
  };
  const start = async (target: Target, expectedPreviousLeadId: string, confirmation?: WhatsAppPhoneChangeConfirmation) => {
    if (!current(target)) throw Error("O contexto do atendimento mudou. Reabra o lead.");
    const scope = { ...latest.current.scope };
    const result = await request(target, intent => whatsappAPI.startConversation({ phone: target.phone!, leadId: target.leadId, sessionId: target.sessionId,
      leadName: target.leadName, expectedPreviousLeadId, ownSessionOnly: true,
      ...(confirmation ? { confirmPhoneChange: true, expectedPreviousConversationId: confirmation.conversationId,
        ...(confirmation.requiresDestinationHistoryConfirmation ? { confirmDestinationHistory: true,
          expectedDestinationConversationId: confirmation.destinationConversationId } : {}) } : {}) }, scope.organizationId, intent));
    void queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
    return result;
  };
  async function loadPreview(pending: Exclude<Pending, { kind: "select" }>) {
    const target = pending.target;
    update(target, { busy: true, pending });
    try {
      const conversationId = pending.kind === "link" ? pending.conversationId : pending.confirmation.destinationConversationId;
      if (!conversationId) throw Error("O destino da conversa mudou. Inicie novamente.");
      const preview = await request(target, intent => whatsappAPI.getConversationLinkPreview(conversationId, "unlinked", target.leadId,
        latest.current.scope.organizationId, intent));
      if (!current(target)) return;
      if (preview.conversationId !== conversationId || preview.sessionId !== target.sessionId || preview.leadId !== target.leadId
        || preview.expectedPreviousLeadId !== "unlinked" || preview.bindingMode !== "active") throw Error("O vínculo da conversa mudou. Inicie novamente.");
      update(target, { pending, preview, busy: false });
    } catch (error) { update(target, { pending, busy: false, error: getWhatsAppStartErrorMessage(error) }); }
  }
  async function prepare(target: Target) {
    if (!current(target)) return;
    update(target, { busy: true });
    let prepared = target;
    try {
      const fresh = await freshLead(target);
      if (!fresh) return;
      prepared = fresh;
      const exact = await request(prepared, intent => whatsappAPI.findConversation({ phone: prepared.phone!, leadId: prepared.leadId,
        sessionId: prepared.sessionId, organizationId: latest.current.scope.organizationId }, intent));
      if (!current(prepared)) return;
      if (exact && !exact.historical_lead_view) { finish(prepared, exact); return; }
      const physical = await request(prepared, intent => whatsappAPI.findConversation({ phone: prepared.phone!, sessionId: prepared.sessionId,
        organizationId: latest.current.scope.organizationId }, intent));
      if (!current(prepared)) return;
      if (physical?.lead_id && physical.lead_id !== prepared.leadId) throw Error("Este telefone está vinculado a outro lead. Confira o cadastro antes de continuar.");
      const result = await start(prepared, physical ? prepared.leadId : "unlinked");
      finish(prepared, result);
    } catch (error) {
      if (!current(prepared)) return;
      const confirmation = getWhatsAppPhoneChangeConfirmation(error);
      if (confirmation) {
        if (confirmation.leadId !== prepared.leadId || confirmation.sessionId !== prepared.sessionId) {
          update(prepared, { busy: false, error: "O atendimento mudou. Inicie novamente." }); return;
        }
        const pending: Pending = { kind: "phone", target: prepared, confirmation };
        if (confirmation.requiresDestinationHistoryConfirmation) await loadPreview(pending);
        else update(prepared, { pending, busy: false });
        return;
      }
      if (error instanceof VimobAPIError && error.code === "whatsapp_history_link_required") {
        try {
          const physical = await request(prepared, intent => whatsappAPI.findConversation({ phone: prepared.phone!, sessionId: prepared.sessionId,
            organizationId: latest.current.scope.organizationId }, intent));
          if (!current(prepared)) return;
          if (!physical || physical.lead_id || physical.historical_lead_view || physical.session_id !== prepared.sessionId) throw Error("A conversa mudou. Inicie novamente.");
          await loadPreview({ kind: "link", target: prepared, conversationId: physical.id });
        } catch (failure) { update(prepared, { busy: false, error: getWhatsAppStartErrorMessage(failure) }); }
        return;
      }
      update(prepared, { busy: false, error: getWhatsAppStartErrorMessage(error) });
    }
  }
  const begin = () => {
    if (notice?.kind !== "start" || latest.current.busy) return;
    const ref = latest.current, leadId = ref.conversation?.lead_id || ref.conversation?.lead?.id;
    if (!leadId || !ref.ownSessions.length) return;
    const target: Target = { key: ref.key, owner: ref.owner, generation: ref.generation, request: ++ref.request, leadId };
    if (ref.ownSessions.length > 1) update(target, { pending: { kind: "select", target }, busy: false });
    else void prepare({ ...target, sessionId: ref.ownSessions[0].id });
  };
  const chooseSession = (sessionId: string) => {
    if (visible?.pending?.kind !== "select" || latest.current.busy || !current(visible.target)
      || !latest.current.ownSessions.some(s => s.id === sessionId)) return;
    void prepare({ ...visible.target, sessionId });
  };
  const confirm = async () => {
    const pending = visible?.pending;
    if (!pending || pending.kind === "select" || latest.current.busy || visible.error) return;
    const target = pending.target;
    if ((pending.kind === "link" || pending.confirmation.requiresDestinationHistoryConfirmation) && !visible.preview) return;
    update(target, { pending, preview: visible.preview, busy: true });
    try {
      const fresh = await freshLead(target);
      if (!fresh) return;
      if (pending.kind === "link") {
        const result = await request(fresh, intent => whatsappAPI.linkConversationToLead(pending.conversationId, fresh.leadId, "unlinked",
          latest.current.scope.organizationId, intent, true));
        if (!current(fresh)) return;
        if (result.bindingMode !== "active") throw Error("O histórico foi preservado. Atualize para conferir a conversa atual.");
      }
      const result = await start(fresh, fresh.leadId, pending.kind === "phone" ? pending.confirmation : undefined);
      finish(fresh, result);
    } catch (error) { update(target, { pending, preview: visible.preview, busy: false, error: getWhatsAppStartErrorMessage(error) }); }
  };
  const cancel = () => { latest.current.request++; latest.current.busy = false; abortWhatsAppRequestIntents(controllers.current); setState(null); };
  return { notice, ownSessions, pending: visible?.pending, preview: visible?.preview ?? null, error: visible?.error,
    busy: visible?.busy ?? false, begin, chooseSession, confirm, cancel,
    retryPreview: () => { if (visible?.pending && visible.pending.kind !== "select") void loadPreview(visible.pending); } };
}

export type OwnWhatsAppLeadStart = ReturnType<typeof useOwnWhatsAppLeadStart>;
