begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- A capability carried only by the new Go worker prevents older replicas
-- from consuming this backend event during a migration-first rolling release.
-- Generic notification events retain their previous scheduling rules.
do $protocol$
declare v_definition text; v_old text; v_new text;
begin
  select replace(pg_catalog.pg_get_functiondef('private.claim_notification_deliveries(text,integer,interval,text[])'::regprocedure),E'\r\n',E'\n')
    into v_definition;
  v_old := 'if p_channels is null or ''push''=any(p_channels) then';
  v_new := 'if right(p_worker_id,11)=''|wa_push_v2'' and (p_channels is null or ''push''=any(p_channels)) then';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'whatsapp_push_protocol_waiting_source_drift';
  end if;
  v_definition:=replace(v_definition,v_old,v_new);

  v_old := '(delivery.status=''blocked_dependency'' and private.whatsapp_inbound_push_needs_reassignment(delivery))';
  v_new := '(right(p_worker_id,11)=''|wa_push_v2'' and delivery.status=''blocked_dependency'' and private.whatsapp_inbound_push_needs_reassignment(delivery))';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'whatsapp_push_protocol_blocked_source_drift';
  end if;
  v_definition:=replace(v_definition,v_old,v_new);

  v_old := 'or private.whatsapp_inbound_push_is_unstarted(delivery)';
  v_new := 'or (right(p_worker_id,11)=''|wa_push_v2'' and private.whatsapp_inbound_push_is_unstarted(delivery))';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'whatsapp_push_protocol_token_source_drift';
  end if;
  v_definition:=replace(v_definition,v_old,v_new);

  -- Some original replicas have no WhatsApp authorization fence at all.
  -- Gate active tokens and retries too, not only the newly added exceptions.
  v_old := 'and (p_channels is null or delivery.channel = any(p_channels))';
  v_new := 'and (p_channels is null or delivery.channel = any(p_channels))
        and (right(p_worker_id,11)=''|wa_push_v2'' or delivery.channel<>''push'' or not exists (
          select 1 from public.notifications notification where notification.id=delivery.notification_id
            and notification.organization_id=delivery.organization_id
            and notification.metadata->>''event_key''=''whatsapp_inbound_attendant''
        ))';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'whatsapp_push_protocol_event_source_drift';
  end if;
  execute replace(v_definition,v_old,v_new);
end;
$protocol$;
commit;
