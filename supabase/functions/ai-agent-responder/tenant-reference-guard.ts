type ReferenceRecord = Record<string, unknown>;
type RelatedReference = ReferenceRecord | ReferenceRecord[] | null | undefined;

type ConversationReferenceSnapshot = {
  organization_id?: unknown;
  session_id?: unknown;
  lead_id?: unknown;
  session?: RelatedReference;
  lead?: RelatedReference;
};

type AgentConversationReferenceSnapshot = {
  agent_id?: unknown;
  lead_id?: unknown;
  last_property_id?: unknown;
  agent?: RelatedReference;
  lead?: RelatedReference;
  last_property?: RelatedReference;
};

type LeadReferenceSnapshot = {
  id?: unknown;
  organization_id?: unknown;
  assigned_user_id?: unknown;
  property_id?: unknown;
  interest_property_id?: unknown;
  pipeline_id?: unknown;
  stage_id?: unknown;
};

export type LoadedLeadTenantReferences = {
  property?: RelatedReference;
  interestProperty?: RelatedReference;
  pipeline?: RelatedReference;
  stage?: RelatedReference;
  assignedMember?: RelatedReference;
};

function requiredText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function oneRelatedRecord(value: RelatedReference) {
  if (Array.isArray(value)) {
    return value.length === 1 && value[0] && typeof value[0] === "object"
      ? value[0]
      : null;
  }

  return value && typeof value === "object" ? value : null;
}

function optionalOwnedReferenceMatches(
  referenceIdValue: unknown,
  relatedValue: RelatedReference,
  organizationId: string,
  relatedIdKey = "id",
) {
  const referenceId = requiredText(referenceIdValue);
  if (!referenceId) return relatedValue === null || relatedValue === undefined;

  const related = oneRelatedRecord(relatedValue);
  if (!related) return false;

  return requiredText(related[relatedIdKey]) === referenceId &&
    requiredText(related.organization_id) === organizationId;
}

/**
 * Checks the direct foreign keys on the already tenant-scoped WhatsApp
 * conversation. A populated FK must have exactly one matching related row;
 * service-role reads never get to treat a missing/cross-tenant relation as an
 * optional reference.
 */
export function conversationReferencesBelongToTenant(
  conversation: ConversationReferenceSnapshot,
  organizationId: string,
) {
  if (requiredText(conversation.organization_id) !== organizationId) {
    return false;
  }

  if (
    !optionalOwnedReferenceMatches(
      conversation.session_id,
      conversation.session,
      organizationId,
    )
  ) return false;

  return optionalOwnedReferenceMatches(
    conversation.lead_id,
    conversation.lead,
    organizationId,
  );
}

/**
 * `ai_agent_conversations` has no organization_id of its own. Its tenant is
 * therefore proven through every referenced row before memory, lead or
 * property data can be used.
 */
export function agentConversationReferencesBelongToTenant(
  agentConversation: AgentConversationReferenceSnapshot | null | undefined,
  organizationId: string,
  conversationSessionId: string | null,
) {
  if (!agentConversation) return true;

  const agentId = requiredText(agentConversation.agent_id);
  const agent = oneRelatedRecord(agentConversation.agent);
  if (
    !agentId || !agent || requiredText(agent.id) !== agentId ||
    requiredText(agent.organization_id) !== organizationId
  ) return false;

  const agentSessionId = requiredText(agent.session_id);
  if (agentSessionId && agentSessionId !== conversationSessionId) return false;

  if (
    !optionalOwnedReferenceMatches(
      agentConversation.lead_id,
      agentConversation.lead,
      organizationId,
    )
  ) return false;

  return optionalOwnedReferenceMatches(
    agentConversation.last_property_id,
    agentConversation.last_property,
    organizationId,
  );
}

export function organizationMemberBelongsToTenant(
  userIdValue: unknown,
  membershipValue: RelatedReference,
  organizationId: string,
) {
  const userId = requiredText(userIdValue);
  if (!userId) {
    return membershipValue === null || membershipValue === undefined;
  }

  const membership = oneRelatedRecord(membershipValue);
  if (!membership) return false;

  return requiredText(membership.user_id) === userId &&
    requiredText(membership.organization_id) === organizationId &&
    membership.is_active !== false;
}

/**
 * Validates all lead references that are later used to build the AI prompt or
 * create agenda/notification effects. The caller must load each relation with
 * organization_id in the query; this function provides the independent,
 * fail-closed value check.
 */
export function leadReferencesBelongToTenant(
  lead: LeadReferenceSnapshot,
  references: LoadedLeadTenantReferences,
  organizationId: string,
) {
  if (
    !requiredText(lead.id) ||
    requiredText(lead.organization_id) !== organizationId
  ) return false;

  if (
    !optionalOwnedReferenceMatches(
      lead.property_id,
      references.property,
      organizationId,
    ) ||
    !optionalOwnedReferenceMatches(
      lead.interest_property_id,
      references.interestProperty,
      organizationId,
    ) ||
    !optionalOwnedReferenceMatches(
      lead.pipeline_id,
      references.pipeline,
      organizationId,
    ) ||
    !optionalOwnedReferenceMatches(
      lead.stage_id,
      references.stage,
      organizationId,
    ) ||
    !organizationMemberBelongsToTenant(
      lead.assigned_user_id,
      references.assignedMember,
      organizationId,
    )
  ) return false;

  const stage = oneRelatedRecord(references.stage);
  const pipelineId = requiredText(lead.pipeline_id);
  const stageId = requiredText(lead.stage_id);
  if (stageId && !pipelineId) return false;
  return !stage || requiredText(stage.pipeline_id) === pipelineId;
}
