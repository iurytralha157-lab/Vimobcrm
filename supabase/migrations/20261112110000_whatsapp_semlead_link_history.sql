-- Caixa Sem lead (12/11): cadastrar/vincular lead anexa o historico de
-- qualquer conversa sem lead com mensagens unlinked_ephemeral, nao apenas as
-- do contrato efemero v1. Tres mudancas, com o resto copiado verbatim de
-- 20261009021248 e 20261008210143:
--   1) confirm_whatsapp_unlinked_history_binding: elegibilidade sem exigir
--      unlinked_retention_v1 nem o prazo de 7 dias da criacao; a prova de
--      promocao e plantada para toda conversa; expires_at do vinculo passa a
--      v_now + 7 dias (a retencao rolante chega com o worker proprio).
--   2) promote_whatsapp_unlinked_retention_v1: promove mensagens quando ha
--      prova plantada nesta transacao, para qualquer conversa sem lead; sem
--      prova, v1 continua exigindo o RPC e conversas legadas seguem com o
--      vinculo apenas-futuro de hoje.
-- Permissoes, checagem de identidade por telefone/alias e guardas por linha
-- (ty_guard / contexto estrito) permanecem como estao.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '2min';

create or replace function private.promote_whatsapp_unlinked_retention_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.lead_id is null
     and new.lead_id is not null then
    -- Modelo de 12/11: a promocao autorizada vale para qualquer conversa sem
    -- lead cujo RPC de vinculo plantou a prova nesta transacao. O contrato v1
    -- continua estrito: sem prova, conversa v1 segue exigindo o RPC.
    update private.whatsapp_unlinked_promotion_authorizations as authz
    set promotion_active = true
    where authz.backend_pid = pg_catalog.pg_backend_pid()
      and authz.transaction_id = pg_catalog.txid_current()
      and authz.organization_id = old.organization_id
      and authz.conversation_id = old.id
      and authz.lead_id = new.lead_id
      and not authz.promotion_active;
    if not found then
      if old.unlinked_retention_v1 then
        raise exception using errcode = '23514',
          message = 'unlinked_promotion_requires_binding_rpc';
      end if;
      return new;
    end if;

    update public.whatsapp_messages as message
    set lead_id = new.lead_id,
        capture_state = 'promoted_unlinked'
    where message.organization_id = old.organization_id
      and message.conversation_id = old.id
      and message.lead_id is null
      and message.capture_state = 'unlinked_ephemeral';

    delete from private.whatsapp_unlinked_promotion_authorizations as authz
    where authz.backend_pid = pg_catalog.pg_backend_pid()
      and authz.transaction_id = pg_catalog.txid_current()
      and authz.organization_id = old.organization_id
      and authz.conversation_id = old.id
      and authz.lead_id = new.lead_id
      and authz.promotion_active;

    new.unlinked_retention_v1 := false;
  end if;
  return new;
end;
$$;

revoke all on function private.promote_whatsapp_unlinked_retention_v1()
from public, anon, authenticated, service_role;

create or replace function public.confirm_whatsapp_unlinked_history_binding(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid,
  p_expected_previous_lead_id uuid,
  p_actor_user_id uuid,
  p_action text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_session public.whatsapp_sessions%rowtype;
  v_lead public.leads%rowtype;
  v_link private.whatsapp_unlinked_history_links%rowtype;
  v_mode text;
  v_now timestamptz;
  v_count integer := 0;
  v_first timestamptz;
  v_last timestamptz;
begin
  if p_organization_id is null or p_conversation_id is null
     or p_lead_id is null or p_actor_user_id is null
     or p_action not in ('manual_link', 'manual_lead_create') then
    raise exception using errcode = '22023',
      message = 'whatsapp_history_link_arguments_invalid';
  end if;
  if p_expected_previous_lead_id is not null then
    raise exception using errcode = '40001',
      message = 'whatsapp_history_link_previous_lead_changed';
  end if;

  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = '23503',
      message = 'whatsapp_history_link_conversation_not_found';
  end if;
  -- Expiry is decided after this row lock, never from a timestamp captured
  -- while waiting behind retention or another binding writer.
  v_now := pg_catalog.clock_timestamp();
  select session.* into v_session
  from public.whatsapp_sessions as session
  where session.id = v_conversation.session_id
    and session.organization_id = p_organization_id;
  select lead.* into v_lead
  from public.leads as lead
  where lead.id = p_lead_id
    and lead.organization_id = p_organization_id;
  if v_session.id is null or v_lead.id is null then
    raise exception using errcode = '23503',
      message = 'whatsapp_history_link_target_not_found';
  end if;
  select link.* into v_link
  from private.whatsapp_unlinked_history_links as link
  where link.conversation_id = p_conversation_id
  for update;
  if found then
    if v_link.organization_id <> p_organization_id
       or v_link.lead_id <> p_lead_id
       or v_link.actor_user_id <> p_actor_user_id then
      raise exception using errcode = '40001',
        message = 'whatsapp_history_link_already_attached';
    end if;
    return pg_catalog.jsonb_build_object(
      'success', true, 'conversation_id', v_link.conversation_id,
      'lead_id', v_link.lead_id, 'binding_mode', v_link.binding_mode,
      'attached_message_count', v_link.attached_message_count,
      'history_first_at', v_link.history_first_at,
      'history_last_at', v_link.history_last_at,
      'confirmed_at', v_link.confirmed_at, 'expires_at', v_link.expires_at
    );
  end if;
  if v_conversation.lead_id is not null then
    raise exception using errcode = '40001',
      message = 'whatsapp_history_link_previous_lead_changed';
  end if;
  if coalesce(v_conversation.is_group, false)
     or v_conversation.deleted_at is not null
     or v_conversation.unlinked_retention_scrubbed_at is not null
     then
    raise exception using errcode = '23514',
      message = 'whatsapp_history_link_epoch_ineligible';
  end if;
  if v_session.owner_user_id is distinct from p_actor_user_id
     or not coalesce(v_session.is_active, false)
     or v_session.status = 'deleted'
     or not exists (
       select 1 from public.users as app_user
       where app_user.id = p_actor_user_id
         and app_user.organization_id = p_organization_id
         and coalesce(app_user.is_active, false)
     )
     or not exists (
       select 1 from public.organization_members as member
       where member.organization_id = p_organization_id
         and member.user_id = p_actor_user_id
         and member.is_active
         and member.deleted_at is null
     ) then
    raise exception using errcode = '42501',
      message = 'whatsapp_history_link_actor_denied';
  end if;
  if not (
    exists (
      select 1 from public.organization_members as member
      where member.organization_id = p_organization_id
        and member.user_id = p_actor_user_id
        and member.is_active and member.deleted_at is null
        and member.role in ('owner', 'admin')
    )
    or private.whatsapp_actor_has_lead_permission(
      p_organization_id, p_actor_user_id, 'lead_view_all'
    )
    or (v_lead.assigned_user_id = p_actor_user_id
        and private.whatsapp_actor_has_lead_permission(
          p_organization_id, p_actor_user_id, 'lead_view_own'
        ))
    or (private.whatsapp_actor_has_lead_permission(
          p_organization_id, p_actor_user_id, 'lead_view_team'
        )
      and exists (
        select 1
        from public.team_members as leader
        join public.teams as team
          on team.id = leader.team_id
         and team.organization_id = leader.organization_id
        where leader.organization_id = p_organization_id
          and leader.user_id = p_actor_user_id
          and leader.is_active and leader.is_leader
          and coalesce(team.is_active, true)
          and v_lead.assigned_user_id is null
          and team.id = v_lead.team_id
      ))
    or exists (
      select 1
      from public.team_members as leader
      join public.teams as team
        on team.id = leader.team_id
       and team.organization_id = leader.organization_id
      where leader.organization_id = p_organization_id
        and leader.user_id = p_actor_user_id
        and leader.is_active and leader.is_leader
        and coalesce(team.is_active, true)
        and private.whatsapp_actor_has_lead_permission(
          p_organization_id, p_actor_user_id, 'lead_view_team'
        )
        and v_lead.assigned_user_id is not null
        and exists (
          select 1
          from public.team_members as assignee
          join public.users as broker
            on broker.id = assignee.user_id
           and coalesce(broker.is_active, false)
          join public.organization_members as broker_member
            on broker_member.organization_id = assignee.organization_id
           and broker_member.user_id = assignee.user_id
           and broker_member.is_active
           and broker_member.deleted_at is null
          where assignee.organization_id = p_organization_id
            and assignee.team_id = team.id
            and assignee.user_id = v_lead.assigned_user_id
            and assignee.is_active
        )
      )
  ) then
    raise exception using errcode = '42501',
      message = 'whatsapp_history_link_lead_denied';
  end if;
  if not (
    (public.normalize_phone(v_conversation.contact_phone) is not null
     and public.normalize_phone(v_conversation.contact_phone) in (
       public.normalize_phone(v_lead.phone),
       public.normalize_phone(nullif(to_jsonb(v_lead)->>'whatsapp', ''))
     ))
    or exists (
      select 1 from public.whatsapp_contact_identity_aliases as alias
      where alias.organization_id = p_organization_id
        and alias.session_id = v_conversation.session_id
        and alias.lead_id = p_lead_id
        and (alias.alias_jid = v_conversation.remote_jid
             or alias.canonical_jid = v_conversation.remote_jid)
    )
  ) then
    raise exception using errcode = '23514',
      message = 'whatsapp_history_link_identity_mismatch';
  end if;
  if private.whatsapp_conversation_has_protected_history(v_conversation.id) then
    raise exception using errcode = '23514',
      message = 'whatsapp_history_link_has_prior_lead_history';
  end if;

  v_mode := case when v_conversation.retired_at is null
    then 'active' else 'history_only' end;
  insert into private.whatsapp_unlinked_history_links (
    organization_id, conversation_id, session_id, lead_id,
    actor_user_id, action, binding_mode, confirmed_at, expires_at
  ) values (
    p_organization_id, p_conversation_id, v_conversation.session_id,
    p_lead_id, p_actor_user_id, p_action, v_mode, v_now,
    v_now + interval '7 days'
  );

  insert into private.whatsapp_unlinked_promotion_authorizations (
    backend_pid, transaction_id, organization_id, conversation_id,
    lead_id, promotion_active
  ) values (
    pg_catalog.pg_backend_pid(), pg_catalog.txid_current(),
    p_organization_id, p_conversation_id, p_lead_id,
    v_mode = 'history_only'
  );

  if v_mode = 'active' then
    perform public.activate_whatsapp_conversation_lead_binding(
      p_organization_id, p_conversation_id, p_lead_id, null
    );
  else
    -- A later intake has its own new active epoch. Preserve this retired
    -- physical route, its aliases, and the new epoch's binding untouched.
    update public.whatsapp_messages as message
    set lead_id = p_lead_id,
        capture_state = 'promoted_unlinked'
    where message.organization_id = p_organization_id
      and message.session_id = v_conversation.session_id
      and message.conversation_id = p_conversation_id
      and message.lead_id is null
      and message.capture_state = 'unlinked_ephemeral'
      and message.unlinked_retention_scrubbed_at is null;
    update public.whatsapp_conversations
    set unlinked_retention_v1 = false,
        updated_at = v_now
    where id = p_conversation_id;
    delete from private.whatsapp_unlinked_promotion_authorizations as authz
    where authz.backend_pid = pg_catalog.pg_backend_pid()
      and authz.transaction_id = pg_catalog.txid_current()
      and authz.conversation_id = p_conversation_id;
  end if;

  select count(*)::integer, min(message.sent_at), max(message.sent_at)
  into v_count, v_first, v_last
  from public.whatsapp_messages as message
  where message.organization_id = p_organization_id
    and message.conversation_id = p_conversation_id
    and message.lead_id = p_lead_id
    and message.capture_state = 'promoted_unlinked';
  update private.whatsapp_unlinked_history_links as link
  set attached_message_count = v_count,
      history_first_at = v_first,
      history_last_at = v_last
  where link.conversation_id = p_conversation_id;

  return pg_catalog.jsonb_build_object(
    'success', true, 'conversation_id', p_conversation_id,
    'lead_id', p_lead_id, 'binding_mode', v_mode,
    'attached_message_count', v_count,
    'history_first_at', v_first, 'history_last_at', v_last,
    'confirmed_at', v_now,
    'expires_at', v_now + interval '7 days'
  );
end;
$$;
revoke all on function public.confirm_whatsapp_unlinked_history_binding(
  uuid, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.confirm_whatsapp_unlinked_history_binding(
  uuid, uuid, uuid, uuid, uuid, text
) to service_role;

commit;
