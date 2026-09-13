import type { LeadMeta } from '@/hooks/use-lead-meta';
import { getSafeHttpUrl } from '@/lib/safe-http-url';
import type { CampaignTrackingDetails, LeadDetailLead } from './types';

const sourceLabels: Record<string, string> = {
  meta: 'Meta Ads',
  meta_ads: 'Meta Ads',
  site: 'Site',
  website: 'Site',
  manual: 'Manual',
  facebook: 'Facebook',
  instagram: 'Instagram',
  import: 'Importação',
  google: 'Google Ads',
  google_ads: 'Google Ads',
  indicacao: 'Indicação',
  whatsapp: 'WhatsApp',
  webhook: 'Webhook',
  outros: 'Outros',
};

export function getLeadSourceLabel(source: string) {
  return sourceLabels[source] || source;
}

export function metaText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function safeExternalUrl(value: unknown): string | null {
  return getSafeHttpUrl(metaText(value));
}

function firstTrackingText(...values: unknown[]) {
  for (const value of values) {
    const text = metaText(value);
    if (text) return text;
  }

  return null;
}

export function trackingRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeTrackingKey(value: unknown) {
  return metaText(value)?.toLowerCase().replace(/[\s-]+/g, '_') || '';
}

export function isTrackedLeadSource(value: unknown) {
  return ['meta', 'meta_ads', 'facebook', 'instagram', 'google', 'google_ads'].includes(
    normalizeTrackingKey(value),
  );
}

export function trackingSourceLabel(value: unknown) {
  const key = normalizeTrackingKey(value);
  return sourceLabels[key] || metaText(value);
}

export function buildCampaignTrackingDetails(
  leadMeta: LeadMeta | null | undefined,
  lead: LeadDetailLead | null | undefined,
): CampaignTrackingDetails | null {
  if (!lead && !leadMeta) return null;

  const boardMeta = Array.isArray(lead?.lead_meta)
    ? lead.lead_meta.find(
        (meta) =>
          metaText(meta?.campaign_name) ||
          metaText(meta?.campaign_id) ||
          metaText(meta?.adset_name) ||
          metaText(meta?.adset_id) ||
          metaText(meta?.ad_name) ||
          metaText(meta?.ad_id) ||
          metaText(meta?.platform),
      )
    : null;

  const source = metaText(lead?.source);
  const inferredPlatform = isTrackedLeadSource(source) ? normalizeTrackingKey(source) : null;
  const leadRecord = trackingRecord(lead);
  const boardMetaRecord = trackingRecord(boardMeta);
  const rawPayload = trackingRecord(leadMeta?.raw_payload);
  const rawDetails = trackingRecord(rawPayload?.lead_details);
  const rawSourceReferral = trackingRecord(rawPayload?.source_referral);
  const rawReferral = trackingRecord(rawPayload?.referral);

  const details: CampaignTrackingDetails = {
    lead_id: firstTrackingText(leadMeta?.lead_id, lead?.id),
    campaign_name: firstTrackingText(
      leadMeta?.campaign_name,
      boardMeta?.campaign_name,
      rawDetails?.campaign_name,
      rawPayload?.campaign_name,
    ),
    campaign_id: firstTrackingText(
      leadMeta?.campaign_id,
      boardMeta?.campaign_id,
      lead?.meta_campaign_id,
    ),
    adset_name: firstTrackingText(
      leadMeta?.adset_name,
      boardMeta?.adset_name,
      rawDetails?.adset_name,
      rawPayload?.adset_name,
    ),
    adset_id: firstTrackingText(leadMeta?.adset_id, boardMeta?.adset_id, lead?.meta_adset_id),
    ad_name: firstTrackingText(
      leadMeta?.ad_name,
      boardMeta?.ad_name,
      rawDetails?.ad_name,
      rawPayload?.ad_name,
    ),
    ad_id: firstTrackingText(leadMeta?.ad_id, boardMeta?.ad_id, lead?.meta_ad_id),
    form_name: firstTrackingText(
      leadMeta?.form_name,
      boardMetaRecord?.form_name,
      rawDetails?.form_name,
      rawPayload?.form_name,
      leadRecord?.utm_term,
    ),
    form_id: firstTrackingText(
      leadMeta?.form_id,
      rawDetails?.form_id,
      rawPayload?.form_id,
      lead?.meta_form_id,
    ),
    page_id: firstTrackingText(leadMeta?.page_id, rawDetails?.page_id, rawPayload?.page_id),
    page_name: firstTrackingText(rawDetails?.page_name, rawPayload?.page_name),
    leadgen_id: firstTrackingText(rawDetails?.leadgen_id, rawPayload?.leadgen_id),
    platform: firstTrackingText(
      leadMeta?.platform,
      boardMeta?.platform,
      rawDetails?.platform,
      rawPayload?.platform,
      inferredPlatform,
    ),
    source_type: firstTrackingText(leadMeta?.source_type, source),
    created_at: firstTrackingText(leadMeta?.created_at, lead?.created_at),
    utm_source: firstTrackingText(leadMeta?.utm_source, lead?.utm_source),
    utm_medium: firstTrackingText(leadMeta?.utm_medium, lead?.utm_medium),
    utm_campaign: firstTrackingText(leadMeta?.utm_campaign, lead?.utm_campaign),
    utm_content: firstTrackingText(leadMeta?.utm_content, lead?.utm_content),
    utm_term: firstTrackingText(leadMeta?.utm_term, lead?.utm_term),
    contact_notes: firstTrackingText(leadMeta?.contact_notes),
    creative_url: firstTrackingText(leadMeta?.creative_url),
    creative_video_url: firstTrackingText(leadMeta?.creative_video_url),
    creative_instagram_url: firstTrackingText(leadMeta?.creative_instagram_url),
    creative_link_url: firstTrackingText(
      rawPayload?.source_url,
      rawPayload?.creative_link_url,
      rawPayload?.creative_destination_url,
      rawSourceReferral?.source_url,
      rawReferral?.source_url,
      rawDetails?.source_url,
      leadMeta?.creative_instagram_url,
    ),
  };

  return hasLeadTrackingData(details) ? details : null;
}

export function hasLeadTrackingData(
  leadMeta: CampaignTrackingDetails | null | undefined,
) {
  if (!leadMeta) return false;

  return [
    leadMeta.campaign_name,
    leadMeta.campaign_id,
    leadMeta.adset_name,
    leadMeta.adset_id,
    leadMeta.ad_name,
    leadMeta.ad_id,
    leadMeta.form_name,
    leadMeta.form_id,
    leadMeta.page_id,
    leadMeta.page_name,
    leadMeta.leadgen_id,
    leadMeta.utm_source,
    leadMeta.utm_medium,
    leadMeta.utm_campaign,
    leadMeta.utm_content,
    leadMeta.utm_term,
    leadMeta.creative_url,
    leadMeta.creative_video_url,
    leadMeta.creative_instagram_url,
    leadMeta.creative_link_url,
    leadMeta.contact_notes,
  ].some((value) => Boolean(metaText(value))) ||
    isTrackedLeadSource(leadMeta.platform) ||
    isTrackedLeadSource(leadMeta.source_type);
}
