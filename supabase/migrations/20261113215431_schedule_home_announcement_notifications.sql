begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Reconcile the announcement scheduling schema on installations where the
-- earlier additive migration has not landed. Its old SELECT policy is not
-- installed here; this transaction replaces both supported policy names.
alter table public.announcements
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists display_duration_seconds integer;
do $schema$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.announcements'::regclass
      and conname = 'announcements_display_duration_seconds_check'
  ) then
    alter table public.announcements
      add constraint announcements_display_duration_seconds_check
      check (display_duration_seconds is null or display_duration_seconds between 5 and 86400);
  end if;
end;
$schema$;
create index if not exists announcements_active_schedule_idx
  on public.announcements (is_active,show_banner,starts_at,ends_at,created_at desc);
create index if not exists announcements_target_user_ids_idx
  on public.announcements using gin (target_user_ids);
create index if not exists announcements_target_organization_ids_idx
  on public.announcements using gin (target_organization_ids);


do $dependencies$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.notifications'::regclass
      and tgname = 'sync_notification_deliveries_from_notification'
      and tgenabled in ('O','A') and not tgisinternal
  ) then
    raise exception 'Canonical notification outbox trigger is required for announcement scheduling';
  end if;
end;
$dependencies$;
create table private.announcement_notification_jobs (
  announcement_id uuid primary key references public.announcements(id) on delete cascade,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','completed','cancelled','expired')),
  after_user_id uuid,
  after_organization_id uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((after_user_id is null) = (after_organization_id is null)),
  check ((status = 'pending') = (finished_at is null))
);
alter table private.announcement_notification_jobs enable row level security;
revoke all on private.announcement_notification_jobs from public, anon, authenticated, service_role;

create index announcement_notification_jobs_due_idx
  on private.announcement_notification_jobs (due_at, announcement_id)
  where status = 'pending';

comment on table private.announcement_notification_jobs is
  'One server-owned fan-out per explicitly scheduled announcement, with a durable cursor for bounded recipient batches.';

create function private.track_announcement_notification_job()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog'
as $function$
declare
  v_now timestamptz := clock_timestamp();
begin
  if tg_op = 'UPDATE' and row(
    new.starts_at,new.ends_at,new.is_active,new.send_notification,new.target_type,
    new.target_user_ids,new.target_organization_ids,new.message
  ) is not distinct from row(
    old.starts_at,old.ends_at,old.is_active,old.send_notification,old.target_type,
    old.target_user_ids,old.target_organization_ids,old.message
  ) then
    return new;
  end if;

  if new.is_active is not true or new.send_notification is not true or new.starts_at is null
    or (new.ends_at is not null and new.ends_at <= new.starts_at) then
    update private.announcement_notification_jobs
    set status = 'cancelled', finished_at = v_now
    where announcement_id = new.id and status = 'pending';
    return new;
  end if;

  -- Changing a currently enrolled announcement must never keep an outdated
  -- cursor or deadline. Its immutable per-recipient notification key prevents
  -- a second fan-out to recipients already processed before the edit.
  update private.announcement_notification_jobs
  set due_at = new.starts_at, after_user_id = null, after_organization_id = null
  where announcement_id = new.id and status = 'pending';
  if found or new.starts_at <= v_now then
    return new;
  end if;

  -- Only explicit future scheduling/activation may create or re-arm a job.
  -- Unrelated edits cannot enqueue any historical or untracked announcement.
  if tg_op = 'INSERT' or row(new.starts_at,new.is_active,new.send_notification)
    is distinct from row(old.starts_at,old.is_active,old.send_notification) then
    insert into private.announcement_notification_jobs as job (announcement_id,due_at)
    values (new.id,new.starts_at)
    on conflict (announcement_id) do update set
      due_at = excluded.due_at, status = 'pending', finished_at = null,
      after_user_id = null, after_organization_id = null
    where job.status in ('cancelled','expired');
  end if;
  return new;
end;
$function$;
revoke all on function private.track_announcement_notification_job() from public, anon, authenticated, service_role;

create trigger track_announcement_notification_job
after insert or update of starts_at, ends_at, is_active, send_notification, target_type,
  target_user_ids, target_organization_ids, message on public.announcements
for each row execute function private.track_announcement_notification_job();

-- Preserve already scheduled, opted-in future work in environments that had
-- the scheduling columns. Do not replay any past or unscheduled announcement.
insert into private.announcement_notification_jobs (announcement_id,due_at)
select a.id,a.starts_at from public.announcements a
where a.is_active is true and a.send_notification is true
  and a.starts_at > statement_timestamp()
  and (a.ends_at is null or a.ends_at > a.starts_at);

create function private.process_due_announcement_notifications(p_limit integer default 250)
returns table (processed integer, notifications_created integer, more_due boolean)
language plpgsql
security definer
set search_path = 'pg_catalog'
as $function$
declare
  v_limit integer := least(1000,greatest(1,coalesce(p_limit,250)));
  v_now timestamptz := clock_timestamp();
  v_announcement public.announcements%rowtype;
  v_job private.announcement_notification_jobs%rowtype;
  v_expires_at timestamptz;
  v_last_user uuid;
  v_last_organization uuid;
  v_has_more_recipients boolean;
begin
  processed := 0;
  notifications_created := 0;
  more_due := false;

  -- Match the admin mutation order: announcement row before its job.
  -- Only one replica may publish one announcement slice at a time.
  select a.* into v_announcement
  from private.announcement_notification_jobs job
  join public.announcements a on a.id = job.announcement_id
  where job.status = 'pending' and job.due_at <= v_now
  order by job.due_at,job.announcement_id
  limit 1 for update of a skip locked;
  if not found then
    return next;
    return;
  end if;
  select job.* into strict v_job from private.announcement_notification_jobs job
  where job.announcement_id = v_announcement.id for update;
  if v_job.status <> 'pending' or v_job.due_at > v_now then
    return next;
    return;
  end if;

  processed := 1;
  v_expires_at := least(v_job.due_at + interval '1 hour',v_announcement.ends_at);
  if v_announcement.is_active is not true or v_announcement.send_notification is not true
    or v_announcement.starts_at is distinct from v_job.due_at then
    update private.announcement_notification_jobs
    set status = 'cancelled', finished_at = v_now where announcement_id = v_announcement.id;
  elsif v_expires_at <= v_now then
    update private.announcement_notification_jobs
    set status = 'expired', finished_at = v_now where announcement_id = v_announcement.id;
  else
    with eligible as materialized (
      select member.user_id,member.organization_id
      from public.organization_members member
      join public.users app_user on app_user.id = member.user_id and app_user.is_active is true
      join public.organizations organization on organization.id = member.organization_id and organization.is_active is true
      where member.is_active is true and member.deleted_at is null
        and (v_job.after_user_id is null or (member.user_id,member.organization_id) >
          (v_job.after_user_id,v_job.after_organization_id))
        and (
          v_announcement.target_type = 'all'
          or (v_announcement.target_type = 'specific' and member.user_id = any(v_announcement.target_user_ids)
            and (coalesce(cardinality(v_announcement.target_organization_ids),0) = 0
              or member.organization_id = any(v_announcement.target_organization_ids)))
          or (v_announcement.target_type = 'organizations'
            and member.organization_id = any(v_announcement.target_organization_ids))
          or (v_announcement.target_type = 'admins' and lower(btrim(member.role)) in ('owner','admin'))
          or (v_announcement.target_type = 'brokers' and lower(btrim(member.role)) = 'user')
        )
      order by member.user_id,member.organization_id
      limit v_limit + 1
    ), batch as materialized (
      select eligible.user_id,eligible.organization_id from eligible
      order by eligible.user_id,eligible.organization_id limit v_limit
    ), inserted as (
      insert into public.notifications (
        organization_id,user_id,title,content,body,type,channel,target_url,metadata
      )
      select recipient.organization_id,recipient.user_id,'Novo comunicado',v_announcement.message,
        v_announcement.message,'system','in_app','/inicio',jsonb_build_object(
          'event_key','announcement_published',
          'announcement_id',v_announcement.id::text,
          'dedupe_key',concat_ws(':','announcement_published',v_announcement.id::text,
            recipient.organization_id::text,recipient.user_id::text),
          'due_at',v_job.due_at,
          'expires_at',v_expires_at,
          'dispatch',jsonb_build_object('push',jsonb_build_object('required',true,'status','pending'))
        )
      from batch recipient
      on conflict (organization_id,user_id,(metadata->>'dedupe_key'))
      where nullif(metadata->>'dedupe_key','') is not null
      do nothing returning 1
    )
    select (select count(*)::integer from inserted),
      (select count(*) > v_limit from eligible),last_pair.user_id,last_pair.organization_id
    into notifications_created,v_has_more_recipients,v_last_user,v_last_organization
    from (values (1)) row_anchor(dummy)
    left join lateral (
      select batch.user_id,batch.organization_id from batch
      order by batch.user_id desc,batch.organization_id desc limit 1
    ) last_pair on true;

    update private.announcement_notification_jobs set
      status = case when v_has_more_recipients then 'pending' else 'completed' end,
      finished_at = case when v_has_more_recipients then null else v_now end,
      after_user_id = v_last_user, after_organization_id = v_last_organization
    where announcement_id = v_announcement.id;
  end if;

  select exists (
    select 1 from private.announcement_notification_jobs job
    where job.status = 'pending' and job.due_at <= v_now
  ) into more_due;
  return next;
end;
$function$;
revoke all on function private.process_due_announcement_notifications(integer) from public, anon, authenticated, service_role;
grant execute on function private.process_due_announcement_notifications(integer) to service_role;

-- Evaluate against the current account inside a protected function: browser
-- roles intentionally lack table privileges on several recipient columns.
-- Caller identity is never an argument, so this helper only reveals whether
-- the caller matches an audience the caller already supplied.
create function private.announcement_audience_contains_current_user(
  p_target_type text,p_target_users uuid[],p_target_organizations uuid[]
)
returns boolean
language sql stable
security definer
set search_path = 'pg_catalog'
as $function$
  select exists (
    select 1 from public.organization_members member
    join public.users app_user on app_user.id = member.user_id and app_user.is_active is true
    join public.organizations organization on organization.id = member.organization_id and organization.is_active is true
    where member.user_id = (select auth.uid()) and member.is_active is true and member.deleted_at is null
      and (
        p_target_type = 'all'
        or (p_target_type = 'specific' and member.user_id = any(p_target_users)
          and (coalesce(cardinality(p_target_organizations),0) = 0
            or member.organization_id = any(p_target_organizations)))
        or (p_target_type = 'organizations' and member.organization_id = any(p_target_organizations))
        or (p_target_type = 'admins' and lower(btrim(member.role)) in ('owner','admin'))
        or (p_target_type = 'brokers' and lower(btrim(member.role)) = 'user')
      )
  );
$function$;
revoke all on function private.announcement_audience_contains_current_user(text,uuid[],uuid[]) from public, anon, authenticated, service_role;
grant execute on function private.announcement_audience_contains_current_user(text,uuid[],uuid[]) to authenticated;

-- The Go Home route additionally limits the projection to the selected tenant
-- of the active browser session.
drop policy if exists "users read targeted active announcements" on public.announcements;
drop policy if exists "vimob_canonical_9cc813bff9178df78090c772" on public.announcements;
create policy "users read targeted active announcements"
on public.announcements for select to authenticated
using (
  (select public.is_super_admin())
  or (
    is_active is true and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
    and private.announcement_audience_contains_current_user(target_type,target_user_ids,target_organization_ids)
  )
);

commit;
