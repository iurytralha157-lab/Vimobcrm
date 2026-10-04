-- READ ONLY. Do not use these aggregates to start a backfill or a purge.
-- Historical inbox rows may already be gone; a full match among SURVIVING
-- messages cannot prove that no earlier inbound message was once received.
-- Output contains IDs, counts and times only; no phone, content or media URL.
-- Fill BOTH IDs before a local/production read; NULL returns zero rows. Review
-- EXPLAIN first. Advance after_conversation_id with next_after_conversation_id
-- until a batch returns zero rows. Each run examines at most 1,000 contacts.
-- Media counts below cover only conversations in this batch. One legacy URL
-- anywhere else in the organization can hold ALL Storage deletes under the
-- preparatory GC rule. Zero here is not proof of zero organization-wide.
-- A whole-organization URL scan, including media_jobs, needs a separate
-- indexed/EXPLAIN-reviewed query; do not add it to every batch by accident.
with scope as (
  select null::uuid as organization_id,
         null::uuid as session_id,
         null::uuid as after_conversation_id,
         1000::integer as batch_size
), conversations as materialized (
  select conversation.id, conversation.organization_id,
         conversation.session_id, conversation.created_at,
         conversation.contact_picture
  from public.whatsapp_conversations as conversation
  cross join scope
  where scope.organization_id is not null
    and scope.session_id is not null
    and conversation.organization_id = scope.organization_id
    and conversation.session_id = scope.session_id
    and (scope.after_conversation_id is null
         or conversation.id > scope.after_conversation_id)
    and conversation.lead_id is null
    and conversation.deleted_at is null
    and conversation.is_group is not true
    and not exists (
      select 1 from private.whatsapp_nonlead_retention_candidates as candidate
      where candidate.conversation_id = conversation.id
    )
  order by conversation.id
  limit (select batch_size from scope)
), inbound as materialized (
  select conversation.id as conversation_id,
         message.id as message_id,
         message.created_at as recorded_at,
         inbox.created_at as proven_ingress_at
  from conversations as conversation
  left join public.whatsapp_messages as message
    on message.conversation_id = conversation.id
   and message.organization_id = conversation.organization_id
   and message.from_me = false
   and message.direction = 'inbound'
  left join public.whatsapp_webhook_routing_snapshots as snapshot
    on snapshot.organization_id = conversation.organization_id
   and snapshot.session_id = conversation.session_id
   and snapshot.provider_message_id = coalesce(
     nullif(btrim(message.provider_message_id), ''), message.message_id
   )
  left join public.whatsapp_webhook_inbox as inbox
    on inbox.organization_id = snapshot.organization_id
   and inbox.session_id = snapshot.session_id
   and inbox.event_key = snapshot.inbox_event_key
), message_media as (
  select conversation.id as conversation_id,
         count(message.id) filter (
           where message.media_storage_path is not null
         ) as media_paths,
         count(message.id) filter (
           where message.media_storage_path like
             'orgs/' || conversation.organization_id::text || '/assets/v2/%'
         ) as assets_v2_path_refs,
         count(message.id) filter (
           where message.media_storage_path like
             'orgs/' || conversation.organization_id::text || '/sessions/' ||
             conversation.session_id::text || '/incoming/%'
         ) as incoming_path_refs,
         count(message.id) filter (
           where message.media_storage_path is null
             and coalesce(message.media_url, '') ilike '%whatsapp-media%'
             and (coalesce(message.media_url, '') ilike '%assets/v2/%'
                  or coalesce(message.media_url, '') ilike '%assets%2fv2%')
         ) as legacy_assets_v2_url_without_path,
         count(message.id) filter (
           where message.media_storage_path is null
             and coalesce(message.media_url, '') ilike '%whatsapp-media%'
             and (coalesce(message.media_url, '') ilike '%incoming/%'
                  or coalesce(message.media_url, '') ilike '%incoming%2f%')
         ) as legacy_incoming_url_without_path
  from conversations as conversation
  left join public.whatsapp_messages as message
    on message.conversation_id = conversation.id
   and message.organization_id = conversation.organization_id
  group by conversation.id
), outbox_media as (
  select conversation.id as conversation_id,
         count(outbox.id) filter (
           where coalesce(outbox.media_url, '') ilike '%whatsapp-media%'
             and (coalesce(outbox.media_url, '') ilike '%assets/v2/%'
                  or coalesce(outbox.media_url, '') ilike '%assets%2fv2%')
         ) as legacy_outbox_assets_v2_urls,
         count(outbox.id) filter (
           where coalesce(outbox.media_url, '') ilike '%whatsapp-media%'
             and (coalesce(outbox.media_url, '') ilike '%incoming/%'
                  or coalesce(outbox.media_url, '') ilike '%incoming%2f%')
         ) as legacy_outbox_incoming_urls
  from conversations as conversation
  left join public.outbox_messages as outbox
    on outbox.conversation_id = conversation.id
   and outbox.organization_id = conversation.organization_id
  group by conversation.id
), per_conversation as (
  select conversation.id, conversation.organization_id,
         conversation.session_id, conversation.created_at,
         count(inbound.message_id) as surviving_inbound_messages,
         count(inbound.proven_ingress_at) as messages_with_inbox_proof,
         min(inbound.proven_ingress_at) as earliest_proven_ingress_at,
         min(inbound.recorded_at) as earliest_surviving_message_at,
         exists (
           select 1 from public.whatsapp_conversation_lead_bindings as binding
           where binding.conversation_id = conversation.id
         ) or exists (
           select 1 from public.whatsapp_messages as message
           where message.conversation_id = conversation.id
             and message.lead_id is not null
         ) as has_lead_history,
         message_media.media_paths,
         message_media.assets_v2_path_refs,
         message_media.incoming_path_refs,
         message_media.legacy_assets_v2_url_without_path,
         message_media.legacy_incoming_url_without_path,
         outbox_media.legacy_outbox_assets_v2_urls,
         outbox_media.legacy_outbox_incoming_urls,
         case when coalesce(conversation.contact_picture, '') ilike '%whatsapp-media%'
                   and (coalesce(conversation.contact_picture, '') ilike '%assets/v2/%'
                        or coalesce(conversation.contact_picture, '') ilike '%assets%2fv2%')
              then 1 else 0 end as legacy_contact_picture_assets_v2_url,
         case when coalesce(conversation.contact_picture, '') ilike '%whatsapp-media%'
                   and (coalesce(conversation.contact_picture, '') ilike '%incoming/%'
                        or coalesce(conversation.contact_picture, '') ilike '%incoming%2f%')
              then 1 else 0 end as legacy_contact_picture_incoming_url
  from conversations as conversation
  left join inbound on inbound.conversation_id = conversation.id
  left join message_media on message_media.conversation_id = conversation.id
  left join outbox_media on outbox_media.conversation_id = conversation.id
  group by conversation.id, conversation.organization_id,
           conversation.session_id, conversation.created_at,
           conversation.contact_picture,
           message_media.media_paths, message_media.assets_v2_path_refs,
           message_media.incoming_path_refs,
           message_media.legacy_assets_v2_url_without_path,
           message_media.legacy_incoming_url_without_path,
           outbox_media.legacy_outbox_assets_v2_urls,
           outbox_media.legacy_outbox_incoming_urls
), classified as (
  select per_conversation.*,
         case
           when has_lead_history then 'preservar_historico_de_lead'
           when surviving_inbound_messages = 0 then 'sem_inbound_sobrevivente'
           when messages_with_inbox_proof = 0 then 'sem_prova_de_chegada'
           when messages_with_inbox_proof < surviving_inbound_messages
             then 'prova_parcial'
           else 'cobertura_observada_na_inbox'
         end as proof_class
  from per_conversation
)
select organization_id, session_id, proof_class,
       count(*) as conversations,
       (select max(id) from conversations) as next_after_conversation_id,
       sum(surviving_inbound_messages) as surviving_inbound_messages,
       sum(messages_with_inbox_proof) as messages_with_inbox_proof,
       sum(media_paths) as media_paths,
       sum(assets_v2_path_refs) as assets_v2_path_refs,
       sum(incoming_path_refs) as incoming_path_refs,
       sum(legacy_assets_v2_url_without_path)
         as legacy_assets_v2_message_urls_without_path,
       sum(legacy_incoming_url_without_path)
         as legacy_incoming_message_urls_without_path,
       sum(legacy_contact_picture_assets_v2_url)
         as legacy_assets_v2_contact_picture_urls,
       sum(legacy_contact_picture_incoming_url)
         as legacy_incoming_contact_picture_urls,
       sum(legacy_outbox_assets_v2_urls) as legacy_assets_v2_outbox_urls,
       sum(legacy_outbox_incoming_urls) as legacy_incoming_outbox_urls,
       min(earliest_proven_ingress_at) as oldest_proven_ingress_at,
       min(earliest_surviving_message_at) as oldest_surviving_message_at,
       count(*) filter (
         where earliest_proven_ingress_at <= clock_timestamp() - interval '168 hours'
       ) as past_168h_on_proven_earliest_ingress
from classified
group by organization_id, session_id, proof_class
order by conversations desc, organization_id, session_id, proof_class;
