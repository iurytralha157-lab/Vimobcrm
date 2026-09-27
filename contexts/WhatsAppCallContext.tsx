"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WhatsAppCallDialog } from "@/components/features/whatsapp/calls/WhatsAppCallDialog";
import { WhatsAppRecordingDialog } from "@/components/features/whatsapp/calls/WhatsAppRecordingDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useWhatsAppSessions } from "@/hooks/use-whatsapp-sessions";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useSessionWhatsAppCalls } from "@/hooks/whatsapp/use-whatsapp-calls";
import { useWhatsAppCallAudio } from "@/hooks/whatsapp/use-whatsapp-call-audio";
import { toast } from "@/hooks/use-toast";
import { whatsappAPI } from "@/lib/api/whatsapp";
import { whatsappCallsAPI } from "@/lib/api/whatsapp-calls";
import { isWhatsAppSessionFeatureEnabled } from "@/lib/whatsapp-call-capabilities";
import type { WhatsAppCall } from "@/lib/validation/whatsapp-calls";

const ACTIVE_STATES = new Set<WhatsAppCall["state"]>(["incoming", "outgoing", "ringing", "active", "end_pending", "reject_pending", "outcome_unknown"]);
const TERMINAL_STATES = new Set<WhatsAppCall["state"]>(["rejected", "ended", "failed"]);
const EMPTY_SESSIONS: never[] = [];
const EMPTY_CALLS: WhatsAppCall[] = [];
const CALL_STATE_RANK: Record<WhatsAppCall["state"], number> = {
  incoming: 0,
  outgoing: 0,
  ringing: 1,
  active: 2,
  end_pending: 3,
  reject_pending: 3,
  outcome_unknown: 4,
  rejected: 5,
  ended: 5,
  failed: 5,
};

type WhatsAppCallContextValue = {
  activeCalls: WhatsAppCall[];
  currentCall: WhatsAppCall | null;
  openForConversation: (conversationId: string, contactName: string) => Promise<void>;
  openRecording: (callId: string) => void;
  reopenCall: () => void;
};

const WhatsAppCallContext = createContext<WhatsAppCallContextValue | null>(null);

export function useWhatsAppCallContext() {
  const context = useContext(WhatsAppCallContext);
  if (!context) throw new Error("useWhatsAppCallContext requires WhatsAppCallProvider");
  return context;
}

function errorMessage(cause: unknown) {
  return cause instanceof Error && cause.message ? cause.message : "Não foi possível executar a ação na ligação";
}

function isTerminal(call: WhatsAppCall | null): boolean {
  return Boolean(call && TERMINAL_STATES.has(call.state));
}

function incomingDisplayName(call: WhatsAppCall) {
  return call.remote_jid.split("@")[0] || "Contato";
}

export function WhatsAppCallProvider({ children }: { children: ReactNode }) {
  const { activeOrganization, user } = useAuth();
  const scopeKey = `${activeOrganization.organizationId ?? ""}:${user?.id ?? ""}`;
  return <ScopedWhatsAppCallProvider key={scopeKey}>{children}</ScopedWhatsAppCallProvider>;
}

function ScopedWhatsAppCallProvider({ children }: { children: ReactNode }) {
  const { activeOrganization, user } = useAuth();
  const organizationId = activeOrganization.organizationId;
  const userId = user?.id ?? null;
  const scopeKey = `${organizationId ?? ""}:${userId ?? ""}`;
  const queryClient = useQueryClient();
  const { hasPermission } = useUserPermissions();
  const { hasModule } = useOrganizationModules();
  const canOperateWhatsApp = hasModule("whatsapp") && hasPermission("whatsapp_operate");
  const { connect: connectAudio, stop: stopAudio, status: audioStatus, error: audioError } = useWhatsAppCallAudio();
  const sessionsQuery = useWhatsAppSessions({ enabled: Boolean(organizationId && userId && canOperateWhatsApp), live: true });
  const sessions = sessionsQuery.data ?? EMPTY_SESSIONS;

  const enabledSessionIds = useMemo(() => new Set(canOperateWhatsApp ? sessions
    .filter((session) => isWhatsAppSessionFeatureEnabled(session, "whatsapp_calls_enabled", userId))
    .map((session) => session.id) : []), [canOperateWhatsApp, sessions, userId]);
  const activeQueryKey = useMemo(() => ["whatsapp-calls", "active", organizationId, userId] as const, [organizationId, userId]);
  const activeQuery = useQuery({
    queryKey: activeQueryKey,
    queryFn: () => whatsappCallsAPI.listActive(organizationId!),
    enabled: Boolean(organizationId && userId && enabledSessionIds.size),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    staleTime: 2_000,
  });

  const activeCalls = useMemo(() => (activeQuery.data ?? []).filter((call) =>
    call.organization_id === organizationId && enabledSessionIds.has(call.session_id) && ACTIVE_STATES.has(call.state)),
  [activeQuery.data, enabledSessionIds, organizationId]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [contactName, setContactName] = useState("Contato");
  const [draftConversationId, setDraftConversationId] = useState<string | null>(null);
  const [draftSessionId, setDraftSessionId] = useState<string | null>(null);
  const [selectedCall, setSelectedCall] = useState<WhatsAppCall | null>(null);
  const [recordingCallId, setRecordingCallId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const seenIncomingIdsRef = useRef(new Set<string>());
  const autoConnectCallIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const actionGenerationRef = useRef(0);
  const openGenerationRef = useRef(0);
  const scopeRef = useRef(scopeKey);
  const selectedCallRef = useRef(selectedCall);

  useEffect(() => {
    selectedCallRef.current = selectedCall;
  }, [selectedCall]);

  const selectedSessionId = selectedCall?.session_id ?? null;
  const shouldPollSelectedSession = Boolean(selectedSessionId && (dialogOpen || (selectedCall && !isTerminal(selectedCall))));
  const selectedSessionQuery = useSessionWhatsAppCalls(selectedSessionId, shouldPollSelectedSession);
  const sessionCalls = selectedSessionQuery.data ?? EMPTY_CALLS;

  useEffect(() => () => {
    scopeRef.current = "";
    actionGenerationRef.current += 1;
    openGenerationRef.current += 1;
  }, []);

  useEffect(() => {
    if (!selectedCall || !organizationId || !enabledSessionIds.has(selectedCall.session_id)) return;
    const fromSession = sessionCalls.find((call) => call.id === selectedCall.id && call.organization_id === organizationId);
    const fromActive = activeCalls.find((call) => call.id === selectedCall.id);
    const latest = fromActive && (!fromSession || CALL_STATE_RANK[fromActive.state] > CALL_STATE_RANK[fromSession.state])
      ? fromActive : fromSession;
    if (!latest) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSelectedCall((current) => current?.id === latest.id && current !== latest
        && CALL_STATE_RANK[latest.state] >= CALL_STATE_RANK[current.state] ? latest : current);
    });
    return () => { cancelled = true; };
  }, [sessionCalls, activeCalls, selectedCall, organizationId, enabledSessionIds]);

  useEffect(() => {
    if (!selectedCall || !organizationId || !userId || !enabledSessionIds.has(selectedCall.session_id)) {
      stopAudio();
      if (selectedCall && !enabledSessionIds.has(selectedCall.session_id)) {
        let cancelled = false;
        queueMicrotask(() => {
          if (cancelled) return;
          setSelectedCall(null);
          setDialogOpen(false);
        });
        return () => { cancelled = true; };
      }
      return;
    }
    if (selectedCall.state !== "active" || selectedCall.operator_user_id !== userId) {
      stopAudio();
      return;
    }
    if (autoConnectCallIdRef.current === selectedCall.id) {
      autoConnectCallIdRef.current = null;
      void connectAudio(selectedCall.id).catch(() => {
        // The dialog offers an explicit retry after a failed media connection.
      });
    }
  }, [selectedCall, organizationId, userId, enabledSessionIds, connectAudio, stopAudio]);

  useEffect(() => {
    if (!organizationId || !userId || (selectedCall && !isTerminal(selectedCall))) return;
    const candidate = activeCalls.find((call) =>
      !seenIncomingIdsRef.current.has(call.id)
      && (call.operator_user_id === null || call.operator_user_id === userId)
      && (call.direction === "incoming" && (call.state === "incoming" || call.state === "ringing")
        || call.operator_user_id === userId && (call.state === "outgoing" || call.state === "ringing" || call.state === "active")));
    if (!candidate) return;
    seenIncomingIdsRef.current.add(candidate.id);
    setSelectedCall(candidate);
    setDraftConversationId(candidate.conversation_id);
    setDraftSessionId(candidate.session_id);
    setContactName(incomingDisplayName(candidate));
    setActionError(null);
    setDialogOpen(true);
  }, [activeCalls, selectedCall, organizationId, userId]);

  const runAction = useCallback(async (operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const generation = ++actionGenerationRef.current;
    const operationScope = scopeRef.current;
    setBusy(true);
    setActionError(null);
    try {
      await operation();
    } catch (cause) {
      if (scopeRef.current === operationScope) setActionError(errorMessage(cause));
    } finally {
      if (generation === actionGenerationRef.current && scopeRef.current === operationScope) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, []);

  const openForConversation = useCallback(async (conversationId: string, requestedName: string) => {
    if (!organizationId || !userId || !conversationId) return;
    if (selectedCallRef.current && !isTerminal(selectedCallRef.current)) {
      setDialogOpen(true);
      return;
    }
    const generation = ++openGenerationRef.current;
    const requestScope = scopeKey;
    try {
      const conversation = await whatsappAPI.getConversationSnapshot(conversationId, organizationId);
      if (generation !== openGenerationRef.current || scopeRef.current !== requestScope) return;
      if (!conversation.session_id || !enabledSessionIds.has(conversation.session_id)
        || conversation.is_group || conversation.deleted_at || !conversation.remote_jid) {
        throw new Error("Ligações não estão habilitadas para esta conversa e sessão.");
      }
      setSelectedCall(null);
      setDraftConversationId(conversationId);
      setDraftSessionId(conversation.session_id);
      setContactName(requestedName || conversation.contact_name || conversation.contact_phone || "Contato");
      setActionError(null);
      setDialogOpen(true);
    } catch (cause) {
      if (generation !== openGenerationRef.current || scopeRef.current !== requestScope) return;
      toast({ title: "Ligação indisponível", description: errorMessage(cause), variant: "destructive" });
    }
  }, [organizationId, userId, scopeKey, enabledSessionIds]);

  const onStart = useCallback(() => {
    if (!organizationId || !userId || !draftConversationId || !draftSessionId || !enabledSessionIds.has(draftSessionId)) return;
    const conversationId = draftConversationId;
    const actionScope = scopeKey;
    void runAction(async () => {
      const call = await whatsappCallsAPI.start(conversationId, organizationId);
      if (scopeRef.current !== actionScope) return;
      if (call.organization_id !== organizationId || !enabledSessionIds.has(call.session_id)) throw new Error("Sessão da ligação inesperada");
      setSelectedCall(call);
      if (call.operator_user_id !== userId) throw new Error("A ligação não foi atribuída a você");
      autoConnectCallIdRef.current = call.id;
      void queryClient.invalidateQueries({ queryKey: activeQueryKey });
    });
  }, [organizationId, userId, draftConversationId, draftSessionId, enabledSessionIds, scopeKey, runAction, queryClient, activeQueryKey]);

  const onCommand = useCallback((action: "accept" | "reject" | "end") => {
    const call = selectedCallRef.current;
    if (!call || !organizationId || !userId || !enabledSessionIds.has(call.session_id)) return;
    if (action === "accept" || action === "reject") {
      if (call.direction !== "incoming" || (call.state !== "incoming" && call.state !== "ringing")
        || (call.operator_user_id && call.operator_user_id !== userId)) return;
    } else if (call.operator_user_id !== userId || !ACTIVE_STATES.has(call.state)) {
      return;
    }
    const actionScope = scopeKey;
    if (action !== "accept") stopAudio();
    void runAction(async () => {
      const updated = await whatsappCallsAPI.command(call.id, action, organizationId);
      if (scopeRef.current !== actionScope) return;
      if (updated.organization_id !== organizationId || updated.session_id !== call.session_id) throw new Error("Sessão da ligação inesperada");
      setSelectedCall(updated);
      if (action === "accept") {
        if (updated.operator_user_id !== userId) throw new Error("A ligação foi assumida por outro operador");
        autoConnectCallIdRef.current = updated.id;
      }
      void queryClient.invalidateQueries({ queryKey: activeQueryKey });
    });
  }, [organizationId, userId, enabledSessionIds, scopeKey, stopAudio, runAction, queryClient, activeQueryKey]);

  const onReconnectAudio = useCallback(() => {
    const call = selectedCallRef.current;
    if (!call || call.state !== "active" || call.operator_user_id !== userId || !enabledSessionIds.has(call.session_id)) return;
    void connectAudio(call.id).catch(() => {
      // Audio hook surfaces the error in the dialog.
    });
  }, [userId, enabledSessionIds, connectAudio]);

  const dismissUnknownCall = useCallback(() => {
    const call = selectedCallRef.current;
    if (!call || call.state !== "outcome_unknown") return;
    seenIncomingIdsRef.current.add(call.id);
    selectedCallRef.current = null;
    autoConnectCallIdRef.current = null;
    stopAudio();
    setSelectedCall(null);
    setDraftConversationId(null);
    setDraftSessionId(null);
    setDialogOpen(false);
    toast({
      title: "Estado da ligação ainda incerto",
      description: "Confira a chamada no aparelho antes de tentar outra ligação.",
    });
  }, [stopAudio]);

  const onCallDialogOpenChange = useCallback((open: boolean) => {
    if (!open && selectedCallRef.current?.state === "outcome_unknown") {
      dismissUnknownCall();
      return;
    }
    setDialogOpen(open);
  }, [dismissUnknownCall]);

  const openRecording = useCallback((callId: string) => {
    if (organizationId && userId && callId) setRecordingCallId(callId);
  }, [organizationId, userId]);

  const currentCall = selectedCall && !isTerminal(selectedCall) ? selectedCall : null;
  const lastCall = isTerminal(selectedCall) ? selectedCall : null;
  const canControlCall = Boolean(currentCall && currentCall.operator_user_id === userId && enabledSessionIds.has(currentCall.session_id));
  const value = useMemo<WhatsAppCallContextValue>(() => ({
    activeCalls,
    currentCall,
    openForConversation,
    openRecording,
    reopenCall: () => setDialogOpen(true),
  }), [activeCalls, currentCall, openForConversation, openRecording]);

  return (
    <WhatsAppCallContext.Provider value={value}>
      {children}
      {!dialogOpen && currentCall && (
        <Button type="button" variant="outline" className="fixed bottom-5 right-5 z-[60] shadow-lg" onClick={() => setDialogOpen(true)}>
          <Phone className="mr-2 h-4 w-4" /> Ligação pelo WhatsApp
        </Button>
      )}
      <WhatsAppCallDialog
        open={dialogOpen}
        onOpenChange={onCallDialogOpenChange}
        contactName={contactName}
        call={currentCall}
        lastCall={lastCall}
        busy={busy || (!currentCall && !draftConversationId)}
        audioStatus={audioStatus}
        audioError={actionError || audioError}
        canControlCall={canControlCall}
        onStart={onStart}
        onAccept={() => onCommand("accept")}
        onReject={() => onCommand("reject")}
        onEnd={() => onCommand("end")}
        onDismissUnknown={dismissUnknownCall}
        onReconnectAudio={onReconnectAudio}
        onPlayRecording={openRecording}
      />
      <WhatsAppRecordingDialog callId={recordingCallId} onOpenChange={(open) => {
        if (!open) setRecordingCallId(null);
      }} />
    </WhatsAppCallContext.Provider>
  );
}
