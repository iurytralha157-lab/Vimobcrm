import type { ActivityEventRow } from './types';
import { asMetadata, metadataString } from './metadata';

export function isStageChangeTriggerActivity(activity: ActivityEventRow): boolean {
  if (activity.type !== 'stage_change' && activity.type !== 'stage_changed') return false;
  const metadata = asMetadata(activity.metadata);
  return !metadataString(metadata.to_pipeline)
    && /^Movido de ".*" para ".*"$/i.test(activity.content || '');
}

function isApiStageChangeWithActor(activity: ActivityEventRow): boolean {
  if (activity.type !== 'stage_change' && activity.type !== 'stage_changed') return false;
  const metadata = asMetadata(activity.metadata);
  return Boolean(activity.user_id && metadataString(metadata.to_pipeline))
    && /^Lead ".*" movido de etapa$/i.test(activity.content || '');
}

function isSameStageTransition(left: ActivityEventRow, right: ActivityEventRow): boolean {
  const leftMetadata = asMetadata(left.metadata);
  const rightMetadata = asMetadata(right.metadata);
  const leftFrom = metadataString(leftMetadata.from_stage_id) || metadataString(leftMetadata.old_stage_id);
  const leftTo = metadataString(leftMetadata.to_stage_id) || metadataString(leftMetadata.new_stage_id);
  const rightFrom = metadataString(rightMetadata.from_stage_id) || metadataString(rightMetadata.old_stage_id);
  const rightTo = metadataString(rightMetadata.to_stage_id) || metadataString(rightMetadata.new_stage_id);
  const leftTime = new Date(left.created_at).getTime();
  const rightTime = new Date(right.created_at).getTime();
  return Boolean(leftFrom && leftTo && leftFrom === rightFrom && leftTo === rightTo)
    && Number.isFinite(leftTime) && Number.isFinite(rightTime)
    && Math.abs(leftTime - rightTime) <= 5_000;
}

export function getActivityFingerprint(activity: ActivityEventRow): string {
  const metadata = asMetadata(activity.metadata);
  const timestampWindow = Math.floor(new Date(activity.created_at).getTime() / 2000);

  if (activity.type === 'stage_change' || activity.type === 'stage_changed') {
    const from =
      metadataString(metadata.from_stage_id) ||
      metadataString(metadata.old_stage_id) ||
      metadataString(metadata.from_stage) ||
      metadataString(metadata.old_stage_name) ||
      '';
    const to =
      metadataString(metadata.to_stage_id) ||
      metadataString(metadata.new_stage_id) ||
      metadataString(metadata.to_stage) ||
      metadataString(metadata.new_stage_name) ||
      '';
    return `${activity.type}-${from}->${to}-${timestampWindow}`;
  }

  const detail = [
    metadataString(metadata.to_stage),
    metadataString(metadata.to_user_id),
    metadataString(metadata.new_stage_name),
    metadataString(metadata.tag_name),
    metadataString(metadata.property_id),
    metadataString(metadata.property_code),
    metadataString(metadata.file_name) ||
      metadataString(metadata.fileName) ||
      metadataString(metadata.filename) ||
      metadataString(metadata.attachment_name),
    metadataString(metadata.outcome),
    metadataString(metadata.kind),
    metadataString(metadata.question),
    metadataString(metadata.answer),
    activity.content,
  ].filter(Boolean).join('|');

  return `${activity.type}-${detail}-${timestampWindow}`;
}

export function getActivityDetailScore(activity: ActivityEventRow): number {
  const metadata = asMetadata(activity.metadata);
  let score = 0;
  if (metadataString(metadata.from_stage) || metadataString(metadata.old_stage_name)) score += 3;
  if (metadataString(metadata.to_stage) || metadataString(metadata.new_stage_name)) score += 3;
  if (metadataString(metadata.property_id) || metadataString(metadata.property_title)) score += 3;
  if (metadataString(metadata.file_url) || metadataString(metadata.file_name)) score += 3;
  if (metadataString(metadata.outcome) || metadataString(metadata.notes)) score += 2;
  if (/movido de\s+"/i.test(activity.content || '')) score += 2;
  // The backend writes this pair of fields with the authenticated actor;
  // the lead update trigger only has a recipient fallback for user_id.
  if (isApiStageChangeWithActor(activity)) score += 3;
  if (activity.content) score += 1;
  if (activity.user_id || metadataString(metadata.actor_id)) score += 1;
  return score;
}

export function dedupeActivityEvents(activityEvents: ActivityEventRow[]): ActivityEventRow[] {
  const dedupedActivityMap = new Map<string, ActivityEventRow>();

  activityEvents.forEach((activity) => {
    const fingerprint = getActivityFingerprint(activity);
    const existing = dedupedActivityMap.get(fingerprint);
    if (!existing || getActivityDetailScore(activity) > getActivityDetailScore(existing)) {
      dedupedActivityMap.set(fingerprint, activity);
    }
  });

  const deduped = Array.from(dedupedActivityMap.values()).sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
  );

  // The two writes can fall on opposite sides of the fingerprint's two-second
  // window. Suppress the trigger only when IDs and timing prove the same move.
  return deduped.filter((activity) => !isStageChangeTriggerActivity(activity)
    || !deduped.some((candidate) => isApiStageChangeWithActor(candidate)
      && candidate.type === activity.type
      && isSameStageTransition(activity, candidate)));
}
