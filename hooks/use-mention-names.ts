import { useEffect, useMemo, useState } from "react";
import { whatsappAPI, type WhatsAppConversation } from "@/lib/api/whatsapp";
import { WHATSAPP_UNLINKED_LEAD_SNAPSHOT } from "@/lib/whatsapp-message-input";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";

type MentionLookupContext = {
  groupJid?: string | null;
  sessionId?: string | null;
  leadId?: string | null;
};

type LookupContext = MentionLookupContext & {
  organizationId?: string | null;
  userId?: string | null;
  accessScope?: string | null;
};

type CacheValue = string | null;
type GroupParticipant = string | Record<string, unknown>;
type CacheSubscriber = () => void;

const cache = new Map<string, CacheValue>();
const subscribersByCacheKey = new Map<string, Set<CacheSubscriber>>();
const conversationsCache = new Map<string, Promise<WhatsAppConversation[]>>();

function subscribeToCacheKeys(keys: readonly string[], subscriber: CacheSubscriber): () => void {
  const uniqueKeys = new Set(keys);
  if (uniqueKeys.size === 0) return () => undefined;

  uniqueKeys.forEach((key) => {
    const subscribers = subscribersByCacheKey.get(key) || new Set<CacheSubscriber>();
    subscribers.add(subscriber);
    subscribersByCacheKey.set(key, subscribers);
  });

  return () => {
    uniqueKeys.forEach((key) => {
      const subscribers = subscribersByCacheKey.get(key);
      if (!subscribers) return;

      subscribers.delete(subscriber);
      if (subscribers.size === 0) subscribersByCacheKey.delete(key);
    });
  };
}

function notifyCacheKeys(keys: readonly string[]) {
  const subscribersToNotify = new Set<CacheSubscriber>();
  new Set(keys).forEach((key) => {
    subscribersByCacheKey.get(key)?.forEach((subscriber) => {
      subscribersToNotify.add(subscriber);
    });
  });
  subscribersToNotify.forEach((subscriber) => subscriber());
}

function normalize(raw: string): string {
  return raw.replace(/\D/g, "");
}

function normalizeJid(value: unknown): string {
  return String(value || "").trim();
}

function cacheKey(digits: string, context?: LookupContext): string {
  return JSON.stringify([
    context?.organizationId || "none",
    context?.userId || "none",
    context?.accessScope || "none",
    context?.leadId || "none",
    context?.groupJid || "global",
    context?.sessionId || "any",
    digits,
  ]);
}

function formatPhone(digits: string): string {
  const d = digits.startsWith("55") ? digits.slice(2) : digits;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits;
}

function buildDigitVariants(digits: string): string[] {
  const noCountry = digits.startsWith("55") ? digits.slice(2) : digits;
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  return Array.from(new Set([digits, noCountry, withCountry].filter(Boolean)));
}

function buildJidVariants(digits: string): string[] {
  return buildDigitVariants(digits).flatMap((variant) => [
    variant,
    `${variant}@s.whatsapp.net`,
    `${variant}@c.us`,
    `${variant}@lid`,
  ]);
}

function isUsefulName(value: unknown, digits: string): value is string {
  const text = String(value || "").trim();
  if (!text) return false;
  if (text.includes("@")) return false;
  return normalize(text) !== digits;
}

function getParticipantField(participant: GroupParticipant, field: string): unknown {
  if (typeof participant === "string") return undefined;
  return participant[field];
}

function getParticipantName(participant: GroupParticipant, digits: string): string | null {
  const candidates = [
    getParticipantField(participant, "DisplayName"),
    getParticipantField(participant, "displayName"),
    getParticipantField(participant, "Notify"),
    getParticipantField(participant, "notify"),
    getParticipantField(participant, "Name"),
    getParticipantField(participant, "name"),
    getParticipantField(participant, "pushName"),
    getParticipantField(participant, "PushName"),
    getParticipantField(participant, "verifiedName"),
    getParticipantField(participant, "VerifiedName"),
  ];

  const name = candidates.find((candidate) => isUsefulName(candidate, digits));
  return name ? String(name).trim() : null;
}

function getParticipantIdentifiers(participant: GroupParticipant): string[] {
  if (typeof participant === "string") return [participant];
  return [
    getParticipantField(participant, "id"),
    getParticipantField(participant, "ID"),
    getParticipantField(participant, "jid"),
    getParticipantField(participant, "JID"),
    getParticipantField(participant, "lid"),
    getParticipantField(participant, "LID"),
    getParticipantField(participant, "phone"),
    getParticipantField(participant, "Phone"),
    getParticipantField(participant, "phoneNumber"),
    getParticipantField(participant, "PhoneNumber"),
    getParticipantField(participant, "participant"),
    getParticipantField(participant, "Participant"),
  ].map(normalizeJid).filter(Boolean);
}

function findParticipant(participants: GroupParticipant[], digits: string): GroupParticipant | null {
  const digitVariants = new Set(buildDigitVariants(digits));
  const jidVariants = new Set(buildJidVariants(digits));

  return participants.find((participant) => {
    const identifiers = getParticipantIdentifiers(participant);
    return identifiers.some((identifier) => {
      const clean = normalize(identifier);
      return identifier === digits || jidVariants.has(identifier) || digitVariants.has(clean);
    });
  }) || null;
}

async function fetchConversations(context?: LookupContext): Promise<WhatsAppConversation[]> {
  if (!context?.organizationId || !context.userId || !context.accessScope) return [];

  const key = JSON.stringify([
    context.organizationId,
    context.userId,
    context.accessScope,
    context.sessionId || "all",
  ]);
  if (!conversationsCache.has(key)) {
    conversationsCache.set(
      key,
      whatsappAPI.getConversations({
        organizationId: context.organizationId,
        sessionId: context.sessionId || undefined,
        filters: { showArchived: true },
      }),
    );
  }

  try {
    return await conversationsCache.get(key)!;
  } catch {
    conversationsCache.delete(key);
    return [];
  }
}

async function findGroupConversation(context?: LookupContext): Promise<WhatsAppConversation | null> {
  if (!context?.groupJid) return null;
  const conversations = await fetchConversations(context);
  return conversations.find((conversation) => conversation.remote_jid === context.groupJid && conversation.is_group) || null;
}

async function fetchMessageSenderName(digits: string, context?: LookupContext): Promise<string | null> {
  const conversation = await findGroupConversation(context);
	if (!conversation) return null;

  try {
    const page = await whatsappAPI.getMessages({
      conversationId: conversation.id,
      organizationId: context?.organizationId,
      limit: 200,
	  expectedLeadId: conversation.lead_id || WHATSAPP_UNLINKED_LEAD_SNAPSHOT,
    });
    const digitVariants = new Set(buildDigitVariants(digits));
    const jidVariants = new Set(buildJidVariants(digits));
    const message = page.messages
      .slice()
      .reverse()
      .find((item) => {
        const senderJid = normalizeJid(item.sender_jid);
        const clean = normalize(senderJid);
        return jidVariants.has(senderJid) || digitVariants.has(clean);
      });

    return isUsefulName(message?.sender_name, digits) ? message!.sender_name : null;
  } catch {
    return null;
  }
}

function selectKnownContactName(
  matchingConversations: WhatsAppConversation[],
  digits: string,
  leadId?: string | null,
): string | null {
  const exactCard = leadId
    ? matchingConversations.find((item) => (item.lead_id || item.lead?.id) === leadId)
    : null;
  if (exactCard?.contact_name && isUsefulName(exactCard.contact_name, digits)) return exactCard.contact_name;
  if (exactCard?.lead?.name && isUsefulName(exactCard.lead.name, digits)) return exactCard.lead.name;

  // Provider contact names are neutral to the CRM card. Lead names are not:
  // without an exact card match, falling back to the first lead for a phone
  // would leak or mislabel another card that shares the same number.
  const providerConversation = matchingConversations.find(
    (item) => item.contact_name && isUsefulName(item.contact_name, digits),
  );
  return providerConversation?.contact_name || null;
}

async function fetchKnownContactName(digits: string, context?: LookupContext): Promise<string | null> {
  const variants = new Set(buildDigitVariants(digits));
  const jidVariants = new Set(buildJidVariants(digits));

  const senderName = await fetchMessageSenderName(digits, context);
  if (senderName) return senderName;

  const conversations = await fetchConversations(context);
  const matchingConversations = conversations.filter((item) => {
    const phone = normalize(item.contact_phone || "");
    const jid = normalizeJid(item.remote_jid);
    return variants.has(phone) || jidVariants.has(jid) || variants.has(normalize(jid));
  });

  return selectKnownContactName(matchingConversations, digits, context?.leadId);
}

async function fetchGroupParticipantName(digits: string, context?: LookupContext): Promise<string | null> {
  if (!context?.groupJid || !context?.sessionId || !context.organizationId) return null;

  try {
    const groups = await whatsappAPI.getGroups(context.sessionId, context.organizationId);
    const group = groups.find((item) => item.group_jid === context.groupJid);
    const participants = Array.isArray(group?.participants) ? (group.participants as GroupParticipant[]) : [];
    const participant = findParticipant(participants, digits);
    if (!participant) return null;

    const participantName = getParticipantName(participant, digits);
    if (participantName) return participantName;

    const phoneDigits = normalize(
      String(
        getParticipantField(participant, "PhoneNumber")
        || getParticipantField(participant, "phoneNumber")
        || getParticipantField(participant, "phone")
        || getParticipantField(participant, "Phone")
        || "",
      ),
    );
    if (phoneDigits && phoneDigits !== digits) {
      return (await fetchKnownContactName(phoneDigits, context)) || formatPhone(phoneDigits);
    }
  } catch {
    return null;
  }

  return null;
}

async function fetchName(digits: string, context?: LookupContext): Promise<string> {
  const groupName = await fetchGroupParticipantName(digits, context);
  if (groupName) return groupName;

  const knownName = await fetchKnownContactName(digits, context);
  if (knownName) return knownName;

  return formatPhone(digits);
}

export function useMentionNames(rawDigitsList: string[], context?: MentionLookupContext): Record<string, string> {
  const queryScope = useWhatsAppQueryScope();
  const [, force] = useState(0);
  const rawDigitsKey = rawDigitsList.join(",");
  const contextGroupJid = context?.groupJid;
  const contextSessionId = context?.sessionId;
  const contextLeadId = context?.leadId;
  const organizationId = queryScope.organizationId;
  const userId = queryScope.userId;
  const accessScope = queryScope.accessScope;
  const normalizedDigits = useMemo(
    () => Array.from(new Set(rawDigitsKey.split(",").map(normalize).filter(Boolean))),
    [rawDigitsKey],
  );
  const lookupContext = useMemo<LookupContext | undefined>(
    () => (
      contextGroupJid || contextSessionId || organizationId
        ? {
          groupJid: contextGroupJid,
          sessionId: contextSessionId,
          leadId: contextLeadId,
          organizationId,
          userId,
          accessScope,
        }
        : undefined
    ),
    [accessScope, contextGroupJid, contextLeadId, contextSessionId, organizationId, userId],
  );
  const subscriptionKeys = useMemo(
    () => normalizedDigits.map((digits) => cacheKey(digits, lookupContext)),
    [lookupContext, normalizedDigits],
  );

  useEffect(() => {
    if (subscriptionKeys.length === 0) return;
    return subscribeToCacheKeys(subscriptionKeys, () => force((n) => n + 1));
  }, [subscriptionKeys]);

  useEffect(() => {
    const toFetch = normalizedDigits.filter((digits) => !cache.has(cacheKey(digits, lookupContext)));
    if (toFetch.length === 0) return;

    toFetch.forEach((digits) => cache.set(cacheKey(digits, lookupContext), null));
    void Promise.all(
      toFetch.map(async (digits) => {
        const key = cacheKey(digits, lookupContext);
        let name = formatPhone(digits);
        try {
          name = await fetchName(digits, lookupContext);
        } catch {
          // Mantém o fallback já exibido e conclui a entrada para não prender o cache em loading.
        }

        const changed = cache.get(key) !== name;
        cache.set(key, name);
        return changed ? key : null;
      }),
    ).then((changedKeys) => {
      notifyCacheKeys(changedKeys.filter((key): key is string => Boolean(key)));
    });
  }, [lookupContext, normalizedDigits]);

  const result: Record<string, string> = {};
  for (const raw of rawDigitsList) {
    const digits = normalize(raw);
    const value = cache.get(cacheKey(digits, lookupContext));
    result[raw] = value && typeof value === "string" ? value : formatPhone(digits);
  }
  return result;
}
