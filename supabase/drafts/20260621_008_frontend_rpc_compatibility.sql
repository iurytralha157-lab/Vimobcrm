-- Vimob CRM - DRAFT ONLY - frontend RPC compatibility
-- Do not run before review.
-- Purpose:
--   1. cover RPCs already called by the frontend;
--   2. keep privileged work in private schema;
--   3. avoid automatic external sends from database code.

create or replace function private.get_current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.organization_id
  from public.users u
  where u.id = auth.uid()
$$;

create or replace function public.user_has_permission(p_permission_key text, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security invoker
as $$
  select coalesce((
    select private.is_super_admin()
      or private.has_permission(u.organization_id, p_permission_key)
    from public.users u
    where u.id = coalesce(p_user_id, auth.uid())
      and (
        u.id = auth.uid()
        or private.has_org_role(u.organization_id, array['owner', 'admin'])
        or private.is_super_admin()
      )
  ), false)
$$;

create or replace function public.is_team_leader(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security invoker
as $$
  select coalesce(exists (
    select 1
    from public.team_members tm
    where tm.user_id = coalesce(check_user_id, auth.uid())
      and tm.is_leader = true
      and tm.is_active = true
      and private.is_org_member(tm.organization_id)
  ), false)
$$;

create or replace function public.get_user_led_team_ids()
returns uuid[]
language sql
stable
security invoker
as $$
  select coalesce(array_agg(tm.team_id), array[]::uuid[])
  from public.team_members tm
  where tm.user_id = auth.uid()
    and tm.is_leader = true
    and tm.is_active = true
    and private.is_org_member(tm.organization_id)
$$;

create or replace function public.get_dashboard_team_lead_ids(
  p_team_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null
)
returns table(lead_id uuid)
language sql
stable
security invoker
as $$
  select l.id
  from public.leads l
  join public.team_members tm
    on tm.user_id = l.assigned_user_id
   and tm.team_id = p_team_id
   and tm.is_active = true
  where private.can_access_lead(l.organization_id, l.assigned_user_id)
    and (p_date_from is null or l.created_at >= p_date_from)
    and (p_date_to is null or l.created_at <= p_date_to)
$$;

create or replace function public.count_unique_sessions(
  p_organization_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz
)
returns integer
language sql
stable
security invoker
as $$
  select count(distinct le.session_id)::integer
  from public.lead_events le
  where le.organization_id = p_organization_id
    and private.is_org_member(le.organization_id)
    and le.session_id is not null
    and le.created_at >= p_date_from
    and le.created_at <= p_date_to
$$;

create or replace function public.get_dashboard_stats()
returns jsonb
language sql
stable
security invoker
as $$
  with scoped_leads as (
    select l.*
    from public.leads l
    where private.can_access_lead(l.organization_id, l.assigned_user_id)
  )
  select jsonb_build_object(
    'totalLeads', count(*),
    'leadsInProgress', count(*) filter (where coalesce(deal_status, 'open') = 'open'),
    'leadsClosed', count(*) filter (where deal_status = 'won'),
    'leadsLost', count(*) filter (where deal_status = 'lost'),
    'leadsTrend', 0,
    'closedTrend', 0
  )
  from scoped_leads
$$;

create or replace function public.get_funnel_data(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_team_id uuid default null,
  p_user_id uuid default null,
  p_source text default null,
  p_pipeline_id uuid default null,
  p_tag_id uuid default null,
  p_deal_status text default null
)
returns table(stage_name text, lead_count bigint, stage_key text)
language sql
stable
security invoker
as $$
  with team_users as (
    select tm.user_id
    from public.team_members tm
    where p_team_id is not null
      and tm.team_id = p_team_id
      and tm.is_active = true
  ),
  scoped_stages as (
    select s.id, s.name, s.stage_key, s.position
    from public.stages s
    where private.is_org_member(s.organization_id)
      and (p_pipeline_id is null or s.pipeline_id = p_pipeline_id)
      and s.is_active = true
  ),
  scoped_leads as (
    select l.*
    from public.leads l
    where private.can_access_lead(l.organization_id, l.assigned_user_id)
      and (p_date_from is null or l.created_at >= p_date_from)
      and (p_date_to is null or l.created_at <= p_date_to)
      and (p_user_id is null or l.assigned_user_id = p_user_id)
      and (p_team_id is null or l.assigned_user_id in (select user_id from team_users))
      and (p_source is null or l.source = p_source)
      and (p_deal_status is null or l.deal_status = p_deal_status)
      and (p_tag_id is null or exists (
        select 1 from public.lead_tags lt where lt.lead_id = l.id and lt.tag_id = p_tag_id
      ))
  )
  select ss.name, count(sl.id), coalesce(ss.stage_key, ss.name)
  from scoped_stages ss
  left join scoped_leads sl on sl.stage_id = ss.id
  group by ss.id, ss.name, ss.stage_key, ss.position
  order by ss.position asc
$$;

create or replace function public.get_lead_sources_data(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_team_id uuid default null,
  p_user_id uuid default null,
  p_source text default null,
  p_pipeline_id uuid default null,
  p_tag_id uuid default null,
  p_deal_status text default null
)
returns table(source_name text, lead_count bigint)
language sql
stable
security invoker
as $$
  with team_users as (
    select tm.user_id
    from public.team_members tm
    where p_team_id is not null
      and tm.team_id = p_team_id
      and tm.is_active = true
  )
  select coalesce(l.source, 'manual') as source_name, count(*) as lead_count
  from public.leads l
  where private.can_access_lead(l.organization_id, l.assigned_user_id)
    and (p_date_from is null or l.created_at >= p_date_from)
    and (p_date_to is null or l.created_at <= p_date_to)
    and (p_user_id is null or l.assigned_user_id = p_user_id)
    and (p_team_id is null or l.assigned_user_id in (select user_id from team_users))
    and (p_source is null or l.source = p_source)
    and (p_pipeline_id is null or exists (
      select 1 from public.stages s where s.id = l.stage_id and s.pipeline_id = p_pipeline_id
    ))
    and (p_tag_id is null or exists (
      select 1 from public.lead_tags lt where lt.lead_id = l.id and lt.tag_id = p_tag_id
    ))
    and (p_deal_status is null or l.deal_status = p_deal_status)
  group by coalesce(l.source, 'manual')
  order by count(*) desc
$$;

create or replace function public.list_contacts_paginated(
  p_search text default null,
  p_team_id uuid default null,
  p_pipeline_id uuid default null,
  p_stage_id uuid default null,
  p_assignee_id uuid default null,
  p_unassigned boolean default false,
  p_tag_id uuid default null,
  p_source text default null,
  p_deal_status text default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_sort_by text default 'created_at',
  p_sort_dir text default 'desc',
  p_page integer default 1,
  p_limit integer default 25,
  p_campaign_id text default null,
  p_adset_id text default null,
  p_ad_id text default null
)
returns table(
  id uuid,
  name text,
  phone text,
  email text,
  whatsapp_avatar_url text,
  pipeline_id uuid,
  pipeline_name text,
  stage_id uuid,
  stage_name text,
  stage_color text,
  assigned_user_id uuid,
  assignee_name text,
  assignee_avatar text,
  source text,
  created_at timestamptz,
  sla_status text,
  last_interaction_at timestamptz,
  last_interaction_preview text,
  last_interaction_channel text,
  tags jsonb,
  total_count bigint,
  deal_status text,
  lost_reason text,
  last_entry_at timestamptz,
  reentry_count integer
)
language sql
stable
security invoker
as $$
  with team_users as (
    select tm.user_id
    from public.team_members tm
    where p_team_id is not null
      and tm.team_id = p_team_id
      and tm.is_active = true
  ),
  filtered as (
    select
      l.*,
      p.name as pipeline_name,
      s.name as stage_name,
      s.color as stage_color,
      u.name as assignee_name,
      u.avatar_url as assignee_avatar,
      lm.campaign_id,
      lm.campaign_name,
      lm.adset_id,
      lm.adset_name,
      lm.ad_id,
      lm.ad_name,
      count(*) over() as total_count
    from public.leads l
    left join public.pipelines p on p.id = l.pipeline_id
    left join public.stages s on s.id = l.stage_id
    left join public.users u on u.id = l.assigned_user_id
    left join public.lead_meta lm on lm.lead_id = l.id
    where private.can_access_lead(l.organization_id, l.assigned_user_id)
      and (p_search is null or p_search = '' or l.name ilike '%' || p_search || '%' or l.email ilike '%' || p_search || '%' or l.phone ilike '%' || p_search || '%')
      and (p_team_id is null or l.assigned_user_id in (select user_id from team_users))
      and (p_pipeline_id is null or l.pipeline_id = p_pipeline_id)
      and (p_stage_id is null or l.stage_id = p_stage_id)
      and (p_assignee_id is null or l.assigned_user_id = p_assignee_id)
      and (p_unassigned = false or l.assigned_user_id is null)
      and (p_tag_id is null or exists (select 1 from public.lead_tags lt where lt.lead_id = l.id and lt.tag_id = p_tag_id))
      and (p_source is null or l.source = p_source)
      and (p_deal_status is null or l.deal_status = p_deal_status)
      and (p_created_from is null or l.created_at >= p_created_from)
      and (p_created_to is null or l.created_at <= p_created_to)
      and (p_campaign_id is null or lm.campaign_id = p_campaign_id or lm.campaign_name = p_campaign_id)
      and (p_adset_id is null or lm.adset_id = p_adset_id or lm.adset_name = p_adset_id)
      and (p_ad_id is null or lm.ad_id = p_ad_id or lm.ad_name = p_ad_id)
  )
  select
    f.id,
    f.name,
    f.phone,
    f.email,
    f.whatsapp_avatar_url,
    f.pipeline_id,
    f.pipeline_name,
    f.stage_id,
    f.stage_name,
    f.stage_color,
    f.assigned_user_id,
    f.assignee_name,
    f.assignee_avatar,
    coalesce(f.source, 'manual') as source,
    f.created_at,
    null::text as sla_status,
    f.last_contact_at as last_interaction_at,
    null::text as last_interaction_preview,
    null::text as last_interaction_channel,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name)
      from public.lead_tags lt
      join public.tags t on t.id = lt.tag_id
      where lt.lead_id = f.id
    ), '[]'::jsonb) as tags,
    f.total_count,
    f.deal_status,
    f.lost_reason,
    f.last_entry_at,
    f.reentry_count
  from filtered f
  order by
    case when p_sort_by = 'name' and p_sort_dir = 'asc' then f.name end asc,
    case when p_sort_by = 'name' and p_sort_dir = 'desc' then f.name end desc,
    case when p_sort_by = 'last_interaction_at' and p_sort_dir = 'asc' then f.last_contact_at end asc nulls last,
    case when p_sort_by = 'last_interaction_at' and p_sort_dir = 'desc' then f.last_contact_at end desc nulls last,
    case when p_sort_by = 'stage' and p_sort_dir = 'asc' then f.stage_name end asc nulls last,
    case when p_sort_by = 'stage' and p_sort_dir = 'desc' then f.stage_name end desc nulls last,
    case when p_sort_dir = 'asc' then f.created_at end asc,
    case when p_sort_dir <> 'asc' then f.created_at end desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, (coalesce(p_page, 1) - 1) * greatest(1, least(coalesce(p_limit, 25), 100)))
$$;

create or replace function private.create_default_stages_for_pipeline_impl(p_org_id uuid, p_pipeline_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'manager']) then
    raise exception 'Sem permissao para criar etapas.';
  end if;

  insert into public.stages (organization_id, pipeline_id, name, stage_key, color, position)
  values
    (p_org_id, p_pipeline_id, 'Novo', 'new', '#FF4529', 0),
    (p_org_id, p_pipeline_id, 'Em atendimento', 'in_progress', '#f59e0b', 1),
    (p_org_id, p_pipeline_id, 'Visita agendada', 'scheduled_visit', '#3b82f6', 2),
    (p_org_id, p_pipeline_id, 'Fechamento', 'closing', '#10b981', 3)
  on conflict do nothing;
end;
$$;

create or replace function public.create_default_stages_for_pipeline(p_org_id uuid, p_pipeline_id uuid)
returns void
language sql
security invoker
as $$
  select private.create_default_stages_for_pipeline_impl(p_org_id, p_pipeline_id)
$$;

create or replace function private.reorder_stages_impl(p_stages jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stage_record record;
  target_org_id uuid;
begin
  for stage_record in
    select *
    from jsonb_to_recordset(p_stages) as x(
      id uuid,
      pipeline_id uuid,
      name text,
      color text,
      position integer,
      stage_key text
    )
  loop
    select p.organization_id
      into target_org_id
    from public.pipelines p
    where p.id = stage_record.pipeline_id;

    if target_org_id is null then
      raise exception 'Pipeline nao encontrada.';
    end if;

    if not private.has_org_role(target_org_id, array['owner', 'admin', 'manager']) then
      raise exception 'Sem permissao para reordenar etapas.';
    end if;

    insert into public.stages (id, organization_id, pipeline_id, name, color, position, stage_key)
    values (
      stage_record.id,
      target_org_id,
      stage_record.pipeline_id,
      stage_record.name,
      stage_record.color,
      coalesce(stage_record.position, 0),
      stage_record.stage_key
    )
    on conflict (id) do update set
      name = excluded.name,
      color = excluded.color,
      position = excluded.position,
      stage_key = excluded.stage_key,
      updated_at = now();
  end loop;
end;
$$;

create or replace function public.reorder_stages(p_stages jsonb)
returns void
language sql
security invoker
as $$
  select private.reorder_stages_impl(p_stages)
$$;

create or replace function private.transfer_lead_assignee_impl(p_lead_id uuid, p_assigned_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_lead record;
begin
  select *
    into current_lead
  from public.leads
  where id = p_lead_id;

  if current_lead.id is null then
    raise exception 'Lead nao encontrado.';
  end if;

  if not (
    private.has_permission(current_lead.organization_id, 'lead_transfer')
    or private.has_permission(current_lead.organization_id, 'lead_manage')
    or current_lead.assigned_user_id = auth.uid()
    or private.has_org_role(current_lead.organization_id, array['owner', 'admin', 'manager'])
  ) then
    raise exception 'Sem permissao para transferir lead.';
  end if;

  if p_assigned_user_id is not null and not exists (
    select 1
    from public.organization_members om
    where om.organization_id = current_lead.organization_id
      and om.user_id = p_assigned_user_id
      and om.is_active = true
  ) then
    raise exception 'Usuario destino nao pertence a organizacao.';
  end if;

  update public.leads
  set assigned_user_id = p_assigned_user_id,
      assigned_at = case when p_assigned_user_id is null then null else now() end,
      updated_at = now()
  where id = p_lead_id;

  insert into public.assignments_log (organization_id, lead_id, old_user_id, new_user_id, reason, created_by)
  values (current_lead.organization_id, p_lead_id, current_lead.assigned_user_id, p_assigned_user_id, 'manual_transfer', auth.uid());
end;
$$;

create or replace function public.transfer_lead_assignee(p_lead_id uuid, p_assigned_user_id uuid default null)
returns void
language sql
security invoker
as $$
  select private.transfer_lead_assignee_impl(p_lead_id, p_assigned_user_id)
$$;

create or replace function private.move_lead_stage_impl(
  p_lead_id uuid,
  p_stage_id uuid,
  p_is_own_resource boolean default null,
  p_stage_entered_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_lead record;
  target_stage record;
  moved_lead jsonb;
begin
  select *
    into current_lead
  from public.leads
  where id = p_lead_id;

  select *
    into target_stage
  from public.stages
  where id = p_stage_id;

  if current_lead.id is null or target_stage.id is null then
    raise exception 'Lead ou etapa nao encontrado.';
  end if;

  if current_lead.organization_id <> target_stage.organization_id then
    raise exception 'Lead e etapa pertencem a organizacoes diferentes.';
  end if;

  if not (
    private.has_permission(current_lead.organization_id, 'lead_manage')
    or current_lead.assigned_user_id = auth.uid()
    or private.has_org_role(current_lead.organization_id, array['owner', 'admin', 'manager'])
  ) then
    raise exception 'Sem permissao para mover lead.';
  end if;

  update public.leads
  set stage_id = target_stage.id,
      pipeline_id = target_stage.pipeline_id,
      stage_entered_at = coalesce(p_stage_entered_at, now()),
      is_own_resource = coalesce(p_is_own_resource, is_own_resource),
      updated_at = now()
  where id = p_lead_id
  returning to_jsonb(public.leads.*) into moved_lead;

  return moved_lead;
end;
$$;

create or replace function public.move_lead_stage(
  p_lead_id uuid,
  p_stage_id uuid,
  p_is_own_resource boolean default null,
  p_stage_entered_at timestamptz default now()
)
returns jsonb
language sql
security invoker
as $$
  select private.move_lead_stage_impl(p_lead_id, p_stage_id, p_is_own_resource, p_stage_entered_at)
$$;

create or replace function public.register_lead_reentry(
  p_lead_id uuid,
  p_org_id uuid,
  p_entry_type text default 'reentry',
  p_source text default 'manual',
  p_property_id uuid default null,
  p_valor_interesse numeric default null,
  p_campaign_name text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security invoker
as $$
begin
  if not exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and l.organization_id = p_org_id
      and private.can_access_lead(l.organization_id, l.assigned_user_id)
  ) then
    raise exception 'Sem permissao para registrar reentrada.';
  end if;

  insert into public.lead_entry_events (
    organization_id,
    lead_id,
    source,
    entry_type,
    property_id,
    valor_interesse,
    campaign_name,
    utm_source,
    utm_medium,
    utm_campaign,
    payload
  )
  values (
    p_org_id,
    p_lead_id,
    coalesce(p_source, 'manual'),
    p_entry_type,
    p_property_id,
    p_valor_interesse,
    p_campaign_name,
    p_utm_source,
    p_utm_medium,
    p_utm_campaign,
    coalesce(p_metadata, '{}'::jsonb)
  );

  update public.leads
  set reentry_count = coalesce(reentry_count, 0) + 1,
      last_entry_at = now(),
      source = coalesce(p_source, source),
      interest_property_id = coalesce(p_property_id, interest_property_id),
      valor_interesse = coalesce(p_valor_interesse, valor_interesse),
      updated_at = now()
  where id = p_lead_id;
end;
$$;

create or replace function private.redistribute_lead_round_robin_impl(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_lead record;
  selected_queue record;
  selected_member record;
begin
  select *
    into current_lead
  from public.leads
  where id = p_lead_id;

  if current_lead.id is null then
    raise exception 'Lead nao encontrado.';
  end if;

  if not (
    private.has_permission(current_lead.organization_id, 'lead_assign')
    or private.has_permission(current_lead.organization_id, 'lead_manage')
    or private.has_org_role(current_lead.organization_id, array['owner', 'admin', 'manager'])
  ) then
    raise exception 'Sem permissao para distribuir lead.';
  end if;

  select rr.*
    into selected_queue
  from public.round_robins rr
  where rr.organization_id = current_lead.organization_id
    and rr.is_active = true
    and (rr.pipeline_id is null or rr.pipeline_id = current_lead.pipeline_id)
  order by rr.pipeline_id is null, rr.created_at asc
  limit 1;

  if selected_queue.id is null then
    return jsonb_build_object('assigned', false, 'reason', 'no_queue');
  end if;

  select rrm.*
    into selected_member
  from public.round_robin_members rrm
  join public.organization_members om
    on om.organization_id = current_lead.organization_id
   and om.user_id = rrm.user_id
   and om.is_active = true
  where rrm.round_robin_id = selected_queue.id
    and rrm.is_active = true
  order by rrm.position asc, rrm.created_at asc
  limit 1;

  if selected_member.id is null then
    return jsonb_build_object('assigned', false, 'reason', 'no_member');
  end if;

  perform private.transfer_lead_assignee_impl(p_lead_id, selected_member.user_id);

  insert into public.round_robin_logs (organization_id, round_robin_id, lead_id, assigned_user_id, reason, metadata)
  values (
    current_lead.organization_id,
    selected_queue.id,
    p_lead_id,
    selected_member.user_id,
    'round_robin',
    jsonb_build_object('source', 'frontend_rpc_compatibility')
  );

  return jsonb_build_object('assigned', true, 'user_id', selected_member.user_id, 'round_robin_id', selected_queue.id);
end;
$$;

create or replace function public.redistribute_lead_round_robin(p_lead_id uuid)
returns jsonb
language sql
security invoker
as $$
  select private.redistribute_lead_round_robin_impl(p_lead_id)
$$;

create or replace function public.handle_lead_intake(p_lead_id uuid)
returns jsonb
language sql
security invoker
as $$
  -- Safe compatibility wrapper: distribute internally only.
  -- It must not send WhatsApp, email, Meta events or other external notifications.
  select private.redistribute_lead_round_robin_impl(p_lead_id)
$$;

create or replace function public.rebind_whatsapp_conversation_session(
  p_conversation_id uuid,
  p_session_id uuid,
  p_remote_jid text
)
returns public.whatsapp_conversations
language plpgsql
security invoker
as $$
declare
  updated_conversation public.whatsapp_conversations;
begin
  update public.whatsapp_conversations wc
  set session_id = p_session_id,
      remote_jid = coalesce(nullif(p_remote_jid, ''), wc.remote_jid),
      updated_at = now()
  where wc.id = p_conversation_id
    and private.is_org_member(wc.organization_id)
  returning * into updated_conversation;

  if updated_conversation.id is null then
    raise exception 'Conversa WhatsApp nao encontrada ou sem permissao.';
  end if;

  return updated_conversation;
end;
$$;

create or replace function public.find_orphan_team_members()
returns table(member_id uuid, team_id uuid, user_id uuid, team_name text, reason text)
language sql
stable
security invoker
as $$
  select tm.id, tm.team_id, tm.user_id, t.name, 'Usuario sem membership ativo na organizacao'
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  left join public.organization_members om
    on om.organization_id = tm.organization_id
   and om.user_id = tm.user_id
   and om.is_active = true
  where private.has_org_role(tm.organization_id, array['owner', 'admin', 'manager'])
    and om.id is null
$$;

create or replace function public.find_orphan_rr_members()
returns table(member_id uuid, round_robin_id uuid, user_id uuid, queue_name text, reason text)
language sql
stable
security invoker
as $$
  select rrm.id, rrm.round_robin_id, rrm.user_id, rr.name, 'Usuario sem membership ativo na organizacao'
  from public.round_robin_members rrm
  join public.round_robins rr on rr.id = rrm.round_robin_id
  left join public.organization_members om
    on om.organization_id = rrm.organization_id
   and om.user_id = rrm.user_id
   and om.is_active = true
  where private.has_org_role(rrm.organization_id, array['owner', 'admin', 'manager'])
    and om.id is null
$$;

create or replace function public.cleanup_orphan_members()
returns jsonb
language plpgsql
security invoker
as $$
declare
  removed_team integer := 0;
  removed_rr integer := 0;
begin
  delete from public.team_members tm
  where exists (
    select 1
    from public.find_orphan_team_members() o
    where o.member_id = tm.id
  );
  get diagnostics removed_team = row_count;

  delete from public.round_robin_members rrm
  where exists (
    select 1
    from public.find_orphan_rr_members() o
    where o.member_id = rrm.id
  );
  get diagnostics removed_rr = row_count;

  return jsonb_build_object(
    'team_members_removed', removed_team,
    'round_robin_members_removed', removed_rr,
    'executed_at', now()
  );
end;
$$;

create or replace function public.list_all_organizations_admin()
returns table(
  id uuid,
  name text,
  logo_url text,
  is_active boolean,
  subscription_status text,
  max_users integer,
  admin_notes text,
  created_at timestamptz,
  last_access_at timestamptz,
  user_count bigint,
  lead_count bigint
)
language sql
stable
security invoker
as $$
  select
    o.id,
    o.name,
    o.logo_url,
    o.is_active,
    o.subscription_status,
    o.max_users,
    o.admin_notes,
    o.created_at,
    o.last_access_at,
    (select count(*) from public.organization_members om where om.organization_id = o.id and om.is_active = true) as user_count,
    (select count(*) from public.leads l where l.organization_id = o.id) as lead_count
  from public.organizations o
  where private.is_super_admin()
  order by o.created_at desc
$$;

create or replace function public.list_all_users_admin()
returns table(
  id uuid,
  name text,
  email text,
  avatar_url text,
  role text,
  organization_id uuid,
  organization_name text,
  is_active boolean,
  created_at timestamptz
)
language sql
stable
security invoker
as $$
  select
    u.id,
    u.name,
    u.email,
    u.avatar_url,
    u.role,
    u.organization_id,
    o.name as organization_name,
    u.is_active,
    u.created_at
  from public.users u
  left join public.organizations o on o.id = u.organization_id
  where private.is_super_admin()
  order by u.created_at desc
$$;

grant execute on function public.user_has_permission(text, uuid) to authenticated;
grant execute on function public.is_team_leader(uuid) to authenticated;
grant execute on function public.get_user_led_team_ids() to authenticated;
grant execute on function public.get_dashboard_team_lead_ids(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.count_unique_sessions(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.get_dashboard_stats() to authenticated;
grant execute on function public.get_funnel_data(timestamptz, timestamptz, uuid, uuid, text, uuid, uuid, text) to authenticated;
grant execute on function public.get_lead_sources_data(timestamptz, timestamptz, uuid, uuid, text, uuid, uuid, text) to authenticated;
grant execute on function public.list_contacts_paginated(text, uuid, uuid, uuid, uuid, boolean, uuid, text, text, timestamptz, timestamptz, text, text, integer, integer, text, text, text) to authenticated;
grant execute on function public.create_default_stages_for_pipeline(uuid, uuid) to authenticated;
grant execute on function public.reorder_stages(jsonb) to authenticated;
grant execute on function public.transfer_lead_assignee(uuid, uuid) to authenticated;
grant execute on function public.move_lead_stage(uuid, uuid, boolean, timestamptz) to authenticated;
grant execute on function public.register_lead_reentry(uuid, uuid, text, text, uuid, numeric, text, text, text, text, jsonb) to authenticated;
grant execute on function public.redistribute_lead_round_robin(uuid) to authenticated;
grant execute on function public.handle_lead_intake(uuid) to authenticated;
grant execute on function public.rebind_whatsapp_conversation_session(uuid, uuid, text) to authenticated;
grant execute on function public.find_orphan_team_members() to authenticated;
grant execute on function public.find_orphan_rr_members() to authenticated;
grant execute on function public.cleanup_orphan_members() to authenticated;
grant execute on function public.list_all_organizations_admin() to authenticated;
grant execute on function public.list_all_users_admin() to authenticated;
