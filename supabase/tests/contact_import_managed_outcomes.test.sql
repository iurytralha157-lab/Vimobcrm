-- Execute only in a migrated disposable local database. No real contact payload.
begin;
set local statement_timeout='30s';
do $test$
declare outcome text; n integer:=0; receipt private.contact_import_request_receipts%rowtype;
  org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); key uuid:=gen_random_uuid(); lead uuid:=gen_random_uuid();
begin
  if current_database() not like 'vimob\_%' escape '\' then raise exception 'requires disposable local vimob_ database';end if;
  foreach outcome in array array['assigned','already_assigned','no_matching_queue','no_available_members','skipped','reentry_preserved',
    'pooled','queue_closed','queue_waiting','queue_limit_reached','queue_protected'] loop
    key:=gen_random_uuid();
    insert into private.contact_import_request_receipts(organization_id,actor_id,request_key,payload_sha256)
      values(org,actor,key,repeat('a',64));
    update private.contact_import_request_receipts set lead_id=lead,reentry=false,distribution_outcome=outcome,completed_at=clock_timestamp()
      where organization_id=org and actor_id=actor and request_key=key;
    select * into strict receipt from private.contact_import_request_receipts
      where organization_id=org and actor_id=actor and request_key=key;
    if receipt.lead_id<>lead or receipt.distribution_outcome<>outcome or receipt.completed_at is null then
      raise exception 'completed outcome % did not survive receipt reload',outcome;end if;
    n:=n+1;
    begin
      insert into private.contact_import_request_receipts(organization_id,actor_id,request_key,payload_sha256)
        values(org,actor,key,repeat('a',64));
      raise exception 'duplicate replay key accepted';
    exception when unique_violation then null;end;
  end loop;
  if n<>11 then raise exception 'outcome coverage incomplete';end if;
  foreach outcome in array array['','queue_busy','config_changed','processing','future_outcome','ASSIGNED',null] loop
    begin
      insert into private.contact_import_request_receipts(organization_id,actor_id,request_key,payload_sha256,lead_id,reentry,distribution_outcome,completed_at)
        values(org,actor,gen_random_uuid(),repeat('a',64),lead,false,outcome,clock_timestamp());
      raise exception 'invalid completed outcome accepted: %',outcome;
    exception when check_violation then null;end;
  end loop;
  begin
    insert into private.contact_import_request_receipts(organization_id,actor_id,request_key,payload_sha256,lead_id)
      values(org,actor,gen_random_uuid(),repeat('a',64),lead);
    raise exception 'partially completed receipt accepted';
  exception when check_violation then null;end;
  -- A request UUID is actor+organization scoped, not a global identity.
  insert into private.contact_import_request_receipts(organization_id,actor_id,request_key,payload_sha256)
    values(gen_random_uuid(),actor,key,repeat('a',64)),(org,gen_random_uuid(),key,repeat('a',64));
  if has_table_privilege('authenticated','private.contact_import_request_receipts','select,insert,update,delete')
    or has_table_privilege('service_role','private.contact_import_request_receipts','select,insert,update,delete') then
    raise exception 'receipt private ACL regressed';end if;
end;
$test$;
rollback;
