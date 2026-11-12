-- Pre-requisitos do vinculo de historico Sem lead em producao.
-- Producao nunca recebeu 20261008210143/20261009021248; este arquivo cria,
-- de forma idempotente, apenas os objetos que 20261112110000 usa, com as
-- definicoes copiadas verbatim dessas migracoes:
--   - private.whatsapp_conversation_has_protected_history (0143)
--   - private.whatsapp_unlinked_promotion_authorizations (0143)
--   - private.whatsapp_unlinked_promotion_is_authorized (0143)
--   - private.whatsapp_unlinked_history_links (1248)
--   - patch de autorizacao no contexto estrito de mensagens (0143), com
--     salvaguarda extra: nao repatcha uma funcao ja patchada.
-- Num banco que ja tem as migracoes de outubro (CI), tudo aqui e no-op.
begin;

set local lock_timeout = '15s';
set local statement_timeout = '2min';

create or replace function private.whatsapp_conversation_has_protected_history(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.whatsapp_conversation_lead_bindings as binding
    where binding.conversation_id = p_conversation_id
  ) or exists (
    select 1 from public.whatsapp_attendance_entries as attendance
    where attendance.conversation_id = p_conversation_id
  ) or exists (
    select 1 from public.whatsapp_messages as message
    where message.conversation_id = p_conversation_id
      and (
        message.lead_id is not null
        or message.from_me
        or message.direction <> 'inbound'
      )
  ) or exists (
    select 1 from public.whatsapp_inbound_logs as inbound_log
    where inbound_log.conversation_id = p_conversation_id
      and inbound_log.lead_id is not null
  ) or exists (
    select 1 from public.whatsapp_conversation_routing_heads as routing_head
    where routing_head.conversation_id = p_conversation_id
  ) or exists (
    select 1 from public.whatsapp_outbox as outbox
    where outbox.conversation_id = p_conversation_id
  ) or exists (
    select 1 from public.outbox_messages as outbox
    where outbox.conversation_id = p_conversation_id
  ) or exists (
    select 1
    from public.lead_attachments as attachment
    join public.whatsapp_messages as message on message.id = attachment.message_id
    where message.conversation_id = p_conversation_id
  );
$$;

revoke all on function private.whatsapp_conversation_has_protected_history(uuid)
  from public, anon, authenticated, service_role;

create table if not exists private.whatsapp_unlinked_promotion_authorizations (
  backend_pid integer not null,
  transaction_id bigint not null,
  organization_id uuid not null,
  conversation_id uuid not null,
  lead_id uuid not null,
  promotion_active boolean not null default false,
  primary key (backend_pid, transaction_id, conversation_id)
);

alter table private.whatsapp_unlinked_promotion_authorizations
  enable row level security;
alter table private.whatsapp_unlinked_promotion_authorizations
  force row level security;
revoke all on private.whatsapp_unlinked_promotion_authorizations
from public, anon, authenticated, service_role;

create table if not exists private.whatsapp_unlinked_history_links (
  organization_id uuid not null,
  conversation_id uuid primary key
    references public.whatsapp_conversations(id) on delete restrict,
  session_id uuid not null,
  lead_id uuid not null,
  actor_user_id uuid not null,
  action text not null check (action in ('manual_link', 'manual_lead_create')),
  binding_mode text not null check (binding_mode in ('active', 'history_only')),
  confirmed_at timestamptz not null,
  expires_at timestamptz not null,
  attached_message_count integer not null default 0
    check (attached_message_count >= 0),
  history_first_at timestamptz,
  history_last_at timestamptz,
  constraint whatsapp_unlinked_history_links_period_check check (
    history_first_at is null or history_last_at >= history_first_at
  )
);
create index if not exists whatsapp_unlinked_history_links_lead_idx
  on private.whatsapp_unlinked_history_links (organization_id, lead_id, confirmed_at);
alter table private.whatsapp_unlinked_history_links enable row level security;
alter table private.whatsapp_unlinked_history_links force row level security;
revoke all on private.whatsapp_unlinked_history_links
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_unlinked_history_links is
'Backend-only proof of a human-confirmed unlinked-history attachment. It preserves the original physical epoch and never contains message text or media.';

create or replace function private.whatsapp_unlinked_promotion_is_authorized(
  p_old public.whatsapp_messages,
  p_new public.whatsapp_messages
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select (p_old).capture_state = 'unlinked_ephemeral'
    and (p_old).lead_id is null
    and (p_new).capture_state = 'promoted_unlinked'
    and (p_new).lead_id is not null
    and (p_new).id is not distinct from (p_old).id
    and (p_new).organization_id is not distinct from (p_old).organization_id
    and (p_new).conversation_id is not distinct from (p_old).conversation_id
    and (p_new).session_id is not distinct from (p_old).session_id
    and (p_new).remote_jid is not distinct from (p_old).remote_jid
    and (p_new).provider_message_id is not distinct from (p_old).provider_message_id
    and (p_new).message_id is not distinct from (p_old).message_id
    and (p_new).from_me is not distinct from (p_old).from_me
    and (p_new).direction is not distinct from (p_old).direction
    and exists (
      select 1
      from private.whatsapp_unlinked_promotion_authorizations as authz
      where authz.backend_pid = pg_catalog.pg_backend_pid()
        and authz.transaction_id = pg_catalog.txid_current()
        and authz.organization_id = (p_old).organization_id
        and authz.conversation_id = (p_old).conversation_id
        and authz.lead_id = (p_new).lead_id
        and authz.promotion_active
    );
$$;

revoke all on function private.whatsapp_unlinked_promotion_is_authorized(
  public.whatsapp_messages, public.whatsapp_messages
) from public, anon, authenticated, service_role;

do $allow_strict_unlinked_promotion$
declare
  v_context regprocedure := pg_catalog.to_regprocedure(
    'public.set_whatsapp_message_context()'
  );
  v_definition text;
  v_old text := $old$
    raise exception using
      errcode = '23514',
      message = 'whatsapp_message_context_immutable';
  end if;
$old$;
  v_new text := $new$
    if private.whatsapp_unlinked_promotion_is_authorized(old, new) then
      return new;
    end if;

    raise exception using
      errcode = '23514',
      message = 'whatsapp_message_context_immutable';
  end if;
$new$;
begin
  if v_context is null then
    raise exception using errcode = '55000',
      message = 'unlinked_promotion_message_context_missing';
  end if;
  select pg_catalog.replace(pg_catalog.replace(
    pg_catalog.pg_get_functiondef(v_context), E'\r\n', E'\n'
  ), E'\r', E'\n') into v_definition;
  if pg_catalog.strpos(v_definition, 'whatsapp_unlinked_promotion_is_authorized') > 0 then
    return;  -- ja patchado por 20261008210143
  end if;
  v_old := pg_catalog.replace(pg_catalog.replace(v_old, E'\r\n', E'\n'), E'\r', E'\n');
  v_new := pg_catalog.replace(pg_catalog.replace(v_new, E'\r\n', E'\n'), E'\r', E'\n');
  if pg_catalog.strpos(v_definition, 'whatsapp_message_context_immutable') > 0 then
    if pg_catalog.strpos(v_definition, v_old) = 0
       or pg_catalog.strpos(
         pg_catalog.substr(
           v_definition,
           pg_catalog.strpos(v_definition, v_old) + pg_catalog.length(v_old)
         ),
         v_old
       ) > 0 then
      raise exception using errcode = '55000',
        message = 'unlinked_promotion_strict_message_context_drift';
    end if;
    execute pg_catalog.replace(v_definition, v_old, v_new);
  elsif pg_catalog.strpos(v_definition, 'if new.lead_id is null then') = 0 then
    raise exception using errcode = '55000',
      message = 'unlinked_promotion_baseline_message_context_drift';
  end if;
end;
$allow_strict_unlinked_promotion$;

commit;
