drop policy if exists "Schedule events full detail access"
  on public.schedule_events;

create policy "Schedule events full detail access"
on public.schedule_events
for select
to authenticated
using (
  public.is_super_admin()
  or (
    organization_id = private.get_user_organization_id()
    and (
      coalesce(visibility, 'default') = 'public'
      or user_id = (select auth.uid())
      or private.is_admin()
      or private.is_schedule_event_assignee(id, (select auth.uid()))
    )
  )
);

comment on column public.schedule_events.visibility is
  'Controls agenda event visibility: default shows busy availability to non-participants, public shows permitted details, private is limited to responsible users and administrators.';

create or replace function public.get_schedule_events_secure(
  p_user_id uuid default null::uuid,
  p_lead_id uuid default null::uuid,
  p_start_time timestamptz default null::timestamptz,
  p_end_time timestamptz default null::timestamptz
)
returns table(
  id uuid,
  organization_id uuid,
  user_id uuid,
  lead_id uuid,
  property_id uuid,
  title text,
  description text,
  event_type text,
  start_time timestamptz,
  end_time timestamptz,
  is_all_day boolean,
  location text,
  status text,
  visibility text,
  reminder_minutes integer,
  recurrence_parent_id uuid,
  recurrence_rule text,
  recurrence_until timestamptz,
  recurrence_count integer,
  google_event_id text,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  user_name text,
  user_avatar_url text,
  lead_name text,
  lead_phone text,
  property_title text,
  property_code text,
  completed_by_user_name text,
  assignee_user_ids uuid[],
  is_masked boolean
)
language sql
stable
security definer
set search_path = public
as $function$
  with ctx as (
    select
      auth.uid() as current_user_id,
      public.get_user_organization_id() as current_organization_id,
      public.is_admin() as is_admin,
      public.is_super_admin() as is_super_admin
  ),
  enriched as (
    select
      e.*,
      coalesce(assignees.assignee_ids, array[]::uuid[]) as assignee_ids,
      (
        e.user_id = (select current_user_id from ctx)
        or (select is_admin from ctx)
        or (select is_super_admin from ctx)
        or coalesce(assignees.is_current_user_assignee, false)
      ) as has_full_access
    from public.schedule_events e
    left join lateral (
      select
        array_agg(sea.user_id) filter (where sea.user_id is not null) as assignee_ids,
        bool_or(sea.user_id = (select current_user_id from ctx)) as is_current_user_assignee
      from public.schedule_event_assignees sea
      where sea.event_id = e.id
    ) assignees on true
    where
      ((select is_super_admin from ctx) or e.organization_id = (select current_organization_id from ctx))
      and (p_start_time is null or e.start_time >= p_start_time)
      and (p_end_time is null or e.start_time <= p_end_time)
      and (
        p_user_id is null
        or e.user_id = p_user_id
        or exists (
          select 1
          from public.schedule_event_assignees sea_filter
          where sea_filter.event_id = e.id
            and sea_filter.user_id = p_user_id
        )
      )
  ),
  scoped as (
    select
      enriched.*,
      (
        coalesce(enriched.visibility, 'default') = 'default'
        and not enriched.has_full_access
      ) as masked
    from enriched
    where
      coalesce(enriched.visibility, 'default') in ('default', 'public')
      or enriched.has_full_access
  )
  select
    s.id,
    s.organization_id,
    case when s.masked then null::uuid else s.user_id end,
    case when s.masked then null::uuid else s.lead_id end,
    case when s.masked then null::uuid else s.property_id end,
    case when s.masked then 'Horario ocupado'::text else s.title end,
    case when s.masked then 'Informacao privada'::text else s.description end,
    case when s.masked then 'task'::text else s.event_type end,
    s.start_time,
    s.end_time,
    s.is_all_day,
    case when s.masked then null::text else s.location end,
    s.status,
    s.visibility,
    case when s.masked then null::integer else s.reminder_minutes end,
    case when s.masked then null::uuid else s.recurrence_parent_id end,
    case when s.masked then null::text else s.recurrence_rule end,
    case when s.masked then null::timestamptz else s.recurrence_until end,
    case when s.masked then null::integer else s.recurrence_count end,
    case when s.masked then null::text else s.google_event_id end,
    case when s.masked then null::uuid else s.completed_by end,
    case when s.masked then null::timestamptz else s.completed_at end,
    s.created_at,
    s.updated_at,
    case when s.masked then null::text else u.name end,
    case when s.masked then null::text else u.avatar_url end,
    case when s.masked then null::text else l.name end,
    case when s.masked then null::text else l.phone end,
    case when s.masked then null::text else p.title end,
    case when s.masked then null::text else p.code end,
    case when s.masked then null::text else completed_user.name end,
    case when s.masked then array[]::uuid[] else s.assignee_ids end,
    s.masked
  from scoped s
  left join public.users u on u.id = s.user_id
  left join public.leads l on l.id = s.lead_id
  left join public.properties p on p.id = s.property_id
  left join public.users completed_user on completed_user.id = s.completed_by
  where p_lead_id is null or (not s.masked and s.lead_id = p_lead_id)
  order by s.start_time asc;
$function$;
