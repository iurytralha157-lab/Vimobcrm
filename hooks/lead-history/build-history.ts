import { dedupeActivityEvents } from './activity-deduplication';
import { auditContent, auditEventType, auditVisibleKeys } from './audit';
import { extractMetaCreative, extractMetaFormAnswers, extractWebhookFormAnswers } from './forms';
import { asMetadata, metadataRecord, metadataString, metadataNumber } from './metadata';
import {
  ACTIVITY_ONLY_TYPES,
  TIMELINE_AUTHORITY_TYPES,
  buildContent,
  buildLabel,
  sourceLabel,
} from './presentation';
import type {
  HistoryActor,
  HistoryMetadata,
  LeadHistoryFormatters,
  LeadHistoryRaw,
  UnifiedHistoryEvent,
} from './types';

export function buildLeadHistory(
  raw: LeadHistoryRaw,
  leadId: string,
  formatters: LeadHistoryFormatters,
): UnifiedHistoryEvent[] {
  const timelineEvents = raw.timelineEvents || [];
  const activityEvents = raw.activityEvents || [];
  const entryEvents = raw.entryEvents || [];
  const lead = raw.lead || null;
  const leadMeta = raw.leadMeta || null;
  const distributionLogs = raw.distributionLogs || [];
  const assignmentLogs = raw.assignmentLogs || [];
  const auditLogs = raw.auditLogs || [];

  // Collect all user IDs that need resolution from metadata
  const userIdsToResolve = new Set<string>();
  [...timelineEvents, ...activityEvents].forEach((event) => {
    const meta = asMetadata(event.metadata);
    const userId = metadataString(meta.user_id);
    const toUserId = metadataString(meta.to_user_id);
    const fromUserId = metadataString(meta.from_user_id);
    if (userId) userIdsToResolve.add(userId);
    if (toUserId) userIdsToResolve.add(toUserId);
    if (fromUserId) userIdsToResolve.add(fromUserId);
    if (event.user_id) userIdsToResolve.add(event.user_id);
    if ('actor_user_id' in event && event.actor_user_id) userIdsToResolve.add(event.actor_user_id);
  });
  distributionLogs.forEach((log) => {
    if (log.assigned_user_id && typeof log.assigned_user_id === 'string') userIdsToResolve.add(log.assigned_user_id);
  });
  assignmentLogs.forEach((log) => {
    if (log.old_user_id) userIdsToResolve.add(log.old_user_id);
    if (log.new_user_id) userIdsToResolve.add(log.new_user_id);
    if (log.created_by) userIdsToResolve.add(log.created_by);
  });
  auditLogs.forEach((log) => {
    if (log.user_id) userIdsToResolve.add(log.user_id);
  });
  if (lead?.assigned_user_id) userIdsToResolve.add(lead.assigned_user_id);

  // Resolve users
  const userMap = new Map<string, HistoryActor>();
  if (userIdsToResolve.size > 0) {
    (raw.users || []).forEach((user) => {
      if (!userIdsToResolve.has(user.id)) return;
      userMap.set(user.id, {
        id: user.id,
        name: user.name || 'Usuário',
        avatar_url: user.avatar_url || null,
      });
    });
  }

  const dedupedActivityEvents = dedupeActivityEvents(activityEvents);

  // Build unified events from timeline
  const timelineMapped: UnifiedHistoryEvent[] = timelineEvents.map((event) => {
    const meta = asMetadata(event.metadata);
    const actorId = event.user_id || event.actor_user_id;
    const actor = actorId ? (userMap.get(actorId) || null) : null;
    const responseSeconds = metadataNumber(meta.response_seconds);

    return {
      id: `timeline-${event.id}`,
      type: event.event_type,
      label: buildLabel(event.event_type, meta),
      content: buildContent(event.event_type, meta, formatters),
      timestamp: event.created_at || event.event_at || new Date().toISOString(),
      actor: actor ? { id: actor.id, name: actor.name, avatar_url: actor.avatar_url } : null,
      source: 'timeline' as const,
      metadata: meta,
      channel: event.channel || metadataString(meta.channel),
      isAutomation: event.is_automation || false,
      sourceOrigin: metadataString(meta.source) || metadataString(meta.source_label),
      webhookName: metadataString(meta.webhook_name) || metadataString(meta.form_name),
      firstResponseSeconds: event.event_type === 'first_response' ? responseSeconds : null,
    };
  });

  // Track which timeline types exist for deduplication
  const timelineTypesPresent = new Set(timelineEvents.map((event) => event.event_type));
  const activityTypesPresent = new Set(dedupedActivityEvents.map((activity) => activity.type));

  // Enrich timeline lead_created with webhook_name from activity if missing
  const activityLeadCreated = dedupedActivityEvents.find((activity) => activity.type === 'lead_created');
  timelineMapped.forEach((event) => {
    if (event.type === 'lead_created' && !event.webhookName && activityLeadCreated) {
      const actMeta = asMetadata(activityLeadCreated.metadata);
      const wn = metadataString(actMeta.webhook_name) || metadataString(actMeta.form_name);
      if (wn) {
        event.webhookName = wn;
        // Re-build label with enriched metadata
        event.label = buildLabel('lead_created', { ...asMetadata(event.metadata), webhook_name: wn });
      }
    }
  });

  // Build unified events from activities (with deduplication)
  const activityMapped: UnifiedHistoryEvent[] = dedupedActivityEvents
    .filter((activity) => {
      // Always include activity-only types
      if (ACTIVITY_ONLY_TYPES.has(activity.type)) return true;
      if (activity.type === 'lead_reentry' && asMetadata(activity.metadata).entry_type === 'manual_reentry') return true;
      // Skip if timeline already has authority over this type
      if (TIMELINE_AUTHORITY_TYPES.has(activity.type) && timelineTypesPresent.has(activity.type)) return false;
      // Also map stage_change → stage_changed
      if (activity.type === 'stage_change' && timelineTypesPresent.has('stage_changed')) return false;
      return true;
    })
    .map((activity) => {
      const meta = asMetadata(activity.metadata);
      const actorId = activity.user_id;
      const actorFromQuery = activity.user;
      const actor = actorFromQuery || (actorId ? userMap.get(actorId) || null : null);

      return {
        id: `activity-${activity.id}`,
        type: activity.type,
        label: buildLabel(activity.type, meta),
        content: activity.content || buildContent(activity.type, meta, formatters),
        timestamp: activity.created_at,
        actor: actor ? { id: actor.id, name: actor.name, avatar_url: actor.avatar_url || undefined } : null,
        source: 'activity' as const,
        metadata: meta,
        channel: metadataString(meta.channel),
        isAutomation: Boolean(meta.is_automation) || activity.type.startsWith('automation_'),
      };
    });

  const metaFormAnswerMapped: UnifiedHistoryEvent[] = dedupedActivityEvents.flatMap((activity) => {
    if (activity.type !== 'lead_created' && activity.type !== 'lead_reentry') return [];
    const meta = asMetadata(activity.metadata);
    const source = metadataString(meta.source);
    const sourceType = metadataString(meta.source_type);
    if (source !== 'meta' && sourceType !== 'meta_lead_ads') return [];

    const baseTime = new Date(activity.created_at).getTime();
    return extractMetaFormAnswers(meta).map((answer, index) => {
      const timestamp = Number.isFinite(baseTime)
        ? new Date(baseTime + index + 1).toISOString()
        : activity.created_at;
      const answerMetadata: HistoryMetadata = {
        source: 'meta',
        source_type: 'meta_lead_ads',
        question: answer.question,
        answer: answer.answer,
        form_name: metadataString(meta.form_name),
        form_id: metadataString(meta.form_id),
        leadgen_id: metadataString(meta.leadgen_id),
      };

      return {
        id: `meta-answer-${activity.id}-${index}`,
        type: 'meta_form_answer',
        label: buildLabel('meta_form_answer', answerMetadata),
        content: answer.answer,
        timestamp,
        actor: null,
        source: 'activity' as const,
        metadata: answerMetadata,
        channel: 'meta',
        isAutomation: false,
        sourceOrigin: 'meta',
      };
    });
  });

  const webhookFormAnswerMappedFromActivities: UnifiedHistoryEvent[] = dedupedActivityEvents.flatMap((activity) => {
    if (activity.type !== 'lead_created' && activity.type !== 'lead_reentry') return [];
    const meta = asMetadata(activity.metadata);
    const source = metadataString(meta.source);
    const sourceType = metadataString(meta.source_type);
    const payload = metadataRecord(meta.payload);
    const isWebhook = source === 'generic_webhook' || source === 'webhook' || sourceType === 'generic_webhook' || !!payload;
    if (!isWebhook) return [];

    const baseTime = new Date(activity.created_at).getTime();
    return extractWebhookFormAnswers(meta).map((answer, index) => {
      const timestamp = Number.isFinite(baseTime)
        ? new Date(baseTime + index + 1).toISOString()
        : activity.created_at;
      const answerMetadata: HistoryMetadata = {
        source: 'webhook',
        source_type: 'generic_webhook',
        question: answer.question,
        answer: answer.answer,
        webhook_name: metadataString(meta.webhook_name),
        webhook_id: metadataString(meta.webhook_id),
        form_name: metadataString(meta.form_name) || metadataString(meta.webhook_name),
      };

      return {
        id: `webhook-answer-${activity.id}-${index}`,
        type: 'webhook_form_answer',
        label: buildLabel('webhook_form_answer', answerMetadata),
        content: answer.answer,
        timestamp,
        actor: null,
        source: 'activity' as const,
        metadata: answerMetadata,
        channel: 'webhook',
        isAutomation: false,
        sourceOrigin: 'webhook',
      };
    });
  });

  const webhookFormAnswerMappedFromLeadMeta: UnifiedHistoryEvent[] = (() => {
    if (webhookFormAnswerMappedFromActivities.length > 0) return [];
    const rawPayload = metadataRecord(leadMeta?.raw_payload);
    const isWebhook = lead?.source === 'webhook' || leadMeta?.platform === 'webhook' || leadMeta?.source_type === 'generic_webhook';
    if (!isWebhook || !rawPayload) return [];

    const createdAt = leadMeta?.created_at || lead?.created_at || new Date().toISOString();
    const baseTime = new Date(createdAt).getTime();
    return extractWebhookFormAnswers({ raw_payload: rawPayload }).map((answer, index) => {
      const timestamp = Number.isFinite(baseTime) ? new Date(baseTime + index + 1).toISOString() : createdAt;
      const metadata: HistoryMetadata = {
        source: 'webhook',
        source_type: 'generic_webhook',
        question: answer.question,
        answer: answer.answer,
        form_name: leadMeta?.form_name || null,
        form_id: leadMeta?.form_id || null,
      };

      return {
        id: `webhook-answer-lead-meta-${leadMeta?.id || lead?.id || leadId}-${index}`,
        type: 'webhook_form_answer',
        label: buildLabel('webhook_form_answer', metadata),
        content: answer.answer,
        timestamp,
        actor: null,
        source: 'activity' as const,
        metadata,
        channel: 'webhook',
        isAutomation: false,
        sourceOrigin: 'webhook',
      };
    });
  })();

  const metaCreativeMappedFromActivities: UnifiedHistoryEvent[] = dedupedActivityEvents.flatMap((activity) => {
    if (activity.type !== 'lead_created' && activity.type !== 'lead_reentry') return [];
    const meta = asMetadata(activity.metadata);
    const source = metadataString(meta.source);
    const sourceType = metadataString(meta.source_type);
    if (source !== 'meta' && sourceType !== 'meta_lead_ads') return [];

    const creative = extractMetaCreative(meta as Record<string, unknown>);
    if (!creative) return [];

    const baseTime = new Date(activity.created_at).getTime();
    const timestamp = Number.isFinite(baseTime)
      ? new Date(baseTime + 1).toISOString()
      : activity.created_at;
    const creativeMetadata: HistoryMetadata = {
      source: 'meta',
      source_type: 'meta_lead_ads',
      creative_name: creative.name,
      ad_name: creative.adName,
      campaign_name: creative.campaignName || metadataString(meta.campaign_name),
      adset_name: creative.adsetName || metadataString(meta.adset_name),
      creative_type: creative.type,
      creative_url: creative.imageUrl,
      creative_video_url: creative.videoUrl,
      creative_link_url: creative.linkUrl,
      creative_instagram_url: creative.instagramUrl,
      creative_destination_url: creative.destinationUrl,
      form_name: creative.formName || metadataString(meta.form_name),
      form_id: metadataString(meta.form_id),
      leadgen_id: metadataString(meta.leadgen_id),
    };

    return [{
      id: `meta-creative-${activity.id}`,
      type: 'meta_creative',
      label: buildLabel('meta_creative', creativeMetadata),
      content: creative.name || creative.adName || creative.campaignName || creative.adsetName || creative.formName || 'Criativo do anuncio',
      timestamp,
      actor: null,
      source: 'activity' as const,
      metadata: creativeMetadata,
      channel: 'meta',
      isAutomation: false,
      sourceOrigin: 'meta',
    }];
  });

  const metaCreativeMappedFromLeadMeta: UnifiedHistoryEvent[] = (() => {
    if (metaCreativeMappedFromActivities.length > 0) return [];
    const creative = extractMetaCreative(leadMeta as Record<string, unknown> | null);
    if (!creative) return [];

    const createdAt = leadMeta?.created_at || lead?.created_at || new Date().toISOString();
    const baseTime = new Date(createdAt).getTime();
    const timestamp = Number.isFinite(baseTime) ? new Date(baseTime + 1).toISOString() : createdAt;
    const metadata: HistoryMetadata = {
      source: 'meta',
      source_type: 'meta_lead_ads',
      creative_name: creative.name,
      ad_name: creative.adName,
      campaign_name: creative.campaignName || leadMeta?.campaign_name || null,
      adset_name: creative.adsetName || leadMeta?.adset_name || null,
      creative_type: creative.type,
      creative_url: creative.imageUrl,
      creative_video_url: creative.videoUrl,
      creative_link_url: creative.linkUrl,
      creative_instagram_url: creative.instagramUrl,
      creative_destination_url: creative.destinationUrl,
      form_name: creative.formName || leadMeta?.form_name || null,
      form_id: leadMeta?.form_id || null,
    };

    return [{
      id: `meta-creative-lead-meta-${leadMeta?.id || lead?.id || leadId}`,
      type: 'meta_creative',
      label: buildLabel('meta_creative', metadata),
      content: creative.name || creative.adName || creative.campaignName || creative.adsetName || creative.formName || 'Criativo do anuncio',
      timestamp,
      actor: null,
      source: 'activity' as const,
      metadata,
      channel: 'meta',
      isAutomation: false,
      sourceOrigin: 'meta',
    }];
  })();

  // Build entry events mapped to unified format
  const entriesMapped: UnifiedHistoryEvent[] = entryEvents
    .filter((entry) => entry.entry_type !== 'initial') // Remove redundancy with "Lead criado"
    .map((entry, index) => ({
      id: `entry-${entry.id}`,
      type: 'lead_reentry',
      label: `${index + 2}ª Entrada`, // First re-entry is the 2nd entry
      content: `Origem: ${entry.source}${entry.campaign_name ? ` | Campanha: ${entry.campaign_name}` : ''}`,
      timestamp: entry.created_at,
      actor: null,
      source: 'timeline' as const,
      metadata: { ...entry },
      channel: entry.source,
      isAutomation: false,
    }));

  const distributionMapped: UnifiedHistoryEvent[] = distributionLogs
    .filter((log) => {
      if (!log.round_robin_id && !log.assigned_user_id && !log.reason) return false;
      const hasTimelineQueue = timelineEvents.some((event) => {
        const meta = asMetadata(event.metadata);
        return event.event_type === 'lead_assigned'
          && (meta.distribution_queue_id === log.round_robin_id || meta.queue_id === log.round_robin_id);
      });
      return !hasTimelineQueue;
    })
    .map((log) => {
      const queueName = log.queue?.name || null;
      const assignedUser = log.assigned_user || (log.assigned_user_id ? userMap.get(log.assigned_user_id) : null);
      const assignedName = assignedUser?.name || null;
      const success = !!log.assigned_user_id;
      const reason = log.reason || null;
      const metadata: HistoryMetadata = {
        queue_id: log.round_robin_id,
        distribution_queue_id: log.round_robin_id,
        queue_name: queueName,
        distribution_queue_name: queueName,
        assigned_user_id: log.assigned_user_id,
        assigned_user_name: assignedName,
        to_user_id: log.assigned_user_id,
        to_user_name: assignedName,
        reason,
        is_initial_distribution: true,
      };

      return {
        id: `distribution-${log.id}`,
        type: 'lead_assigned',
        label: success
          ? buildLabel('lead_assigned', metadata)
          : queueName
            ? `Fila "${queueName}" sem distribuição`
            : 'Sem fila de distribuição compatível',
        content: success ? undefined : reason || undefined,
        timestamp: log.created_at,
        actor: assignedUser ? { id: assignedUser.id, name: assignedUser.name, avatar_url: assignedUser.avatar_url || null } : null,
        source: 'timeline' as const,
        metadata,
        channel: null,
        isAutomation: true,
      };
    });

  const assignmentMapped: UnifiedHistoryEvent[] = assignmentLogs
    .filter((log) => {
      return !distributionMapped.some((event) => {
        const meta = asMetadata(event.metadata);
        const sameUser = metadataString(meta.to_user_id) === log.new_user_id;
        const sameReason = metadataString(meta.reason) === log.reason || metadataString(meta.queue_id) === metadataString(log.reason);
        const distance = Math.abs(new Date(event.timestamp).getTime() - new Date(log.created_at).getTime());
        return sameUser && (sameReason || distance < 5000);
      });
    })
    .map((log) => {
      const oldUser = log.old_user || (log.old_user_id ? userMap.get(log.old_user_id) : null);
      const newUser = log.new_user || (log.new_user_id ? userMap.get(log.new_user_id) : null);
      const actor = log.actor || (log.created_by ? userMap.get(log.created_by) : null);
      const metadata: HistoryMetadata = {
        from_user_id: log.old_user_id,
        from_user_name: oldUser?.name || null,
        to_user_id: log.new_user_id,
        to_user_name: newUser?.name || null,
        transferred_by_id: actor?.id || log.created_by || null,
        transferred_by_name: actor?.name || null,
        reason: log.reason,
        is_automation: log.reason !== 'manual_transfer',
      };
      const normalizedReason = metadataString(log.reason)?.toLowerCase();
      const content = normalizedReason && ![
        'manual_transfer',
        'round_robin',
        'round_robin_auto',
        'canonical_round_robin',
      ].includes(normalizedReason)
        ? `Motivo: ${log.reason}`
        : undefined;

      return {
        id: `assignment-${log.id}`,
        type: 'assignee_changed',
        label: buildLabel('assignee_changed', metadata),
        content,
        timestamp: log.created_at,
        actor: actor ? { id: actor.id, name: actor.name, avatar_url: actor.avatar_url || null } : null,
        source: 'timeline' as const,
        metadata,
        channel: null,
        isAutomation: log.reason !== 'manual_transfer',
      };
    });

  const fallbackEvents: UnifiedHistoryEvent[] = [];
  const hasLeadCreated = timelineTypesPresent.has('lead_created') || activityTypesPresent.has('lead_created');
  if (lead && !hasLeadCreated) {
    const label = sourceLabel(lead.source);
    fallbackEvents.push({
      id: `lead-fallback-created-${lead.id}`,
      type: 'lead_created',
      label: buildLabel('lead_created', { source: lead.source, source_label: label }),
      content: label ? `Origem: ${label}` : undefined,
      timestamp: lead.created_at,
      actor: null,
      source: 'timeline' as const,
      metadata: { source: lead.source, source_label: label, utm_source: lead.utm_source },
      channel: lead.source || null,
      isAutomation: false,
      sourceOrigin: lead.source || null,
    });
  }

  const hasAssignmentEvent =
    timelineTypesPresent.has('lead_assigned') ||
    timelineTypesPresent.has('assignee_changed') ||
    activityTypesPresent.has('assignee_changed') ||
    assignmentMapped.length > 0 ||
    distributionMapped.length > 0;
  if (lead?.assigned_user_id && !hasAssignmentEvent) {
    const assignedUser = lead.assigned_user || userMap.get(lead.assigned_user_id);
    const assignedName = assignedUser?.name || 'Responsável atual';
    fallbackEvents.push({
      id: `lead-fallback-assigned-${lead.id}`,
      type: 'lead_assigned',
      label: `Atribuído a ${assignedName}`,
      content: 'Registro sem fila de distribuição vinculada',
      timestamp: lead.assigned_at || lead.created_at,
      actor: assignedUser ? { id: assignedUser.id, name: assignedUser.name, avatar_url: assignedUser.avatar_url || null } : null,
      source: 'timeline' as const,
      metadata: {
        assigned_user_id: lead.assigned_user_id,
        assigned_user_name: assignedName,
        to_user_id: lead.assigned_user_id,
        to_user_name: assignedName,
        source: lead.source,
        source_label: sourceLabel(lead.source),
      },
      channel: null,
      isAutomation: false,
    });
  }

  const auditMapped: UnifiedHistoryEvent[] = auditLogs
    .map((audit) => ({ audit, keys: auditVisibleKeys(audit, activityEvents) }))
    .filter(({ audit, keys }) => {
      const eventType = auditEventType(audit.action, keys);
      if (eventType === 'lead_created' && hasLeadCreated) return false;
      if (
        audit.action === 'move_stage' &&
        (timelineTypesPresent.has('stage_changed') || activityTypesPresent.has('stage_change'))
      ) {
        return false;
      }
      return audit.action === 'create' || audit.action === 'delete' || keys.length > 0;
    })
    .map(({ audit, keys }) => {
      const eventType = auditEventType(audit.action, keys);
      const oldData = asMetadata(audit.old_data);
      const newData = asMetadata(audit.new_data);
      const toUserId = metadataString(newData.assigned_user_id);
      const fromUserId = metadataString(oldData.assigned_user_id);
      const toUser = toUserId ? userMap.get(toUserId) : null;
      const fromUser = fromUserId ? userMap.get(fromUserId) : null;
      const actor = audit.actor || (audit.user_id ? userMap.get(audit.user_id) : null);
      const metadata: HistoryMetadata = {
        ...newData,
        audit_action: audit.action,
        old_data: oldData,
        new_data: newData,
        from_user_id: fromUserId,
        from_user_name: fromUser?.name || null,
        to_user_id: toUserId,
        to_user_name: toUser?.name || null,
        from_status: metadataString(oldData.deal_status),
        to_status: metadataString(newData.deal_status),
        old_stage_id: metadataString(oldData.stage_id),
        new_stage_id: metadataString(newData.stage_id),
      };

      return {
        id: `audit-${audit.id}`,
        type: eventType,
        label: buildLabel(eventType, metadata),
        content: auditContent(audit.action, keys, oldData, newData, formatters.formatPropertyCurrency),
        timestamp: audit.created_at,
        actor: actor ? { id: actor.id, name: actor.name, avatar_url: actor.avatar_url || null } : null,
        source: 'activity' as const,
        metadata,
        channel: null,
        isAutomation: false,
      };
    });

  // Merge and sort chronologically (oldest first)
  return [
    ...fallbackEvents,
    ...timelineMapped,
    ...activityMapped,
    ...assignmentMapped,
    ...auditMapped,
    ...metaCreativeMappedFromActivities,
    ...metaCreativeMappedFromLeadMeta,
    ...metaFormAnswerMapped,
    ...webhookFormAnswerMappedFromActivities,
    ...webhookFormAnswerMappedFromLeadMeta,
    ...entriesMapped,
    ...distributionMapped,
  ].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}
