-- Run only in a disposable database with the notification outbox and scheduler migration.
begin;
set local statement_timeout = '20s';

insert into public.organizations (id,name,slug,is_active) values
  ('ba110000-0000-4000-8000-000000000001','Announcement QA One','announcement-qa-one',true),
  ('ba110000-0000-4000-8000-000000000002','Announcement QA Two','announcement-qa-two',true),
  ('ba110000-0000-4000-8000-000000000003','Announcement QA Inactive','announcement-qa-inactive',false);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values
  ('ba120000-0000-4000-8000-000000000001','authenticated','authenticated','announcement-qa-1@example.invalid','',now(),'{}','{}'),
  ('ba120000-0000-4000-8000-000000000002','authenticated','authenticated','announcement-qa-2@example.invalid','',now(),'{}','{}'),
  ('ba120000-0000-4000-8000-000000000003','authenticated','authenticated','announcement-qa-3@example.invalid','',now(),'{}','{}'),
  ('ba120000-0000-4000-8000-000000000004','authenticated','authenticated','announcement-qa-4@example.invalid','',now(),'{}','{}');

insert into public.users (id,organization_id,name,email,role,is_active)
select auth_user.id,case when auth_user.id='ba120000-0000-4000-8000-000000000002'
  then 'ba110000-0000-4000-8000-000000000002'::uuid else 'ba110000-0000-4000-8000-000000000001'::uuid end,'Announcement QA',auth_user.email,'user',
  auth_user.id <> 'ba120000-0000-4000-8000-000000000004'
from auth.users auth_user where auth_user.email like 'announcement-qa-%@example.invalid'
on conflict (id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=excluded.is_active;

insert into public.organization_members (organization_id,user_id,role,is_active,deleted_at) values
  ('ba110000-0000-4000-8000-000000000001','ba120000-0000-4000-8000-000000000001','user',true,null),
  ('ba110000-0000-4000-8000-000000000002','ba120000-0000-4000-8000-000000000001','user',true,null),
  ('ba110000-0000-4000-8000-000000000003','ba120000-0000-4000-8000-000000000001','user',true,null),
  ('ba110000-0000-4000-8000-000000000002','ba120000-0000-4000-8000-000000000002','user',true,null),
  ('ba110000-0000-4000-8000-000000000001','ba120000-0000-4000-8000-000000000003','user',true,null),
  ('ba110000-0000-4000-8000-000000000001','ba120000-0000-4000-8000-000000000004','user',true,null)
on conflict (user_id,organization_id) do update set role=excluded.role,is_active=excluded.is_active,deleted_at=excluded.deleted_at;

insert into public.push_tokens (id,user_id,organization_id,platform,endpoint,is_active) values
  ('ba130000-0000-4000-8000-000000000001','ba120000-0000-4000-8000-000000000001','ba110000-0000-4000-8000-000000000001','web','https://push.example.invalid/announcement-qa-1',true),
  ('ba130000-0000-4000-8000-000000000002','ba120000-0000-4000-8000-000000000002','ba110000-0000-4000-8000-000000000002','web','https://push.example.invalid/announcement-qa-2',true);

-- Past explicit, immediate, and future banner-only records must never join
-- the scheduled worker. For a test timeout, move a job's schedule into the
-- past after legitimate enrollment, in the same transaction.
insert into public.announcements (id,message,is_active,show_banner,send_notification,target_type,starts_at)
values
  ('ba140000-0000-4000-8000-000000000001','Old scheduled',true,true,true,'all',clock_timestamp()-interval '1 minute'),
  ('ba140000-0000-4000-8000-000000000002','Immediate',true,true,true,'all',null),
  ('ba140000-0000-4000-8000-000000000003','Banner only',true,true,false,'all',clock_timestamp()+interval '1 hour');

insert into public.announcements (
  id,message,is_active,show_banner,send_notification,target_type,target_user_ids,target_organization_ids,starts_at,ends_at
) values
  ('ba140000-0000-4000-8000-000000000004','Scheduled subset',true,true,true,'specific',
    array['ba120000-0000-4000-8000-000000000001','ba120000-0000-4000-8000-000000000002',
      'ba120000-0000-4000-8000-000000000003','ba120000-0000-4000-8000-000000000004']::uuid[],
    array['ba110000-0000-4000-8000-000000000001','ba110000-0000-4000-8000-000000000003']::uuid[],
    clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours');

do $test$
begin
  if has_function_privilege('authenticated','private.process_due_announcement_notifications(integer)','execute')
    or has_function_privilege('anon','private.process_due_announcement_notifications(integer)','execute')
    or not has_function_privilege('service_role','private.process_due_announcement_notifications(integer)','execute')
    or has_table_privilege('service_role','private.announcement_notification_jobs','select,insert,update,delete') then
    raise exception 'Scheduled fan-out privileges allow unintended roles or direct access';
  end if;
  if (select count(*) from private.announcement_notification_jobs
      where announcement_id::text like 'ba140000-%') <> 1 then
    raise exception 'Only the opted-in future record should have enrolled';
  end if;
  if (select processed from private.process_due_announcement_notifications(1)) <> 0 then
    raise exception 'Worker processed a future notification';
  end if;
end;
$test$;

update public.announcements set starts_at=clock_timestamp()-interval '1 minute'
where id='ba140000-0000-4000-8000-000000000004';

set local role authenticated;
select set_config('request.jwt.claim.sub','ba120000-0000-4000-8000-000000000002',true);
do $test$
begin
  if exists (select 1 from public.announcements where id='ba140000-0000-4000-8000-000000000004') then
    raise exception 'Specific recipient outside all permitted organizations can read the announcement';
  end if;
end;
$test$;

select set_config('request.jwt.claim.sub','ba120000-0000-4000-8000-000000000001',true);
do $test$
begin
  if not exists (select 1 from public.announcements where id='ba140000-0000-4000-8000-000000000004') then
    raise exception 'Specific recipient in an allowed organization cannot read the due announcement';
  end if;
end;
$test$;
reset role;

set local role service_role;
do $test$
declare r record;
begin
  select * into r from private.process_due_announcement_notifications(1);
  if r.processed<>1 or r.notifications_created<>1 or r.more_due is not true then
    raise exception 'First chunk did not emit one recipient and signal continuation';
  end if;
end;
$test$;
reset role;

-- Change the message between chunks, resetting the cursor. The first retry
-- encounters the already published dedupe key and must still advance.
update public.announcements set message='Scheduled subset updated'
where id='ba140000-0000-4000-8000-000000000004';
do $test$
declare r record;
begin
  select * into r from private.process_due_announcement_notifications(1);
  if r.processed<>1 or r.notifications_created<>0 or r.more_due is not true then
    raise exception 'Resumed cursor duplicated an existing recipient or lost pending work';
  end if;
  select * into r from private.process_due_announcement_notifications(1);
  if r.processed<>1 or r.notifications_created<>1 or r.more_due then
    raise exception 'Second distinct recipient did not complete the fan-out';
  end if;
  if (select processed from private.process_due_announcement_notifications(1))<>0 then
    raise exception 'Completed job was picked again';
  end if;

  if (select count(*) from public.notifications n
    where n.metadata->>'announcement_id'='ba140000-0000-4000-8000-000000000004')<>2
    or exists (
      select 1 from public.notifications n
      where n.metadata->>'announcement_id'='ba140000-0000-4000-8000-000000000004'
        and (n.organization_id<>'ba110000-0000-4000-8000-000000000001'
          or n.user_id not in ('ba120000-0000-4000-8000-000000000001','ba120000-0000-4000-8000-000000000003')
          or n.channel<>'in_app' or n.metadata#>>'{dispatch,push,required}' is distinct from 'true')
    ) then
    raise exception 'Tenant, user, or channel escaped the configured announcement audience';
  end if;
  if (select count(*) from private.notification_deliveries d
    join public.notifications n on n.id=d.notification_id and n.organization_id=d.organization_id
    where n.metadata->>'announcement_id'='ba140000-0000-4000-8000-000000000004'
      and d.channel='push' and d.push_token_id='ba130000-0000-4000-8000-000000000001'
      and d.expires_at=(n.metadata->>'expires_at')::timestamptz)<>1
    or exists (
      select 1 from private.notification_deliveries d join public.notifications n on n.id=d.notification_id
      where n.metadata->>'announcement_id'='ba140000-0000-4000-8000-000000000004' and d.channel<>'push'
    ) then
    raise exception 'Canonical push was not materialized exactly once, or another channel was emitted';
  end if;
end;
$test$;

insert into public.announcements (id,message,is_active,send_notification,target_type,target_organization_ids,starts_at,ends_at)
values
  ('ba140000-0000-4000-8000-000000000005','Expires by grace',true,true,'organizations',
    array['ba110000-0000-4000-8000-000000000001']::uuid[],clock_timestamp()+interval '1 hour',null),
  ('ba140000-0000-4000-8000-000000000006','Expires by end',true,true,'organizations',
    array['ba110000-0000-4000-8000-000000000001']::uuid[],clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours'),
  ('ba140000-0000-4000-8000-000000000007','Cancels by opt out',true,true,'organizations',
    array['ba110000-0000-4000-8000-000000000001']::uuid[],clock_timestamp()+interval '1 hour',null);

update public.announcements set starts_at=clock_timestamp()-interval '2 hours'
where id='ba140000-0000-4000-8000-000000000005';
update public.announcements set starts_at=clock_timestamp()-interval '10 minutes',ends_at=clock_timestamp()-interval '5 minutes'
where id='ba140000-0000-4000-8000-000000000006';
update public.announcements set send_notification=false
where id='ba140000-0000-4000-8000-000000000007';
update public.announcements set message='Legacy edit'
where id='ba140000-0000-4000-8000-000000000001';

do $test$
declare r record;
begin
  select * into r from private.process_due_announcement_notifications(1);
  if r.processed<>1 or r.notifications_created<>0 or r.more_due is not true then
    raise exception 'Grace expiry was not safely finalized';
  end if;
  select * into r from private.process_due_announcement_notifications(1);
  if r.processed<>1 or r.notifications_created<>0 or r.more_due then
    raise exception 'Banner end expiry was not safely finalized';
  end if;
  if (select count(*) from private.announcement_notification_jobs
      where announcement_id in ('ba140000-0000-4000-8000-000000000005','ba140000-0000-4000-8000-000000000006')
        and status='expired')<>2
    or (select status from private.announcement_notification_jobs where announcement_id='ba140000-0000-4000-8000-000000000007') is distinct from 'cancelled'
    or exists (select 1 from private.announcement_notification_jobs where announcement_id='ba140000-0000-4000-8000-000000000001') then
    raise exception 'Expiry, opt out, or legacy no-replay state is incorrect';
  end if;
end;
$test$;

rollback;
