-- Make the durable outbox head index cover both ordinary attempts and the
-- provider-accepted/local-finalization recovery branch. A populated live table
-- must prepare this index concurrently with the paired cutover first.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';

do $prepare_whatsapp_outbox_finalization_index$
begin
  if to_regclass('public.whatsapp_outbox') is null then
    raise exception 'WhatsApp outbox foundation is not installed';
  end if;

  if to_regclass('public.whatsapp_outbox_conversation_due_head_v2_idx') is null then
    begin
      lock table public.whatsapp_outbox in share mode nowait;
    exception
      when lock_not_available then
        raise exception using
          message = 'WhatsApp outbox finalization index was not prepared',
          hint = 'Run supabase/cutovers/20260912_prepare_whatsapp_outbox_finalization_index.sql first.';
    end;

    if exists (select 1 from public.whatsapp_outbox limit 1)
       or pg_relation_size('public.whatsapp_outbox'::regclass) > 64 * 1024 * 1024
    then
      raise exception using
        message = 'WhatsApp outbox finalization index is missing on a populated table',
        hint = 'Run supabase/cutovers/20260912_prepare_whatsapp_outbox_finalization_index.sql with an autocommit-capable client.';
    end if;

    execute $index$
      create index whatsapp_outbox_conversation_due_head_v2_idx
        on public.whatsapp_outbox (conversation_id, created_at, id)
        include (next_attempt_at)
        where status in ('pending', 'retry')
          and (
            attempts < max_attempts
            or last_error = 'provider_accepted_finalization_pending'
          )
    $index$;
  end if;
end;
$prepare_whatsapp_outbox_finalization_index$;

do $verify_whatsapp_outbox_finalization_index$
declare
  index_definition text;
begin
  select regexp_replace(lower(pg_get_indexdef(index_state.indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index as index_state
  where index_state.indexrelid = to_regclass('public.whatsapp_outbox_conversation_due_head_v2_idx')
    and index_state.indrelid = 'public.whatsapp_outbox'::regclass
    and index_state.indisready
    and index_state.indisvalid
    and not index_state.indisunique;

  if index_definition is distinct from
     'create index whatsapp_outbox_conversation_due_head_v2_idx on public.whatsapp_outbox using btree (conversation_id, created_at, id) include (next_attempt_at) where ((status = any (array[''pending''::text, ''retry''::text])) and ((attempts < max_attempts) or (last_error = ''provider_accepted_finalization_pending''::text)))'
  then
    raise exception 'public.whatsapp_outbox_conversation_due_head_v2_idx is missing, invalid, or unexpected';
  end if;

  -- On a pristine reset the obsolete index can be retired transactionally.
  -- A live cutover removes it concurrently before this migration.
  if not exists (select 1 from public.whatsapp_outbox limit 1)
     and to_regclass('public.whatsapp_outbox_conversation_due_head_idx') is not null
  then
    execute 'drop index public.whatsapp_outbox_conversation_due_head_idx';
  end if;
end;
$verify_whatsapp_outbox_finalization_index$;

comment on index public.whatsapp_outbox_conversation_due_head_v2_idx is
  'Supports FIFO conversation heads for ordinary sends and provider-accepted local finalization recovery.';

commit;
