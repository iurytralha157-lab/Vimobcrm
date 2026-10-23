-- Real SQL assertions against a synthetic database; no provider calls.
begin;
insert into public.organizations values('11111111-1111-4111-8111-111111111111');
insert into public.users values
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','user',true),
 ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','user',true);
insert into public.organization_members(organization_id,user_id,is_active,role,membership_generation) values
 ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',true,'user',1),
 ('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444',true,'user',1);

do $lifecycle$
declare
  org uuid:='11111111-1111-4111-8111-111111111111'; owner uuid:='33333333-3333-4333-8333-333333333333';
  token jsonb:='{"access_token":"synthetic-access","refresh_token":"synthetic-refresh","scope":"https://www.googleapis.com/auth/calendar.events.owned","expires_at":"2027-01-01T00:00:00Z"}';
  activated jsonb; connection_id uuid; old_revision bigint; old_secret uuid; count_before bigint;
begin
  select count(*) into count_before from vault.secrets;
  begin
    perform public.google_calendar_activate_oauth_connection(null,org,owner,null,'synthetic@example.test',null,
      token-'refresh_token'); raise exception 'partial OAuth unexpectedly accepted';
  exception when invalid_parameter_value then null; end;
  if (select count(*) from vault.secrets)<>count_before then raise exception 'partial consent wrote Vault'; end if;
  activated:=public.google_calendar_activate_oauth_connection(null,org,owner,null,'synthetic@example.test',null,token);
  connection_id:=(activated->>'id')::uuid; old_revision:=(activated->>'credential_revision')::bigint;
  old_secret:=(activated->>'token_secret_ref')::uuid;
  if not exists(select 1 from vault.secrets where id=old_secret) then raise exception 'activation lacks Vault'; end if;
  begin
    perform public.google_calendar_activate_oauth_connection(null,org,owner,null,'synthetic@example.test',null,token);
    raise exception 'duplicate initial callback accepted';
  exception when serialization_failure then null; end;
  -- Snapshot taken before disconnect: both activation and refresh must reject.
  if not public.google_calendar_begin_disconnect(connection_id) then raise exception 'disconnect preparation failed'; end if;
  begin
    perform public.google_calendar_activate_oauth_connection(connection_id,org,owner,old_revision,'synthetic@example.test',null,token);
    raise exception 'callback during disconnect accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.google_calendar_store_refreshed_token(connection_id,old_revision,old_secret,token);
    raise exception 'refresh during disconnect accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.google_calendar_store_refreshed_token(connection_id,
      (select credential_revision from public.google_calendar_tokens where id=connection_id),old_secret,token);
    raise exception 'ordinary worker refreshed a disconnect marker';
  exception when serialization_failure then null; end;
  perform public.google_calendar_store_refreshed_token(connection_id,
    (select credential_revision from public.google_calendar_tokens where id=connection_id),old_secret,token,true);
  perform public.google_calendar_disconnect_connection(connection_id);
  begin
    perform public.google_calendar_activate_oauth_connection(connection_id,org,owner,old_revision,'synthetic@example.test',null,token);
    raise exception 'stale callback reactivated disconnected token';
  exception when serialization_failure then null; end;
  if exists(select 1 from vault.secrets where id=old_secret) or exists(select 1 from public.google_calendar_tokens
      where id=connection_id and disconnected_at is null) then raise exception 'disconnect lifecycle resurrected'; end if;
  activated:=public.google_calendar_activate_oauth_connection(connection_id,org,owner,
    (select credential_revision from public.google_calendar_tokens where id=connection_id),'synthetic@example.test',null,token);
  if not exists(select 1 from vault.secrets where id=(activated->>'token_secret_ref')::uuid) then raise exception 'fresh reconnect lacks Vault'; end if;
  begin
    perform public.google_calendar_store_refreshed_token(connection_id,old_revision,old_secret,token);
    raise exception 'prior consent refresh overwrote reconnect';
  exception when serialization_failure then null; end;
  old_revision:=(activated->>'credential_revision')::bigint;
  old_secret:=(activated->>'token_secret_ref')::uuid;
  begin
    perform public.google_calendar_activate_oauth_connection(connection_id,org,owner,old_revision-1,'synthetic@example.test',null,token);
    raise exception 'second stale callback accepted';
  exception when serialization_failure then null; end;
  perform public.google_calendar_store_refreshed_token(connection_id,old_revision,old_secret,token||'{"access_token":"synthetic-next"}');
  if (select credential_revision from public.google_calendar_tokens where id=connection_id)<>old_revision then
    raise exception 'ordinary access rotation invalidated consent revision'; end if;
  -- Metadata writes must not invalidate a credential snapshot.
  update public.google_calendar_tokens set last_error='synthetic metadata' where id=connection_id;
  if (select credential_revision from public.google_calendar_tokens where id=connection_id)<>old_revision then
    raise exception 'metadata changed credential revision'; end if;
  -- A post-Vault table failure rolls back the Vault change too.
  alter table public.google_calendar_tokens add constraint synthetic_oauth_rollback check(account_picture_url is distinct from 'synthetic-reject');
  begin
    perform public.google_calendar_activate_oauth_connection(connection_id,org,owner,old_revision,'synthetic@example.test','synthetic-reject',
      token||'{"access_token":"synthetic-must-rollback"}'); raise exception 'synthetic write failure not enforced';
  exception when check_violation then null; end;
  if (select secret::jsonb->>'access_token' from vault.secrets where id=old_secret)<>'synthetic-next' then raise exception 'Vault escaped OAuth rollback'; end if;
  alter table public.google_calendar_tokens drop constraint synthetic_oauth_rollback;
  update public.organization_members set is_active=false where organization_id=org and user_id=owner;
  begin
    perform public.google_calendar_activate_oauth_connection(connection_id,org,owner,old_revision,'synthetic@example.test',null,token);
    raise exception 'removed owner activated OAuth';
  exception when insufficient_privilege then null; end;
  update public.organization_members set is_active=true where organization_id=org and user_id=owner;
end
$lifecycle$;

insert into public.schedule_events(id,organization_id,user_id,google_sync_status) values
 ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','pending');

do $status$
declare connection public.google_calendar_tokens; job public.google_calendar_sync_jobs; worker text:='synthetic-worker';
begin
  select * into connection from public.google_calendar_tokens where user_id='33333333-3333-4333-8333-333333333333';
  insert into public.google_calendar_sync_jobs(organization_id,schedule_event_id,action,payload)
  values(connection.organization_id,'22222222-2222-4222-8222-222222222222','push_upsert',
    jsonb_build_object('event_id','22222222-2222-4222-8222-222222222222','owner_user_id',connection.user_id)) returning * into job;
  perform public.google_calendar_claim_outbound_sync_jobs_v2(1,worker);
  if not public.google_calendar_finish_outbound_job(job.id,worker,'failed','synthetic-failure',0,true,false) then raise exception 'failure finish rejected'; end if;
  if (select sync_status from public.google_calendar_tokens where id=connection.id)<>'error' then raise exception 'failure status not atomic'; end if;
  perform public.google_calendar_refresh_outbound_connection_status(connection.id,connection.organization_id,connection.user_id,now());
  if (select sync_status from public.google_calendar_tokens where id=connection.id)<>'error' then raise exception 'success hid outstanding failure'; end if;
  perform public.google_calendar_claim_outbound_sync_jobs_v2(1,'synthetic-retry');
  if not public.google_calendar_finish_outbound_job(job.id,'synthetic-retry','succeeded') then raise exception 'retry finish rejected'; end if;
  if (select sync_status from public.google_calendar_tokens where id=connection.id)<>'connected' then raise exception 'resolved failure remains error'; end if;
  -- A late aggregate request carries identity/time only: reads current SQL state.
  perform public.google_calendar_refresh_outbound_connection_status(connection.id,connection.organization_id,connection.user_id,now()-interval '1 minute');
  if (select sync_status from public.google_calendar_tokens where id=connection.id)<>'connected' then raise exception 'old aggregate repainted error'; end if;
  if public.google_calendar_refresh_outbound_connection_status(connection.id,gen_random_uuid(),connection.user_id,now()) then
    raise exception 'cross-tenant aggregate accepted'; end if;
  if public.google_calendar_finish_outbound_job(job.id,worker,'failed','late-error',0,true,false) then raise exception 'old worker finish accepted'; end if;
  if (select sync_status from public.google_calendar_tokens where id=connection.id)<>'connected' then raise exception 'old worker repainted account'; end if;
  -- A provider error from the prior grant must not overwrite a successful
  -- reconnect, even if its event job still owns an unexpired worker lease.
  update public.schedule_events set google_sync_status='pending',google_sync_error=null
    where id='22222222-2222-4222-8222-222222222222';
  insert into public.google_calendar_sync_jobs(organization_id,schedule_event_id,action,payload)
    values(connection.organization_id,'22222222-2222-4222-8222-222222222222','push_upsert',
      jsonb_build_object('event_id','22222222-2222-4222-8222-222222222222','owner_user_id',connection.user_id)) returning * into job;
  perform public.google_calendar_claim_outbound_sync_jobs_v2(1,'prior-grant-worker');
  perform public.google_calendar_activate_oauth_connection(connection.id,connection.organization_id,connection.user_id,
    (select credential_revision from public.google_calendar_tokens where id=connection.id),'synthetic@example.test',null,
    '{"access_token":"synthetic-new-consent","refresh_token":"synthetic-new-consent","scope":"https://www.googleapis.com/auth/calendar.events.owned"}');
  if public.google_calendar_finish_outbound_job(job.id,'prior-grant-worker','dead','old invalid_grant',0,true,false) then
    raise exception 'prior grant error accepted'; end if;
  if (select status from public.google_calendar_sync_jobs where id=job.id)<>'queued'
     or (select attempts from public.google_calendar_sync_jobs where id=job.id)<>0 then raise exception 'prior grant did not requeue free of retry consumption'; end if;
  if (select sync_status from public.google_calendar_tokens where id=connection.id)<>'connected'
     or (select google_sync_status from public.schedule_events where id='22222222-2222-4222-8222-222222222222')='error' then
    raise exception 'prior grant repainted current account/event'; end if;
  update public.google_calendar_sync_jobs set next_run_at=now() where id=job.id;
  perform public.google_calendar_claim_outbound_sync_jobs_v2(1,'current-grant-worker');
  if not public.google_calendar_finish_outbound_job(job.id,'current-grant-worker','succeeded') then raise exception 'fresh grant retry denied'; end if;
end
$status$;

insert into public.leads values('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','Synthetic lead',
 '33333333-3333-4333-8333-333333333333',null);
update public.schedule_events set lead_id='55555555-5555-4555-8555-555555555555' where id='22222222-2222-4222-8222-222222222222';

do $scope$
declare org uuid:='11111111-1111-4111-8111-111111111111'; owner uuid:='33333333-3333-4333-8333-333333333333';
  event_id uuid:='22222222-2222-4222-8222-222222222222'; custom_role uuid:=gen_random_uuid(); team uuid:=gen_random_uuid();
begin
  if public.google_calendar_get_authorized_event_lead(event_id,org,owner) is null then raise exception 'default Own denied'; end if;
  insert into public.user_permission_overrides values(org,owner,'lead_view_own',false);
  if public.google_calendar_get_authorized_event_lead(event_id,org,owner) is not null then raise exception 'Own deny bypassed by event'; end if;
  update public.organization_members set role='manager' where organization_id=org and user_id=owner;
  if public.google_calendar_get_authorized_event_lead(event_id,org,owner) is null then raise exception 'manager All denied'; end if;
  insert into public.user_permission_overrides values(org,owner,'lead_view_all',false);
  if public.google_calendar_get_authorized_event_lead(event_id,org,owner) is not null then raise exception 'manager All deny bypassed'; end if;
  update public.organization_members set role='user' where organization_id=org and user_id=owner;
  delete from public.user_permission_overrides where permission_key='lead_view_all';
  insert into public.available_permissions(key) values('lead_view_all'),('*'),('lead_edit_all'),('lead_view_team');
  insert into public.organization_roles values(custom_role,org,true);
  insert into public.user_organization_roles values(owner,org,custom_role,true);
  insert into public.organization_role_permissions select custom_role,org,id from public.available_permissions where key='lead_view_all';
  if public.google_calendar_get_authorized_event_lead(event_id,org,owner) is null then raise exception 'active custom All denied'; end if;
  update public.organization_roles set is_active=false where id=custom_role;
  if public.google_calendar_get_authorized_event_lead(event_id,org,owner) is not null then raise exception 'inactive custom role exported lead'; end if;
  update public.organization_roles set is_active=true where id=custom_role;
  insert into public.user_permission_overrides values(org,owner,'lead_view_all',false);
  if public.google_calendar_get_authorized_event_lead(event_id,org,owner) is not null then raise exception 'custom All deny bypassed'; end if;
  insert into public.organization_role_permissions select custom_role,org,id from public.available_permissions where key='*';
  if public.google_calendar_get_authorized_event_lead(event_id,org,owner) is null then raise exception 'wildcard should precede overrides'; end if;
  delete from public.organization_role_permissions;
  delete from public.user_permission_overrides where permission_key='lead_view_all';
  insert into public.organization_role_permissions select custom_role,org,id from public.available_permissions where key='lead_edit_all';
  insert into public.user_permission_overrides values(org,owner,'lead_edit_all',false);
  if public.google_calendar_get_authorized_event_lead(event_id,org,owner) is null then raise exception 'legacy grant/override parity changed'; end if;
  delete from public.organization_role_permissions;
  insert into public.teams values(team,org,true);
  insert into public.team_members values(org,team,owner,true,true,1),
    (org,team,'44444444-4444-4444-8444-444444444444',true,false,1);
  update public.leads set assigned_user_id='44444444-4444-4444-8444-444444444444';
  if public.google_calendar_get_authorized_event_lead(event_id,org,owner) is null then raise exception 'leader current assigned team denied'; end if;
  update public.team_members set membership_generation=0 where user_id='44444444-4444-4444-8444-444444444444';
  if public.google_calendar_get_authorized_event_lead(event_id,org,owner) is not null then raise exception 'stale broker generation exported lead'; end if;
  update public.team_members set membership_generation=1 where user_id='44444444-4444-4444-8444-444444444444';
  update public.team_members set membership_generation=0 where user_id=owner;
  if public.google_calendar_get_authorized_event_lead(event_id,org,owner) is not null then raise exception 'stale leader generation exported lead'; end if;
  update public.team_members set membership_generation=1,is_active=null where user_id=owner;
  if public.google_calendar_get_authorized_event_lead(event_id,org,owner) is not null then raise exception 'NULL leader must deny resource'; end if;
  update public.team_members set is_active=true where user_id=owner;
  update public.leads set assigned_user_id=null,team_id=team;
  if public.google_calendar_get_authorized_event_lead(event_id,org,owner) is null then raise exception 'unassigned queue team denied'; end if;
  update public.teams set is_active=false;
  if public.google_calendar_get_authorized_event_lead(event_id,org,owner) is not null then raise exception 'inactive team exported lead'; end if;
  update public.teams set is_active=true;
  update public.organization_members set deleted_at=now() where user_id=owner;
  if public.google_calendar_get_authorized_event_lead(event_id,org,owner) is not null then raise exception 'removed owner exported lead'; end if;
  update public.organization_members set deleted_at=null where user_id=owner;
  if public.google_calendar_get_authorized_event_lead(event_id,gen_random_uuid(),owner) is not null then raise exception 'foreign tenant exported lead'; end if;
  if public.google_calendar_get_authorized_event_lead(event_id,org,'44444444-4444-4444-8444-444444444444') is not null then raise exception 'wrong event owner exported lead'; end if;
end
$scope$;

do $acl$ declare signature text;
begin
  foreach signature in array array[
    'public.google_calendar_activate_oauth_connection(uuid,uuid,uuid,bigint,text,text,jsonb)',
    'public.google_calendar_store_refreshed_token(uuid,bigint,uuid,jsonb,boolean)',
    'public.google_calendar_refresh_outbound_connection_status(uuid,uuid,uuid,timestamptz)',
    'public.google_calendar_get_authorized_event_lead(uuid,uuid,uuid)'
  ] loop
    if has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE')
       or not has_function_privilege('service_role',signature,'EXECUTE') then raise exception 'unsafe RPC grants: %',signature; end if;
  end loop;
end
$acl$;
-- Exercise the independent guard even if an operator accidentally grants the
-- endpoint. This privilege is only temporary in the disposable transaction.
grant execute on function public.google_calendar_get_authorized_event_lead(uuid,uuid,uuid) to authenticated;
set session authorization authenticator;
set local role authenticated;
do $negative_role$ begin
  begin
    perform public.google_calendar_get_authorized_event_lead(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
    raise exception 'authenticated RPC executed';
  exception when insufficient_privilege then null; end;
end $negative_role$;
reset role;
reset session authorization;
rollback;
-- Explicit fixture-session teardown after the data rollback. SET SESSION
-- AUTHORIZATION is session state, not application data; the next synthetic
-- scenario must begin as its bootstrap postgres role.
set session authorization postgres;
reset role;
