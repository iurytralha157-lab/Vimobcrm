import { useEffect, useMemo, useRef, useState } from "react";
import type { WhatsAppSession } from "@/hooks/use-whatsapp-sessions";
import { getOwnConnectedWhatsAppSessions } from "@/lib/access/whatsapp-session-sharing";

type SendOriginConversation = {
  id?: string | null;
  lead_id?: string | null;
  lead?: { id?: string | null } | null;
  session_id?: string | null;
  is_group?: boolean | null;
  historical_lead_view?: boolean | null;
};

export type WhatsAppSendOriginDecision =
  | { kind: "entry" }
  | { kind: "own"; sessionId: string }
  | null;

export function useWhatsAppSendOriginChoice(input: {
  conversation: SendOriginConversation | null | undefined;
  sessions: WhatsAppSession[] | null | undefined;
  currentUserId: string | null | undefined;
  organizationId: string | null | undefined;
  enabled: boolean;
  alreadySentOnEntry?: boolean;
}) {
  const [continuedEntryKeys, setContinuedEntryKeys] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState(false);
  const pendingRef = useRef<{
    choiceKey: string;
    resolve: (decision: WhatsAppSendOriginDecision) => void;
  } | null>(null);
  const entrySession = input.sessions?.find((session) => session.id === input.conversation?.session_id) || null;
  const ownSessions = useMemo(() => getOwnConnectedWhatsAppSessions(
    input.sessions,
    input.currentUserId,
    input.organizationId,
  ).filter((session) => session.id !== entrySession?.id), [
    entrySession?.id,
    input.currentUserId,
    input.organizationId,
    input.sessions,
  ]);
  const leadId = input.conversation?.lead_id || input.conversation?.lead?.id;
  const choiceKey = input.organizationId && input.currentUserId && leadId
    && input.conversation?.id && entrySession?.id
    ? JSON.stringify([input.organizationId, input.currentUserId, leadId, input.conversation.id, entrySession.id])
    : null;
  const required = Boolean(
    input.enabled
    && choiceKey
    && !continuedEntryKeys.has(choiceKey)
    && !input.alreadySentOnEntry
    && !input.conversation?.is_group
    && !input.conversation?.historical_lead_view
    && entrySession?.organization_id === input.organizationId
    && entrySession?.owner_user_id !== input.currentUserId
    && entrySession?.status === "connected"
    && entrySession?.provider === "evolution_go"
    && ownSessions.length > 0,
  );

  useEffect(() => {
    const pending = pendingRef.current;
    if (pending && (pending.choiceKey !== choiceKey || !required)) {
      pendingRef.current = null;
      pending.resolve(null);
      setOpen(false);
    }
  }, [choiceKey, required]);

  useEffect(() => () => {
    pendingRef.current?.resolve(null);
    pendingRef.current = null;
  }, []);

  const finishChoice = (decision: WhatsAppSendOriginDecision) => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    setOpen(false);
    pending.resolve(decision);
  };

  return {
    required,
    open,
    entrySession,
    ownSessions,
    chooseForSend: (): Promise<WhatsAppSendOriginDecision> => {
      if (!required || !choiceKey) return Promise.resolve({ kind: "entry" });
      // Only the first send attempt may continue after a shared dialog closes.
      if (pendingRef.current) return Promise.resolve(null);
      return new Promise((resolve) => {
        pendingRef.current = { choiceKey, resolve };
        setOpen(true);
      });
    },
    continueWithEntry: () => {
      if (!choiceKey || pendingRef.current?.choiceKey !== choiceKey) return;
      setContinuedEntryKeys((current) => new Set(current).add(choiceKey));
      finishChoice({ kind: "entry" });
    },
    startWithOwn: (sessionId: string) => {
      if (pendingRef.current?.choiceKey !== choiceKey || !ownSessions.some((session) => session.id === sessionId)) return;
      finishChoice({ kind: "own", sessionId });
    },
    cancel: () => finishChoice(null),
  };
}
