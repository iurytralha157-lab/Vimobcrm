
export type HistoryMetadata = Record<string, unknown>;

export type LeadHistoryFormatters = {
  formatCurrency: (value: number) => string;
  formatPropertyCurrency: (value: number) => string;
  formatResponseTime: (seconds: number) => string;
};

export type HistoryActor = {
  id: string;
  name: string;
  avatar_url?: string | null;
};

export type TimelineEventRow = {
  id: string;
  event_type: string;
  title?: string | null;
  description?: string | null;
  metadata?: HistoryMetadata | null;
  user_id?: string | null;
  actor_user_id?: string | null;
  created_at?: string | null;
  event_at?: string | null;
  channel?: string | null;
  is_automation?: boolean | null;
};

export type ActivityEventRow = {
  id: string;
  type: string;
  content?: string | null;
  created_at: string;
  metadata?: HistoryMetadata | null;
  user_id?: string | null;
  user?: HistoryActor | null;
};

export type LeadEntryEventRow = {
  id: string;
  entry_type?: string | null;
  source?: string | null;
  campaign_name?: string | null;
  created_at: string;
};

export type DistributionLogRow = {
  id: string;
  round_robin_id?: string | null;
  assigned_user_id?: string | null;
  reason?: string | null;
  created_at: string;
  queue?: { id: string; name?: string | null } | null;
  assigned_user?: HistoryActor | null;
};

export type AssignmentLogRow = {
  id: string;
  old_user_id?: string | null;
  new_user_id?: string | null;
  reason?: string | null;
  created_by?: string | null;
  created_at: string;
  old_user?: HistoryActor | null;
  new_user?: HistoryActor | null;
  actor?: HistoryActor | null;
};

export type AuditLogRow = {
  id: string;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  old_data?: HistoryMetadata | null;
  new_data?: HistoryMetadata | null;
  user_id?: string | null;
  created_at: string;
  actor?: HistoryActor | null;
};

export type LeadMetaHistoryRow = {
  id?: string | null;
  lead_id?: string | null;
  page_id?: string | null;
  form_id?: string | null;
  form_name?: string | null;
  ad_id?: string | null;
  ad_name?: string | null;
  adset_id?: string | null;
  adset_name?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  platform?: string | null;
  source_type?: string | null;
  creative_name?: string | null;
  creative_type?: string | null;
  creative_thumbnail_url?: string | null;
  creative_url?: string | null;
  creative_video_url?: string | null;
  creative_instagram_url?: string | null;
  creative_destination_url?: string | null;
  raw_payload?: Record<string, unknown> | null;
  created_at?: string | null;
};

export type LeadHistoryLead = {
  id: string;
  source?: string | null;
  utm_source?: string | null;
  assigned_user_id?: string | null;
  assigned_at?: string | null;
  created_at: string;
  assigned_user?: HistoryActor | null;
};

export type LeadHistoryRaw = {
  timelineEvents?: TimelineEventRow[];
  activityEvents?: ActivityEventRow[];
  entryEvents?: LeadEntryEventRow[];
  lead?: LeadHistoryLead | null;
  leadMeta?: LeadMetaHistoryRow | null;
  distributionLogs?: DistributionLogRow[];
  assignmentLogs?: AssignmentLogRow[];
  auditLogs?: AuditLogRow[];
  users?: HistoryActor[];
};

export interface UnifiedHistoryEvent {
  id: string;
  type: string;
  label: string;
  content?: string | null;
  timestamp: string;
  actor?: {
    id: string;
    name: string;
    avatar_url?: string | null;
  } | null;
  source: 'timeline' | 'activity';
  metadata?: HistoryMetadata | null;
  channel?: string | null;
  isAutomation?: boolean;
  // enriched fields
  sourceOrigin?: string | null; // 'meta_ads' | 'whatsapp' | 'website' | 'manual' | 'webhook' | etc.
  webhookName?: string | null;
  firstResponseSeconds?: number | null;
}
