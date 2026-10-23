-- Required shared read dependency of the real WhatsApp API. Synthetic only;
-- no queue engine/claim/notification worker is installed or executed here.
begin;
do $$
declare ci_nonce text := nullif(current_setting('vimob.whatsapp_ci_nonce',true),'');
begin
  if ci_nonce is null or ci_nonce !~ '^[a-f0-9]{64}$'
     or current_database()<>'vimob_whatsapp_clone' or inet_server_port()<>57924
     or host(inet_server_addr())<>'127.0.0.1' or current_setting('fsync')<>'on'
     or current_setting('synchronous_commit')<>'on'
     or not exists(select 1 from vimob_ci_fixture.identity i where i.marker='vimob-whatsapp-ci-v1'
       and i.nonce=ci_nonce and i.system_identifier=(select system_identifier::text from pg_control_system())
       and replace(i.data_directory,chr(92),'/')=replace(current_setting('data_directory'),chr(92),'/')
       and i.created_at<=now() and i.created_at>now()-interval '6 hours') then
    raise exception 'queue read SQL requires the fresh owned synthetic CI cluster';
  end if;
end;
$$;
select plan(16);
create temporary table queue_read_fixture(org_a uuid,org_b uuid,user_a uuid,user_b uuid,
  queue_a uuid,queue_b uuid,lead_a uuid,lead_b uuid,no_pool uuid,session_b uuid);
insert into queue_read_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
grant select on queue_read_fixture to authenticated;
insert into public.organizations(id,name,slug,is_active)
select org_a,'Synthetic queue read A','ci-queue-a-'||org_a,true from queue_read_fixture
union all select org_b,'Synthetic queue read B','ci-queue-b-'||org_b,true from queue_read_fixture;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select user_a,'authenticated','authenticated',user_a||'@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now() from queue_read_fixture
union all select user_b,'authenticated','authenticated',user_b||'@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now() from queue_read_fixture;
insert into public.users(id,organization_id,name,email,role,is_active)
select user_a,org_a,'Queue member A',user_a||'@example.invalid','user',true from queue_read_fixture
union all select user_b,org_b,'Queue member B',user_b||'@example.invalid','user',true from queue_read_fixture
on conflict(id) do update set organization_id=excluded.organization_id,role='user',is_active=true;
insert into public.organization_members(organization_id,user_id,role,is_active)
select org_a,user_a,'user',true from queue_read_fixture
union all select org_b,user_b,'user',true from queue_read_fixture
on conflict(user_id,organization_id) do update set role='user',is_active=true,deleted_at=null;
insert into auth.sessions(id,user_id,created_at,updated_at) select session_b,user_b,now(),now() from queue_read_fixture;
insert into public.round_robins(id,organization_id,name,is_active,settings)
select q,org,'Synthetic managed queue',true,jsonb_build_object('operating_schedule',jsonb_build_object('version',1,'timezone','UTC','days',
  (select jsonb_agg(jsonb_build_object('day_of_week',d,'is_active',true,'is_all_day',true) order by d) from generate_series(0,6) d)))
from queue_read_fixture f cross join lateral(values(f.queue_a,f.org_a),(f.queue_b,f.org_b)) v(q,org);
insert into public.round_robin_members(organization_id,round_robin_id,user_id,is_active,position,weight,membership_generation)
select v.org,v.q,v.actor,true,0,1,om.membership_generation from queue_read_fixture f
cross join lateral(values(f.org_a,f.queue_a,f.user_a),(f.org_b,f.queue_b,f.user_b)) v(org,q,actor)
join public.organization_members om on om.organization_id=v.org and om.user_id=v.actor;
insert into public.leads(id,organization_id,name,source)
select lead_a,org_a,'Synthetic pool A','manual' from queue_read_fixture
union all select lead_b,org_b,'Synthetic pool B','manual' from queue_read_fixture
union all select no_pool,org_a,'Synthetic ordinary lead','manual' from queue_read_fixture;
insert into private.queue_lead_runtime(organization_id,lead_id,round_robin_id,state,reason,max_assignments,baseline_at,entered_pool_at)
select org_a,lead_a,queue_a,'pool_ready','ci_read_dependency',0,clock_timestamp(),clock_timestamp() from queue_read_fixture
union all select org_b,lead_b,queue_b,'pool_ready','ci_read_dependency',0,clock_timestamp(),clock_timestamp() from queue_read_fixture;

-- Regular brokers exercise the actual member/window chain, without the
-- implicit admin branch. Seven all-day UTC entries avoid clock-boundary flakes.
select ok((private.queue_window(org_a,queue_a,clock_timestamp())->>'managed')::boolean
  and (private.queue_window(org_a,queue_a,clock_timestamp())->>'valid')::boolean
  and (private.queue_window(org_a,queue_a,clock_timestamp())->>'open')::boolean,
  'managed window is valid and open') from queue_read_fixture;
select is((select count(*)::integer from public.round_robin_members m
  join public.organization_members om on om.organization_id=m.organization_id and om.user_id=m.user_id
    and om.membership_generation=m.membership_generation
  join queue_read_fixture f on m.round_robin_id in(f.queue_a,f.queue_b)),2,'real queue memberships match current generation');
select is((select count(*)::integer from private.queue_runtime_members(f.org_a,f.queue_a,clock_timestamp()) m
  where m.user_id=f.user_a and m.is_available and m.window_key like f.queue_a::text||':%'),1,
  'direct member resolves real open window') from queue_read_fixture f;
select is(private.queue_pool_read_access(org_a,lead_a,user_a),true,'A reads own pool') from queue_read_fixture;
select is(private.queue_pool_read_access(org_b,lead_b,user_b),true,'B reads own pool') from queue_read_fixture;
select is(private.queue_pool_read_access(org_a,lead_a,user_b),false,'foreign actor cannot read A pool') from queue_read_fixture;
select is(private.queue_pool_read_access(org_a,lead_a,gen_random_uuid()),false,'unknown actor denied') from queue_read_fixture;
select ok(private.queue_pool_read_access(org_a,no_pool,user_a) is null,'ordinary lead preserves NULL legacy fallback') from queue_read_fixture;
set local role authenticated;
select set_config('request.jwt.claim.sub',user_b::text,true) from queue_read_fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',user_b,'role','authenticated','session_id',session_b)::text,true) from queue_read_fixture;
select is(auth.uid(),user_b,'actual authenticated actor is B') from queue_read_fixture;
select is(private.queue_pool_read_access(org_b,lead_b,auth.uid()),true,'bound B sees own pool') from queue_read_fixture;
select is(private.queue_pool_read_access(org_a,lead_a,auth.uid()),false,'bound B denied foreign pool') from queue_read_fixture;
select is(private.queue_pool_read_access(org_a,lead_a,user_a),false,'B cannot impersonate A via actor parameter') from queue_read_fixture;
reset role;
update public.users u set is_active=false from queue_read_fixture f where u.id=f.user_a;
select is(private.queue_pool_read_access(org_a,lead_a,user_a),false,'inactive real actor denied') from queue_read_fixture;
select is((select count(*)::integer from private.queue_lead_runtime r join queue_read_fixture f on r.organization_id in(f.org_a,f.org_b)),2,
  'read authorization preserves both pool rows');
select ok(not has_table_privilege('authenticated','private.queue_lead_runtime','select'),'browser has no direct private runtime table grant');
select is((select count(*)::integer from pg_policies where schemaname='public' and tablename='leads'
  and policyname='queue_pool_private_read' and permissive='RESTRICTIVE'),1,'canonical restrictive pool policy installed');
select * from finish();
rollback;
