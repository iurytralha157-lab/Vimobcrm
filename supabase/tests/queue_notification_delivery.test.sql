begin;
grant insert on public.notifications to authenticated;
set local role authenticated;
do $test$
begin
  begin
    insert into public.notifications(organization_id,user_id,type,title,metadata)
      values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
        'queue_pool_available','Forged backend alert','{"event_key":"queue_pool_available","dispatch":{"whatsapp":{"required":true}}}');
    raise exception 'forged_queue_alert_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'queue_pool_notification_backend_owned' then raise exception 'unexpected_notification_denial: %',sqlerrm; end if;
  end;
  insert into public.notifications(organization_id,user_id,type,title,metadata)
    values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','info','Ordinary notification','{}');
end;
$test$;
reset role;
select private.fixture_assert(not exists(select 1 from public.notifications where type='queue_pool_available'),
  'direct Data API cannot forge a throttled backend pool event');
rollback;
