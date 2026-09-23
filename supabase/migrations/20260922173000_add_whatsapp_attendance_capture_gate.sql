-- Explicit, backend-only WhatsApp attendance entry and message capture gate.
--
-- Existing message rows intentionally remain NULL in capture_state. NULL is the
-- legacy-visible sentinel; only writes performed after this migration default
-- to suppressed until the trusted backend proves an attendance entry.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

create table public.whatsapp_attendance_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  conversation_id uuid not null
    references public.whatsapp_conversations(id)
    on delete no action
    deferrable initially deferred,
  session_id uuid not null,
  lead_id uuid not null,
  binding_id uuid not null
    references public.whatsapp_conversation_lead_bindings(id)
    on delete no action
    deferrable initially deferred,
  user_id uuid not null,
  actor_name_snapshot text not null,
  joined_at timestamp with time zone not null default clock_timestamp(),
  ingress_sequence_cutoff bigint not null,
  entry_source text not null default 'manual',
  bootstrap_provider_message_id text,
  bootstrap_ingress_sequence bigint,
  bootstrap_provider_occurred_at timestamp with time zone,
  bootstrap_inbox_created_at timestamp with time zone,
  constraint whatsapp_attendance_entries_actor_name_check
    check (btrim(actor_name_snapshot) <> ''),
  constraint whatsapp_attendance_entries_ingress_cutoff_check
    check (ingress_sequence_cutoff >= 0),
  constraint whatsapp_attendance_entries_source_check
    check (
      (
        entry_source = 'manual'
        and bootstrap_provider_message_id is null
        and bootstrap_ingress_sequence is null
        and bootstrap_provider_occurred_at is null
        and bootstrap_inbox_created_at is null
      ) or (
        entry_source = 'ctwa_auto'
        and btrim(coalesce(bootstrap_provider_message_id, '')) <> ''
        and bootstrap_ingress_sequence is not null
        and bootstrap_ingress_sequence > 0
        and ingress_sequence_cutoff = bootstrap_ingress_sequence
        and bootstrap_provider_occurred_at is not null
        and bootstrap_inbox_created_at is not null
        and bootstrap_provider_occurred_at <= bootstrap_inbox_created_at
      )
    ),
  constraint whatsapp_attendance_entries_identity_key
    unique (
      organization_id,
      conversation_id,
      binding_id,
      session_id,
      user_id
    )
);

comment on table public.whatsapp_attendance_entries is
'Append-only backend ledger proving either explicit user confirmation or verified automatic CTWA entry for one lead/card, WhatsApp session and then-active conversation binding.';

comment on column public.whatsapp_attendance_entries.organization_id is
'Tenant snapshot validated against the conversation and active binding when the entry is inserted.';

comment on column public.whatsapp_attendance_entries.conversation_id is
'Physical WhatsApp conversation through which this user entered the attendance.';

comment on column public.whatsapp_attendance_entries.session_id is
'Immutable WhatsApp session UUID snapshot. It intentionally remains an audit tombstone if the session is later deleted.';

comment on column public.whatsapp_attendance_entries.lead_id is
'Immutable lead/card UUID snapshot. It intentionally remains an audit tombstone if the lead is later deleted or transferred.';

comment on column public.whatsapp_attendance_entries.binding_id is
'Conversation-to-lead binding ledger row that was active when the user confirmed entry.';

comment on column public.whatsapp_attendance_entries.user_id is
'Immutable user UUID snapshot for the actor who confirmed entry.';

comment on column public.whatsapp_attendance_entries.actor_name_snapshot is
'Display-name snapshot used by the immutable system event even if the user is later renamed or removed.';

comment on column public.whatsapp_attendance_entries.joined_at is
'Database timestamp at which the trusted backend recorded explicit confirmation or verified automatic entry; auto capture uses the separate immutable first-event boundary.';

comment on column public.whatsapp_attendance_entries.ingress_sequence_cutoff is
'Manual entries use an exclusive provider-ingress fence. Automatic CTWA entries store the exact first ingress sequence here and in bootstrap_ingress_sequence.';

comment on column public.whatsapp_attendance_entries.entry_source is
'manual means explicit user confirmation; ctwa_auto means database-verified entry by the owner of the receiving WhatsApp when a new CTWA card is created.';

comment on column public.whatsapp_attendance_entries.bootstrap_provider_message_id is
'Exact first CTWA provider message authorized for automatic capture; NULL for manual entry.';

comment on column public.whatsapp_attendance_entries.bootstrap_ingress_sequence is
'First CTWA routing ingress sequence. Later messages require a greater sequence and must not predate the first provider/inbox timestamps.';

create index whatsapp_attendance_entries_lead_idx
  on public.whatsapp_attendance_entries (
    organization_id,
    lead_id,
    session_id,
    joined_at,
    id
  );

create index whatsapp_attendance_entries_conversation_idx
  on public.whatsapp_attendance_entries (
    organization_id,
    conversation_id,
    session_id,
    lead_id,
    ingress_sequence_cutoff,
    id
  );

alter table public.whatsapp_attendance_entries enable row level security;

revoke all privileges
on table public.whatsapp_attendance_entries
from public, anon, authenticated, service_role;

grant select, insert
on table public.whatsapp_attendance_entries
to service_role;

-- Add the nullable column without a default first. This is metadata-only and
-- leaves every pre-migration row NULL (the legacy-visible sentinel), avoiding a
-- rewrite/backfill of the large canonical message table.
alter table public.whatsapp_messages
  add column capture_state text;

alter table public.whatsapp_messages
  alter column capture_state set default 'suppressed';

alter table public.whatsapp_messages
  add constraint whatsapp_messages_capture_state_check
  check (
    capture_state is null
    or capture_state in ('legacy', 'captured', 'suppressed')
  ) not valid;

comment on column public.whatsapp_messages.capture_state is
'Attendance capture gate. NULL means legacy-visible history; captured is visible and may emit downstream effects; suppressed is backend-only and must emit no user-facing or lead-facing side effects.';

-- The nullable legacy-visible sentinel is only for rows written before this
-- migration. A caller must not explicitly INSERT NULL/legacy to bypass the
-- new attendance capture gate; ordinary updates of historical rows remain
-- possible without rewriting or backfilling them.
create or replace function private.reject_new_whatsapp_legacy_capture()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.capture_state is null or new.capture_state = 'legacy' then
    raise exception using
      errcode = '23514',
      message = 'new_whatsapp_message_requires_capture_state';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_new_whatsapp_legacy_capture()
from public, anon, authenticated, service_role;

create trigger zz_reject_new_whatsapp_legacy_capture
before insert on public.whatsapp_messages
for each row
execute function private.reject_new_whatsapp_legacy_capture();

-- The initial managed keyword proof cannot live in leads.metadata: an unkeyed
-- digest beside public provider identifiers would let browser clients guess
-- short messages offline. Keep it in a private, no-grant ledger instead.
create table private.whatsapp_managed_message_proofs (
  organization_id uuid not null,
  lead_id uuid not null,
  session_id uuid not null,
  rule_id uuid not null,
  target_round_robin_id uuid not null,
  provider_event_id text not null,
  provider_message_id text not null,
  message_fingerprint text not null,
  validated_at timestamp with time zone not null default clock_timestamp(),
  constraint whatsapp_managed_message_proofs_pkey
    primary key (organization_id, session_id, provider_event_id),
  constraint whatsapp_managed_message_proofs_lead_key
    unique (organization_id, lead_id),
  constraint whatsapp_managed_message_proofs_lead_fkey
    foreign key (lead_id)
    references public.leads(id)
    on delete cascade
    deferrable initially deferred,
  constraint whatsapp_managed_message_proofs_provider_ids_check
    check (
      btrim(provider_event_id) <> ''
      and btrim(provider_message_id) <> ''
    ),
  constraint whatsapp_managed_message_proofs_fingerprint_check
    check (message_fingerprint ~ '^[0-9a-f]{64}$')
);

comment on table private.whatsapp_managed_message_proofs is
'Backend-only durable proof that the managed first message passed keyword validation before its plaintext was removed from the lead row.';

comment on column private.whatsapp_managed_message_proofs.message_fingerprint is
'Deterministic collision proof kept outside every browser-readable lead or history projection.';

revoke all privileges
on table private.whatsapp_managed_message_proofs
from public, anon, authenticated, service_role;

-- This proof is minted only by the lead INSERT trigger. Re-reading mutable
-- lead metadata on a webhook retry must never turn an old or unrelated card
-- into a newly created CTWA attendance.
create table private.whatsapp_ctwa_auto_origins (
  organization_id uuid not null,
  lead_id uuid not null,
  session_id uuid not null,
  owner_user_id uuid not null,
  auto_entry_eligible boolean not null,
  provider_event_id text not null,
  provider_message_id text not null,
  created_at timestamp with time zone not null default clock_timestamp(),
  constraint whatsapp_ctwa_auto_origins_pkey
    primary key (organization_id, lead_id),
  constraint whatsapp_ctwa_auto_origins_provider_key
    unique (organization_id, session_id, provider_message_id),
  constraint whatsapp_ctwa_auto_origins_lead_fkey
    foreign key (lead_id)
    references public.leads(id)
    on delete cascade
    deferrable initially deferred,
  constraint whatsapp_ctwa_auto_origins_provider_ids_check
    check (
      btrim(provider_event_id) <> ''
      and btrim(provider_message_id) <> ''
      and provider_event_id = session_id::text || ':' || provider_message_id
    )
);

comment on table private.whatsapp_ctwa_auto_origins is
'Private immutable lead-INSERT proof for the first verified CTWA provider event, receiving session owner and connected eligibility at card creation; retries and existing cards cannot mint a new origin.';

revoke all privileges
on table private.whatsapp_ctwa_auto_origins
from public, anon, authenticated, service_role;

create or replace function private.whatsapp_managed_initial_proof_matches(
  p_organization_id uuid,
  p_lead_id uuid,
  p_session_id uuid,
  p_provider_event_id text,
  p_message_fingerprint text default null,
  p_rule_id uuid default null,
  p_target_round_robin_id uuid default null
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.whatsapp_managed_message_proofs as proof
    where proof.organization_id = p_organization_id
      and proof.lead_id = p_lead_id
      and proof.session_id = p_session_id
      and proof.provider_event_id = btrim(coalesce(p_provider_event_id, ''))
      and (
        p_message_fingerprint is null
        or proof.message_fingerprint = p_message_fingerprint
      )
      and (p_rule_id is null or proof.rule_id = p_rule_id)
      and (
        p_target_round_robin_id is null
        or proof.target_round_robin_id = p_target_round_robin_id
      )
  );
$$;

revoke all on function private.whatsapp_managed_initial_proof_matches(
  uuid, uuid, uuid, text, text, uuid, uuid
) from public, anon, authenticated, service_role;

create or replace function private.whatsapp_attendance_message_evidence_matches(
  p_capture_state text,
  p_content text,
  p_metadata jsonb,
  p_expected_fingerprint text,
  p_expected_content text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_capture_state = 'suppressed' then
      p_expected_fingerprint ~ '^[0-9a-f]{64}$'
      and btrim(coalesce(
        p_metadata->'whatsapp_attendance_capture'->>'message_fingerprint',
        ''
      )) = p_expected_fingerprint
    else coalesce(p_content, '') is not distinct from coalesce(p_expected_content, '')
  end;
$$;

revoke all on function private.whatsapp_attendance_message_evidence_matches(
  text, text, jsonb, text, text
) from public, anon, authenticated, service_role;

-- The existing managed-intake validator must see the first message in NEW to
-- prove its keyword/rule. This alphabetically-late BEFORE INSERT trigger runs
-- after that validator, records a private proof, then removes plaintext before
-- the row and every AFTER INSERT projection become visible.
create or replace function private.sanitize_whatsapp_attendance_lead_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb := coalesce(new.metadata, '{}'::jsonb);
  v_provider_event_id text := btrim(coalesce(
    v_metadata->>'whatsapp_initial_provider_event_id',
    ''
  ));
  v_managed boolean := lower(btrim(coalesce(
    v_metadata->>'managed_whatsapp_message_distribution',
    'false'
  ))) in ('true', '1', 'yes');
  v_ctwa boolean := lower(btrim(coalesce(
    v_metadata->>'ctwa_ad_confirmed',
    'false'
  ))) in ('true', '1', 'yes')
    and v_metadata->>'whatsapp_lead_creation_contract' = 'ctwa_ad_v2';
  v_session_id uuid;
  v_rule_id uuid;
  v_target_round_robin_id uuid;
  v_ctwa_owner_user_id uuid;
  v_ctwa_auto_eligible boolean;
  v_provider_message_id text;
  v_message text;
begin
  -- Never retain a caller-supplied proof in the public lead document.
  new.metadata := v_metadata - 'whatsapp_attendance_initial_message_proof';

  if v_provider_event_id <> '' then
    if v_ctwa then
      begin
        v_session_id := nullif(
          btrim(v_metadata->>'whatsapp_session_id'),
          ''
        )::uuid;
      exception
        when invalid_text_representation then
          raise exception using
            errcode = '23514',
            message = 'whatsapp_ctwa_auto_origin_invalid';
      end;

      if new.id is null
         or new.organization_id is null
         or v_session_id is null
         or new.source_session_id is distinct from v_session_id
         or v_metadata->>'source' is distinct from 'whatsapp'
         or new.first_touch_channel is distinct from 'whatsapp'
         or btrim(coalesce(v_metadata->>'ctwa_confirmation_method', '')) = ''
         or left(
           v_provider_event_id,
           length(v_session_id::text) + 1
         ) <> (v_session_id::text || ':') then
        raise exception using
          errcode = '23514',
          message = 'whatsapp_ctwa_auto_origin_invalid';
      end if;

      v_provider_message_id := substr(
        v_provider_event_id,
        length(v_session_id::text) + 2
      );
      -- Pre-migration inbox rows may lack the durable routing snapshot. Keep
      -- their lead creation intact, but do not mint automatic attendance.
      if btrim(v_provider_message_id) <> ''
         and exists (
           select 1
           from public.whatsapp_webhook_routing_snapshots as route
           join public.whatsapp_webhook_inbox as inbox
             on inbox.organization_id = route.organization_id
            and inbox.session_id = route.session_id
            and inbox.event_key = route.inbox_event_key
           where route.organization_id = new.organization_id
             and route.session_id = v_session_id
             and route.provider_message_id = v_provider_message_id
             and route.binding_eligible = true
             and route.snapshot->>'context_kind' = 'contextual_intake'
             and (
               (v_managed and route.snapshot->>'context_proof' = 'managed_rule')
               or (
                 not v_managed
                 and route.snapshot->>'context_proof' like 'canonical_intake_v1:%'
               )
             )
         ) then
        select session.owner_user_id,
               session.status = 'connected'
                 and coalesce(session.is_active, true) = true
                 and exists (
                   select 1
                   from public.users as owner
                   join public.organization_members as member
                     on member.user_id = owner.id
                    and member.organization_id = session.organization_id
                    and coalesce(member.is_active, true) = true
                   where owner.id = session.owner_user_id
                     and owner.organization_id = session.organization_id
                     and coalesce(owner.is_active, false) = true
                 )
        into v_ctwa_owner_user_id, v_ctwa_auto_eligible
        from public.whatsapp_sessions as session
        where session.id = v_session_id
          and session.organization_id = new.organization_id
          and session.provider = 'evolution_go';
        if v_ctwa_owner_user_id is not null then
          insert into private.whatsapp_ctwa_auto_origins (
            organization_id,
            lead_id,
            session_id,
            owner_user_id,
            auto_entry_eligible,
            provider_event_id,
            provider_message_id
          ) values (
            new.organization_id,
            new.id,
            v_session_id,
            v_ctwa_owner_user_id,
            v_ctwa_auto_eligible,
            v_provider_event_id,
            v_provider_message_id
          );
        end if;
      end if;
    end if;

    if v_managed then
      begin
        v_session_id := nullif(
          btrim(v_metadata->>'whatsapp_session_id'),
          ''
        )::uuid;
        v_rule_id := nullif(
          btrim(v_metadata->>'matched_rule_id'),
          ''
        )::uuid;
        v_target_round_robin_id := nullif(
          btrim(v_metadata->>'target_round_robin_id'),
          ''
        )::uuid;
      exception
        when invalid_text_representation then
          raise exception using
            errcode = '23514',
            message = 'managed_whatsapp_attendance_proof_invalid';
      end;

      if new.id is null
         or new.organization_id is null
         or v_session_id is null
         or new.source_session_id is distinct from v_session_id
         or v_rule_id is null
         or v_target_round_robin_id is null
         or btrim(coalesce(
           v_metadata->>'managed_whatsapp_initial_provider_event_id',
           ''
         )) <> v_provider_event_id
         or left(
           v_provider_event_id,
           length(v_session_id::text) + 1
         ) <> (v_session_id::text || ':') then
        raise exception using
          errcode = '23514',
          message = 'managed_whatsapp_attendance_proof_invalid';
      end if;

      v_provider_message_id := substr(
        v_provider_event_id,
        length(v_session_id::text) + 2
      );
      v_message := coalesce(
        nullif(new.initial_message, ''),
        new.message,
        ''
      );
      if btrim(v_provider_message_id) = '' or btrim(v_message) = '' then
        raise exception using
          errcode = '23514',
          message = 'managed_whatsapp_attendance_proof_invalid';
      end if;

      insert into private.whatsapp_managed_message_proofs (
        organization_id,
        lead_id,
        session_id,
        rule_id,
        target_round_robin_id,
        provider_event_id,
        provider_message_id,
        message_fingerprint
      ) values (
        new.organization_id,
        new.id,
        v_session_id,
        v_rule_id,
        v_target_round_robin_id,
        v_provider_event_id,
        v_provider_message_id,
        private.managed_whatsapp_message_fingerprint(
          new.organization_id,
          v_session_id,
          v_provider_message_id,
          v_message
        )
      );
    end if;

    new.initial_message := null;
    new.message := null;
  end if;
  return new;
end;
$$;

revoke all on function private.sanitize_whatsapp_attendance_lead_insert()
from public, anon, authenticated, service_role;

drop trigger if exists zz_whatsapp_attendance_sanitize_insert
on public.leads;
create trigger zz_whatsapp_attendance_sanitize_insert
before insert on public.leads
for each row
execute function private.sanitize_whatsapp_attendance_lead_insert();

comment on function private.sanitize_whatsapp_attendance_lead_insert() is
'Records immutable CTWA creation and managed validation proofs privately, then removes automatic WhatsApp lead plaintext before persistence and downstream insert effects.';

-- The backend may request automatic entry only for the exact provider event
-- that inserted the CTWA lead. A private INSERT-time proof, the immutable
-- routing snapshot and its inbox row, the current card binding, and the
-- session owner must all agree. No browser role may execute this function.
create or replace function public.auto_enter_whatsapp_ctwa_attendance(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_session_id uuid,
  p_lead_id uuid,
  p_binding_id uuid,
  p_provider_message_id text,
  p_ingress_sequence bigint,
  p_provider_occurred_at timestamp with time zone
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner_user_id uuid;
  v_actor_name text;
  v_inbox_created_at timestamp with time zone;
  v_entry_id uuid;
  v_joined_at timestamp with time zone;
begin
  if p_organization_id is null
     or p_conversation_id is null
     or p_session_id is null
     or p_lead_id is null
     or p_binding_id is null
     or btrim(coalesce(p_provider_message_id, '')) = ''
     or p_ingress_sequence is null
     or p_ingress_sequence <= 0
     or p_provider_occurred_at is null then
    return null;
  end if;

  select origin.owner_user_id,
         left(coalesce(
           nullif(btrim(actor.name), ''),
           nullif(btrim(actor.email), ''),
           'Usuario'
         ), 180),
         inbox.created_at
  into v_owner_user_id, v_actor_name, v_inbox_created_at
  from private.whatsapp_ctwa_auto_origins as origin
  join public.leads as lead
    on lead.id = origin.lead_id
   and lead.organization_id = origin.organization_id
   and lead.source_session_id = origin.session_id
  join public.whatsapp_sessions as session
    on session.id = origin.session_id
   and session.organization_id = origin.organization_id
   and session.owner_user_id = origin.owner_user_id
   and session.provider = 'evolution_go'
   and session.status not in ('disabled', 'deleted')
   and coalesce(session.is_active, true) = true
  join public.users as actor
    on actor.id = origin.owner_user_id
   and actor.organization_id = origin.organization_id
   and coalesce(actor.is_active, false) = true
  join public.organization_members as member
    on member.organization_id = origin.organization_id
   and member.user_id = origin.owner_user_id
   and coalesce(member.is_active, true) = true
  join public.whatsapp_conversations as conversation
    on conversation.id = p_conversation_id
   and conversation.organization_id = origin.organization_id
   and conversation.session_id = origin.session_id
   and conversation.lead_id = origin.lead_id
   and conversation.deleted_at is null
  join public.whatsapp_conversation_lead_bindings as binding
    on binding.id = p_binding_id
   and binding.organization_id = origin.organization_id
   and binding.conversation_id = conversation.id
   and binding.session_id = origin.session_id
   and binding.lead_id = origin.lead_id
   and binding.provider_message_id = origin.provider_message_id
   and binding.active_to is null
   and binding.stale = false
  join public.whatsapp_webhook_routing_snapshots as route
    on route.organization_id = origin.organization_id
   and route.session_id = origin.session_id
   and route.provider_message_id = origin.provider_message_id
   and route.ingress_sequence = p_ingress_sequence
   and route.binding_eligible = true
   and route.snapshot->>'context_kind' = 'contextual_intake'
  join public.whatsapp_webhook_inbox as inbox
    on inbox.organization_id = route.organization_id
   and inbox.session_id = route.session_id
   and inbox.event_key = route.inbox_event_key
  where origin.organization_id = p_organization_id
    and origin.auto_entry_eligible = true
    and origin.session_id = p_session_id
    and origin.lead_id = p_lead_id
    and origin.provider_message_id = btrim(p_provider_message_id)
    and origin.provider_event_id = p_session_id::text || ':' || btrim(p_provider_message_id)
    and lead.metadata->>'whatsapp_initial_provider_event_id' = origin.provider_event_id
    and lead.metadata->>'whatsapp_lead_creation_contract' = 'ctwa_ad_v2'
    and lead.metadata->>'ctwa_ad_confirmed' = 'true'
    and p_provider_occurred_at <= inbox.created_at;

  if v_owner_user_id is null then
    return null;
  end if;

  insert into public.whatsapp_attendance_entries (
    organization_id,
    conversation_id,
    session_id,
    lead_id,
    binding_id,
    user_id,
    actor_name_snapshot,
    joined_at,
    ingress_sequence_cutoff,
    entry_source,
    bootstrap_provider_message_id,
    bootstrap_ingress_sequence,
    bootstrap_provider_occurred_at,
    bootstrap_inbox_created_at
  ) values (
    p_organization_id,
    p_conversation_id,
    p_session_id,
    p_lead_id,
    p_binding_id,
    v_owner_user_id,
    v_actor_name,
    clock_timestamp(),
    p_ingress_sequence,
    'ctwa_auto',
    btrim(p_provider_message_id),
    p_ingress_sequence,
    p_provider_occurred_at,
    v_inbox_created_at
  )
  on conflict on constraint whatsapp_attendance_entries_identity_key
    do nothing
  returning id, joined_at into v_entry_id, v_joined_at;

  if v_entry_id is null then
    select entry.id
    into v_entry_id
    from public.whatsapp_attendance_entries as entry
    where entry.organization_id = p_organization_id
      and entry.conversation_id = p_conversation_id
      and entry.session_id = p_session_id
      and entry.lead_id = p_lead_id
      and entry.binding_id = p_binding_id
      and entry.user_id = v_owner_user_id
      and entry.entry_source = 'ctwa_auto'
      and entry.bootstrap_provider_message_id = btrim(p_provider_message_id)
      and entry.bootstrap_ingress_sequence = p_ingress_sequence
      and entry.bootstrap_provider_occurred_at = p_provider_occurred_at
      and entry.bootstrap_inbox_created_at = v_inbox_created_at;
    return v_entry_id;
  end if;

  insert into public.lead_timeline_events (
    organization_id,
    lead_id,
    user_id,
    actor_user_id,
    event_type,
    title,
    description,
    event_at,
    metadata
  ) values (
    p_organization_id,
    p_lead_id,
    v_owner_user_id,
    v_owner_user_id,
    'whatsapp_attendance_joined',
    v_actor_name || ' entrou no atendimento',
    'Atendimento iniciado automaticamente pelo WhatsApp que recebeu o lead.',
    v_joined_at,
    pg_catalog.jsonb_build_object(
      'attendance_entry_id', v_entry_id,
      'conversation_id', p_conversation_id,
      'session_id', p_session_id,
      'binding_id', p_binding_id,
      'ingress_sequence_cutoff', p_ingress_sequence,
      'entry_source', 'ctwa_auto'
    )
  );

  return v_entry_id;
end;
$$;

revoke all on function public.auto_enter_whatsapp_ctwa_attendance(
  uuid, uuid, uuid, uuid, uuid, text, bigint, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.auto_enter_whatsapp_ctwa_attendance(
  uuid, uuid, uuid, uuid, uuid, text, bigint, timestamptz
) to service_role;

comment on function public.auto_enter_whatsapp_ctwa_attendance(
  uuid, uuid, uuid, uuid, uuid, text, bigint, timestamptz
) is
'Atomically and idempotently auto-enters the receiving WhatsApp owner only for the proven first inbound event of a newly inserted CTWA lead/card.';

-- The canonical distribution handler used to re-read plaintext from the lead
-- after INSERT. Patch only that exact predicate and fail the migration if the
-- upstream definition has drifted, so a sanitizer can never silently disable
-- managed distribution.
do $patch_handler$
declare
  v_definition text;
  v_updated text;
  v_old text := $old$
     and position(
       lower(normalized.keyword)
       in lower(coalesce(nullif(v_lead.initial_message, ''), v_lead.message, ''))
     ) > 0
$old$;
  v_new text := $new$
     and private.whatsapp_managed_initial_proof_matches(
       v_lead.organization_id,
       v_lead.id,
       v_session_id,
       btrim(coalesce(
         v_lead.metadata->>'managed_whatsapp_initial_provider_event_id',
         ''
       )),
       null,
       v_rule_id,
       v_target_queue_id
     )
$new$;
begin
  v_definition := replace(replace(
    pg_catalog.pg_get_functiondef(
      'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  ), E'\r', E'\n');
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception using
      errcode = '55000',
      message = 'managed_whatsapp_handler_proof_patch_drift';
  end if;
  execute v_updated;
end;
$patch_handler$;

-- Pending retries and legacy collision checks must authenticate redacted rows
-- by the private lead proof or backend-only message proof. Non-suppressed and
-- legacy rows retain the historical exact-content comparison.
do $patch_lookup$
declare
  v_definition text;
  v_updated text;
  v_old text;
  v_new text;
begin
  v_definition := replace(replace(
    pg_catalog.pg_get_functiondef(
      'public.lookup_managed_whatsapp_lead_entry(uuid,uuid,text,text)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  ), E'\r', E'\n');

  v_old := $old$
       or coalesce(v_pending_lead.initial_message, '')
            is distinct from coalesce(p_message, '') then
$old$;
  v_new := $new$
       or not private.whatsapp_managed_initial_proof_matches(
         p_organization_id,
         v_pending_lead.id,
         p_session_id,
         v_provider_event_id,
         v_message_fingerprint,
         null,
         null
       ) then
$new$;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception using errcode = '55000',
      message = 'managed_whatsapp_lookup_lead_proof_patch_drift';
  end if;
  v_definition := v_updated;

  v_old := $old$
    if coalesce(v_legacy_message.content, '')
         is distinct from coalesce(p_message, '')
$old$;
  v_new := $new$
    if not private.whatsapp_attendance_message_evidence_matches(
         v_legacy_message.capture_state,
         v_legacy_message.content,
         v_legacy_message.metadata,
         v_message_fingerprint,
         p_message
       )
$new$;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception using errcode = '55000',
      message = 'managed_whatsapp_lookup_legacy_proof_patch_drift';
  end if;
  v_definition := v_updated;

  v_old := $old$
             coalesce(conflicting_legacy_message.content, '')
               is distinct from coalesce(p_message, '')
$old$;
  v_new := $new$
             not private.whatsapp_attendance_message_evidence_matches(
               conflicting_legacy_message.capture_state,
               conflicting_legacy_message.content,
               conflicting_legacy_message.metadata,
               v_message_fingerprint,
               p_message
             )
$new$;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception using errcode = '55000',
      message = 'managed_whatsapp_lookup_legacy_collision_patch_drift';
  end if;
  v_definition := v_updated;

  v_old := $old$
      and coalesce(message.content, '') is not distinct from coalesce(p_message, '')
$old$;
  v_new := $new$
      and private.whatsapp_attendance_message_evidence_matches(
        message.capture_state,
        message.content,
        message.metadata,
        v_message_fingerprint,
        p_message
      )
$new$;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception using errcode = '55000',
      message = 'managed_whatsapp_lookup_pending_message_patch_drift';
  end if;
  v_definition := v_updated;

  v_old := $old$
        or coalesce(conflicting_message.content, '')
             is distinct from coalesce(p_message, '')
$old$;
  v_new := $new$
        or not private.whatsapp_attendance_message_evidence_matches(
             conflicting_message.capture_state,
             conflicting_message.content,
             conflicting_message.metadata,
             v_message_fingerprint,
             p_message
           )
$new$;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception using errcode = '55000',
      message = 'managed_whatsapp_lookup_pending_collision_patch_drift';
  end if;

  execute v_updated;
end;
$patch_lookup$;

-- The managed intake RPC receives plaintext only as its transient argument.
-- Its persisted-message and initial-lead fences use the same trusted proofs;
-- lead.message is independently guarded below while capture is suppressed.
do $patch_process$
declare
  v_definition text;
  v_updated text;
  v_old text;
  v_new text;
begin
  v_definition := replace(replace(
    pg_catalog.pg_get_functiondef(
      'public.process_managed_whatsapp_lead_entry(uuid,uuid,uuid,uuid,text,text,timestamp with time zone)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  ), E'\r', E'\n');

  v_old := $old$
      and coalesce(message.content, '') is not distinct from coalesce(p_message, '')
$old$;
  v_new := $new$
      and private.whatsapp_attendance_message_evidence_matches(
        message.capture_state,
        message.content,
        message.metadata,
        v_message_fingerprint,
        p_message
      )
$new$;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception using errcode = '55000',
      message = 'managed_whatsapp_process_message_proof_patch_drift';
  end if;
  v_definition := v_updated;

  v_old := $old$
     and btrim(coalesce(v_lead.initial_message, '')) = btrim(p_message)
$old$;
  v_new := $new$
     and (
       btrim(coalesce(v_lead.initial_message, '')) = btrim(p_message)
       or private.whatsapp_managed_initial_proof_matches(
         p_organization_id,
         p_lead_id,
         p_session_id,
         v_provider_event_id,
         v_message_fingerprint,
         v_effective_rule_id,
         v_round_robin_id
       )
     )
$new$;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception using errcode = '55000',
      message = 'managed_whatsapp_process_initial_proof_patch_drift';
  end if;

  execute v_updated;
end;
$patch_process$;

-- Managed distribution auto-replies run from a lead-entry trigger and bypass
-- the normal composer. Require the inbound row to prove the exact attendance
-- entry and current binding before any outbound row, outbox payload or preview
-- can be created. Rows that pass the gate are explicitly captured; the new
-- table default intentionally remains suppressed for every unclassified write.
do $patch_managed_auto_reply$
declare
  v_definition text;
  v_updated text;
  v_old text;
  v_new text;
begin
  v_definition := replace(replace(
    pg_catalog.pg_get_functiondef(
      'public.enqueue_managed_whatsapp_distribution_auto_reply(uuid,uuid,uuid,text)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  ), E'\r', E'\n');

  v_old := $old$
  if not found
     or v_conversation_id is null
     or v_inbound_message_id is null then
    return jsonb_build_object(
      'handled', true,
      'queued', false,
      'reason', 'inbound_transport_context_not_found'
    );
  end if;

  if jsonb_typeof(v_reservation) <> 'object'
$old$;
  v_new := $new$
  if not found
     or v_conversation_id is null
     or v_inbound_message_id is null then
    return jsonb_build_object(
      'handled', true,
      'queued', false,
      'reason', 'inbound_transport_context_not_found'
    );
  end if;

  if not exists (
    select 1
    from public.whatsapp_messages as attended_message
    join public.whatsapp_conversation_lead_bindings as active_binding
      on active_binding.organization_id = attended_message.organization_id
     and active_binding.conversation_id = attended_message.conversation_id
     and active_binding.session_id = attended_message.session_id
     and active_binding.lead_id = attended_message.lead_id
     and active_binding.active_to is null
     and active_binding.stale = false
    join public.whatsapp_attendance_entries as attendance
      on attendance.organization_id = active_binding.organization_id
     and attendance.conversation_id = active_binding.conversation_id
     and attendance.session_id = active_binding.session_id
     and attendance.lead_id = active_binding.lead_id
     and attendance.binding_id = active_binding.id
     and attendance.id::text = coalesce(
       attended_message.metadata
         ->'whatsapp_attendance_capture'->>'attendance_entry_id',
       ''
     )
    where attended_message.organization_id = p_organization_id
      and attended_message.id = v_inbound_message_id
      and attended_message.conversation_id = v_conversation_id
      and attended_message.session_id = v_session_id
      and attended_message.lead_id = v_entry.lead_id
      and attended_message.capture_state = 'captured'
  ) then
    return jsonb_build_object(
      'handled', true,
      'queued', false,
      'reason', 'whatsapp_attendance_required'
    );
  end if;

  if jsonb_typeof(v_reservation) <> 'object'
$new$;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception using errcode = '55000',
      message = 'managed_whatsapp_auto_reply_attendance_patch_drift';
  end if;
  v_definition := v_updated;

  v_old := $old$
    sender_user_id,
    message_id,
$old$;
  v_new := $new$
    sender_user_id,
    capture_state,
    message_id,
$new$;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception using errcode = '55000',
      message = 'managed_whatsapp_auto_reply_capture_column_patch_drift';
  end if;
  v_definition := v_updated;

  v_old := $old$
    null,
    v_provider_request_id,
$old$;
  v_new := $new$
    null,
    'captured',
    v_provider_request_id,
$new$;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception using errcode = '55000',
      message = 'managed_whatsapp_auto_reply_capture_value_patch_drift';
  end if;

  execute v_updated;
end;
$patch_managed_auto_reply$;

-- Automation dispatch is another backend-only sender that bypasses the normal
-- composer. Fence its canonical message, provider outbox, preview and timeline
-- writes behind the exact active binding's attendance entry.
do $patch_automation_dispatch$
declare
  v_definition text;
  v_updated text;
  v_old text;
  v_new text;
begin
  v_definition := replace(replace(
    pg_catalog.pg_get_functiondef(
      'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  ), E'\r', E'\n');

  v_old := $old$
  if not found
     or locked_binding.organization_id is distinct from p_organization_id
     or locked_binding.session_id is distinct from p_session_id
     or locked_binding.lead_id is distinct from target_lead_id then
    raise exception using errcode = '23514', message = 'automation_whatsapp_queue_binding_mismatch';
  end if;

  select execution.*
$old$;
  v_new := $new$
  if not found
     or locked_binding.organization_id is distinct from p_organization_id
     or locked_binding.session_id is distinct from p_session_id
     or locked_binding.lead_id is distinct from target_lead_id
     or locked_binding.stale is distinct from false then
    raise exception using errcode = '23514', message = 'automation_whatsapp_queue_binding_mismatch';
  end if;

  if not exists (
    select 1
    from public.whatsapp_attendance_entries as attendance
    where attendance.organization_id = p_organization_id
      and attendance.conversation_id = p_conversation_id
      and attendance.session_id = p_session_id
      and attendance.lead_id = target_lead_id
      and attendance.binding_id = locked_binding.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'automation_whatsapp_attendance_required';
  end if;

  select execution.*
$new$;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception using errcode = '55000',
      message = 'automation_whatsapp_attendance_patch_drift';
  end if;
  v_definition := v_updated;

  v_old := $old$
    organization_id, conversation_id, session_id, lead_id, sender_user_id,
    provider_message_id, message_id, client_message_id, from_me, direction,
$old$;
  v_new := $new$
    organization_id, conversation_id, session_id, lead_id, sender_user_id,
    capture_state, provider_message_id, message_id, client_message_id, from_me, direction,
$new$;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception using errcode = '55000',
      message = 'automation_whatsapp_capture_column_patch_drift';
  end if;
  v_definition := v_updated;

  v_old := $old$
    p_organization_id, p_conversation_id, p_session_id, target_lead_id, actor_user_id,
    provider_request_id, queued_message_key, p_client_message_id, true, 'outbound',
$old$;
  v_new := $new$
    p_organization_id, p_conversation_id, p_session_id, target_lead_id, actor_user_id,
    'captured', provider_request_id, queued_message_key, p_client_message_id, true, 'outbound',
$new$;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception using errcode = '55000',
      message = 'automation_whatsapp_capture_value_patch_drift';
  end if;
  v_definition := v_updated;

  v_old := $old$
       or existing_message.sender_user_id is distinct from actor_user_id
       or existing_message.message_type <> clean_message_type
$old$;
  v_new := $new$
       or existing_message.sender_user_id is distinct from actor_user_id
       or existing_message.capture_state is distinct from 'captured'
       or existing_message.message_type <> clean_message_type
$new$;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception using errcode = '55000',
      message = 'automation_whatsapp_capture_collision_patch_drift';
  end if;

  execute v_updated;
end;
$patch_automation_dispatch$;

-- Managed intake still needs the plaintext in-memory to prove the immutable
-- provider fingerprint and distribution ledger. Under suppressed attendance,
-- prevent that transient argument from being projected onto leads.message (or
-- observed as a message change by later lead triggers).
create or replace function private.suppress_whatsapp_attendance_lead_message()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.current_setting(
    'vimob.whatsapp_attendance_capture',
    true
  ) = 'suppressed' then
    new.message := old.message;
  end if;
  return new;
end;
$$;

revoke all on function private.suppress_whatsapp_attendance_lead_message()
from public, anon, authenticated, service_role;

drop trigger if exists aa_whatsapp_attendance_suppress_lead_message
on public.leads;
create trigger aa_whatsapp_attendance_suppress_lead_message
before update of message on public.leads
for each row
execute function private.suppress_whatsapp_attendance_lead_message();

comment on function private.suppress_whatsapp_attendance_lead_message() is
'Transaction-local guard that prevents pre-attendance WhatsApp plaintext from being projected onto leads.message.';

create or replace function public.process_managed_whatsapp_lead_entry_attendance(
  p_organization_id uuid,
  p_lead_id uuid,
  p_session_id uuid,
  p_rule_id uuid,
  p_provider_message_id text,
  p_message text,
  p_occurred_at timestamp with time zone,
  p_suppress_lead_message boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_capture_setting text := pg_catalog.current_setting(
    'vimob.whatsapp_attendance_capture',
    true
  );
  v_result jsonb;
begin
  if p_suppress_lead_message is null then
    raise exception using
      errcode = '22023',
      message = 'whatsapp_attendance_suppression_flag_required';
  end if;

  perform pg_catalog.set_config(
    'vimob.whatsapp_attendance_capture',
    case when p_suppress_lead_message then 'suppressed' else 'captured' end,
    true
  );

  v_result := public.process_managed_whatsapp_lead_entry(
    p_organization_id,
    p_lead_id,
    p_session_id,
    p_rule_id,
    p_provider_message_id,
    p_message,
    p_occurred_at
  );

  perform pg_catalog.set_config(
    'vimob.whatsapp_attendance_capture',
    coalesce(v_previous_capture_setting, ''),
    true
  );
  return v_result;
exception
  when others then
    perform pg_catalog.set_config(
      'vimob.whatsapp_attendance_capture',
      coalesce(v_previous_capture_setting, ''),
      true
    );
    raise;
end;
$$;

revoke all on function public.process_managed_whatsapp_lead_entry_attendance(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamp with time zone,
  boolean
) from public, anon, authenticated, service_role;

grant execute on function public.process_managed_whatsapp_lead_entry_attendance(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamp with time zone,
  boolean
) to service_role;

comment on function public.process_managed_whatsapp_lead_entry_attendance(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamp with time zone,
  boolean
) is
'Backend-only managed intake wrapper. It retains message fingerprint semantics while suppressing leads.message projection before attendance.';

-- Canonical messages are now a backend-only transport ledger. The browser UI
-- already consumes the fenced API projections; leaving the historical table
-- grants in place would let authenticated callers self-assert captured.
revoke all privileges
on table public.whatsapp_messages
from public, anon, authenticated;

-- Managed intake historically stores deterministic message fingerprints in
-- both lifecycle ledgers. They are backend analytics/history sources; no
-- browser callsite reads them directly, and exposing low-entropy digests would
-- permit offline guesses of pre-attendance message text.
revoke all privileges
on table public.lead_entry_events
from public, anon, authenticated;

revoke all privileges
on table public.lead_timeline_events
from public, anon, authenticated;

-- Keep the historical SELECT policy safe as defense in depth. It remains
-- useful for drift detection, but revoked browser grants are the hard boundary.
drop policy if exists whatsapp_messages_select_owner_only
on public.whatsapp_messages;

create policy whatsapp_messages_select_owner_only
on public.whatsapp_messages
for select
to authenticated
using (
  capture_state is distinct from 'suppressed'
  and private.whatsapp_message_conversation_session_matches(
    conversation_id,
    session_id
  )
  and private.can_view_whatsapp_conversation(conversation_id)
);

-- Suppressed rows are transport reconciliation only. They must not reach any
-- Realtime, automation, gamification, attention, avatar or conversation-touch
-- side-effect lane before an explicit attendance entry permits capture.
drop trigger if exists gamification_canonical_whatsapp_insert_enqueue
on public.whatsapp_messages;
create trigger gamification_canonical_whatsapp_insert_enqueue
after insert on public.whatsapp_messages
for each row
when (new.capture_state is distinct from 'suppressed')
execute function private.enqueue_whatsapp_message_gamification();

drop trigger if exists gamification_canonical_whatsapp_status_enqueue
on public.whatsapp_messages;
create trigger gamification_canonical_whatsapp_status_enqueue
after update of status on public.whatsapp_messages
for each row
when (new.capture_state is distinct from 'suppressed')
execute function private.enqueue_whatsapp_message_gamification();

drop trigger if exists trg_capture_whatsapp_attention_fact
on public.whatsapp_messages;
create trigger trg_capture_whatsapp_attention_fact
after insert on public.whatsapp_messages
for each row
when (new.capture_state is distinct from 'suppressed')
execute function private.capture_whatsapp_attention_fact();

drop trigger if exists trg_touch_whatsapp_conversation_received_at
on public.whatsapp_messages;
create trigger trg_touch_whatsapp_conversation_received_at
after insert on public.whatsapp_messages
for each row
when (
  new.capture_state is distinct from 'suppressed'
  and coalesce(new.from_me, false) = false
  and lower(coalesce(new.direction, 'inbound')) <> 'outbound'
)
execute function public.touch_whatsapp_conversation_received_at();

drop trigger if exists whatsapp_message_private_broadcast
on public.whatsapp_messages;
create trigger whatsapp_message_private_broadcast
after insert or update of
  lead_id,
  status,
  delivered_at,
  read_at,
  media_status,
  media_url,
  content,
  message_type,
  reaction_emoji,
  reaction_to_message_id
on public.whatsapp_messages
for each row
when (new.capture_state is distinct from 'suppressed')
execute function private.broadcast_whatsapp_message_change();

drop trigger if exists zz_automation_human_outbound_handoff
on public.whatsapp_messages;
create trigger zz_automation_human_outbound_handoff
after insert on public.whatsapp_messages
for each row
when (new.capture_state is distinct from 'suppressed')
execute function private.capture_automation_human_outbound_handoff();

drop trigger if exists zz_automation_inbound_message
on public.whatsapp_messages;
create trigger zz_automation_inbound_message
after insert on public.whatsapp_messages
for each row
when (new.capture_state is distinct from 'suppressed')
execute function private.capture_automation_inbound_message_event();

drop trigger if exists enqueue_whatsapp_avatar_after_message
on public.whatsapp_messages;
create trigger enqueue_whatsapp_avatar_after_message
after insert or update of
  status,
  direction,
  from_me,
  message_type,
  lead_id,
  session_id,
  conversation_id,
  remote_jid
on public.whatsapp_messages
for each row
when (new.capture_state is distinct from 'suppressed')
execute function private.enqueue_whatsapp_avatar_from_message();

commit;
