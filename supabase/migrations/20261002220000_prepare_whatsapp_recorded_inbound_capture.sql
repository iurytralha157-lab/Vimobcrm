-- Prepare an independent state for received history. No existing writer uses
-- 'recorded' yet, so this migration alone does not change inbound behavior.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $verify_whatsapp_capture_gate_before_extension$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid = 'public.whatsapp_messages'::regclass
      and constraint_state.conname = 'whatsapp_messages_capture_state_check'
      and constraint_state.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_state.oid, true)
        like '%legacy%captured%suppressed%'
  ) then
    raise exception 'Expected WhatsApp capture gate is missing or has drifted';
  end if;

end;
$verify_whatsapp_capture_gate_before_extension$;

alter table public.whatsapp_messages
  drop constraint whatsapp_messages_capture_state_check;
alter table public.whatsapp_messages
  add constraint whatsapp_messages_capture_state_check
  check (
    capture_state is null
    or capture_state in ('legacy', 'captured', 'suppressed', 'recorded')
  ) not valid;

comment on column public.whatsapp_messages.capture_state is
  'NULL/legacy is prior history; suppressed is transport-only; recorded preserves received history independently of send consent; captured retains the existing attended-history behavior.';

-- No writer uses recorded in this step. The message_received trigger also
-- cancels follow-ups when a customer replies. Its behavior must be split
-- from generic automation startup before runtime starts writing recorded.

commit;
