export type GoogleCalendarEventContext = {
  title?: unknown;
  event_type?: unknown;
  description?: unknown;
  lead?: {
    name?: unknown;
  } | null;
  property?: {
    title?: unknown;
    code?: unknown;
  } | null;
};

export type GoogleReminderSettings = {
  useDefault: false;
  overrides: Array<{ method: "popup"; minutes: number }>;
};

export type VimobGoogleEventIdentity = {
  eventId: string;
  organizationId: string;
  ownerUserId: string;
  eventType: string | null;
  source: "shared" | "private";
};

type VimobGoogleEventIdentityInput = {
  id?: unknown;
  organization_id?: unknown;
  user_id?: unknown;
  event_type?: unknown;
};

const FINAL_VIMOB_SCHEDULE_STATUSES = new Set([
  "completed",
  "no_show",
  "cancelled",
  "canceled",
]);

const GOOGLE_EVENT_TYPE_LABELS: Record<string, string> = {
  call: "Ligação",
  email: "E-mail",
  meeting: "Reunião",
  task: "Tarefa",
  message: "Mensagem",
  visit: "Visita",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanUuid(value: unknown) {
  const candidate = cleanText(value).toLowerCase();
  return UUID_PATTERN.test(candidate) ? candidate : "";
}

function readIdentityNamespace(
  value: unknown,
  source: VimobGoogleEventIdentity["source"],
): VimobGoogleEventIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const properties = value as Record<string, unknown>;
  const eventId = cleanUuid(properties.vimob_event_id);
  const organizationId = cleanUuid(properties.vimob_organization_id);
  const ownerUserId = cleanUuid(properties.vimob_user_id);
  if (!eventId || !organizationId || !ownerUserId) return null;

  return {
    eventId,
    organizationId,
    ownerUserId,
    eventType: cleanText(properties.vimob_event_type) || null,
    source,
  };
}

export function buildVimobGoogleExtendedProperties(
  event: VimobGoogleEventIdentityInput,
) {
  const eventId = cleanUuid(event.id);
  const organizationId = cleanUuid(event.organization_id);
  const ownerUserId = cleanUuid(event.user_id);
  if (!eventId || !organizationId || !ownerUserId) {
    throw new Error("Invalid Vimob Google Calendar identity");
  }

  const identity = {
    vimob_event_id: eventId,
    vimob_organization_id: organizationId,
    vimob_user_id: ownerUserId,
    vimob_event_type: cleanText(event.event_type) || "task",
    vimob_identity_version: "1",
  };

  // `private` keeps old organizer copies readable. `shared` is the canonical
  // identity because Google propagates it to attendee copies.
  return {
    private: { ...identity },
    shared: { ...identity },
  };
}

export function readVimobGoogleEventIdentity(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  const extendedProperties = event.extendedProperties;
  if (!extendedProperties || typeof extendedProperties !== "object" || Array.isArray(extendedProperties)) {
    return null;
  }

  const namespaces = extendedProperties as Record<string, unknown>;
  return readIdentityNamespace(namespaces.shared, "shared")
    || readIdentityNamespace(namespaces.private, "private");
}

export function identityBelongsToOrganization(
  identity: VimobGoogleEventIdentity | null,
  organizationId: unknown,
) {
  const expectedOrganizationId = cleanUuid(organizationId);
  return Boolean(
    identity
    && expectedOrganizationId
    && identity.organizationId === expectedOrganizationId,
  );
}

export function isFinalVimobScheduleStatus(value: unknown) {
  return FINAL_VIMOB_SCHEDULE_STATUSES.has(cleanText(value).toLowerCase());
}

export function buildGoogleReminderSettings(
  value: unknown,
): GoogleReminderSettings | undefined {
  if (value === null) {
    return { useDefault: false, overrides: [] };
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 40_320
  ) {
    return undefined;
  }
  return {
    useDefault: false,
    overrides: [{ method: "popup", minutes: value }],
  };
}

export function buildVimobGoogleEventId(value: unknown) {
  const normalized = cleanText(value).toLowerCase().replace(/[^0-9a-v]/g, "");
  if (normalized.length < 5) throw new Error("Invalid Vimob event id");
  return `vimob${normalized}`.slice(0, 1024);
}

export function buildGoogleEventSummary(event: GoogleCalendarEventContext) {
  const label = GOOGLE_EVENT_TYPE_LABELS[cleanText(event.event_type)] || "Atividade";
  const title = cleanText(event.title) || "Sem título";
  return title.toLocaleLowerCase("pt-BR").startsWith(`${label}: `.toLocaleLowerCase("pt-BR"))
    ? title
    : `${label}: ${title}`;
}

export function stripVimobLinkedDescription(value: unknown) {
  const description = cleanText(value);
  if (!description) return undefined;

  const withoutGeneratedLinks = description.replace(
    /(?:\n\n|^)Vínculos do Vimob CRM(?:\nLead\/cliente:[^\n]*)?(?:\nImóvel:[^\n]*)?\s*$/u,
    "",
  ).trim();
  return withoutGeneratedLinks || undefined;
}

export function buildGoogleEventDescription(event: GoogleCalendarEventContext) {
  const blocks: string[] = [];
  const description = cleanText(event.description);
  const leadName = cleanText(event.lead?.name);
  const propertyTitle = cleanText(event.property?.title);
  const propertyCode = cleanText(event.property?.code);

  if (description) {
    blocks.push(description);
  }

  const linkedData: string[] = [];
  if (leadName) {
    linkedData.push(`Lead/cliente: ${leadName}`);
  }
  if (propertyTitle || propertyCode) {
    const propertyLabel = [propertyCode, propertyTitle].filter(Boolean).join(" — ");
    linkedData.push(`Imóvel: ${propertyLabel}`);
  }
  if (linkedData.length > 0) {
    blocks.push(["Vínculos do Vimob CRM", ...linkedData].join("\n"));
  }

  const result = blocks.join("\n\n").trim();
  return result ? result.slice(0, 8_000) : undefined;
}

export function buildGoogleEventAttendees(
  attendeeEmails: unknown[],
  excludedEmails: unknown[] = [],
) {
  const excluded = new Set(
    excludedEmails
      .map(cleanText)
      .filter(Boolean)
      .map((email) => email.toLowerCase()),
  );
  const uniqueEmails = new Set<string>();

  for (const value of attendeeEmails) {
    const email = cleanText(value).toLowerCase();
    if (
      email.length > 254
      || !email.includes("@")
      || email.startsWith("@")
      || email.endsWith("@")
      || excluded.has(email)
    ) {
      continue;
    }
    uniqueEmails.add(email);
  }

  return Array.from(uniqueEmails).map((email) => ({ email }));
}
