import type { ActivityEventRow } from './types';
import { asMetadata, metadataString } from './metadata';

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

  return Array.from(dedupedActivityMap.values()).sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
  );
}
