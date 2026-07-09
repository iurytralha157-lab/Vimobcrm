with latest_group_names as (
  select distinct on (wm.conversation_id)
    wm.conversation_id,
    nullif(trim(wm.metadata->'raw'->'groupData'->>'Name'), '') as group_name
  from public.whatsapp_messages wm
  join public.whatsapp_conversations wc on wc.id = wm.conversation_id
  where wc.is_group = true
    and wm.metadata->'raw'->'groupData'->>'Name' is not null
  order by wm.conversation_id, wm.created_at desc
)
update public.whatsapp_conversations wc
set
  contact_name = latest_group_names.group_name,
  metadata = coalesce(wc.metadata, '{}'::jsonb) || jsonb_build_object('group_name', latest_group_names.group_name),
  updated_at = now()
from latest_group_names
where wc.id = latest_group_names.conversation_id
  and latest_group_names.group_name is not null
  and wc.contact_name is distinct from latest_group_names.group_name;
