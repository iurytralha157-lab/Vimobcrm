import {
  distributionQueueRuleInputs,
  getDistributionQueueEligibleUserIds,
  hasValidDistributionQueueCriteria,
  hydrateDistributionQueueFormData,
  type DistributionQueueFormData,
  type ExistingDistributionQueue,
} from "@/lib/round-robin/distribution-queue-form";
import type { QueueMemberDraft, QueueTeamSource } from "@/lib/round-robin/member-context";

function conditionsKey(form: DistributionQueueFormData) {
  return JSON.stringify(form.conditions.map(({ id, type, values, sessionId, legacyType }) =>
    [id, type, values, sessionId || "", legacyType || ""]));
}

function membersKey(members: QueueMemberDraft[], eligibilityOnly = false) {
  const rows = members.map(({ id, type, entityId, teamId, weight, isActive, reenroll }) =>
    [id || "", type, entityId, teamId || "", isActive !== false, Boolean(reenroll), ...(eligibilityOnly ? [] : [weight])]);
  return JSON.stringify(eligibilityOnly ? rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : rows);
}

// Compare with the actual loaded snapshot. Draft-supplied fingerprints and flags
// cannot make a changed participant or matcher count as unchanged.
export function queueSnapshotPreservation(form: DistributionQueueFormData, queue?: ExistingDistributionQueue | null) {
  if (!queue) return { preserveRuleSnapshot: false, preserveMemberSnapshot: false };
  const loaded = hydrateDistributionQueueFormData(queue, []);
  return {
    preserveRuleSnapshot: conditionsKey(form) === conditionsKey(loaded),
    preserveMemberSnapshot: membersKey(form.members) === membersKey(loaded.members),
  };
}

export function queueMutationCollections(
  input: Pick<DistributionQueueFormData, "conditions" | "members" | "preserveRuleSnapshot" | "preserveMemberSnapshot">,
  updating = false,
) {
  return {
    ...(!updating || !input.preserveRuleSnapshot ? distributionQueueRuleInputs(input.conditions) : {}),
    ...(!updating || !input.preserveMemberSnapshot ? { members: input.members } : {}),
  };
}

export function hasValidQueueDestination(form: DistributionQueueFormData, queue?: ExistingDistributionQueue | null) {
  if (form.target_pipeline_id && form.target_stage_id) return true;
  return Boolean(queue &&
    form.target_pipeline_id === (queue.target_pipeline_id || "") &&
    form.target_stage_id === (queue.target_stage_id || ""));
}

export function hasValidQueueCriteria(form: DistributionQueueFormData, queue?: ExistingDistributionQueue | null) {
  return hasValidDistributionQueueCriteria(form.conditions) ||
    Boolean(queue && !queue.rules?.length && queueSnapshotPreservation(form, queue).preserveRuleSnapshot);
}

export function queueRedistributionCapacity(
  members: QueueMemberDraft[],
  queue: ExistingDistributionQueue | null | undefined,
  teams: QueueTeamSource[],
  activeUserIds: string[],
  restricted = false,
): number | null {
  const loaded = queue ? hydrateDistributionQueueFormData(queue, []).members : null;
  if (loaded && membersKey(members, true) === membersKey(loaded, true)) {
    const count = queue?.eligible_user_count;
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) return count;
    // A mixed rollout can omit the authoritative snapshot. The server still
    // validates capacity in the transaction rather than guessing from a scope.
    return null;
  }
  const knownUsers = new Set(activeUserIds);
  const knownTeams = new Set(teams.map((team) => team.id));
  const unknown = members.some((member) => member.isActive !== false &&
    (member.type === "team" ? restricted || !knownTeams.has(member.entityId)
      : !knownUsers.has(member.entityId) || Boolean(member.teamId && !knownTeams.has(member.teamId))));
  if (unknown) return null;
  return getDistributionQueueEligibleUserIds(members, teams, activeUserIds).length;
}

// Managed queues can wait safely in their own pool with zero/one eligible
// recipients. Only the legacy timer requires a structural alternative.
export function hasQueueRedistributionCapacity(
  settings: Pick<DistributionQueueFormData['settings'], 'enable_redistribution' | 'operating_schedule'>,
  eligibleUserCount: number | null,
): boolean {
  return !settings.enable_redistribution || settings.operating_schedule !== undefined ||
    eligibleUserCount === null || eligibleUserCount >= 2;
}

