-- Forward-only candidate. Drain old workers, OAuth callbacks and token refreshes
-- before applying; no HTTP/Google call runs while these SQL locks are held.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.google_calendar_tokens
  add column credential_revision bigint not null default 1;

create or replace function private.google_calendar_stamp_credential_revision()
returns trigger language plpgsql set search_path = pg_catalog as $function$
begin
  if (new.token_secret_ref, new.disconnected_at, new.disconnecting_at)
     is distinct from (old.token_secret_ref, old.disconnected_at, old.disconnecting_at) then
    new.credential_revision := old.credential_revision + 1;
  elsif new.credential_revision is distinct from old.credential_revision then
    new.credential_revision := old.credential_revision + 1;
  end if;
  return new;
end
$function$;
revoke all on function private.google_calendar_stamp_credential_revision() from public, anon, authenticated, service_role;
create trigger stamp_google_calendar_credential_revision before update on public.google_calendar_tokens
for each row execute function private.google_calendar_stamp_credential_revision();

create or replace function private.google_calendar_validate_oauth_token(p_token jsonb)
returns void language plpgsql set search_path = pg_catalog as $function$
begin
  if jsonb_typeof(p_token) is distinct from 'object' or octet_length(p_token::text) > 65536
     or jsonb_typeof(p_token->'access_token') is distinct from 'string'
     or nullif(btrim(p_token->>'access_token'), '') is null
     or jsonb_typeof(p_token->'refresh_token') is distinct from 'string'
     or nullif(btrim(p_token->>'refresh_token'), '') is null
     or not (regexp_split_to_array(coalesce(p_token->>'scope', ''), '\s+') && array[
       'https://www.googleapis.com/auth/calendar.events.owned',
       'https://www.googleapis.com/auth/calendar.events',
       'https://www.googleapis.com/auth/calendar']) then
    raise exception 'Google Calendar offline authorization and scope required' using errcode = '22023';
  end if;
end
$function$;
revoke all on function private.google_calendar_validate_oauth_token(jsonb) from public, anon, authenticated, service_role;

create or replace function public.google_calendar_activate_oauth_connection(
  p_connection_id uuid, p_organization_id uuid, p_user_id uuid,
  p_expected_revision bigint, p_account_email text, p_account_picture_url text, p_token jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $function$
declare
  connection public.google_calendar_tokens;
  secret_ref uuid;
  v_account_email text := lower(btrim(p_account_email));
begin
  perform private.google_calendar_require_backend();
  perform private.google_calendar_validate_oauth_token(p_token);
  if nullif(v_account_email, '') is null or char_length(v_account_email) > 320
     or p_organization_id is null or p_user_id is null then
    raise exception 'Invalid Google connection identity' using errcode = '22023';
  end if;
  -- The callback may have spent time at Google after its earlier permission
  -- check. Do not persist capability for a removed/inactive owner.
  if not exists (select 1 from public.users owner where owner.id = p_user_id and owner.is_active = true
    and (owner.role = 'super_admin' or exists (select 1 from public.organization_members member
      where member.user_id = owner.id and member.organization_id = p_organization_id
        and member.is_active = true and member.deleted_at is null))) then
    raise exception 'Google connection owner access revoked' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('google-oauth:' || p_organization_id::text || ':' || p_user_id::text, 0));
  if p_connection_id is not null then
    select token.* into connection from public.google_calendar_tokens token
      where token.id = p_connection_id and token.organization_id = p_organization_id and token.user_id = p_user_id
      for update;
    if connection.id is null or p_expected_revision is null
       or connection.credential_revision <> p_expected_revision or connection.disconnecting_at is not null
       or lower(connection.account_email) <> v_account_email then
      raise exception 'Google connection changed; restart authorization' using errcode = '40001';
    end if;
  elsif p_expected_revision is not null or exists (select 1 from public.google_calendar_tokens token
    where token.organization_id = p_organization_id and token.user_id = p_user_id
      and (token.disconnected_at is null or lower(token.account_email) = v_account_email)) then
    raise exception 'Google connection changed; restart authorization' using errcode = '40001';
  end if;
  if exists (select 1 from public.google_calendar_tokens token
    where token.organization_id = p_organization_id and token.user_id = p_user_id and token.disconnected_at is null
      and token.id is distinct from p_connection_id) then
    raise exception 'Google connection changed; restart authorization' using errcode = '40001';
  end if;
  secret_ref := connection.token_secret_ref;
  if secret_ref is not null then
    if not exists (select 1 from vault.secrets where id = secret_ref) then
      raise exception 'Google credential missing; operational review required' using errcode = '40001';
    end if;
    perform vault.update_secret(secret_ref, p_token::text,
      'google-calendar-' || p_organization_id::text || '-' || p_user_id::text || '-' || v_account_email,
      'Vimob CRM Google Calendar OAuth token');
  else
    secret_ref := vault.create_secret(p_token::text,
      'google-calendar-' || p_organization_id::text || '-' || p_user_id::text || '-' || v_account_email,
      'Vimob CRM Google Calendar OAuth token');
  end if;
  if connection.id is null then
    insert into public.google_calendar_tokens(organization_id,user_id,account_email,account_picture_url,
      token_secret_ref,scopes,expires_at,calendar_id,calendar_summary,sync_enabled,sync_status,connected_at)
    values(p_organization_id,p_user_id,v_account_email,p_account_picture_url,secret_ref,
      regexp_split_to_array(p_token->>'scope','\s+'),nullif(p_token->>'expires_at','')::timestamptz,
      'primary','Agenda principal',true,'connected',now()) returning * into connection;
  else
    update public.google_calendar_tokens token set token_secret_ref = secret_ref,
      credential_revision = token.credential_revision + 1, account_picture_url = p_account_picture_url,
      scopes = regexp_split_to_array(p_token->>'scope','\s+'), expires_at = nullif(p_token->>'expires_at','')::timestamptz,
      sync_enabled = true, sync_status = 'connected', disconnected_at = null, connected_at = now(), last_error = null
    where token.id = connection.id returning token.* into connection;
  end if;
  -- Reconnection renews capability; it does not replay/discard unresolved
  -- outbound intents or hide their current aggregate error.
  perform private.google_calendar_refresh_connection_status(connection.id,connection.organization_id,connection.user_id);
  select * into connection from public.google_calendar_tokens where id=connection.id;
  return to_jsonb(connection);
end
$function$;

create or replace function public.google_calendar_store_refreshed_token(
  p_connection_id uuid, p_expected_revision bigint, p_expected_secret_ref uuid, p_token jsonb,
  p_allow_disconnecting boolean default false
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $function$
declare connection public.google_calendar_tokens;
begin
  perform private.google_calendar_require_backend();
  perform private.google_calendar_validate_oauth_token(p_token);
  select * into connection from public.google_calendar_tokens where id = p_connection_id for update;
  if connection.id is null or connection.disconnected_at is not null
     or (connection.disconnecting_at is not null and not coalesce(p_allow_disconnecting,false))
     or p_expected_revision is null or connection.credential_revision <> p_expected_revision
     or connection.token_secret_ref is distinct from p_expected_secret_ref
     or connection.token_secret_ref is null
     or not exists(select 1 from vault.secrets where id = connection.token_secret_ref) then
    raise exception 'Google credential changed; discard stale refresh' using errcode = '40001';
  end if;
  perform vault.update_secret(connection.token_secret_ref, p_token::text,
    'google-calendar-' || connection.organization_id::text || '-' || connection.user_id::text || '-' || connection.account_email,
    'Vimob CRM Google Calendar OAuth token');
  -- Access-token rotation does not invalidate a consent/lifecycle snapshot.
  update public.google_calendar_tokens token set expires_at = nullif(p_token->>'expires_at','')::timestamptz
    where token.id = connection.id returning token.* into connection;
  return to_jsonb(connection);
end
$function$;

create or replace function private.google_calendar_refresh_connection_status(
  p_connection_id uuid, p_organization_id uuid, p_owner_user_id uuid, p_synced_at timestamptz default null
) returns boolean language plpgsql security definer set search_path = pg_catalog as $function$
declare connection public.google_calendar_tokens; unresolved_error text;
begin
  select * into connection from public.google_calendar_tokens token where token.id = p_connection_id
    and token.organization_id = p_organization_id and token.user_id = p_owner_user_id for update;
  if connection.id is null or connection.disconnected_at is not null or connection.disconnecting_at is not null then return false; end if;
  select coalesce(nullif(job.last_error,''),'Envio Google pendente de revisao.') into unresolved_error
  from public.google_calendar_sync_jobs job where job.organization_id = p_organization_id
    and job.connection_id = p_connection_id and job.payload->>'owner_user_id' = p_owner_user_id::text
    and job.action in ('push_upsert','push_delete') and job.status in ('failed','dead')
  order by job.updated_at desc, job.id desc limit 1;
  update public.google_calendar_tokens token set
    sync_status = case when unresolved_error is null then 'connected' else 'error' end,
    last_error = left(unresolved_error,2000),
    last_synced_at = case when p_synced_at is null then token.last_synced_at
      else greatest(coalesce(token.last_synced_at,p_synced_at),p_synced_at) end
  where token.id = connection.id;
  return true;
end
$function$;
revoke all on function private.google_calendar_refresh_connection_status(uuid,uuid,uuid,timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.google_calendar_refresh_outbound_connection_status(
  p_connection_id uuid, p_organization_id uuid, p_owner_user_id uuid, p_synced_at timestamptz default null
) returns boolean language plpgsql security definer set search_path = pg_catalog as $function$
begin
  perform private.google_calendar_require_backend();
  return private.google_calendar_refresh_connection_status(p_connection_id,p_organization_id,p_owner_user_id,p_synced_at);
end
$function$;

-- Keep the first-round signature compatible. Derive account state in the same
-- transaction for every outcome, so a prior failure resolved by a retry cannot
-- remain visible and no separate Edge snapshot can repaint it.
create or replace function public.google_calendar_claim_outbound_sync_jobs_v2(p_limit integer,p_worker text)
returns setof public.google_calendar_sync_jobs language plpgsql security definer set search_path=pg_catalog as $function$
begin
  perform private.google_calendar_require_backend();
  if nullif(btrim(p_worker),'') is null then raise exception 'Worker required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('google-calendar-outbound-claim-v2',0));
  perform private.google_calendar_cancel_obsolete_jobs();
  return query with due as (
    select job.id,token.credential_revision,
      row_number() over(partition by job.organization_id,coalesce(job.payload->>'event_id',job.schedule_event_id::text)
        order by job.next_run_at,job.created_at,job.id) ordinal
    from public.google_calendar_sync_jobs job join public.google_calendar_tokens token
      on token.id=job.connection_id and token.organization_id=job.organization_id
        and token.user_id::text=job.payload->>'owner_user_id' and token.disconnected_at is null
        and token.disconnecting_at is null and token.token_secret_ref is not null
    where job.action in ('push_upsert','push_delete') and job.attempts<job.max_attempts
      and ((job.status in ('queued','failed') and job.next_run_at<=now())
        or (job.status='running' and job.locked_at<now()-interval '2 minutes'))
      and not exists(select 1 from public.google_calendar_sync_jobs active where active.organization_id=job.organization_id
        and active.id<>job.id and coalesce(active.payload->>'event_id',active.schedule_event_id::text)
          =coalesce(job.payload->>'event_id',job.schedule_event_id::text)
        and active.status='running' and active.locked_at>=now()-interval '2 minutes')
  ), candidates as (
    select job.id,due.credential_revision from public.google_calendar_sync_jobs job join due on due.id=job.id
      where due.ordinal=1 order by job.next_run_at,job.created_at,job.id
      for update of job skip locked limit greatest(1,least(coalesce(p_limit,10),20))
  ) update public.google_calendar_sync_jobs job set status='running',locked_at=now(),locked_by=btrim(p_worker),
      last_error=null,terminal_reason=null,
      payload=job.payload||jsonb_build_object('claimed_credential_revision',candidates.credential_revision)
    from candidates where job.id=candidates.id returning job.*;
end
$function$;

create or replace function public.google_calendar_finish_outbound_job(
  p_job_id uuid, p_worker text, p_status text, p_error text default null,
  p_delay_seconds integer default 0, p_consume_attempt boolean default false, p_is_conflict boolean default false
) returns boolean language plpgsql security definer set search_path = pg_catalog as $function$
declare finished public.google_calendar_sync_jobs; candidate public.google_calendar_sync_jobs;
  locked_connection public.google_calendar_tokens; requeued integer;
begin
  perform private.google_calendar_require_backend();
  if p_status not in ('queued','succeeded','failed','dead') then raise exception 'Invalid job outcome'; end if;
  -- Go mutations lock the event, may update its FK links, then insert an intent
  -- whose trigger locks the connection. Match event -> links -> connection ->
  -- job. Disconnect takes connection -> job but never locks/writes events or
  -- links; claim takes jobs and only MVCC-reads events/connections. Network is
  -- outside all these transactions. The unlocked candidate grants no outcome
  -- authority: binding, worker and lease are rechecked after the locks.
  select * into candidate from public.google_calendar_sync_jobs where id=p_job_id;
  if candidate.id is null then return false; end if;
  perform 1 from public.schedule_events event
    where event.organization_id=candidate.organization_id
      and event.id::text=coalesce(candidate.schedule_event_id::text,candidate.payload->>'event_id') for update;
  if candidate.action='push_delete' then
    perform 1 from public.google_calendar_event_links link
    where link.organization_id=candidate.organization_id and link.connection_id=candidate.connection_id
      and link.deleted_at is null and link.id::text in(select jsonb_array_elements_text(
        case when jsonb_typeof(candidate.payload->'link_ids')='array' then candidate.payload->'link_ids' else '[]'::jsonb end))
    order by link.id for update;
  end if;
  select token.* into locked_connection from public.google_calendar_sync_jobs job
    join public.google_calendar_tokens token on token.id=job.connection_id
      and token.organization_id=job.organization_id and token.user_id::text=job.payload->>'owner_user_id'
    where job.id=p_job_id and job.organization_id=candidate.organization_id
      and job.connection_id is not distinct from candidate.connection_id and job.action=candidate.action
      and job.schedule_event_id is not distinct from candidate.schedule_event_id
      and job.payload-'claimed_credential_revision'=candidate.payload-'claimed_credential_revision' for update of token;
  if locked_connection.id is null or locked_connection.disconnected_at is not null
     or locked_connection.disconnecting_at is not null then return false; end if;
  -- A reconnect can invalidate provider results even while the job lease is
  -- still owned. Requeue, without recording an old authorization error or
  -- consuming a retry, behind the same worker/binding/lease predicates.
  update public.google_calendar_sync_jobs job set status='queued',locked_at=null,locked_by=null,
    next_run_at=now()+interval '10 seconds',last_error=null
  where job.id=p_job_id and job.status='running' and job.locked_by=p_worker
    and job.locked_at>=now()-interval '2 minutes' and job.connection_id=locked_connection.id
    and job.organization_id=locked_connection.organization_id and job.payload->>'owner_user_id'=locked_connection.user_id::text
    and jsonb_typeof(job.payload->'claimed_credential_revision')='number'
    and job.payload->'claimed_credential_revision'<>to_jsonb(locked_connection.credential_revision);
  get diagnostics requeued=row_count;
  if requeued=1 then return false; end if;
  update public.google_calendar_sync_jobs job set status=p_status,locked_at=null,locked_by=null,
    attempts=attempts+case when p_consume_attempt then 1 else 0 end,
    next_run_at=now()+make_interval(secs=>greatest(0,least(p_delay_seconds,86400))),last_error=left(p_error,2000)
  where job.id=p_job_id and job.status='running' and job.locked_by=p_worker
    and job.locked_at>=now()-interval '2 minutes' and job.connection_id=locked_connection.id
    and job.organization_id=locked_connection.organization_id
    and job.payload->>'owner_user_id'=locked_connection.user_id::text
    and (job.payload->'claimed_credential_revision' is null
      or job.payload->'claimed_credential_revision'=to_jsonb(locked_connection.credential_revision)) returning job.* into finished;
  if not found then return false; end if;
  if p_status in ('failed','dead') then
    if finished.action='push_upsert' then
      update public.schedule_events event set google_sync_status=case when p_is_conflict then 'conflict' else 'error' end,
        google_sync_error=left(p_error,2000)
      where event.id::text=coalesce(finished.schedule_event_id::text,finished.payload->>'event_id')
        and event.organization_id=finished.organization_id and event.user_id::text=finished.payload->>'owner_user_id';
    elsif finished.action='push_delete' then
      update public.google_calendar_event_links link set last_error=left(p_error,2000)
      where link.organization_id=finished.organization_id and link.connection_id=finished.connection_id
        and link.deleted_at is null and link.id::text in(select jsonb_array_elements_text(
          case when jsonb_typeof(finished.payload->'link_ids')='array' then finished.payload->'link_ids' else '[]'::jsonb end));
    end if;
  end if;
  -- The producer binds jobs to an owner token, not to a request actor or a
  -- caller-supplied UUID cast. Unknown legacy owner values remain reviewable.
  perform private.google_calendar_refresh_connection_status(token.id,token.organization_id,token.user_id)
    from public.google_calendar_tokens token where token.id=finished.connection_id
      and token.organization_id=finished.organization_id and token.user_id::text=finished.payload->>'owner_user_id';
  return true;
end
$function$;

-- The export reader mirrors permissions.Resolve + leadscope.VisibilitySQL:
-- ordinary members default to Own, managers to All, active leaders to Team;
-- active custom roles expand legacy grants, wildcard precedes overrides, and
-- exact current overrides are final. Event participation is not a lead grant.
create or replace function public.google_calendar_get_authorized_event_lead(
  p_event_id uuid, p_organization_id uuid, p_owner_user_id uuid
) returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $function$
declare result jsonb;
begin
  perform private.google_calendar_require_backend();
  with subject as (
    select owner.id, owner.role='super_admin' super_admin, lower(btrim(coalesce(member.role,''))) member_role,
      exists(select 1 from public.team_members leader join public.teams team
        on team.id=leader.team_id and team.organization_id=leader.organization_id
      join public.organization_members lm on lm.organization_id=leader.organization_id and lm.user_id=leader.user_id
        and lm.is_active=true and lm.deleted_at is null and lm.membership_generation=leader.membership_generation
      where leader.organization_id=p_organization_id and leader.user_id=owner.id
        and coalesce(leader.is_active,true)=true and leader.is_leader=true and coalesce(team.is_active,true)=true) is_leader,
      coalesce((select array_agg(distinct lower(btrim(ap.key))) from public.user_organization_roles uor
        join public.organization_roles role on role.id=uor.role_id and role.organization_id=uor.organization_id and role.is_active=true
        join public.organization_role_permissions orp on orp.role_id=uor.role_id and orp.organization_id=uor.organization_id
        join public.available_permissions ap on ap.id=orp.permission_id
        where uor.organization_id=p_organization_id and uor.user_id=owner.id and uor.is_active=true),'{}'::text[]) grants,
      coalesce((select jsonb_object_agg(lower(btrim(upo.permission_key)),upo.allowed) from public.user_permission_overrides upo
        where upo.organization_id=p_organization_id and upo.user_id=owner.id),'{}'::jsonb) overrides
    from public.users owner
    left join public.organization_members member on member.organization_id=p_organization_id and member.user_id=owner.id
      and member.is_active=true and member.deleted_at is null
    where owner.id=p_owner_user_id and owner.is_active=true and (owner.role='super_admin' or member.user_id is not null)
  ), flags as (
    select subject.*,
      (super_admin or member_role in ('owner','admin') or '*'=any(grants)) unrestricted,
      coalesce((overrides->>'lead_view_all')::boolean,
        member_role='manager' or grants && array['lead_view_all','lead_edit_all','lead_manage']) can_all,
      coalesce((overrides->>'lead_view_own')::boolean,true) can_own,
      coalesce((overrides->>'lead_view_team')::boolean,is_leader or 'lead_view_team'=any(grants)) can_team
    from subject
  ), leaders as (
    select leader.team_id from public.team_members leader join public.teams team
      on team.id=leader.team_id and team.organization_id=leader.organization_id and coalesce(team.is_active,true)=true
    join public.organization_members lm on lm.organization_id=leader.organization_id and lm.user_id=leader.user_id
      and lm.is_active=true and lm.deleted_at is null and lm.membership_generation=leader.membership_generation
    where leader.organization_id=p_organization_id and leader.user_id=p_owner_user_id
      and leader.is_active=true and leader.is_leader=true
  )
  select jsonb_build_object('id',lead.id,'name',lead.name) into result
  from public.schedule_events event join public.leads lead on lead.id=event.lead_id and lead.organization_id=event.organization_id
  cross join flags where event.id=p_event_id and event.organization_id=p_organization_id and event.user_id=p_owner_user_id
    and (flags.unrestricted or flags.can_all or (flags.can_own and lead.assigned_user_id=p_owner_user_id)
      or (flags.can_team and (
        (lead.assigned_user_id is null and exists(select 1 from leaders
          where leaders.team_id::text=to_jsonb(lead)->>'team_id'))
        or (lead.assigned_user_id is not null and exists(select 1 from leaders
          join public.team_members broker_team on broker_team.team_id=leaders.team_id
            and broker_team.organization_id=p_organization_id and broker_team.is_active=true
          join public.users broker on broker.id=broker_team.user_id and coalesce(broker.is_active,false)=true
          join public.organization_members bm on bm.organization_id=broker_team.organization_id and bm.user_id=broker_team.user_id
            and bm.is_active=true and bm.deleted_at is null and bm.membership_generation=broker_team.membership_generation
          where broker_team.user_id=lead.assigned_user_id))
      )));
  return result;
end
$function$;

-- Supabase exposes public functions as API endpoints: PUBLIC privileges must
-- be revoked even when a runtime role guard also exists.
do $grants$ declare signature text;
begin
  foreach signature in array array[
    'google_calendar_activate_oauth_connection(uuid,uuid,uuid,bigint,text,text,jsonb)',
    'google_calendar_store_refreshed_token(uuid,bigint,uuid,jsonb,boolean)',
    'google_calendar_refresh_outbound_connection_status(uuid,uuid,uuid,timestamptz)',
    'google_calendar_get_authorized_event_lead(uuid,uuid,uuid)',
    'google_calendar_finish_outbound_job(uuid,text,text,text,integer,boolean,boolean)',
    'google_calendar_claim_outbound_sync_jobs_v2(integer,text)'
  ] loop
    execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
    execute 'grant execute on function public.'||signature||' to service_role';
  end loop;
end
$grants$;

commit;
