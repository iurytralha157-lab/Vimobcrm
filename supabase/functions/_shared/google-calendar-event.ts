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

const GOOGLE_EVENT_TYPE_LABELS: Record<string, string> = {
  call: "Ligação",
  email: "E-mail",
  meeting: "Reunião",
  task: "Tarefa",
  message: "Mensagem",
  visit: "Visita",
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function buildGoogleEventSummary(event: GoogleCalendarEventContext) {
  const label = GOOGLE_EVENT_TYPE_LABELS[cleanText(event.event_type)] || "Atividade";
  const title = cleanText(event.title) || "Sem título";
  return `${label}: ${title}`;
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
