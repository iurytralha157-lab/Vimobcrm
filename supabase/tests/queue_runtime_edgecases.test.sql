begin;
do $cases$
declare
  org uuid:='10000000-0000-4000-8000-000000000001';
  queue uuid:='30000000-0000-4000-8000-000000000001'; closed_queue uuid:='30000000-0000-4000-8000-000000000002';
  a uuid:='20000000-0000-4000-8000-000000000001'; b uuid:='20000000-0000-4000-8000-000000000002'; admin uuid:='20000000-0000-4000-8000-000000000006';
  lead uuid:='50000000-0000-4000-8000-000000000001'; human_lead uuid:='50000000-0000-4000-8000-000000000002';
  closed_lead uuid:='50000000-0000-4000-8000-000000000003'; alert_lead uuid:='50000000-0000-4000-8000-000000000004';
  all_day jsonb; all_off jsonb; daytime jsonb; result jsonb; r private.queue_lead_runtime%rowtype; old_revision bigint;
  old_assigned timestamptz; old_count integer; new_count integer; k integer; owner uuid; previous uuid; pending_message uuid:=gen_random_uuid();
  current_cycle uuid:=gen_random_uuid(); old_cycle uuid:=gen_random_uuid(); warning_metadata jsonb; alert_metadata jsonb; first_receipt jsonb;
  wake_lead uuid:='50000000-0000-4000-8000-000000000006'; shift_queue uuid:='30000000-0000-4000-8000-000000000006';
  shift_lead uuid:='50000000-0000-4000-8000-000000000007'; shift_pool_lead uuid:='50000000-0000-4000-8000-000000000008';
  current_window jsonb; shift_end timestamptz; missed_end timestamptz;
begin
  insert into public.organizations(id) values(org);
  insert into public.users(id,name) values(a,'Synthetic A'),(b,'Synthetic B'),(admin,'Synthetic Admin');
  insert into public.organization_members(organization_id,user_id,role) values(org,a,'user'),(org,b,'user'),(org,admin,'admin');
  select jsonb_build_object('version',1,'timezone','UTC','days',jsonb_agg(jsonb_build_object('day_of_week',n,'is_active',true,
    'is_all_day',true,'start_time',null,'end_time',null))) into all_day from generate_series(0,6)n;
  select jsonb_set(all_day,'{days}',jsonb_agg(jsonb_build_object('day_of_week',n,'is_active',false,
    'is_all_day',false,'start_time',null,'end_time',null))) into all_off from generate_series(0,6)n;
  select jsonb_set(all_day,'{days}',jsonb_agg(jsonb_build_object('day_of_week',n,'is_active',true,
    'is_all_day',false,'start_time','08:00','end_time','23:00'))) into daytime from generate_series(0,6)n;
  perform private.fixture_assert(private.queue_schedule_valid(all_off),'explicit all-off week supported');
  insert into public.round_robins(id,organization_id,strategy,settings) values(queue,org,'weighted',jsonb_build_object(
    'operating_schedule',daytime,'enable_redistribution',true,'redistribution_timeout_minutes',1,'redistribution_warning_minutes',0,'redistribution_max_attempts',0)),
    (closed_queue,org,'simple',jsonb_build_object('operating_schedule',all_off));
  perform private.fixture_assert(not(private.queue_window(org,queue,'2026-10-14 07:59:59+00')->>'open')::boolean,'before opening closed');
  perform private.fixture_assert((private.queue_window(org,queue,'2026-10-14 08:00:00+00')->>'open')::boolean,'opening inclusive');
  perform private.fixture_assert((private.queue_window(org,queue,'2026-10-14 22:59:59+00')->>'open')::boolean,'before closing open');
  perform private.fixture_assert(not(private.queue_window(org,queue,'2026-10-14 23:00:00+00')->>'open')::boolean,'closing exclusive');
  perform private.fixture_assert(not(private.queue_window(org,closed_queue)->>'open')::boolean,'all-off queue closed');
  update public.round_robins set settings=jsonb_set(settings,'{operating_schedule}',all_day) where id=queue;
  insert into public.round_robin_members(id,organization_id,round_robin_id,user_id,position,weight)
    values('40000000-0000-4000-8000-000000000001',org,queue,a,1,3),('40000000-0000-4000-8000-000000000002',org,queue,b,2,1),
      ('40000000-0000-4000-8000-000000000003',org,closed_queue,a,1,1),('40000000-0000-4000-8000-000000000004',org,closed_queue,b,2,1);
  perform private.fixture_assert((select array_agg(p.user_id order by n)=array[a,b,a,a] from generate_series(1,4)n
    cross join lateral private.pick_queue_runtime_ticket_candidate(org,queue,'weighted',n,clock_timestamp())p),'weighted initial 3:1 IWRR');
  update public.round_robin_members set is_active=false where round_robin_id=queue and user_id=b;
  insert into public.leads(id,organization_id,origin_round_robin_id) values(lead,org,queue);
  result:=private.distribute_lead(org,lead,'sole-initial',queue,false,'meta');
  first_receipt:=jsonb_build_object('distribution_event_id',result->>'distribution_event_id');
  perform private.fixture_assert(result->>'assigned_user_id'=a::text,'sole initial assigned A');
  select assigned_at into old_assigned from public.leads where id=lead;
  result:=private.queue_runtime_step(org,lead,clock_timestamp(),true);
  perform private.fixture_assert(result->>'reason'='queue_waiting','sole current owner no-op');
  perform private.fixture_assert((select assigned_at=old_assigned from public.leads where id=lead),'no-op never resets SLA');
  perform private.fixture_assert((select assignment_count=0 and round_number=1 from private.queue_lead_runtime where lead_id=lead),'no-op consumes neither round nor redistribution budget');
  perform private.queue_runtime_pool(org,lead,'member_unavailable',clock_timestamp(),private.queue_window(org,queue));
  result:=private.queue_runtime_step(org,lead,clock_timestamp(),true);
  perform private.fixture_assert(not(result->>'success')::boolean and (select assigned_user_id is null from public.leads where id=lead),'same availability window cannot manufacture A NULL A');
  update private.queue_lead_runtime set last_window_key='genuine_previous_window' where lead_id=lead;
  result:=private.queue_runtime_step(org,lead,clock_timestamp(),true);
  perform private.fixture_assert(result->>'assigned_user_id'=a::text,'sole old owner can resume in genuine new window');
  perform private.fixture_assert(not private.queue_notification_delivery_allowed(org,lead,a,'new_lead_received',first_receipt),'old A receipt not reauthorized after A pool A new assignment');
  perform private.fixture_assert((select max_assignments=0 from private.queue_lead_runtime where lead_id=lead),'zero keeps configured unlimited semantics');
  update public.round_robin_members set is_active=true where round_robin_id=queue and user_id=b;
  result:=private.queue_runtime_step(org,lead,clock_timestamp(),true);
  perform private.fixture_assert(result->>'assigned_user_id'=b::text,'newly available unvisited B before repeat A');
  select assignment_count,revision,due_at into old_count,old_revision,old_assigned from private.queue_lead_runtime where lead_id=lead;
  result:=private.distribute_lead(org,lead,'old-background-pool-rpc',queue,false,'pool');
  perform private.fixture_assert(result->>'reason'='queue_waiting' and (select assignment_count=old_count and revision=old_revision and due_at=old_assigned
    from private.queue_lead_runtime where lead_id=lead),'legacy pool RPC cannot force advance before due');

  -- Team-backed candidates fail closed when no actual schedule exists.
  insert into public.teams(id,organization_id) values('60000000-0000-4000-8000-000000000001',org);
  insert into public.team_members(id,organization_id,team_id,user_id) values('70000000-0000-4000-8000-000000000001',org,'60000000-0000-4000-8000-000000000001',a);
  insert into public.round_robin_members(id,organization_id,round_robin_id,team_id,position) values('40000000-0000-4000-8000-000000000005',org,queue,'60000000-0000-4000-8000-000000000001',3);
  update public.round_robin_members set is_active=false where round_robin_id=queue and user_id=a;
  perform private.fixture_assert(not(select is_available from private.queue_runtime_members(org,queue,clock_timestamp()) where user_id=a),'team missing schedule is unavailable');
  insert into public.member_availability(organization_id,team_member_id,day_of_week,start_time,end_time)
    values(org,'70000000-0000-4000-8000-000000000001',3,'22:00','06:00');
  perform private.fixture_assert((select is_available from private.queue_runtime_members(org,queue,'2026-10-14 22:00:00+00') where user_id=a),'member overnight opens inclusive');
  perform private.fixture_assert((select is_available from private.queue_runtime_members(org,queue,'2026-10-15 05:59:59+00') where user_id=a),'overnight carries next day');
  perform private.fixture_assert(not(select is_available from private.queue_runtime_members(org,queue,'2026-10-15 06:00:00+00') where user_id=a),'member end exclusive');
  update public.round_robin_members set is_active=true where round_robin_id=queue and user_id=a;

  -- Initial closed intake creates exactly one actual pool entry and no ticket.
  insert into public.leads(id,organization_id,origin_round_robin_id) values(closed_lead,org,closed_queue);
  result:=private.distribute_lead(org,closed_lead,'closed-intake',closed_queue,false,'meta');
  perform private.fixture_assert(result->>'reason'='queue_closed','closed intake preserved');
  perform private.fixture_assert((select count(*)=1 from private.queue_runtime_events where lead_id=closed_lead and event_type='entered_pool'),'first closed intake entry event');
  perform private.fixture_assert(not exists(select 1 from private.lead_distribution_events where lead_id=closed_lead and distribution_ticket is not null),'closed never consumes queue ticket');
  select count(*) into old_count from private.lead_distribution_events;
  update private.queue_lead_runtime set next_action_at=clock_timestamp() where lead_id=closed_lead;
  result:=private.process_queue_runtime_batch(50);
  perform private.fixture_assert((select count(*)=old_count from private.lead_distribution_events),'no eligible pending check does not flood idempotency ledger');
  perform private.fixture_assert((select next_action_at<=clock_timestamp()+interval '31 seconds' from private.queue_lead_runtime where lead_id=closed_lead),'pool waits bounded for schedule reconfiguration');
  perform private.fixture_assert(not exists(select 1 from public.notifications where type='queue_pool_available'),'pool notifications opt-in disabled');
  update public.round_robins set settings=settings||'{"pool_notifications":{"enabled":true}}' where id=closed_queue;
  insert into public.leads(id,organization_id,origin_round_robin_id) values(alert_lead,org,closed_queue);
  result:=private.distribute_lead(org,alert_lead,'alert-intake',closed_queue,false,'meta');
  select metadata into alert_metadata from public.notifications where lead_id=alert_lead and user_id=a and type='queue_pool_available';
  perform private.fixture_assert(alert_metadata is not null,'atomic initial pool alert created');
  perform private.fixture_assert(not exists(select 1 from public.notifications where type='queue_pool_available' and user_id=admin),'admin visibility does not subscribe outsider admin to alerts');
  perform private.fixture_assert(private.notification_dispatch_required(alert_metadata#>'{dispatch,whatsapp,required}') and private.notification_dispatch_required(alert_metadata#>'{dispatch,push,required}'),'real outbox required predicate accepts WA and push metadata');
  select * into r from private.queue_lead_runtime where lead_id=alert_lead;
  perform private.enqueue_queue_pool_alert(org,alert_lead,r.episode_id,r.revision);
  perform private.fixture_assert((select count(*)=2 from public.notifications where type='queue_pool_available'),'per-queue user cooldown and exact event dedupe');
  perform private.fixture_assert(private.queue_notification_delivery_allowed(org,alert_lead,a,'queue_pool_available',alert_metadata),'pending pool alert authorized');
  update public.round_robin_members set is_active=false where round_robin_id=closed_queue and user_id=a;
  perform private.fixture_assert(not private.queue_notification_delivery_allowed(org,alert_lead,a,'queue_pool_available',alert_metadata),'removed member cancels pending pool alert');
  update public.round_robin_members set is_active=true where round_robin_id=closed_queue and user_id=a;
  update public.users set is_active=false where id=a;
  perform private.fixture_assert(not private.queue_notification_delivery_allowed(org,alert_lead,a,'queue_pool_available',alert_metadata),'inactive user cancels pending pool alert');
  update public.users set is_active=true where id=a;
  result:=private.claim_queue_pool(org,alert_lead,a,closed_queue,r.episode_id,r.revision,'alert-claim');
  perform private.fixture_assert(result->>'reason'='claimed','manual claim does not need open queue');
  perform private.fixture_assert(not private.queue_notification_delivery_allowed(org,alert_lead,a,'queue_pool_available',alert_metadata),'claimed before delivery cancels old pool alert');

  -- Old queued warnings are reauthorized under current configuration.
  insert into public.leads(id,organization_id,origin_round_robin_id) values(human_lead,org,queue);
  result:=private.distribute_lead(org,human_lead,'warning-initial',queue,false,'meta');
  owner:=(result->>'assigned_user_id')::uuid; previous:=case when owner=a then b else a end;
  update public.round_robins set settings=settings||'{"redistribution_timeout_minutes":6,"redistribution_warning_minutes":5}' where id=queue;
  update private.queue_lead_runtime set due_at=clock_timestamp()+interval '30 seconds' where lead_id=human_lead;
  result:=private.queue_runtime_step(org,human_lead,clock_timestamp());
  select metadata into warning_metadata from public.notifications where lead_id=human_lead and type='lead_redistribution_warning';
  perform private.fixture_assert(warning_metadata is not null,'timeout six emits configured warning');
  perform private.fixture_assert(private.queue_notification_delivery_allowed(org,human_lead,owner,'lead_redistribution_warning',warning_metadata),'timeout six current warning authorized');
  foreach k in array array[1,4,5] loop
    update public.round_robins set settings=settings||jsonb_build_object('redistribution_timeout_minutes',k,'redistribution_warning_minutes',0) where id=queue;
    perform private.fixture_assert(not private.queue_notification_delivery_allowed(org,human_lead,owner,'lead_redistribution_warning',warning_metadata),'queued warning cancelled at timeout '||k);
  end loop;
  update public.round_robins set settings=settings||'{"redistribution_timeout_minutes":6,"redistribution_warning_minutes":5}' where id=queue;

  -- The legacy fact/cycle capture classifies pending WhatsApp as outreach;
  -- runtime must still require confirmed provider status in the matching cycle.
  insert into public.lead_assignment_cycles(id,organization_id,lead_id,assigned_user_id,assigned_at,ended_at,first_human_outreach_at)
    values(current_cycle,org,human_lead,owner,clock_timestamp()-interval '1 minute',null,clock_timestamp()),
      (old_cycle,org,human_lead,previous,clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute',null);
  insert into public.whatsapp_messages(id,organization_id,lead_id,sender_user_id,status,from_me,direction)
    values(pending_message,org,human_lead,owner,'pending',true,'outbound');
  insert into public.lead_action_facts(organization_id,lead_id,actor_user_id,assignment_cycle_id,occurred_at,action_type,source_type,source_id,qualifies_first_outreach)
    values(org,human_lead,owner,current_cycle,clock_timestamp(),'whatsapp_outbound','whatsapp_message',pending_message::text,true);
  perform private.fixture_assert(not private.queue_runtime_has_human_activity(org,human_lead,(select baseline_at from private.queue_lead_runtime where lead_id=human_lead)),'pending fact and cycle do not protect');
  update public.whatsapp_messages set status='failed' where id=pending_message;
  perform private.fixture_assert(not private.queue_runtime_has_human_activity(org,human_lead,(select baseline_at from private.queue_lead_runtime where lead_id=human_lead)),'failed outbound does not protect');
  insert into public.lead_timeline_events(organization_id,lead_id,actor_user_id,user_id,event_type,event_at,metadata)
    values(org,human_lead,previous,previous,'first_response',clock_timestamp(),'{"is_automation":false}');
  perform private.fixture_assert(not private.queue_runtime_has_human_activity(org,human_lead,(select baseline_at from private.queue_lead_runtime where lead_id=human_lead)),'old-assignee manual first response not current proof');
  insert into public.lead_timeline_events(organization_id,lead_id,actor_user_id,user_id,event_type,event_at,metadata)
    values(org,human_lead,owner,owner,'first_response',clock_timestamp(),'{"is_automation":false}');
  perform private.fixture_assert(private.queue_runtime_has_human_activity(org,human_lead,(select baseline_at from private.queue_lead_runtime where lead_id=human_lead)),'explicit current manual first response protects without fact');
  delete from public.lead_timeline_events where lead_id=human_lead and event_type='first_response';
  update public.whatsapp_messages set status='delivered',sender_user_id=previous where id=pending_message;
  update public.lead_action_facts set actor_user_id=previous,assignment_cycle_id=old_cycle where lead_id=human_lead;
  perform private.fixture_assert(not private.queue_runtime_has_human_activity(org,human_lead,(select baseline_at from private.queue_lead_runtime where lead_id=human_lead)),'late old-owner confirmed event does not protect new cycle');
  update public.whatsapp_messages set sender_user_id=owner,metadata='{"is_automation":true}' where id=pending_message;
  update public.lead_action_facts set actor_user_id=owner,assignment_cycle_id=current_cycle where lead_id=human_lead;
  perform private.fixture_assert(not private.queue_runtime_has_human_activity(org,human_lead,(select baseline_at from private.queue_lead_runtime where lead_id=human_lead)),'confirmed AI outbound does not protect');
  update public.whatsapp_messages set status='sent',metadata='{}' where id=pending_message;
  perform private.fixture_assert(private.queue_runtime_has_human_activity(org,human_lead,(select baseline_at from private.queue_lead_runtime where lead_id=human_lead)),'confirmed current human outbound protects');
  perform private.fixture_assert(not private.queue_notification_delivery_allowed(org,human_lead,owner,'lead_redistribution_warning',warning_metadata),'human contact cancels pending warning');
  result:=private.queue_runtime_step(org,human_lead,clock_timestamp(),true);
  perform private.fixture_assert(result->>'reason'='queue_protected','human protected owner not rotated');

  -- Queue retry is capped independently of business redistribution budget.
  select assignment_count,revision into old_count,old_revision from private.queue_lead_runtime where lead_id=lead;
  update private.queue_lead_runtime set due_at=clock_timestamp()-interval '1 minute',next_action_at=clock_timestamp() where lead_id=lead;
  execute 'create function private.fixture_delivery_failure() returns trigger language plpgsql as $f$begin if new.type=''lead_assigned'' and new.lead_id=''50000000-0000-4000-8000-000000000001''::uuid then raise exception ''forced_fixture_delivery_failure''; end if; return new; end;$f$';
  execute 'create trigger fixture_delivery_failure before insert on public.notifications for each row execute function private.fixture_delivery_failure()';
  for k in 1..5 loop
    update private.queue_lead_runtime set next_action_at=clock_timestamp() where lead_id=lead;
    result:=private.process_queue_runtime_batch(50);
    perform private.fixture_assert((result->>'failed')::integer=1,'forced failure retry '||k);
  end loop;
  perform private.fixture_assert((select retry_count=5 and quarantined_at is not null and next_action_at is null and assignment_count=old_count and revision=old_revision and reason='round_assignment'
    from private.queue_lead_runtime where lead_id=lead),'fifth failure quarantines without consuming owner round budget or business reason');
  result:=private.process_queue_runtime_batch(50);
  perform private.fixture_assert((result->>'failed')::integer=0,'quarantined item not polled forever');
  execute 'drop trigger fixture_delivery_failure on public.notifications';
  perform private.fixture_assert(private.prepare_queue_manual_transfer(org,lead,admin,a),'authorized manual recovery supported');
  update public.leads set assigned_user_id=a,assigned_at=clock_timestamp() where id=lead;
  perform private.fixture_assert((select state='manual_protected' and quarantined_at is null from private.queue_lead_runtime where lead_id=lead),'manual recovery preserves protection');

  -- Worker downtime across a genuine queue closure must materialize the
  -- missed boundary even if the next queue window is already open.
  select jsonb_set(all_day,'{days}',jsonb_agg(jsonb_build_object('day_of_week',n,'is_active',true,'is_all_day',false,
    'start_time',to_char(clock_timestamp() at time zone 'UTC'-interval '10 minutes','HH24:MI:SS'),
    'end_time',to_char(clock_timestamp() at time zone 'UTC'+interval '10 minutes','HH24:MI:SS')))) into current_window from generate_series(0,6)n;
  update public.round_robins set settings=jsonb_set(settings,'{operating_schedule}',current_window) where id=queue;
  insert into public.leads(id,organization_id,origin_round_robin_id) values(wake_lead,org,queue);
  result:=private.distribute_lead(org,wake_lead,'missed-close-initial',queue,false,'meta');
  owner:=(result->>'assigned_user_id')::uuid;
  missed_end:=(((clock_timestamp() at time zone 'UTC')::date-1)+(current_window->'days'->0->>'end_time')::time) at time zone 'UTC';
  update private.queue_lead_runtime set last_queue_close_at=missed_end,last_window_key='prior_real_queue_window' where lead_id=wake_lead;
  update public.round_robin_members set is_active=false where round_robin_id=queue and user_id is distinct from owner;
  result:=private.queue_runtime_step(org,wake_lead,clock_timestamp());
  perform private.fixture_assert(result->>'reason'='queue_closed' and (select assigned_user_id is null from public.leads where id=wake_lead),'missed genuine close reconciled despite currently open queue');
  result:=private.queue_runtime_step(org,wake_lead,clock_timestamp());
  perform private.fixture_assert(result->>'assigned_user_id'=owner::text and (select assignment_count=1 from private.queue_lead_runtime where lead_id=wake_lead),'new window sole old owner resumes exactly once after missed close');
  result:=private.queue_runtime_step(org,wake_lead,clock_timestamp(),true);
  perform private.fixture_assert(result->>'reason'='queue_waiting' and (select assignment_count=1 from private.queue_lead_runtime where lead_id=wake_lead),'resumed sole owner cannot loop again');

  -- Exact member shift end routes to another eligible participant, or pools
  -- when none exists; initial next_action_at never overshoots that boundary.
  insert into public.round_robins(id,organization_id,settings) values(shift_queue,org,jsonb_build_object('operating_schedule',all_day,
    'enable_redistribution',true,'redistribution_timeout_minutes',20,'redistribution_warning_minutes',0));
  delete from public.member_availability;
  shift_end:=date_trunc('second',clock_timestamp())+interval '10 seconds';
  insert into public.member_availability(organization_id,team_member_id,day_of_week,start_time,end_time)
    select org,'70000000-0000-4000-8000-000000000001',n,(clock_timestamp() at time zone 'UTC'-interval '10 minutes')::time,(shift_end at time zone 'UTC')::time from generate_series(0,6)n;
  insert into public.round_robin_members(id,organization_id,round_robin_id,team_id,position)
    values('40000000-0000-4000-8000-000000000006',org,shift_queue,'60000000-0000-4000-8000-000000000001',1);
  insert into public.round_robin_members(id,organization_id,round_robin_id,user_id,position)
    values('40000000-0000-4000-8000-000000000007',org,shift_queue,b,2);
  insert into public.leads(id,organization_id,origin_round_robin_id) values(shift_lead,org,shift_queue);
  result:=private.distribute_lead(org,shift_lead,'member-shift-initial',shift_queue,false,'meta');
  perform private.fixture_assert(result->>'assigned_user_id'=a::text,'team recipient initially selected');
  perform private.fixture_assert((select next_action_at<=shift_end from private.queue_lead_runtime where lead_id=shift_lead),'initial deadline at most member end');
  result:=private.queue_runtime_step(org,shift_lead,shift_end);
  perform private.fixture_assert(result->>'assigned_user_id'=b::text,'exact member end transfers to eligible B');
  update public.round_robin_members set is_active=false where round_robin_id=shift_queue and user_id=b;
  insert into public.leads(id,organization_id,origin_round_robin_id) values(shift_pool_lead,org,shift_queue);
  result:=private.distribute_lead(org,shift_pool_lead,'member-shift-sole-initial',shift_queue,false,'meta');
  perform private.fixture_assert(result->>'assigned_user_id'=a::text,'sole team member initially receives');
  result:=private.queue_runtime_step(org,shift_pool_lead,shift_end);
  perform private.fixture_assert(result->>'reason'='pooled' and (select assigned_user_id is null from public.leads where id=shift_pool_lead),'member end without alternative enters pool');
end;
$cases$;
set constraints all immediate;
rollback;
