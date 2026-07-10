-- Repair conversations created with opaque WhatsApp identifiers (@lid, @status, etc).
--
-- The webhook now stores identity aliases, but old rows may still be visible as
-- separate conversations. This data repair keeps messages, promotes rows with a
-- safe canonical JID, and softly merges rows when the canonical conversation
-- already exists.

begin;

create temp table tmp_whatsapp_opaque_conversation_matches on commit drop as
with alias_candidates as (
  select distinct on (wc.id)
    wc.id as conversation_id,
    wc.organization_id,
    wc.session_id,
    wc.remote_jid as legacy_remote_jid,
    wc.contact_phone as legacy_contact_phone,
    wc.lead_id as legacy_lead_id,
    wc.assigned_user_id as legacy_assigned_user_id,
    wc.last_message as legacy_last_message,
    wc.last_message_at as legacy_last_message_at,
    wc.unread_count as legacy_unread_count,
    a.canonical_jid,
    a.contact_phone,
    a.lead_id as alias_lead_id
  from public.whatsapp_conversations wc
  join public.whatsapp_contact_identity_aliases a
    on a.organization_id = wc.organization_id
   and a.session_id is not distinct from wc.session_id
   and a.alias_jid = wc.remote_jid
  where wc.deleted_at is null
    and coalesce(wc.is_group, false) = false
    and (
      wc.remote_jid like '%@lid'
      or wc.remote_jid like '%@newsletter'
      or wc.remote_jid like '%@broadcast'
      or wc.remote_jid like '%@status'
    )
    and a.canonical_jid is not null
    and a.canonical_jid <> ''
    and a.canonical_jid not like '%@lid'
    and a.canonical_jid not like '%@newsletter'
    and a.canonical_jid not like '%@broadcast'
    and a.canonical_jid not like '%@status'
  order by wc.id, a.last_seen_at desc nulls last, a.first_seen_at desc nulls last
),
with_canonical as (
  select
    ac.*,
    canonical.id as canonical_conversation_id,
    any_conflict.id as conflicting_conversation_id
  from alias_candidates ac
  left join lateral (
    select c.id
    from public.whatsapp_conversations c
    where c.organization_id = ac.organization_id
      and c.session_id is not distinct from ac.session_id
      and c.remote_jid = ac.canonical_jid
      and c.deleted_at is null
      and c.id <> ac.conversation_id
    order by c.last_message_at desc nulls last, c.created_at desc
    limit 1
  ) canonical on true
  left join lateral (
    select c.id
    from public.whatsapp_conversations c
    where c.organization_id = ac.organization_id
      and c.session_id is not distinct from ac.session_id
      and c.remote_jid = ac.canonical_jid
      and c.id <> ac.conversation_id
    order by c.deleted_at asc nulls first, c.last_message_at desc nulls last, c.created_at desc
    limit 1
  ) any_conflict on true
),
ranked as (
  select
    wc.*,
    row_number() over (
      partition by wc.organization_id, wc.session_id, wc.canonical_jid
      order by wc.legacy_last_message_at desc nulls last, wc.conversation_id
    ) as promote_rank,
    first_value(wc.conversation_id) over (
      partition by wc.organization_id, wc.session_id, wc.canonical_jid
      order by wc.legacy_last_message_at desc nulls last, wc.conversation_id
    ) as promoted_conversation_id
  from with_canonical wc
)
select *
from ranked;

-- Move non-duplicated messages from merged opaque conversations to the existing
-- canonical conversation. If the same provider message already exists there, we
-- keep the canonical copy and leave the duplicate behind on the soft-deleted row.
update public.whatsapp_messages wm
set
  conversation_id = m.canonical_conversation_id
from tmp_whatsapp_opaque_conversation_matches m
where m.canonical_conversation_id is not null
  and wm.conversation_id = m.conversation_id
  and not exists (
    select 1
    from public.whatsapp_messages existing
    where existing.conversation_id = m.canonical_conversation_id
      and existing.message_id = wm.message_id
  );

-- Keep the canonical conversation fresh after moving messages.
with latest_merged_message as (
  select distinct on (m.canonical_conversation_id)
    m.canonical_conversation_id,
    wm.content,
    wm.created_at
  from tmp_whatsapp_opaque_conversation_matches m
  join public.whatsapp_messages wm
    on wm.conversation_id = m.canonical_conversation_id
  where m.canonical_conversation_id is not null
  order by m.canonical_conversation_id, wm.created_at desc nulls last
),
merged_sources as (
  select
    m.canonical_conversation_id,
    max(m.legacy_last_message_at) as max_legacy_last_message_at,
    sum(coalesce(m.legacy_unread_count, 0)) as unread_to_add,
    array_agg(m.conversation_id) as merged_conversation_ids
  from tmp_whatsapp_opaque_conversation_matches m
  where m.canonical_conversation_id is not null
  group by m.canonical_conversation_id
)
update public.whatsapp_conversations wc
set
  last_message = coalesce(lmm.content, wc.last_message),
  last_message_at = greatest(
    coalesce(wc.last_message_at, '-infinity'::timestamptz),
    coalesce(lmm.created_at, '-infinity'::timestamptz),
    coalesce(ms.max_legacy_last_message_at, '-infinity'::timestamptz)
  ),
  unread_count = coalesce(wc.unread_count, 0) + coalesce(ms.unread_to_add, 0),
  metadata = coalesce(wc.metadata, '{}'::jsonb) || jsonb_build_object(
    'merged_opaque_conversation_ids',
    coalesce(wc.metadata->'merged_opaque_conversation_ids', '[]'::jsonb) || to_jsonb(ms.merged_conversation_ids)
  ),
  updated_at = now()
from merged_sources ms
left join latest_merged_message lmm
  on lmm.canonical_conversation_id = ms.canonical_conversation_id
where wc.id = ms.canonical_conversation_id;

-- Soft-delete merged opaque conversations.
update public.whatsapp_conversations wc
set
  deleted_at = now(),
  metadata = coalesce(wc.metadata, '{}'::jsonb) || jsonb_build_object(
    'merged_into_conversation_id',
    m.canonical_conversation_id,
    'legacy_remote_jid',
    m.legacy_remote_jid,
    'merge_source',
    'repair_whatsapp_opaque_conversations'
  ),
  updated_at = now()
from tmp_whatsapp_opaque_conversation_matches m
where m.canonical_conversation_id is not null
  and wc.id = m.conversation_id;

-- When multiple opaque conversations resolve to the same canonical JID and no
-- canonical row exists yet, keep one row and merge the others into it before
-- promoting the survivor.
update public.whatsapp_messages wm
set
  conversation_id = m.promoted_conversation_id
from tmp_whatsapp_opaque_conversation_matches m
where m.canonical_conversation_id is null
  and m.conflicting_conversation_id is null
  and m.promote_rank > 1
  and wm.conversation_id = m.conversation_id
  and not exists (
    select 1
    from public.whatsapp_messages existing
    where existing.conversation_id = m.promoted_conversation_id
      and existing.message_id = wm.message_id
  );

with latest_promoted_message as (
  select distinct on (m.promoted_conversation_id)
    m.promoted_conversation_id,
    wm.content,
    wm.created_at
  from tmp_whatsapp_opaque_conversation_matches m
  join public.whatsapp_messages wm
    on wm.conversation_id = m.promoted_conversation_id
  where m.canonical_conversation_id is null
    and m.conflicting_conversation_id is null
    and m.promote_rank > 1
  order by m.promoted_conversation_id, wm.created_at desc nulls last
),
promoted_sources as (
  select
    m.promoted_conversation_id,
    max(m.legacy_last_message_at) as max_legacy_last_message_at,
    sum(coalesce(m.legacy_unread_count, 0)) as unread_to_add,
    array_agg(m.conversation_id) as merged_conversation_ids
  from tmp_whatsapp_opaque_conversation_matches m
  where m.canonical_conversation_id is null
    and m.conflicting_conversation_id is null
    and m.promote_rank > 1
  group by m.promoted_conversation_id
)
update public.whatsapp_conversations wc
set
  last_message = coalesce(lpm.content, wc.last_message),
  last_message_at = greatest(
    coalesce(wc.last_message_at, '-infinity'::timestamptz),
    coalesce(lpm.created_at, '-infinity'::timestamptz),
    coalesce(ps.max_legacy_last_message_at, '-infinity'::timestamptz)
  ),
  unread_count = coalesce(wc.unread_count, 0) + coalesce(ps.unread_to_add, 0),
  metadata = coalesce(wc.metadata, '{}'::jsonb) || jsonb_build_object(
    'merged_opaque_conversation_ids',
    coalesce(wc.metadata->'merged_opaque_conversation_ids', '[]'::jsonb) || to_jsonb(ps.merged_conversation_ids)
  ),
  updated_at = now()
from promoted_sources ps
left join latest_promoted_message lpm
  on lpm.promoted_conversation_id = ps.promoted_conversation_id
where wc.id = ps.promoted_conversation_id;

update public.whatsapp_conversations wc
set
  deleted_at = now(),
  metadata = coalesce(wc.metadata, '{}'::jsonb) || jsonb_build_object(
    'merged_into_conversation_id',
    m.promoted_conversation_id,
    'legacy_remote_jid',
    m.legacy_remote_jid,
    'merge_source',
    'repair_whatsapp_opaque_conversations'
  ),
  updated_at = now()
from tmp_whatsapp_opaque_conversation_matches m
where m.canonical_conversation_id is null
  and m.conflicting_conversation_id is null
  and m.promote_rank > 1
  and wc.id = m.conversation_id;

-- Promote opaque conversations when no other row uses the canonical JID.
update public.whatsapp_conversations wc
set
  remote_jid = m.canonical_jid,
  contact_phone = coalesce(wc.contact_phone, m.contact_phone),
  lead_id = coalesce(
    wc.lead_id,
    case
      when m.alias_lead_id is not null
        and not exists (
          select 1
          from public.whatsapp_conversations existing_lead_conversation
          where existing_lead_conversation.organization_id = wc.organization_id
            and existing_lead_conversation.deleted_at is null
            and existing_lead_conversation.id <> wc.id
            and existing_lead_conversation.lead_id = m.alias_lead_id
        )
      then m.alias_lead_id
      else null
    end
  ),
  metadata = coalesce(wc.metadata, '{}'::jsonb) || jsonb_build_object(
    'legacy_remote_jid',
    m.legacy_remote_jid,
    'whatsapp_identity',
    jsonb_build_object(
      'canonical_jid',
      m.canonical_jid,
      'contact_phone',
      coalesce(wc.contact_phone, m.contact_phone),
      'aliases',
      jsonb_build_array(m.legacy_remote_jid, m.canonical_jid)
    ),
    'merge_source',
    'repair_whatsapp_opaque_conversations'
  ),
  updated_at = now()
from tmp_whatsapp_opaque_conversation_matches m
where m.canonical_conversation_id is null
  and m.conflicting_conversation_id is null
  and m.promote_rank = 1
  and wc.id = m.conversation_id;

commit;
