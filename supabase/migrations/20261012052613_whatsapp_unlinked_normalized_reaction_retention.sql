begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- The normalized projection contains actor identity even after the message
-- projection is scrubbed. Delete only state tied to an actually expired target;
-- captured/promoted history and ambiguous legacy provider IDs stay protected.
create or replace function private.scrub_expired_whatsapp_normalized_reactions(
  p_limit integer default 500
)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_deleted integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 2000 then
    raise exception using errcode='22023',message='whatsapp_unlinked_retention_limit_invalid';
  end if;
  with candidates as (
    select reaction.id from public.whatsapp_message_reactions reaction
    where exists (
      select 1 from public.whatsapp_messages target
      where target.organization_id=reaction.organization_id and target.session_id=reaction.session_id
        and target.conversation_id=reaction.conversation_id
        and target.capture_state='suppressed' and target.unlinked_retention_scrubbed_at is not null
        and target.metadata->>'unlinked_retention_v1'='expired'
        and (target.id=reaction.target_message_id or (reaction.target_message_id is null
          and coalesce(nullif(target.provider_message_id,''),target.message_id)=reaction.target_provider_message_id
          and not exists (
            select 1 from public.whatsapp_messages protected
            where protected.organization_id=reaction.organization_id and protected.session_id=reaction.session_id
              and coalesce(nullif(protected.provider_message_id,''),protected.message_id)=reaction.target_provider_message_id
              and (protected.capture_state is distinct from 'suppressed'
                or protected.unlinked_retention_scrubbed_at is null
                or protected.metadata->>'unlinked_retention_v1' is distinct from 'expired')
          )))
    )
    order by reaction.id limit p_limit for update of reaction skip locked
  )
  delete from public.whatsapp_message_reactions reaction using candidates
  where reaction.id=candidates.id;
  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$$;
revoke all on function private.scrub_expired_whatsapp_normalized_reactions(integer)
from public, anon, authenticated, service_role;

do $guard$
declare v_definition text;
begin
  select pg_catalog.pg_get_functiondef('private.scrub_expired_whatsapp_unlinked_conversations(integer)'::regprocedure)
    into v_definition;
  if position('private.scrub_expired_whatsapp_unlinked_inbox(p_message_limit)' in v_definition)=0
    or position('private.scrub_expired_whatsapp_unlinked_conversations_base(' in v_definition)=0
    or position('cutover_required' in v_definition)=0
    or position('normalized_reactions' in v_definition)>0 then
    raise exception 'whatsapp_normalized_reaction_retention_source_drift';
  end if;
end;
$guard$;

create or replace function private.scrub_expired_whatsapp_unlinked_conversations(
  p_message_limit integer default 500
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_base jsonb; v_inbox jsonb; v_reactions integer;
begin
  v_inbox := private.scrub_expired_whatsapp_unlinked_inbox(p_message_limit);
  v_base := private.scrub_expired_whatsapp_unlinked_conversations_base(p_message_limit);
  if v_base->>'status'='cutover_required' then return v_base; end if;
  v_reactions := private.scrub_expired_whatsapp_normalized_reactions(p_message_limit);
  return v_base || v_inbox || pg_catalog.jsonb_build_object(
    'normalized_reactions_scrubbed',v_reactions,
    'status',case when v_base->>'status'='idle'
      and (coalesce((v_inbox->>'inbox_scrubbed')::integer,0)>0 or v_reactions>0)
      then 'processed' else v_base->>'status' end);
end;
$$;
revoke all on function private.scrub_expired_whatsapp_unlinked_conversations(integer)
from public, anon, authenticated;
grant execute on function private.scrub_expired_whatsapp_unlinked_conversations(integer) to service_role;
commit;
