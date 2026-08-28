import { createClient } from "npm:@supabase/supabase-js@2";
import {
  readSupabaseSecretKeyEnvironment,
  selectSupabaseAdminSecretKey,
} from "../_shared/supabase-secret-keys.ts";
import {
  AI_AGENT_RESPONDER_ALLOWED_METHODS,
  guardAiAgentResponderRequest,
} from "./request-guard.ts";
import {
  agentConversationReferencesBelongToTenant,
  conversationReferencesBelongToTenant,
  leadReferencesBelongToTenant,
  organizationMemberBelongsToTenant,
  type LoadedLeadTenantReferences,
} from "./tenant-reference-guard.ts";
import {
  buildAIOutboxClientMessageId,
  buildAIResponseClaimId,
} from "./response-idempotency.ts";
import { canonicalAIPauseReason } from "./canonical-ai-pause.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": AI_AGENT_RESPONDER_ALLOWED_METHODS,
};

const DEFAULT_HISTORY_LIMIT = 4;
const DEFAULT_SITE_BASE_URL = "https://vimob.vettercompany.com.br";
const HUMAN_TAKEOVER_LOOKBACK_HOURS = 6;
const AI_MODEL = "google/gemini-3-flash-preview";

type ChatMessage = { role: "user" | "assistant"; content: string };
type PropertyCandidate = Record<string, any> & { score?: number; public_url?: string | null };
type AICompletionResult = {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
};

type AIResponseClaimContext = {
  id: string;
  organizationId: string;
  sessionId: string;
  conversationId: string;
  providerMessageId: string;
};

type OutboxInsertResult =
  | { kind: "queued"; queuedChunks: number }
  | { kind: "suppressed"; reason: string; queuedChunks: number };

Deno.serve(async (req) => {
  let supabase: any = null;
  let responseClaimContext: AIResponseClaimContext | null = null;
  try {
    let privateWorkerContext: {
      supabaseUrl: string;
      apiKey: string;
    } | null = null;
    const guarded = await guardAiAgentResponderRequest(
      req,
      async (input) => {
        // This closure cannot run until method, private auth and payload checks
        // pass. Hosted opaque keys arrive through `apikey`; JWT-shaped legacy
        // service-role Bearer remains supported by the shared auth boundary.
        const secretEnvironment = readSupabaseSecretKeyEnvironment();
        const adminSecret = selectSupabaseAdminSecretKey(secretEnvironment);
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        if (!supabaseUrl || !adminSecret) {
          throw new Error("Supabase admin environment is not configured");
        }

        supabase = createClient(supabaseUrl, adminSecret);
        privateWorkerContext = { supabaseUrl, apiKey: adminSecret };
        return await getConversationForTenant(
          supabase,
          input.conversation_id,
          input.organization_id,
          input.session_id,
        );
      },
    );

    if (guarded.kind === "preflight") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (guarded.kind === "method_not_allowed") {
      return json(
        { success: false, error: "Method not allowed" },
        405,
        { Allow: AI_AGENT_RESPONDER_ALLOWED_METHODS },
      );
    }
    if (guarded.kind === "unauthorized") {
      return json({ success: false, error: "Unauthorized" }, 401);
    }
    if (guarded.kind === "invalid_payload") {
      return json({ success: false, error: "Invalid request payload" }, 400);
    }
    if (guarded.kind === "conversation_not_found") {
      return json({ success: false, error: "Conversation not found" }, 404);
    }

    const {
      conversation_id,
      organization_id,
      provider_message_id,
      message,
      contact_name,
    } = guarded.input;
    const conversation = guarded.conversation;
    if (!supabase || !privateWorkerContext) {
      throw new Error("Privileged request context was not initialized");
    }

    console.log(`[ai-agent-responder] Processing message for conversation ${conversation_id}`);

    // The tenant-scoped conversation lookup above is intentionally the first
    // privileged read. No agent, history, AI, scheduling or outbox work can
    // happen before organization/session ownership has been established.
    if (
      !conversation.session_id ||
      !conversationReferencesBelongToTenant(conversation, organization_id)
    ) {
      return json({ success: false, error: "Related resource not found" }, 404);
    }

    const agent = await findActiveAgent(
      supabase,
      organization_id,
      conversation.session_id,
    );
    if (!agent) {
      console.log(`[ai-agent-responder] No active agent found for org ${organization_id}`);
      return json({ success: true, message: "No active agent found" });
    }

    if (conversation.is_group) {
      return json({ success: true, message: "Conversation not eligible for AI" });
    }

    const agentConversationIdentity = await getAgentConversationReferenceIdentity(
      supabase,
      conversation_id,
    );
    const tenantReferences = await loadTenantReferenceContext(supabase, {
      organizationId: organization_id,
      conversation,
      agentConversation: agentConversationIdentity,
    });
    if (!tenantReferences) {
      return json({ success: false, error: "Related resource not found" }, 404);
    }
    const agentConv = await getAgentConversation(
      supabase,
      agentConversationIdentity,
    );
    if (agentConversationIdentity && !agentConv) {
      return json({ success: false, error: "Related resource not found" }, 404);
    }

    if (agentConv && agentConv.status !== "active") {
      console.log(`[ai-agent-responder] Conversation ${conversation_id} is ${agentConv.status}, skipping`);
      return json({ success: true, message: `Conversation is ${agentConv.status}` });
    }

    const lead = tenantReferences.lead;
    const initialCanonicalPause = await getCanonicalAIPauseReason(supabase, {
      organizationId: organization_id,
      sessionId: conversation.session_id,
      conversationId: conversation_id,
    });
    if (initialCanonicalPause) {
      return json({ success: true, action: "human_takeover_active" });
    }

    const responseClaim = await claimAIResponse(supabase, {
      organizationId: organization_id,
      sessionId: conversation.session_id,
      conversationId: conversation_id,
      providerMessageId: provider_message_id,
      legacyAgentId: agent.id,
    });
    if (responseClaim.kind === "message_not_found") {
      return json({ success: false, error: "Related resource not found" }, 404);
    }
    if (responseClaim.kind === "duplicate") {
      return json({ success: true, action: "duplicate_ignored" });
    }
    responseClaimContext = responseClaim.claim;

    if (tenantReferences.conversationLeadNeedsBinding && lead?.id) {
      const bound = await bindConversationLead(supabase, {
        organizationId: organization_id,
        conversationId: conversation_id,
        sessionId: conversation.session_id,
        lead,
        contactName: contact_name,
        existingContactName: conversation.contact_name,
      });
      if (!bound) {
        throw new Error("Tenant conversation reference changed after claim");
      }
      conversation.lead_id = lead.id;
      conversation.lead = {
        id: lead.id,
        organization_id,
      };
    }

    const sessionOwnerId = tenantReferences.sessionOwnerId;
    const conversationResetAt = await getConversationResetAt(
      supabase,
      organization_id,
      conversation_id,
    );
    const takeoverSince = mostRecentTimestamp(
      agentConv?.context_reset_at,
      conversationResetAt,
      agentConv?.started_at,
      hoursAgo(HUMAN_TAKEOVER_LOOKBACK_HOURS),
    );
    const humanTakeover = await detectHumanTakeover(
      supabase,
      organization_id,
      conversation_id,
      conversation.session_id || null,
      takeoverSince,
    );

    if (humanTakeover.detected) {
      await markHandedOff(supabase, agent, conversation_id, lead?.id || null, agentConv, humanTakeover.reason);
      await notifyHumanNeeded(supabase, organization_id, lead, sessionOwnerId, conversation_id, humanTakeover.reason);
      await completeAIResponseClaim(supabase, responseClaimContext, {
        eventType: "auto_reply_human_takeover",
        success: true,
        metadata: { reason: humanTakeover.reason },
      });
      responseClaimContext = null;
      return json({ success: true, action: "human_takeover_detected" });
    }

    const messageCount = (agentConv?.message_count || 0) + 1;
    const handoffKeywords = agent.handoff_keywords || [];
    const keywordMatch = containsKeyword(message, handoffKeywords);
    const limitReached = agent.max_messages_before_handoff
      ? messageCount > agent.max_messages_before_handoff
      : false;

    if (keywordMatch || limitReached) {
      const reason = keywordMatch ? "keyword" : "message_limit";
      const handoffMsg = "Entendido. Vou chamar um corretor para continuar por aqui.";
      const pauseBeforeHandoff = await getCanonicalAIPauseReason(supabase, {
        organizationId: organization_id,
        sessionId: conversation.session_id,
        conversationId: conversation_id,
      });
      if (pauseBeforeHandoff) {
        await completeSuppressedAIResponseClaim(
          supabase,
          responseClaimContext,
          pauseBeforeHandoff,
        );
        responseClaimContext = null;
        return json({ success: true, action: "human_takeover_active" });
      }

      await markHandedOff(supabase, agent, conversation_id, lead?.id || null, agentConv, reason, messageCount);
      const pauseBeforeHandoffOutbox = await getCanonicalAIPauseReason(
        supabase,
        {
          organizationId: organization_id,
          sessionId: conversation.session_id,
          conversationId: conversation_id,
        },
      );
      if (pauseBeforeHandoffOutbox) {
        await completeSuppressedAIResponseClaim(
          supabase,
          responseClaimContext,
          pauseBeforeHandoffOutbox,
        );
        responseClaimContext = null;
        return json({ success: true, action: "human_takeover_active" });
      }
      const handoffOutboxResult = await insertOutboxMessage(
        supabase,
        conversation,
        organization_id,
        handoffMsg,
        privateWorkerContext,
        responseClaimContext.id,
      );
      if (handoffOutboxResult.kind === "suppressed") {
        await completeSuppressedAIResponseClaim(
          supabase,
          responseClaimContext,
          handoffOutboxResult.reason,
          handoffOutboxResult.queuedChunks,
        );
        responseClaimContext = null;
        return json({ success: true, action: "human_takeover_active" });
      }
      await notifyHumanNeeded(supabase, organization_id, lead, sessionOwnerId, conversation_id, reason);
      await completeAIResponseClaim(supabase, responseClaimContext, {
        eventType: "auto_reply_handed_off",
        success: true,
        metadata: { reason },
      });
      responseClaimContext = null;
      return json({ success: true, action: "handed_off" });
    }

    const publicBaseUrl = await getPublicSiteBaseUrl(supabase, organization_id);
    const mentionedProperties = await findMentionedProperties(supabase, organization_id, message, publicBaseUrl);
    const leadContext = await buildLeadContext(
      supabase,
      organization_id,
      lead,
      tenantReferences.currentProperty,
      contact_name,
    );
    const organizationContext = await buildOrganizationContext(supabase, organization_id, message);
    const bestProperties = await searchBestProperties(
      supabase,
      organization_id,
      message,
      lead,
      mentionedProperties,
      publicBaseUrl,
    );

    const selectedProperty = mentionedProperties[0] || bestProperties[0] || leadContext.currentProperty || null;
    const pauseBeforeVisitIntent = await getCanonicalAIPauseReason(supabase, {
      organizationId: organization_id,
      sessionId: conversation.session_id,
      conversationId: conversation_id,
    });
    if (pauseBeforeVisitIntent) {
      await completeSuppressedAIResponseClaim(
        supabase,
        responseClaimContext,
        pauseBeforeVisitIntent,
      );
      responseClaimContext = null;
      return json({ success: true, action: "human_takeover_active" });
    }
    const visitAction = await maybeCreateVisitSchedule({
      message,
      lead,
    });

    const historyLimit = Math.min(DEFAULT_HISTORY_LIMIT, Math.max(4, agent.max_messages_before_handoff || DEFAULT_HISTORY_LIMIT));
    const historySince = conversationResetAt || agentConv?.context_reset_at || agentConv?.started_at || null;
    const history = await getCompactHistory(
      supabase,
      organization_id,
      conversation_id,
      conversation.session_id || null,
      message,
      historyLimit,
      historySince,
    );
    const memorySummary = buildMemorySummary({
      previous: agentConv?.memory_summary || "",
      lead,
      leadMeta: leadContext.leadMeta,
      selectedProperty,
      visitAction,
      message,
    });

    const fullSystemPrompt = buildSystemPrompt({
      agent,
      leadContext,
      mentionedProperties,
      bestProperties,
      organizationContext,
      memorySummary,
      visitAction,
    });

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      console.error("[ai-agent-responder] LOVABLE_API_KEY not configured");
      throw new Error("AI provider is not configured");
    }

    const pauseBeforeProvider = await getCanonicalAIPauseReason(supabase, {
      organizationId: organization_id,
      sessionId: conversation.session_id,
      conversationId: conversation_id,
    });
    if (pauseBeforeProvider) {
      await completeSuppressedAIResponseClaim(
        supabase,
        responseClaimContext,
        pauseBeforeProvider,
      );
      responseClaimContext = null;
      return json({ success: true, action: "human_takeover_active" });
    }

    const aiResult = await callLovableAI(lovableApiKey, fullSystemPrompt, history);
    const aiResponse = appendActionConfirmation(aiResult.content, visitAction);

    if (!aiResponse) {
      console.error("[ai-agent-responder] Empty AI response");
      throw new Error("AI provider returned an empty response");
    }

    const pauseBeforeStateCommit = await getCanonicalAIPauseReason(supabase, {
      organizationId: organization_id,
      sessionId: conversation.session_id,
      conversationId: conversation_id,
    });
    if (pauseBeforeStateCommit) {
      await completeSuppressedAIResponseClaim(
        supabase,
        responseClaimContext,
        pauseBeforeStateCommit,
      );
      responseClaimContext = null;
      return json({ success: true, action: "human_takeover_active" });
    }

    const committedAgentConversation = await upsertAgentConversation(supabase, {
      agent,
      agentConv,
      conversationId: conversation_id,
      leadId: lead?.id || null,
      messageCount,
      memorySummary,
      property: selectedProperty,
    });
    const pauseBeforeOutbox = await getCanonicalAIPauseReason(supabase, {
      organizationId: organization_id,
      sessionId: conversation.session_id,
      conversationId: conversation_id,
    });
    if (pauseBeforeOutbox) {
      await completeSuppressedAIResponseClaim(
        supabase,
        responseClaimContext,
        pauseBeforeOutbox,
      );
      responseClaimContext = null;
      return json({ success: true, action: "human_takeover_active" });
    }

    const outboxResult = await insertOutboxMessage(
      supabase,
      conversation,
      organization_id,
      aiResponse,
      privateWorkerContext,
      responseClaimContext.id,
    );
    if (outboxResult.kind === "suppressed") {
      await completeSuppressedAIResponseClaim(
        supabase,
        responseClaimContext,
        outboxResult.reason,
        outboxResult.queuedChunks,
      );
      responseClaimContext = null;
      return json({ success: true, action: "human_takeover_active" });
    }
    await markAgentConversationAIMessageQueued(supabase, {
      state: committedAgentConversation,
      agentId: agent.id,
      conversationId: conversation_id,
    });
    await completeAIResponseClaim(supabase, responseClaimContext, {
      eventType: "auto_reply_generated",
      success: true,
      model: aiResult.model,
      promptTokens: aiResult.promptTokens,
      completionTokens: aiResult.completionTokens,
      totalTokens: aiResult.totalTokens,
      estimatedCostUsd: aiResult.estimatedCostUsd,
      latencyMs: aiResult.latencyMs,
      inputPreview: message,
      outputPreview: aiResponse,
      metadata: {
        source: "ai-agent-responder",
        mode: "auto",
        lead_id: lead?.id || null,
        property_id: selectedProperty?.id || null,
        property_code: selectedProperty?.code || null,
        response_parts: splitAssistantMessages(aiResponse).length,
      },
    });
    responseClaimContext = null;

    console.log(`[ai-agent-responder] Successfully responded to conversation ${conversation_id}`);
    return json({ success: true, response: aiResponse });
  } catch (error) {
    console.error("[ai-agent-responder] Error:", error);
    if (supabase && responseClaimContext) {
      try {
        await completeAIResponseClaim(supabase, responseClaimContext, {
          eventType: "auto_reply_failed",
          success: false,
          errorMessage: "Internal processing failure",
        });
      } catch (claimError) {
        console.error(
          "[ai-agent-responder] Error finalizing response claim:",
          claimError,
        );
      }
    }
    return json({ success: false, error: "Internal error" }, 500);
  }
});

function json(
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: HeadersInit = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...Object.fromEntries(new Headers(extraHeaders).entries()),
    },
  });
}

async function claimAIResponse(supabase: any, input: {
  organizationId: string;
  sessionId: string;
  conversationId: string;
  providerMessageId: string;
  legacyAgentId: string;
}): Promise<
  | { kind: "message_not_found" }
  | { kind: "duplicate" }
  | { kind: "owned"; claim: AIResponseClaimContext }
> {
  // Bind the supplied provider identity to the canonical inbound row. A
  // service credential alone cannot invent a replay key for another
  // conversation/session and reach the provider or any downstream effect.
  const { data: inboundMessage, error: inboundError } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("session_id", input.sessionId)
    .eq("conversation_id", input.conversationId)
    .eq("message_id", input.providerMessageId)
    .eq("from_me", false)
    .eq("message_type", "text")
    .maybeSingle();
  if (inboundError) throw inboundError;
  if (!inboundMessage?.id) return { kind: "message_not_found" };

  const id = await buildAIResponseClaimId(input);
  const claim: AIResponseClaimContext = {
    id,
    organizationId: input.organizationId,
    sessionId: input.sessionId,
    conversationId: input.conversationId,
    providerMessageId: input.providerMessageId,
  };
  const { data: inserted, error } = await supabase
    .from("ai_interaction_logs")
    .upsert({
      id,
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      agent_id: null,
      mode: "auto",
      event_type: "auto_reply_claimed",
      success: false,
      metadata: responseClaimMetadata(claim, "claimed", {
        legacy_agent_id: input.legacyAgentId,
      }),
    }, {
      onConflict: "id",
      ignoreDuplicates: true,
    })
    .select("id")
    .maybeSingle();
  if (error) throw error;

  // `DO NOTHING ... RETURNING` returns no row to every loser. This is the
  // ownership boundary: duplicate requests do not read or mutate the claim.
  return inserted?.id === id
    ? { kind: "owned", claim }
    : { kind: "duplicate" };
}

function responseClaimMetadata(
  claim: AIResponseClaimContext,
  phase: string,
  extra: Record<string, unknown> = {},
) {
  return {
    ...extra,
    source: "ai-agent-responder",
    idempotency_version: 1,
    phase,
    session_id: claim.sessionId,
    provider_message_id: claim.providerMessageId,
  };
}

async function completeAIResponseClaim(supabase: any, claim: AIResponseClaimContext, input: {
  eventType: string;
  success: boolean;
  model?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  latencyMs?: number | null;
  inputPreview?: string;
  outputPreview?: string;
  metadata?: Record<string, unknown>;
  errorMessage?: string | null;
}) {
  const { data, error } = await supabase
    .from("ai_interaction_logs")
    .update({
      event_type: input.eventType,
      model: input.model || null,
      prompt_tokens: input.promptTokens || 0,
      completion_tokens: input.completionTokens || 0,
      total_tokens: input.totalTokens || 0,
      estimated_cost_usd: input.estimatedCostUsd || 0,
      latency_ms: input.latencyMs ?? null,
      success: input.success,
      error_message: input.errorMessage || null,
      input_preview: truncate(input.inputPreview || "", 500) || null,
      output_preview: truncate(input.outputPreview || "", 500) || null,
      metadata: responseClaimMetadata(
        claim,
        input.success ? "completed" : "failed",
        input.metadata,
      ),
    })
    .eq("id", claim.id)
    .eq("organization_id", claim.organizationId)
    .eq("conversation_id", claim.conversationId)
    .eq("metadata->>session_id", claim.sessionId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (data?.id !== claim.id) {
    throw new Error("AI response claim ownership was lost");
  }
}

async function completeSuppressedAIResponseClaim(
  supabase: any,
  claim: AIResponseClaimContext,
  reason: string,
  queuedChunks = 0,
) {
  await completeAIResponseClaim(supabase, claim, {
    eventType: queuedChunks > 0
      ? "auto_reply_partially_queued_before_human_takeover"
      : "auto_reply_suppressed_human_takeover",
    success: true,
    metadata: {
      reason,
      queued_chunks_before_suppression: queuedChunks,
    },
  });
}

async function getCanonicalAIPauseReason(supabase: any, input: {
  organizationId: string;
  sessionId: string;
  conversationId: string;
}) {
  // `conversation_ai_state` does not carry a session_id. Re-prove the live
  // conversation -> session -> organization relationship on every pause
  // check before reading that canonical state with the service-role client.
  const { data: conversation, error: conversationError } = await supabase
    .from("whatsapp_conversations")
    .select(
      "id, organization_id, session_id, session:whatsapp_sessions(id, organization_id)",
    )
    .eq("id", input.conversationId)
    .eq("organization_id", input.organizationId)
    .eq("session_id", input.sessionId)
    .maybeSingle();
  if (conversationError) throw conversationError;
  if (
    !conversation ||
    !conversationReferencesBelongToTenant(
      conversation,
      input.organizationId,
    )
  ) return "conversation_scope_changed";

  const { data: state, error: stateError } = await supabase
    .from("conversation_ai_state")
    .select("human_override, paused_until")
    .eq("organization_id", input.organizationId)
    .eq("conversation_id", input.conversationId)
    .maybeSingle();
  if (stateError) throw stateError;

  return canonicalAIPauseReason(state);
}

async function findActiveAgent(supabase: any, organizationId: string, sessionId?: string | null) {
  let agentQuery = supabase
    .from("ai_agents")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  if (sessionId) agentQuery = agentQuery.eq("session_id", sessionId);
  const { data: agents } = await agentQuery.limit(1);
  let agent = agents?.[0];

  if (!agent && sessionId) {
    const { data: fallbackAgents } = await supabase
      .from("ai_agents")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .is("session_id", null)
      .limit(1);
    agent = fallbackAgents?.[0];
  }

  return agent || null;
}

async function getConversationForTenant(
  supabase: any,
  conversationId: string,
  organizationId: string,
  sessionId?: string | null,
) {
  let query = supabase
    .from("whatsapp_conversations")
    .select("id, organization_id, session_id, lead_id, remote_jid, contact_phone, contact_name, is_group, last_message, last_message_at, lead:leads(id, organization_id), session:whatsapp_sessions(id, owner_user_id, organization_id)")
    .eq("id", conversationId)
    .eq("organization_id", organizationId);

  if (sessionId) query = query.eq("session_id", sessionId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;

  return data || null;
}

async function getAgentConversationReferenceIdentity(
  supabase: any,
  conversationId: string,
) {
  const { data, error } = await supabase
    .from("ai_agent_conversations")
    .select("id, agent_id, conversation_id, lead_id, last_property_id, agent:ai_agents(id, organization_id, session_id), lead:leads(id, organization_id), last_property:properties(id, organization_id)")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getAgentConversation(supabase: any, identity: any) {
  if (!identity) return null;

  let query = supabase
    .from("ai_agent_conversations")
    .select("*")
    .eq("id", identity.id)
    .eq("conversation_id", identity.conversation_id)
    .eq("agent_id", identity.agent_id);

  query = identity.lead_id
    ? query.eq("lead_id", identity.lead_id)
    : query.is("lead_id", null);
  query = identity.last_property_id
    ? query.eq("last_property_id", identity.last_property_id)
    : query.is("last_property_id", null);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadTenantReferenceContext(supabase: any, input: {
  organizationId: string;
  conversation: any;
  agentConversation: any;
}) {
  if (
    !input.conversation.session_id ||
    !conversationReferencesBelongToTenant(
      input.conversation,
      input.organizationId,
    ) ||
    !agentConversationReferencesBelongToTenant(
      input.agentConversation,
      input.organizationId,
      input.conversation.session_id || null,
    )
  ) return null;

  const agentConversationLeadId = input.agentConversation?.lead_id || null;
  const conversationLeadId = input.conversation.lead_id || null;
  if (
    agentConversationLeadId && conversationLeadId &&
    agentConversationLeadId !== conversationLeadId
  ) return null;

  const leadId = agentConversationLeadId || conversationLeadId;
  const lead = leadId
    ? await fetchLead(supabase, input.organizationId, leadId)
    : await findLeadByConversationPhone(
      supabase,
      input.organizationId,
      input.conversation,
    );

  // A populated FK that disappeared or resolves outside this tenant is a
  // broken reference, not permission to fall back to another tenant's data.
  if (leadId && !lead) return null;

  const leadReferences = lead
    ? await loadLeadTenantReferences(supabase, input.organizationId, lead)
    : emptyLeadTenantReferences();
  if (
    lead &&
    !leadReferencesBelongToTenant(
      lead,
      leadReferences,
      input.organizationId,
    )
  ) return null;

  const sessionOwnerId = relatedRecord(input.conversation.session)?.owner_user_id;
  const sessionOwnerMembership = sessionOwnerId
    ? await loadOrganizationMembership(
      supabase,
      input.organizationId,
      String(sessionOwnerId),
    )
    : null;
  if (
    !organizationMemberBelongsToTenant(
      sessionOwnerId,
      sessionOwnerMembership,
      input.organizationId,
    )
  ) return null;

  const hydratedLead = lead
    ? {
      ...lead,
      pipeline: relatedRecord(leadReferences.pipeline),
      stage: relatedRecord(leadReferences.stage),
    }
    : null;

  return {
    lead: hydratedLead,
    conversationLeadNeedsBinding: !conversationLeadId && Boolean(lead?.id),
    sessionOwnerId: sessionOwnerId ? String(sessionOwnerId) : null,
    currentProperty: relatedRecord(
      leadReferences.interestProperty || leadReferences.property,
    ),
  };
}

function relatedRecord(value: any) {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
  return value && typeof value === "object" ? value : null;
}

function emptyLeadTenantReferences(): LoadedLeadTenantReferences {
  return {
    property: null,
    interestProperty: null,
    pipeline: null,
    stage: null,
    assignedMember: null,
  };
}

async function loadLeadTenantReferences(
  supabase: any,
  organizationId: string,
  lead: any,
): Promise<LoadedLeadTenantReferences> {
  const [property, interestProperty, pipeline, stage, assignedMember] =
    await Promise.all([
      lead.property_id
        ? fetchPropertyById(supabase, organizationId, lead.property_id)
        : null,
      lead.interest_property_id
        ? fetchPropertyById(
          supabase,
          organizationId,
          lead.interest_property_id,
        )
        : null,
      lead.pipeline_id
        ? loadPipelineForTenant(supabase, organizationId, lead.pipeline_id)
        : null,
      lead.stage_id
        ? loadStageForTenant(supabase, organizationId, lead.stage_id)
        : null,
      lead.assigned_user_id
        ? loadOrganizationMembership(
          supabase,
          organizationId,
          lead.assigned_user_id,
        )
        : null,
    ]);

  return { property, interestProperty, pipeline, stage, assignedMember };
}

async function loadPipelineForTenant(
  supabase: any,
  organizationId: string,
  pipelineId: string,
) {
  const { data } = await supabase
    .from("pipelines")
    .select("id, organization_id, name")
    .eq("id", pipelineId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data || null;
}

async function loadStageForTenant(
  supabase: any,
  organizationId: string,
  stageId: string,
) {
  const { data } = await supabase
    .from("stages")
    .select("id, organization_id, pipeline_id, name, stage_key")
    .eq("id", stageId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data || null;
}

async function loadOrganizationMembership(
  supabase: any,
  organizationId: string,
  userId: string,
) {
  const { data } = await supabase
    .from("organization_members")
    .select("user_id, organization_id, is_active")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  return data || null;
}

async function getConversationResetAt(
  supabase: any,
  organizationId: string,
  conversationId: string,
) {
  const { data } = await supabase
    .from("chatbot_conversation_state")
    .select("context_reset_at")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  return data?.context_reset_at || null;
}

async function findLeadByConversationPhone(
  supabase: any,
  organizationId: string,
  conversation: any,
) {
  const phone = conversation.contact_phone || conversation.remote_jid || "";
  const variants = phoneVariants(phone);
  if (!variants.length) return null;

  const { data } = await supabase
    .from("leads")
    .select(leadSelect())
    .eq("organization_id", organizationId)
    .or(variants.map((variant) => `phone.ilike.%${variant}%`).join(","))
    .limit(20);

  return (data || []).find((candidate: any) =>
    candidate.organization_id === organizationId &&
    phonesMatch(candidate.phone || "", phone)
  ) || null;
}

async function bindConversationLead(supabase: any, input: {
  organizationId: string;
  conversationId: string;
  sessionId: string;
  lead: any;
  contactName?: string | null;
  existingContactName?: string | null;
}) {
  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .update({
      lead_id: input.lead.id,
      contact_name: input.lead.name || input.contactName ||
        input.existingContactName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.conversationId)
    .eq("organization_id", input.organizationId)
    .eq("session_id", input.sessionId)
    .is("lead_id", null)
    .select("id")
    .maybeSingle();

  if (error) return false;
  if (data?.id === input.conversationId) return true;

  // A concurrent invocation may have established the exact same safe link.
  // Re-read only inside the already established tenant/session boundary.
  const { data: current, error: currentError } = await supabase
    .from("whatsapp_conversations")
    .select("id, lead_id")
    .eq("id", input.conversationId)
    .eq("organization_id", input.organizationId)
    .eq("session_id", input.sessionId)
    .maybeSingle();

  return !currentError && current?.id === input.conversationId &&
    current.lead_id === input.lead.id;
}

async function fetchLead(
  supabase: any,
  organizationId: string,
  leadId: string,
) {
  const { data } = await supabase
    .from("leads")
    .select(leadSelect())
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data || null;
}

function leadSelect() {
  return [
    "id",
    "organization_id",
    "name",
    "phone",
    "email",
    "message",
    "initial_message",
    "cidade",
    "bairro",
    "uf",
    "empresa",
    "profissao",
    "cargo",
    "renda_familiar",
    "procura_financiamento",
    "faixa_valor_imovel",
    "valor_interesse",
    "finalidade_compra",
    "property_code",
    "property_id",
    "interest_property_id",
    "pipeline_id",
    "stage_id",
    "assigned_user_id",
    "source",
    "meta_form_id",
    "created_at",
  ].join(", ");
}

async function buildLeadContext(
  supabase: any,
  organizationId: string,
  lead: any,
  currentProperty: any,
  fallbackName?: string | null,
) {
  if (!lead?.id) {
    return {
      lead,
      leadMeta: [],
      currentProperty: null,
      text: fallbackName ? `[CONTEXTO DO CONTATO]\nNome: ${fallbackName}` : "",
    };
  }

  const { data: leadMeta } = await supabase
    .from("lead_meta")
    .select("form_id, form_name, campaign_name, ad_name, adset_name, platform, contact_notes, raw_payload, created_at")
    .eq("lead_id", lead.id)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(1);

  const lines = [
    "[CONTEXTO DO LEAD]",
    line("Nome", lead.name),
    line("Telefone", lead.phone),
    line("Email", lead.email),
    line("Origem", lead.source),
    line("Pipeline", lead.pipeline?.name),
    line("Coluna", lead.stage?.name),
    line("Cidade", joinParts([lead.bairro, lead.cidade, lead.uf])),
    line("Empresa", lead.empresa),
    line("Profissao", lead.profissao),
    line("Cargo", lead.cargo),
    line("Renda familiar", lead.renda_familiar),
    line("Faixa de valor", lead.faixa_valor_imovel),
    line("Valor de interesse", formatCurrency(lead.valor_interesse)),
    lead.procura_financiamento ? "Busca financiamento: sim" : "",
    line("Finalidade", lead.finalidade_compra),
    line("Mensagem inicial", truncate(String(lead.message || lead.initial_message || ""), 180)),
    line("Imovel de interesse", currentProperty ? propertyLine(currentProperty) : lead.property_code),
  ].filter(Boolean);

  const metaLines = formatLeadMeta(leadMeta || []);
  return {
    lead,
    leadMeta: leadMeta || [],
    currentProperty,
    text: [...lines, ...metaLines].join("\n"),
  };
}

async function buildOrganizationContext(supabase: any, organizationId: string, message: string) {
  const { data: organization } = await supabase
    .from("organizations")
    .select("name, nome_fantasia, razao_social, segment, cidade, uf, bairro, website")
    .eq("id", organizationId)
    .maybeSingle();

  const { data: site } = await supabase
    .from("organization_sites")
    .select("site_title, site_description, city, state, about_title, about_text")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .maybeSingle();

  const { data: properties, error } = await supabase
    .from("properties")
    .select("organization_id, bairro, cidade, uf, tipo_de_imovel, tipo_de_negocio, status, destaque, preco, valor_locacao")
    .eq("organization_id", organizationId)
    .order("destaque", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(250);

  if (error) {
    console.error("[ai-agent-responder] organization inventory context error:", error);
  }

  const offerable = (properties || [])
    .filter((property: any) => property.organization_id === organizationId)
    .filter(isOfferableProperty);
  const inventory = summarizeInventory(offerable, message);
  const displayName = organization?.nome_fantasia || organization?.name || site?.site_title || "a imobiliaria";
  const baseCity = joinParts([organization?.bairro, organization?.cidade, organization?.uf]);

  const lines = [
    "[CONTEXTO DA IMOBILIARIA]",
    line("Nome", displayName),
    line("Razao social", organization?.razao_social),
    line("Segmento", organization?.segment),
    line("Base/endereco publico", baseCity),
    line("Site", organization?.website),
    line("Titulo do site", site?.site_title),
    line("Cidade do site", joinParts([site?.city, site?.state])),
    line("Descricao do site", truncate(String(site?.site_description || site?.about_text || ""), 260)),
    "",
    "[ESTOQUE E REGIOES DE ATUACAO]",
    line("Total de imoveis ofertaveis analisados", offerable.length ? String(offerable.length) : ""),
    inventory.cities.length ? `Cidades com estoque: ${inventory.cities.join("; ")}` : "",
    inventory.neighborhoods.length ? `Principais bairros/regioes: ${inventory.neighborhoods.join(", ")}` : "",
    inventory.propertyTypes.length ? `Tipos mais comuns: ${inventory.propertyTypes.join(", ")}` : "",
    inventory.businessTypes.length ? `Finalidades no estoque: ${inventory.businessTypes.join(", ")}` : "",
    inventory.messageCityMatches.length ? `Cidade/regiao citada pelo lead encontrada no estoque: ${inventory.messageCityMatches.join(", ")}` : "",
    inventory.messageCityMisses.length ? `Cidade/regiao citada pelo lead NAO encontrada no estoque: ${inventory.messageCityMisses.join(", ")}` : "",
  ].filter(Boolean);

  return {
    organization,
    site,
    inventory,
    text: lines.join("\n"),
  };
}

function summarizeInventory(properties: any[], message: string) {
  const cityCounts = new Map<string, number>();
  const neighborhoodCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const businessCounts = new Map<string, number>();

  for (const property of properties) {
    const city = joinParts([property.cidade, property.uf]);
    const neighborhood = joinParts([property.bairro, property.cidade]);
    incrementMap(cityCounts, city);
    incrementMap(neighborhoodCounts, neighborhood);
    incrementMap(typeCounts, property.tipo_de_imovel);
    incrementMap(businessCounts, property.tipo_de_negocio);
  }

  const cities = topMapEntries(cityCounts, 8);
  const neighborhoods = topMapEntries(neighborhoodCounts, 18);
  const propertyTypes = topMapEntries(typeCounts, 8);
  const businessTypes = topMapEntries(businessCounts, 5);
  const messageTerms = extractLocationTerms(message);
  const searchableLocations = [...cityCounts.keys(), ...neighborhoodCounts.keys()];
  const messageCityMatches = messageTerms
    .filter((term) => searchableLocations.some((location) => normalizeText(location).includes(normalizeText(term))))
    .slice(0, 5);
  const messageCityMisses = messageTerms
    .filter((term) => !messageCityMatches.some((match) => normalizeText(match) === normalizeText(term)))
    .slice(0, 5);

  return {
    cities,
    neighborhoods,
    propertyTypes,
    businessTypes,
    messageCityMatches,
    messageCityMisses,
  };
}

function incrementMap(map: Map<string, number>, value?: string | null) {
  const clean = String(value || "").trim();
  if (!clean) return;
  map.set(clean, (map.get(clean) || 0) + 1);
}

function topMapEntries(map: Map<string, number>, limit: number) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
    .slice(0, limit)
    .map(([name, count]) => `${name} (${count})`);
}

function extractLocationTerms(message: string) {
  const text = normalizeText(message);
  const known = [
    ["sao paulo", "Sao Paulo"],
    ["sp", "Sao Paulo"],
    ["belo horizonte", "Belo Horizonte"],
    ["bh", "Belo Horizonte"],
    ["nova lima", "Nova Lima"],
    ["rio das ostras", "Rio das Ostras"],
    ["mg", "MG"],
    ["rj", "RJ"],
  ];
  return uniqueStrings(known.filter(([term]) => text.includes(term)).map(([, display]) => display));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function estimateTokens(text: string) {
  const normalized = String(text || "").trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function estimateCostUsd(model: string, promptTokens: number, completionTokens: number) {
  const normalizedModel = normalizeText(model);
  if (normalizedModel.includes("gemini")) {
    return Number((((promptTokens / 1_000_000) * 0.10) + ((completionTokens / 1_000_000) * 0.40)).toFixed(8));
  }
  if (normalizedModel.includes("gpt-4.1-nano")) {
    return Number((((promptTokens / 1_000_000) * 0.10) + ((completionTokens / 1_000_000) * 0.40)).toFixed(8));
  }
  return Number((((promptTokens / 1_000_000) * 0.15) + ((completionTokens / 1_000_000) * 0.60)).toFixed(8));
}

function formatLeadMeta(rows: any[]) {
  if (!rows.length) return [];

  const lines = ["", "[RESPOSTAS E ORIGEM META]"];
  for (const row of rows) {
    lines.push(
      [
        line("Formulario", row.form_name || row.form_id),
        line("Campanha", row.campaign_name),
        line("Conjunto", row.adset_name),
        line("Anuncio", row.ad_name),
        line("Plataforma", row.platform),
        line("Notas do formulario", truncate(String(row.contact_notes || ""), 180)),
      ].filter(Boolean).join("\n"),
    );

    for (const answer of extractMetaAnswers(row.raw_payload)) {
      lines.push(`Resposta: ${answer}`);
    }
  }
  return lines.filter(Boolean);
}

function extractMetaAnswers(raw: any): string[] {
  const payload = parseJsonValue(raw);
  const fieldData = payload?.field_data || payload?.fieldData || payload?.data?.field_data || [];
  if (!Array.isArray(fieldData)) return [];

  return fieldData
    .map((field: any) => {
      const value = Array.isArray(field.values) ? field.values.filter(Boolean).join(", ") : field.value;
      if (!field.name || !value) return "";
      return `${field.name}: ${value}`;
    })
    .filter(Boolean)
    .slice(0, 6);
}

async function fetchPropertyById(
  supabase: any,
  organizationId: string,
  propertyId: string,
) {
  const { data } = await supabase
    .from("properties")
    .select(propertySelect())
    .eq("id", propertyId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data || null;
}

async function findMentionedProperties(
  supabase: any,
  organizationId: string,
  message: string,
  publicBaseUrl: string | null,
): Promise<PropertyCandidate[]> {
  const codes = extractPropertyCodes(message);
  if (!codes.length) return [];

  const orFilter = codes.map((code) => `code.ilike.%${code}%`).join(",");
  const { data, error } = await supabase
    .from("properties")
    .select(propertySelect())
    .eq("organization_id", organizationId)
    .or(orFilter)
    .limit(4);

  if (error) {
    console.error("[ai-agent-responder] property code lookup error:", error);
    return [];
  }

  return (data || [])
    .filter((property: any) => property.organization_id === organizationId)
    .map((property: any) => ({
      ...property,
      score: codes.includes(normalizeCode(property.code)) ? 100 : 80,
      public_url: propertyPublicUrl(publicBaseUrl, property.code),
    }))
    .sort((a: PropertyCandidate, b: PropertyCandidate) => (b.score || 0) - (a.score || 0));
}

async function searchBestProperties(
  supabase: any,
  organizationId: string,
  message: string,
  lead: any,
  mentionedProperties: PropertyCandidate[],
  publicBaseUrl: string | null,
): Promise<PropertyCandidate[]> {
  const { data, error } = await supabase
    .from("properties")
    .select(propertySelect())
    .eq("organization_id", organizationId)
    .order("destaque", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error("[ai-agent-responder] property search error:", error);
    return mentionedProperties.slice(0, 3);
  }

  const mentionedIds = new Set(mentionedProperties.map((property) => property.id));
  const scored = (data || [])
    .filter((property: any) => property.organization_id === organizationId)
    .filter(isOfferableProperty)
    .map((property: any) => ({
      ...property,
      score: scoreProperty(property, lead, message, mentionedIds.has(property.id)),
      public_url: propertyPublicUrl(publicBaseUrl, property.code),
    }))
    .filter((property: PropertyCandidate) => (property.score || 0) > 0)
    .sort((a: PropertyCandidate, b: PropertyCandidate) => (b.score || 0) - (a.score || 0));

  const merged = [...mentionedProperties, ...scored].filter(uniqueById);
  return merged.slice(0, 3);
}

function propertySelect() {
  return [
    "id",
    "organization_id",
    "code",
    "title",
    "descricao",
    "tipo_de_imovel",
    "tipo_de_negocio",
    "status",
    "destaque",
    "bairro",
    "cidade",
    "uf",
    "quartos",
    "suites",
    "banheiros",
    "vagas",
    "area_util",
    "area_total",
    "preco",
    "valor_locacao",
    "imagem_principal",
    "created_at",
  ].join(", ");
}

function isOfferableProperty(property: any) {
  const status = normalizeText(property.status || "");
  if (!status) return true;
  return !["inativo", "vendido", "locado", "indisponivel", "arquivado", "excluido"].some((blocked) =>
    status.includes(blocked)
  );
}

function scoreProperty(property: any, lead: any, message: string, mentioned: boolean) {
  const text = normalizeText(message);
  const leadCity = normalizeText(lead?.cidade || "");
  const leadNeighborhood = normalizeText(lead?.bairro || "");
  const propertyCity = normalizeText(property.cidade || "");
  const propertyNeighborhood = normalizeText(property.bairro || "");
  const desiredBedrooms = extractBedrooms(message);
  const desiredBudget = extractBudget(message) || Number(lead?.valor_interesse || 0);

  let score = mentioned ? 80 : 1;
  if (property.destaque) score += 4;
  if (propertyNeighborhood && (text.includes(propertyNeighborhood) || propertyNeighborhood === leadNeighborhood)) score += 12;
  if (propertyCity && (text.includes(propertyCity) || propertyCity === leadCity)) score += 8;
  if (desiredBedrooms && Number(property.quartos || 0) >= desiredBedrooms) score += 7;
  if (desiredBudget && Number(property.preco || property.valor_locacao || 0) > 0) {
    const price = Number(property.preco || property.valor_locacao);
    if (price <= desiredBudget) score += 6;
    else if (price <= desiredBudget * 1.15) score += 3;
  }
  if (property.tipo_de_imovel && text.includes(normalizeText(property.tipo_de_imovel))) score += 4;
  if (property.tipo_de_negocio && text.includes(normalizeText(property.tipo_de_negocio))) score += 3;
  return score;
}

async function maybeCreateVisitSchedule(input: {
  message: string;
  lead: any;
}) {
  const visitDate = parseVisitDate(input.message);
  if (!visitDate || !input.lead?.id) return null;

  // There is no unique visit-intent key or atomic scheduling RPC in the
  // current schema. A check-then-insert can create duplicate/partial agenda
  // effects under retries, so legacy auto-creation stays fail-closed until an
  // atomic database primitive is available.
  return {
    requested: true,
    created: false,
    reason: "manual_confirmation_required",
    start_time: visitDate.toISOString(),
  };
}

export async function moveLeadToVisitStage(
  supabase: any,
  lead: any,
  organizationId: string,
) {
  if (!lead?.id || !lead.pipeline_id) return false;

  const { data: stages, error: stagesError } = await supabase
    .from("stages")
    .select("id, name, stage_key, pipeline_id")
    .eq("organization_id", organizationId)
    .eq("pipeline_id", lead.pipeline_id);
  if (stagesError) throw stagesError;

  const target = (stages || []).find((stage: any) => {
    const value = normalizeText(`${stage.name || ""} ${stage.stage_key || ""}`);
    return value.includes("visit") && (value.includes("agend") || value.includes("marcad"));
  });

  if (!target?.id || target.id === lead.stage_id) return false;

  let update = supabase
    .from("leads")
    .update({
      stage_id: target.id,
      pipeline_id: target.pipeline_id,
      stage_entered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", lead.id)
    .eq("organization_id", organizationId)
    .eq("pipeline_id", lead.pipeline_id);

  update = lead.stage_id
    ? update.eq("stage_id", lead.stage_id)
    : update.is("stage_id", null);
  const { data: movedLead, error: moveError } = await update
    .select("id, pipeline_id, stage_id")
    .maybeSingle();
  if (moveError) throw moveError;
  if (movedLead?.id !== lead.id || movedLead.stage_id !== target.id) {
    throw new Error("Lead stage changed before visit transition");
  }
  return true;
}

async function getCompactHistory(
  supabase: any,
  organizationId: string,
  conversationId: string,
  sessionId: string | null,
  currentMessage: string,
  limit: number,
  since?: string | null,
) {
  let query = supabase
    .from("whatsapp_messages")
    .select("content, from_me, message_type, sent_at, created_at")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .eq("message_type", "text")
    .order("sent_at", { ascending: false })
    .limit(limit);

  if (sessionId) query = query.eq("session_id", sessionId);
  if (since) {
    query = query.gte("sent_at", since);
  }

  const { data } = await query;

  const history = (data || [])
    .reverse()
    .map((msg: any) => ({
      role: msg.from_me ? "assistant" as const : "user" as const,
      content: truncate(String(msg.content || ""), 260),
    }))
    .filter((msg: ChatMessage) => msg.content.trim() !== "");

  const last = history[history.length - 1];
  if (!last || last.role !== "user" || normalizeText(last.content) !== normalizeText(currentMessage)) {
    history.push({ role: "user", content: truncate(currentMessage, 260) });
  }

  return history;
}

function buildSystemPrompt(input: {
  agent: any;
  leadContext: any;
  mentionedProperties: PropertyCandidate[];
  bestProperties: PropertyCandidate[];
  organizationContext: any;
  memorySummary: string;
  visitAction: any;
}) {
  const defaultSystemPrompt =
    "Voce e a Jhenny, assistente comercial imobiliaria do Vimob. Responda com clareza, cuidado e objetividade.";
  const systemPromptBase = input.agent.system_prompt || defaultSystemPrompt;
  const propertyContext = formatPropertyContext(input.mentionedProperties, input.bestProperties);
  const actionContext = input.visitAction?.created
    ? `[ACAO EXECUTADA]\nVisita criada na agenda para ${formatDateTimePtBR(new Date(input.visitAction.start_time))}. Confirme isso ao lead de forma curta.`
    : input.visitAction?.requested
    ? `[ACAO NAO EXECUTADA]\nO lead demonstrou intencao de visita para ${formatDateTimePtBR(new Date(input.visitAction.start_time))}, mas a agenda automatica esta desativada por seguranca. Nao diga que a visita foi agendada. Informe que dia e horario ainda precisam de confirmacao humana.`
    : "";

  return [
    systemPromptBase,
    [
      "[REGRAS DA JHENNY]",
      "- Responda em portugues do Brasil, de forma leve, solta e natural para WhatsApp.",
      "- Use frases curtas. Evite parecer formulario, triagem agressiva ou atendimento robotico.",
      "- Use o nome do lead de vez em quando quando ele estiver no contexto, principalmente em abertura, retomada ou resposta importante. Nao repita o nome em toda mensagem.",
      "- Se o lead perguntar se voce sabe o nome dele e o contexto tiver Nome, responda que sim e use esse nome. Nunca diga que nao tem o nome se ele aparece no contexto do lead.",
      "- Reaja ao que o lead disse antes de perguntar outra coisa. Se ele escolheu um bairro, comente de forma natural que e uma boa regiao ou que combina com o que ele procura, sem exagerar.",
      "- Converse em fluxo: responda a duvida, acrescente uma informacao util e faca uma pergunta simples para continuar. Varie as palavras e nao repita a mesma frase de fechamento.",
      "- Foco: tirar duvidas, entender o que o lead quer, qualificar com calma, oferecer imoveis e conduzir para visita.",
      "- Use somente dados fornecidos no contexto da organizacao atual.",
      "- Voce atende em nome da imobiliaria do bloco CONTEXTO DA IMOBILIARIA. Use esse contexto para saber para quem voce atua, segmento, site e regioes.",
      "- Quando o lead perguntar onde a imobiliaria atua, se tem imoveis em uma cidade/regiao, quais bairros atende, ou 'tem algo em X?', responda com base no bloco ESTOQUE E REGIOES DE ATUACAO.",
      "- Nesses casos, nao responda apenas 'tenho algumas opcoes' e nao devolva de cara 'qual bairro voce prefere?'. Cite primeiro cidades/bairros reais do estoque e depois pergunte qual deles faz sentido.",
      "- Se a cidade/regiao citada pelo lead aparecer como NAO encontrada no estoque, diga com naturalidade que nao encontrou opcoes ali no estoque atual e apresente as regioes reais mais fortes. Nao diga que atua em uma cidade sem estoque no contexto.",
      "- Se o lead disser uma cidade ampla, liste 3 a 8 bairros/regioes onde ha estoque naquela cidade. Se nao houver estoque naquela cidade, liste as cidades/bairros principais do estoque.",
      "- Se houver valor, metragem, quartos, suites, vagas, condominio, IPTU, bairro, cidade ou link no contexto, use esses dados quando o lead perguntar.",
      "- Use a descricao do imovel quando ela existir para explicar com outras palavras, sem repetir sempre a mesma lista de quartos/vagas/valor.",
      "- Nunca invente preco, endereco completo, disponibilidade ou condicao que nao esteja no contexto.",
      "- Nunca revele nome/telefone do proprietario, endereco completo, numero, complemento, documentos, codigos internos sensiveis ou observacoes privadas.",
      "- Pode falar bairro, cidade e UF. Nao fale rua/numero/complemento, mesmo que apareca em algum dado interno.",
      "- Quando o lead citar um codigo como CA1050 ou 1050, priorize o bloco IMOVEL CITADO.",
      "- Ao sugerir imoveis, envie no maximo 3 opcoes. Link e opcional, nao o centro da conversa.",
      "- Para agendar visita, colete dia e horario se faltarem. Se a acao ja foi executada, apenas confirme.",
      "- Use apenas corretor ou especialista para se referir a uma pessoa de atendimento.",
      "- Nao ofereca corretor como saida padrao. Primeiro converse e entenda bairro, faixa de valor, quartos, prazo, financiamento, urgencia e tipo de imovel.",
      "- So diga que vai chamar/encaminhar para um corretor ou especialista quando o lead pedir atendimento com uma pessoa, confirmar que quer ser atendido, quiser agendar visita/ligacao, ou faltar uma informacao critica que voce nao pode afirmar.",
      "- Se nao houver opcao exatamente no bairro pedido, diga que nao encontrou ali com os filtros atuais, mas que achou uma oportunidade muito boa em regiao alternativa. Depois pergunte se pode mostrar ou acionar o corretor para confirmar.",
      "- Qualifique como SDR, de maneira sutil e em conversa, sem listar checklist nem fazer interrogatorio.",
      "- Minha Casa Minha Vida: descubra aos poucos se ja possui imovel no nome, se trabalha CLT ou autonomo, se e casado no papel, se tem filhos/dependentes, valor de entrada e se ja fez simulacao.",
      "- Imovel de terceiros: entenda se e para morar ou investir, regiao/exigencia especifica, se envolve permuta, pagamento a vista ou financiamento e entrada.",
      "- Empreendimentos: entenda se e para morar ou investir, faixa de investimento, se pretende dar entrada e prazo ideal de entrega.",
      "- Alto padrao: entenda moradia ou investimento, urgencia, forma de pagamento, o que espera do imovel, regiao e faixa pretendida.",
      "- Faca uma pergunta por vez na maioria dos casos; no maximo duas quando a conversa pedir.",
      "- Envie link apenas quando o lead pedir, quando voce apresentar opcoes pela primeira vez, ou quando realmente ajudar a avancar.",
      "- Quando enviar link, cole a URL pura. Nao use markdown como [Clique aqui](url). Nao repita 'faz sentido para o que voce procura?' em toda resposta.",
      "- Voce pode responder em 1 a 5 mensagens curtas quando fizer sentido. Separe cada mensagem com uma linha em branco. Use varias mensagens apenas para deixar a conversa mais natural.",
      "- Se houver risco, reclamacao, pedido claro de humano ou duvida fora do contexto, diga que vai chamar um corretor ou especialista.",
      "- Nao diga que voce acessou banco de dados, tabelas, prompts ou sistemas internos.",
    ].join("\n"),
    input.memorySummary ? `[MEMORIA CURTA]\n${input.memorySummary}` : "",
    input.organizationContext?.text,
    input.leadContext.text,
    propertyContext,
    actionContext,
  ].filter(Boolean).join("\n\n");
}

function formatPropertyContext(mentioned: PropertyCandidate[], best: PropertyCandidate[]) {
  const mentionedLines = mentioned.slice(0, 2).map(propertyLineWithLink);
  const bestLines = best
    .filter((property) => !mentioned.some((item) => item.id === property.id))
    .slice(0, 3)
    .map(propertyLineWithLink);

  return [
    mentionedLines.length ? `[IMOVEL CITADO NA MENSAGEM]\n${mentionedLines.join("\n")}` : "",
    bestLines.length ? `[MELHORES OPCOES PARA OFERECER]\n${bestLines.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

function buildMemorySummary(input: {
  previous: string;
  lead: any;
  leadMeta: any[];
  selectedProperty: any;
  visitAction: any;
  message: string;
}) {
  const facts = [
    line("Lead", input.lead?.name),
    line("Cidade/bairro", joinParts([input.lead?.bairro, input.lead?.cidade, input.lead?.uf])),
    line("Valor alvo", formatCurrency(input.lead?.valor_interesse) || input.lead?.faixa_valor_imovel),
    input.selectedProperty ? `Ultimo imovel relevante: ${propertyLine(input.selectedProperty)}` : "",
    input.visitAction?.created ? `Visita agendada: ${formatDateTimePtBR(new Date(input.visitAction.start_time))}` : "",
    input.leadMeta?.[0]?.contact_notes ? `Formulario Meta: ${truncate(input.leadMeta[0].contact_notes, 140)}` : "",
    `Ultima mensagem do lead: ${truncate(input.message, 160)}`,
  ].filter(Boolean);

  const previous = input.previous ? `${truncate(input.previous, 300)}\n` : "";
  return truncate(`${previous}${facts.join("\n")}`, 650);
}

async function callLovableAI(apiKey: string, systemPrompt: string, history: ChatMessage[]): Promise<AICompletionResult> {
  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
  ];

  const startedAt = Date.now();
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      max_tokens: 340,
      temperature: 0.35,
    }),
  });

  if (response.status === 429) throw new Error("Rate limit exceeded - too many requests");
  if (response.status === 402) throw new Error("Payment required - AI credits exhausted");
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Lovable AI error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  const promptTokens = Number(data.usage?.prompt_tokens ?? estimateTokens(messages.map((msg) => msg.content).join("\n")));
  const completionTokens = Number(data.usage?.completion_tokens ?? estimateTokens(content));
  const totalTokens = Number(data.usage?.total_tokens ?? promptTokens + completionTokens);
  const model = data.model || AI_MODEL;

  return {
    content,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    latencyMs: Date.now() - startedAt,
    estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens),
  };
}

async function insertOutboxMessage(
  supabase: any,
  conversation: any,
  organizationId: string,
  content: string,
  privateWorker: { supabaseUrl: string; apiKey: string },
  responseClaimId: string,
): Promise<OutboxInsertResult> {
  if (
    !conversationReferencesBelongToTenant(conversation, organizationId) ||
    !conversation.session_id
  ) {
    throw new Error("Tenant conversation reference is unavailable");
  }

  const chunks = splitAssistantMessages(content);
  let lastContent = chunks[chunks.length - 1] || content;
  let lastSentAt = new Date().toISOString();
  let queuedChunks = 0;

  for (const [chunkIndex, chunk] of chunks.entries()) {
    const clientMessageId = buildAIOutboxClientMessageId(
      responseClaimId,
      chunkIndex,
    );
    const now = new Date().toISOString();
    lastContent = chunk;
    lastSentAt = now;

    // A response can contain several WhatsApp messages. Re-read the canonical
    // takeover state immediately before every individual outbox insert so a
    // human takeover between chunks stops the remaining response.
    const pauseReason = await getCanonicalAIPauseReason(supabase, {
      organizationId,
      sessionId: conversation.session_id,
      conversationId: conversation.id,
    });
    if (pauseReason) {
      return { kind: "suppressed", reason: pauseReason, queuedChunks };
    }

    const { error } = await supabase.from("outbox_messages").insert({
      conversation_id: conversation.id,
      session_id: conversation.session_id,
      organization_id: organizationId,
      content: chunk,
      message_type: "text",
      status: "pending",
      created_by: null,
      client_message_id: clientMessageId,
    });

    if (error) {
      console.error("[ai-agent-responder] Error inserting outbox message:", error);
      throw error;
    }

    const { error: historyError } = await supabase
      .from("whatsapp_messages")
      .upsert({
        conversation_id: conversation.id,
        session_id: conversation.session_id,
        organization_id: organizationId,
        lead_id: conversation.lead_id || null,
        message_id: clientMessageId,
        client_message_id: clientMessageId,
        from_me: true,
        content: chunk,
        message_type: "text",
        remote_jid: conversation.remote_jid,
        status: "pending",
        sent_at: now,
        sender_name: "Jhenny",
      }, { onConflict: "session_id,message_id" });

    if (historyError) {
      console.error("[ai-agent-responder] Error inserting optimistic AI history:", historyError);
      throw historyError;
    }
    queuedChunks += 1;
  }

  let conversationUpdate = supabase
    .from("whatsapp_conversations")
    .update({
      last_message: lastContent,
      last_message_at: lastSentAt,
      unread_count: 0,
      updated_at: lastSentAt,
    })
    .eq("id", conversation.id)
    .eq("organization_id", organizationId)
    .eq("session_id", conversation.session_id);

  // Optimistic history inserts can touch conversation.updated_at through a
  // trigger, so use the inbound last-message snapshot as the CAS token. A
  // human/manual or concurrent response changes this snapshot and prevents
  // the AI from overwriting the newer conversation preview.
  conversationUpdate = conversation.last_message_at
    ? conversationUpdate.eq("last_message_at", conversation.last_message_at)
    : conversationUpdate.is("last_message_at", null);
  conversationUpdate = conversation.last_message !== null &&
      conversation.last_message !== undefined
    ? conversationUpdate.eq("last_message", conversation.last_message)
    : conversationUpdate.is("last_message", null);

  const { data: updatedConversation, error: conversationUpdateError } =
    await conversationUpdate.select("id").maybeSingle();
  if (conversationUpdateError) throw conversationUpdateError;
  if (updatedConversation?.id !== conversation.id) {
    throw new Error("Conversation changed before AI outbox finalization");
  }

  try {
    await fetch(`${privateWorker.supabaseUrl}/functions/v1/message-sender`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // `apikey` is required for hosted opaque `sb_secret_...` keys. Keep
        // Authorization during the migration for legacy service-role JWTs.
        apikey: privateWorker.apiKey,
        Authorization: `Bearer ${privateWorker.apiKey}`,
      },
      body: JSON.stringify({}),
    });
  } catch (e) {
    console.error("[ai-agent-responder] Error triggering message-sender:", e);
  }

  return { kind: "queued", queuedChunks };
}

async function upsertAgentConversation(supabase: any, input: {
  agent: any;
  agentConv: any;
  conversationId: string;
  leadId: string | null;
  messageCount: number;
  memorySummary: string;
  property: any;
}) {
  const nextState = {
    agent_id: input.agent.id,
    conversation_id: input.conversationId,
    lead_id: input.leadId,
    status: "active",
    message_count: input.messageCount,
    memory_summary: input.memorySummary,
    last_user_message_at: new Date().toISOString(),
    last_property_id: input.property?.id || null,
    last_property_code: input.property?.code || null,
  };

  if (!input.agentConv) {
    const { data: created, error } = await supabase
      .from("ai_agent_conversations")
      .insert(nextState)
      .select("id, status, updated_at")
      .single();
    if (error) throw error;
    if (!created?.id || created.status !== "active") {
      throw new Error("AI conversation state was not created");
    }
    return created;
  }

  if (
    !input.agentConv.id ||
    !input.agentConv.updated_at ||
    input.agentConv.status !== "active" ||
    input.agentConv.agent_id !== input.agent.id
  ) {
    throw new Error("AI conversation state is no longer active");
  }

  const { data: updated, error } = await supabase
    .from("ai_agent_conversations")
    .update({
      agent_id: input.agent.id,
      lead_id: input.leadId,
      message_count: input.messageCount,
      memory_summary: input.memorySummary,
      last_user_message_at: nextState.last_user_message_at,
      last_property_id: input.property?.id || null,
      last_property_code: input.property?.code || null,
    })
    .eq("id", input.agentConv.id)
    .eq("conversation_id", input.conversationId)
    .eq("agent_id", input.agentConv.agent_id)
    .eq("status", "active")
    .eq("updated_at", input.agentConv.updated_at)
    .select("id, status, updated_at")
    .maybeSingle();
  if (error) throw error;
  if (updated?.id !== input.agentConv.id || updated.status !== "active") {
    throw new Error("AI conversation state changed concurrently");
  }
  return updated;
}

async function markAgentConversationAIMessageQueued(supabase: any, input: {
  state: any;
  agentId: string;
  conversationId: string;
}) {
  if (
    !input.state?.id ||
    !input.state.updated_at ||
    input.state.status !== "active"
  ) throw new Error("AI conversation state is no longer active");

  // `last_ai_message_at` means that an AI response really reached the outbox,
  // not merely that a model completed. Keep this as a second CAS so a pause
  // observed after the first state commit never leaves a false sent marker.
  const { data: updated, error } = await supabase
    .from("ai_agent_conversations")
    .update({ last_ai_message_at: new Date().toISOString() })
    .eq("id", input.state.id)
    .eq("conversation_id", input.conversationId)
    .eq("agent_id", input.agentId)
    .eq("status", "active")
    .eq("updated_at", input.state.updated_at)
    .select("id, status, updated_at")
    .maybeSingle();
  if (error) throw error;
  if (updated?.id !== input.state.id || updated.status !== "active") {
    throw new Error("AI conversation state changed concurrently");
  }
  return updated;
}

async function markHandedOff(
  supabase: any,
  agent: any,
  conversationId: string,
  leadId: string | null,
  agentConv: any,
  reason: string,
  messageCount?: number,
) {
  const handedOffAt = new Date().toISOString();
  const nextState = {
    agent_id: agent.id,
    conversation_id: conversationId,
    lead_id: leadId,
    status: "handed_off",
    message_count: messageCount ?? agentConv?.message_count ?? 0,
    handed_off_at: handedOffAt,
    last_human_message_at: reason === "manual_message"
      ? handedOffAt
      : agentConv?.last_human_message_at || null,
    handoff_reason: reason,
  };

  if (!agentConv) {
    const { data: created, error } = await supabase
      .from("ai_agent_conversations")
      .insert(nextState)
      .select("id, status, updated_at")
      .single();
    if (error) throw error;
    if (!created?.id || created.status !== "handed_off") {
      throw new Error("AI handoff state was not created");
    }
    return created;
  }

  if (
    !agentConv.id ||
    !agentConv.updated_at ||
    agentConv.status !== "active" ||
    agentConv.agent_id !== agent.id
  ) {
    throw new Error("AI conversation state is no longer active");
  }

  const { data: updated, error } = await supabase
    .from("ai_agent_conversations")
    .update({
      agent_id: agent.id,
      lead_id: leadId,
      status: "handed_off",
      message_count: nextState.message_count,
      handed_off_at: handedOffAt,
      last_human_message_at: nextState.last_human_message_at,
      handoff_reason: reason,
    })
    .eq("id", agentConv.id)
    .eq("conversation_id", conversationId)
    .eq("agent_id", agentConv.agent_id)
    .eq("status", "active")
    .eq("updated_at", agentConv.updated_at)
    .select("id, status, updated_at")
    .maybeSingle();
  if (error) throw error;
  if (updated?.id !== agentConv.id || updated.status !== "handed_off") {
    throw new Error("AI conversation state changed concurrently");
  }
  return updated;
}

async function detectHumanTakeover(
  supabase: any,
  organizationId: string,
  conversationId: string,
  sessionId: string | null,
  since: string,
) {
  let messageQuery = supabase
    .from("whatsapp_messages")
    .select("id, sender_name")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .eq("from_me", true)
    .not("sender_name", "is", null)
    .gte("sent_at", since)
    .limit(8);
  if (sessionId) messageQuery = messageQuery.eq("session_id", sessionId);
  const { data: manualMessages, error: manualMessagesError } = await messageQuery;
  if (manualMessagesError) throw manualMessagesError;

  if ((manualMessages || []).some((message: any) => !isAutomationSenderName(message.sender_name))) {
    return { detected: true, reason: "manual_message" };
  }

  let outboxQuery = supabase
    .from("outbox_messages")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .not("created_by", "is", null)
    .gte("created_at", since)
    .limit(1);
  if (sessionId) outboxQuery = outboxQuery.eq("session_id", sessionId);
  const { data: manualOutbox, error: manualOutboxError } = await outboxQuery;
  if (manualOutboxError) throw manualOutboxError;

  if (manualOutbox?.length) return { detected: true, reason: "manual_outbox" };
  return { detected: false, reason: "" };
}

function isAutomationSenderName(value: string | null | undefined) {
  const name = normalizeText(value || "");
  if (!name) return false;
  return name.includes("jhenny")
    || name.includes("jenny")
    || name === "ia"
    || name === "ai"
    || name.startsWith("autom");
}

async function notifyHumanNeeded(
  supabase: any,
  organizationId: string,
  lead: any,
  fallbackUserId: string | null,
  conversationId: string,
  reason: string,
) {
  const userId = lead?.assigned_user_id || fallbackUserId;
  if (!userId) return;

  await notifyUser(supabase, organizationId, userId, lead?.id || null, {
    type: "ai_handoff",
    title: "Jhenny chamou um corretor",
    content: `${lead?.name || "Um lead"} precisa de um corretor. Motivo: ${reason}. Conversa: ${conversationId}.`,
  });
}

async function notifyUser(
  supabase: any,
  organizationId: string,
  userId: string,
  leadId: string | null,
  input: { title: string; content: string; type: string },
) {
  const { error } = await supabase.from("notifications").insert({
    organization_id: organizationId,
    user_id: userId,
    lead_id: leadId,
    type: input.type,
    title: input.title,
    content: input.content,
    is_read: false,
  });
  if (error) throw error;
}

async function getPublicSiteBaseUrl(supabase: any, organizationId: string) {
  const { data } = await supabase
    .from("organization_sites")
    .select("subdomain, custom_domain, domain_verified, is_active")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .maybeSingle();

  if (!data) return null;
  if (data.custom_domain && data.domain_verified) return `https://${data.custom_domain}`;
  if (data.subdomain) return `${DEFAULT_SITE_BASE_URL}/sites/${data.subdomain}`;
  return null;
}

function propertyPublicUrl(baseUrl: string | null, code: string | null | undefined) {
  if (!baseUrl || !code) return null;
  return `${baseUrl.replace(/\/+$/, "")}/imovel/${encodeURIComponent(code)}`;
}

function appendActionConfirmation(response: string, visitAction: any) {
  if (!visitAction?.created) return response;
  if (normalizeText(response).includes("visita") && normalizeText(response).includes("agend")) return response;
  return `${response.trim()}\n\nVisita agendada para ${formatDateTimePtBR(new Date(visitAction.start_time))}.`;
}

function containsKeyword(message: string, keywords: string[]) {
  const text = normalizeText(message);
  return keywords.some((keyword) => {
    const normalized = normalizeText(keyword);
    return normalized && text.includes(normalized);
  });
}

function extractPropertyCodes(message: string) {
  const candidates = new Set<string>();
  const upper = normalizeText(message).toUpperCase();
  const codeRegex = /\b([A-Z]{1,5}\s*-?\s*\d{2,7})\b/g;
  const numberRegex = /\b(?:IMOVEL|CODIGO|COD|REF|REFERENCIA)?\s*#?\s*(\d{3,7})\b/g;

  for (const match of upper.matchAll(codeRegex)) candidates.add(normalizeCode(match[1]));
  for (const match of upper.matchAll(numberRegex)) candidates.add(normalizeCode(match[1]));

  return Array.from(candidates).filter((code) => code.length >= 3).slice(0, 8);
}

function normalizeCode(value: string) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseVisitDate(message: string): Date | null {
  const text = normalizeText(message);
  if (!/(visita|visitar|conhecer|agenda|agendar|marcar|horario)/i.test(text)) return null;

  const dateMatch = message.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
  const timeMatch = message.match(/\b(\d{1,2})(?:h|:)(\d{0,2})\b/i);
  if (!dateMatch || !timeMatch) return null;

  const now = new Date();
  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const rawYear = dateMatch[3] ? Number(dateMatch[3]) : now.getFullYear();
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const hour = Number(timeMatch[1]);
  const minute = timeMatch[2] ? Number(timeMatch[2]) : 0;
  if (day < 1 || day > 31 || month < 1 || month > 12 || hour < 7 || hour > 22 || minute > 59) return null;

  const scheduled = new Date(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00-03:00`);
  if (Number.isNaN(scheduled.getTime()) || scheduled.getTime() < now.getTime() - 60 * 60 * 1000) return null;
  return scheduled;
}

function extractBedrooms(message: string) {
  const match = normalizeText(message).match(/\b(\d{1,2})\s*(quarto|quartos|dormitorio|dormitorios|dorm)\b/);
  return match ? Number(match[1]) : null;
}

function extractBudget(message: string) {
  const normalized = normalizeText(message).replace(/\./g, "").replace(/,/g, ".");
  const match = normalized.match(/\b(?:ate|max|maximo|r\$)?\s*(\d{2,7})(?:\s*(mil|k|m|milhao|milhoes))?\b/);
  if (!match) return null;
  let value = Number(match[1]);
  const suffix = match[2] || "";
  if (suffix === "mil" || suffix === "k") value *= 1000;
  if (suffix === "m" || suffix.startsWith("milhao") || suffix.startsWith("milhoes")) value *= 1000000;
  return value >= 10000 ? value : null;
}

function propertyLine(property: any) {
  return [
    property.code,
    property.title || property.tipo_de_imovel,
    property.descricao ? `Descricao: ${truncate(String(property.descricao), 120)}` : "",
    joinParts([property.bairro, property.cidade, property.uf]),
    property.quartos ? `${property.quartos} quartos` : "",
    property.area_util ? `${property.area_util}m2` : "",
    formatCurrency(property.preco || property.valor_locacao),
  ].filter(Boolean).join(" | ");
}

function propertyLineWithLink(property: PropertyCandidate) {
  const base = propertyLine(property);
  return property.public_url ? `${base} | Link: ${property.public_url}` : base;
}

function formatCurrency(value: any) {
  const number = Number(value || 0);
  if (!number) return "";
  return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function formatDateTimePtBR(date: Date) {
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function line(label: string, value: any) {
  if (value === undefined || value === null || value === "") return "";
  return `${label}: ${value}`;
}

function joinParts(parts: any[]) {
  return parts.filter(Boolean).join(", ");
}

function truncate(value: string, limit: number) {
  if (!value) return "";
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}...`;
}

function splitAssistantMessages(value: string) {
  const cleaned = String(value || "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$2")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  if (!cleaned) return ["Certo, vou seguir por aqui."];

  const chunks = cleaned
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .flatMap((chunk) => splitLongMessage(chunk, 900));

  if (chunks.length <= 5) return chunks;
  return [...chunks.slice(0, 4), chunks.slice(4).join("\n\n")];
}

function splitLongMessage(value: string, limit: number) {
  const chunks: string[] = [];
  let rest = value.trim();

  while (rest.length > limit) {
    let cut = Math.max(rest.lastIndexOf(". ", limit), rest.lastIndexOf("! ", limit), rest.lastIndexOf("? ", limit));
    if (cut < limit / 2) cut = rest.lastIndexOf(" ", limit);
    if (cut < limit / 2) cut = limit;
    chunks.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }

  if (rest) chunks.push(rest);
  return chunks;
}

function parseJsonValue(value: any) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizePhone(value: string) {
  return String(value || "").replace(/@.*/, "").replace(/:.*/, "").replace(/\D/g, "");
}

function phoneVariants(value: string) {
  const digits = normalizePhone(value);
  const variants = new Set<string>();
  if (!digits) return [];

  variants.add(digits);
  const local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  variants.add(local);
  variants.add(`55${local}`);

  if (local.length === 11 && local[2] === "9") {
    const withoutNinth = `${local.slice(0, 2)}${local.slice(3)}`;
    variants.add(withoutNinth);
    variants.add(`55${withoutNinth}`);
  }

  if (local.length === 10) {
    const withNinth = `${local.slice(0, 2)}9${local.slice(2)}`;
    variants.add(withNinth);
    variants.add(`55${withNinth}`);
  }

  return Array.from(variants).filter(Boolean);
}

function phonesMatch(a: string, b: string) {
  const aVariants = new Set(phoneVariants(a));
  return phoneVariants(b).some((variant) => aVariants.has(variant));
}

function uniqueById(value: PropertyCandidate, index: number, arr: PropertyCandidate[]) {
  return arr.findIndex((item) => item.id === value.id) === index;
}

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function mostRecentTimestamp(...values: Array<string | null | undefined>) {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(String(value)).getTime())
    .filter((value) => Number.isFinite(value));

  if (!timestamps.length) return hoursAgo(HUMAN_TAKEOVER_LOOKBACK_HOURS);
  return new Date(Math.max(...timestamps)).toISOString();
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
