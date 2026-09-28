-- Read-only classification of at most 500 suppressed canonical messages older
-- than seven days. Every category is HOLD until immutable provider-ID
-- tombstones are enforced by both native and Edge ingestion paths.
-- Aggregate output contains no message, phone, provider ID, or payload.
begin transaction read only;
set local statement_timeout = '10s';

with sample as materialized (
  select m.id, m.organization_id, m.session_id, m.conversation_id,
         m.lead_id, m.message_id, m.provider_message_id, m.message_type,
         m.content, m.media_url, m.media_storage_path, m.metadata
  from public.whatsapp_messages as m
  where m.capture_state = 'suppressed'
    and m.created_at < now() - interval '7 days'
  order by m.created_at, m.id
  limit 500
), classified as (
  select case
    when c.id is null or s.id is null or m.session_id is null
      or c.organization_id is distinct from m.organization_id
      or s.organization_id is distinct from m.organization_id
      or c.session_id is distinct from m.session_id
      then 'identity_mismatch_hold'
    when m.lead_id is not null or c.lead_id is not null
      or exists (
        select 1 from public.whatsapp_conversation_lead_bindings as b
        where b.conversation_id = m.conversation_id
      )
      or exists (
        select 1 from public.whatsapp_attendance_entries as a
        where a.conversation_id = m.conversation_id
      )
      or exists (
        select 1 from public.whatsapp_conversation_routing_heads as h
        where h.conversation_id = m.conversation_id
      )
      then 'lead_history_hold'
    when m.message_type is distinct from 'text'
      or m.content is not null
      or m.media_url is not null
      or m.media_storage_path is not null
      or exists (
        select 1 from public.media_jobs as j where j.message_id = m.id
      )
      then 'content_or_media_hold'
    when m.metadata->>'source' is distinct from 'evolution_go_webhook'
      or m.metadata #>> '{whatsapp_attendance_capture,state}' is distinct from 'suppressed'
      then 'capture_proof_hold'
    when exists (
        select 1 from public.whatsapp_outbox as o where o.message_id = m.id
      )
      or exists (
        select 1 from public.whatsapp_message_reactions as r
        where r.target_message_id = m.id
           or (r.organization_id = m.organization_id
               and r.session_id = m.session_id
               and r.target_provider_message_id in (m.message_id, m.provider_message_id))
      )
      or exists (
        select 1 from public.lead_attachments as a where a.message_id = m.id
      )
      or exists (
        select 1 from public.ai_outbox_messages as o where o.sent_message_id = m.id
      )
      or exists (
        select 1 from private.whatsapp_avatar_jobs as j
        where j.source_message_id = m.id
           or j.last_contact_message_id = m.id
           or j.last_attempt_message_id = m.id
      )
      then 'dependent_effect_hold'
    when exists (
        select 1 from public.whatsapp_webhook_routing_snapshots as route
        where route.organization_id = m.organization_id
          and route.session_id = m.session_id
          and route.provider_message_id in (m.message_id, m.provider_message_id)
      )
      then 'routing_provenance_hold'
    else 'tombstone_required_hold'
  end as reason
  from sample as m
  left join public.whatsapp_conversations as c on c.id = m.conversation_id
  left join public.whatsapp_sessions as s on s.id = m.session_id
)
select reason, count(*) as sampled_rows
from classified
group by reason
order by reason;

commit;
