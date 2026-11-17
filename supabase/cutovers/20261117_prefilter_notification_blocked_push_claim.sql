\set ON_ERROR_STOP on
-- Explicit operation only: psql -v direction=apply|rollback -f this-file.sql.
-- Preserve an owning-host pg_get_functiondef preimage before apply. This patch
-- changes eligibility planning only; leases and dispatch fences stay intact.
begin;
set local lock_timeout = '500ms';
set local statement_timeout = '10s';
select set_config('vimob.notification_blocked_push_prefilter.direction', :'direction', true);

do $guard$
declare
  target constant regprocedure := to_regprocedure('private.claim_notification_deliveries(text,integer,interval,text[])');
  unstarted constant regprocedure := to_regprocedure('private.whatsapp_inbound_push_is_unstarted(private.notification_deliveries)');
  reassignment constant regprocedure := to_regprocedure('private.whatsapp_inbound_push_needs_reassignment(private.notification_deliveries)');
  before_md5 constant text := 'fd5d88955a50359567c13b09780ac644';
  after_md5 constant text := '5745e185e04aeafdde8d0486bed3de60';
  direction constant text := current_setting('vimob.notification_blocked_push_prefilter.direction');
  before_anchor constant text := $a$or (right(p_worker_id,11)='|wa_push_v2' and delivery.status='blocked_dependency' and private.whatsapp_inbound_push_needs_reassignment(delivery)))$a$;
  after_anchor constant text := $a$or (right(p_worker_id,11)='|wa_push_v2' and delivery.status='blocked_dependency' and delivery.channel='push' and delivery.attempt_count=0 and private.whatsapp_inbound_push_needs_reassignment(delivery)))$a$;
  original text;
  definition text;
  attributes jsonb;
  expected_before text;
  expected_after text;
  from_anchor text;
  to_anchor text;
  next_body text;
begin
  if direction not in ('apply','rollback') or direction is null
     or target is null or current_user <> 'postgres' or current_user <> session_user then
    raise exception 'notification_blocked_push_prefilter_invalid_preflight';
  end if;
  -- needs_reassignment => is_unstarted => channel=push AND attempt_count=0.
  -- Reject drift in both helpers rather than assume the implication survives.
  if direction = 'apply' and not (
    exists (select 1 from pg_proc p where p.oid=unstarted and p.prosecdef and p.provolatile='s'
      and md5(replace(p.prosrc,chr(13),''))='879771f67242142eedd0476a19fa3cf9')
    and exists (select 1 from pg_proc p where p.oid=reassignment and p.prosecdef and p.provolatile='s'
      and md5(replace(p.prosrc,chr(13),''))='c7cf2a769055bb43cca329b36e9c4dd9')
  ) then
    raise exception 'notification_blocked_push_prefilter_helper_drift';
  end if;
  perform pg_advisory_xact_lock(target::oid::bigint);
  select replace(p.prosrc,chr(13),''), replace(pg_get_functiondef(p.oid),chr(13),''),
         to_jsonb(p)-array['prosrc','prosqlbody']
    into original,definition,attributes
  from pg_proc p where p.oid=target and p.proowner='postgres'::regrole
    and p.prosecdef and p.provolatile='v' and p.proconfig=array['search_path=""'];
  expected_before := case when direction='apply' then before_md5 else after_md5 end;
  expected_after := case when direction='apply' then after_md5 else before_md5 end;
  from_anchor := case when direction='apply' then before_anchor else after_anchor end;
  to_anchor := case when direction='apply' then after_anchor else before_anchor end;
  if original is null or md5(original)<>expected_before then
    raise exception 'notification_blocked_push_prefilter_preimage_drift';
  end if;
  if length(original)-length(replace(original,from_anchor,''))<>length(from_anchor)
     or length(definition)-length(replace(definition,from_anchor,''))<>length(from_anchor) then
    raise exception 'notification_blocked_push_prefilter_anchor_drift';
  end if;
  next_body := replace(original,from_anchor,to_anchor);
  if md5(next_body)<>expected_after then
    raise exception 'notification_blocked_push_prefilter_postimage_drift';
  end if;
  execute replace(definition,from_anchor,to_anchor);
  if not exists (select 1 from pg_proc p where p.oid=target
    and replace(p.prosrc,chr(13),'')=next_body
    and to_jsonb(p)-array['prosrc','prosqlbody']=attributes) then
    raise exception 'notification_blocked_push_prefilter_postcondition_failed';
  end if;
end;
$guard$;
commit;
