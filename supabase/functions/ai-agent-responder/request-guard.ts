import {
  authorizePrivateWorkerRequest,
  type PrivateWorkerAuthEnvironment,
} from "../_shared/private-worker-auth.ts";

export const AI_AGENT_RESPONDER_ALLOWED_METHODS = "POST, OPTIONS";

export type AiAgentResponderInput = {
  conversation_id: string;
  session_id: string | null;
  organization_id: string;
  provider_message_id: string;
  message: string;
  contact_name: string | null;
};

type ConversationIdentity = {
  organization_id?: unknown;
  session_id?: unknown;
  session?: unknown;
};

export type AiAgentResponderGuardResult<TConversation> =
  | { kind: "preflight" }
  | { kind: "method_not_allowed" }
  | { kind: "unauthorized" }
  | { kind: "invalid_payload" }
  | { kind: "conversation_not_found" }
  | {
    kind: "allowed";
    input: AiAgentResponderInput;
    conversation: TConversation;
  };

function requiredText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function optionalText(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value);
}

export function parseAiAgentResponderInput(
  value: unknown,
): AiAgentResponderInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const body = value as Record<string, unknown>;
  const conversationId = requiredText(body.conversation_id);
  const organizationId = requiredText(body.organization_id);
  const providerMessageId = requiredText(body.provider_message_id);
  const message = requiredText(body.message);
  const sessionId = optionalText(body.session_id);
  const contactName = optionalText(body.contact_name);

  if (
    !conversationId || !organizationId || !providerMessageId ||
    providerMessageId.length > 512 || !message
  ) return null;
  if (body.session_id !== undefined && body.session_id !== null && !sessionId) {
    return null;
  }
  if (
    body.contact_name !== undefined && body.contact_name !== null &&
    body.contact_name !== "" && !contactName
  ) return null;

  return {
    conversation_id: conversationId,
    session_id: sessionId,
    organization_id: organizationId,
    provider_message_id: providerMessageId,
    message,
    contact_name: contactName,
  };
}

function relatedSessionOrganizationId(session: unknown) {
  const related = Array.isArray(session) ? session[0] : session;
  if (!related || typeof related !== "object") return null;
  return requiredText(
    (related as Record<string, unknown>).organization_id,
  );
}

export function conversationBelongsToRequestTenant(
  conversation: ConversationIdentity,
  input: AiAgentResponderInput,
) {
  if (conversation.organization_id !== input.organization_id) return false;
  if (input.session_id && conversation.session_id !== input.session_id) {
    return false;
  }

  const sessionOrganizationId = relatedSessionOrganizationId(
    conversation.session,
  );
  return !sessionOrganizationId ||
    sessionOrganizationId === input.organization_id;
}

/**
 * Fail-closed request boundary for the privileged AI worker.
 *
 * Authentication deliberately runs before body parsing. The supplied loader
 * must perform the tenant-scoped conversation lookup and is never invoked for
 * a rejected method, credential or payload.
 */
export async function guardAiAgentResponderRequest<
  TConversation extends ConversationIdentity,
>(
  request: Request,
  loadConversation: (
    input: AiAgentResponderInput,
  ) => Promise<TConversation | null>,
  environment?: PrivateWorkerAuthEnvironment,
): Promise<AiAgentResponderGuardResult<TConversation>> {
  if (request.method === "OPTIONS") return { kind: "preflight" };
  if (request.method !== "POST") return { kind: "method_not_allowed" };

  const authorized = environment === undefined
    ? authorizePrivateWorkerRequest(request)
    : authorizePrivateWorkerRequest(request, environment);
  if (!authorized) return { kind: "unauthorized" };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { kind: "invalid_payload" };
  }

  const input = parseAiAgentResponderInput(body);
  if (!input) return { kind: "invalid_payload" };

  const conversation = await loadConversation(input);
  if (!conversation || !conversationBelongsToRequestTenant(conversation, input)) {
    return { kind: "conversation_not_found" };
  }

  return { kind: "allowed", input, conversation };
}
