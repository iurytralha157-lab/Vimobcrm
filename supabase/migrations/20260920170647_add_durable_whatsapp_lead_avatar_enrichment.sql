begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- Keep the durable object key separate from the delivery URL. Signed URLs are
-- intentionally short-lived and must never become the database source of truth.
alter table public.leads
  add column if not exists whatsapp_avatar_storage_path text;

comment on column public.leads.whatsapp_avatar_storage_path is
  'Backend-owned object key in the private whatsapp-media bucket. Read models exchange it for a short-lived signed URL.';

do $avatar_path_contract$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.leads'::regclass
      and conname = 'leads_whatsapp_avatar_storage_path_scope_check'
  ) then
    alter table public.leads
      add constraint leads_whatsapp_avatar_storage_path_scope_check
      check (
        whatsapp_avatar_storage_path is null
        or whatsapp_avatar_storage_path ~ (
          '^orgs/' || organization_id::text || '/profile-pictures/' || id::text ||
          '/[0-9a-f]{64}[.](jpg|png|webp)$'
        )
      ) not valid;
  end if;
end;
$avatar_path_contract$;

-- Release the brief ACCESS EXCLUSIVE lock from ADD COLUMN/ADD CONSTRAINT
-- before validation and the rest of the migration. Validation uses a weaker
-- lock and can coexist with normal lead reads and writes.
commit;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.leads
  validate constraint leads_whatsapp_avatar_storage_path_scope_check;

commit;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

create table if not exists private.whatsapp_avatar_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  lead_id uuid not null
    references public.leads(id) on delete cascade,
  session_id uuid not null
    references public.whatsapp_sessions(id) on delete cascade,
  conversation_id uuid not null
    references public.whatsapp_conversations(id) on delete cascade,
  binding_id uuid not null
    references public.whatsapp_conversation_lead_bindings(id) on delete cascade,
  source_message_id uuid
    references public.whatsapp_messages(id) on delete set null,
  last_contact_message_id uuid
    references public.whatsapp_messages(id) on delete set null,
  last_contact_binding_id uuid not null
    references public.whatsapp_conversation_lead_bindings(id) on delete cascade,
  last_contact_eligible_at timestamptz not null,
  eligible_contact_count smallint not null default 1,
  last_attempt_message_id uuid
    references public.whatsapp_messages(id) on delete set null,
  remote_jid text not null,
  status text not null default 'pending',
  attempts smallint not null default 0,
  max_attempts smallint not null default 2,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  lease_expires_at timestamptz,
  locked_by text,
  lease_token uuid,
  provider_avatar_id text,
  storage_path text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_avatar_jobs_status_check
    check (status in (
      'pending',
      'processing',
      'awaiting_next_contact',
      'completed',
      'not_available',
      'stale'
    )),
  constraint whatsapp_avatar_jobs_attempts_check
    check (attempts between 0 and 2 and max_attempts = 2),
  constraint whatsapp_avatar_jobs_eligible_contact_count_check
    check (eligible_contact_count between 1 and 2),
  constraint whatsapp_avatar_jobs_remote_jid_check
    check (
      btrim(remote_jid) ~ '^[^[:space:]@]+@(s[.]whatsapp[.]net|lid)$'
    ),
  constraint whatsapp_avatar_jobs_lease_check
    check (
      (
        status = 'processing'
        and locked_at is not null
        and lease_expires_at is not null
        and nullif(btrim(locked_by), '') is not null
        and lease_token is not null
      )
      or (
        status <> 'processing'
        and locked_at is null
        and lease_expires_at is null
        and locked_by is null
        and lease_token is null
      )
    ),
  constraint whatsapp_avatar_jobs_storage_path_scope_check
    check (
      storage_path is null
      or storage_path ~ (
        '^orgs/' || organization_id::text || '/profile-pictures/' || lead_id::text ||
        '/[0-9a-f]{64}[.](jpg|png|webp)$'
      )
    )
);

create unique index if not exists whatsapp_avatar_jobs_lead_uidx
  on private.whatsapp_avatar_jobs (organization_id, lead_id);

create index if not exists whatsapp_avatar_jobs_pending_idx
  on private.whatsapp_avatar_jobs (next_attempt_at, created_at, id)
  where status = 'pending';

create unique index if not exists whatsapp_avatar_jobs_one_processing_per_session_uidx
  on private.whatsapp_avatar_jobs (session_id)
  where status = 'processing';

create index if not exists whatsapp_avatar_jobs_lead_fk_idx
  on private.whatsapp_avatar_jobs (lead_id);

create index if not exists whatsapp_avatar_jobs_session_fk_idx
  on private.whatsapp_avatar_jobs (session_id);

create index if not exists whatsapp_avatar_jobs_conversation_fk_idx
  on private.whatsapp_avatar_jobs (conversation_id);

create index if not exists whatsapp_avatar_jobs_binding_fk_idx
  on private.whatsapp_avatar_jobs (binding_id);

create index if not exists whatsapp_avatar_jobs_source_message_fk_idx
  on private.whatsapp_avatar_jobs (source_message_id);

create index if not exists whatsapp_avatar_jobs_last_contact_message_fk_idx
  on private.whatsapp_avatar_jobs (last_contact_message_id);

create index if not exists whatsapp_avatar_jobs_last_contact_binding_fk_idx
  on private.whatsapp_avatar_jobs (last_contact_binding_id);

create index if not exists whatsapp_avatar_jobs_last_attempt_message_fk_idx
  on private.whatsapp_avatar_jobs (last_attempt_message_id)
  where last_attempt_message_id is not null;

alter table private.whatsapp_avatar_jobs enable row level security;

revoke all on table private.whatsapp_avatar_jobs
from public, anon, authenticated, service_role;

comment on table private.whatsapp_avatar_jobs is
  'Backend-only, two-contact durable queue for one-time WhatsApp lead avatar enrichment.';

comment on column private.whatsapp_avatar_jobs.last_contact_message_id is
  'Second distinct eligible contact once present; later contacts cannot replace it.';

comment on column private.whatsapp_avatar_jobs.source_message_id is
  'First eligible contact when its message row still exists; deletion does not discard a recorded second opportunity.';

comment on column private.whatsapp_avatar_jobs.last_contact_binding_id is
  'Exact binding epoch captured with last_contact_message_id; a later same-card relink cannot validate an older contact.';

comment on column private.whatsapp_avatar_jobs.eligible_contact_count is
  'Number of distinct eligible contacts recorded for enrichment, capped permanently at two.';

comment on column private.whatsapp_avatar_jobs.last_attempt_message_id is
  'Contact message whose claim consumed the latest provider attempt.';

create or replace function private.guard_whatsapp_avatar_storage_path_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_request_role text := pg_catalog.lower(coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    current_user
  ));
  v_path_changed boolean := case
    when tg_op = 'INSERT' then new.whatsapp_avatar_storage_path is not null
    else new.whatsapp_avatar_storage_path is distinct from old.whatsapp_avatar_storage_path
  end;
begin
  if v_path_changed
     and (
       current_user in ('anon', 'authenticated', 'service_role')
       or v_request_role in ('anon', 'authenticated', 'service_role')
     ) then
    raise exception 'whatsapp_avatar_storage_path is backend-owned'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_whatsapp_avatar_storage_path_on_insert
on public.leads;

create trigger guard_whatsapp_avatar_storage_path_on_insert
before insert on public.leads
for each row
execute function private.guard_whatsapp_avatar_storage_path_write();

drop trigger if exists guard_whatsapp_avatar_storage_path_on_update
on public.leads;

create trigger guard_whatsapp_avatar_storage_path_on_update
before update of whatsapp_avatar_storage_path on public.leads
for each row
execute function private.guard_whatsapp_avatar_storage_path_write();

revoke all on function private.guard_whatsapp_avatar_storage_path_write()
from public, anon, authenticated, service_role;

-- Release trigger DDL locks on leads before touching the high-volume message
-- table. The private table and backend-owned column contract are now complete.
commit;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function private.enqueue_whatsapp_avatar_from_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remote_jid text;
  v_binding_id uuid;
  v_is_eligible boolean;
begin
  if new.organization_id is null
     or new.session_id is null
     or new.conversation_id is null
     or new.lead_id is null then
    return new;
  end if;

  v_is_eligible := case
    when coalesce(new.from_me, false)
      or lower(coalesce(new.direction, 'inbound')) = 'outbound'
      then lower(coalesce(new.status, '')) in ('sent', 'delivered', 'read')
    else lower(coalesce(new.status, '')) in ('received', 'delivered', 'read')
  end;

  if not v_is_eligible
     or lower(coalesce(new.message_type, 'text')) in (
       'reaction', 'receipt', 'protocol', 'revoked', 'deleted'
     ) then
    return new;
  end if;

  -- Terminal cards and receipts/replays of the same row pay only one indexed
  -- lookup and never re-enter the conversation/binding join.
  if exists (
    select 1
    from private.whatsapp_avatar_jobs as existing
    where existing.organization_id = new.organization_id
      and existing.lead_id = new.lead_id
      and (
        existing.status in ('completed', 'not_available')
        or (
          existing.status <> 'stale'
          and existing.last_contact_message_id = new.id
        )
      )
  ) then
    return new;
  end if;

  select
    coalesce(nullif(btrim(new.remote_jid), ''), nullif(btrim(conversation.remote_jid), '')),
    binding.id
  into v_remote_jid, v_binding_id
  from public.whatsapp_conversations as conversation
  join public.whatsapp_conversation_lead_bindings as binding
    on binding.organization_id = conversation.organization_id
   and binding.conversation_id = conversation.id
   and binding.session_id = new.session_id
   and binding.lead_id = new.lead_id
   and binding.active_to is null
   and binding.stale = false
  join public.leads as lead
    on lead.organization_id = conversation.organization_id
   and lead.id = binding.lead_id
  where conversation.organization_id = new.organization_id
    and conversation.id = new.conversation_id
    and conversation.session_id = new.session_id
    and conversation.lead_id = new.lead_id
    and conversation.deleted_at is null
    and coalesce(conversation.is_group, false) = false
    and nullif(btrim(lead.whatsapp_avatar_storage_path), '') is null
  limit 1;

  if v_binding_id is null
     or v_remote_jid is null
     or v_remote_jid !~ '^[^[:space:]@]+@(s[.]whatsapp[.]net|lid)$' then
    return new;
  end if;

  insert into private.whatsapp_avatar_jobs as job (
    organization_id,
    lead_id,
    session_id,
    conversation_id,
    binding_id,
    source_message_id,
    last_contact_message_id,
    last_contact_binding_id,
    last_contact_eligible_at,
    eligible_contact_count,
    remote_jid,
    status,
    attempts,
    max_attempts,
    next_attempt_at,
    created_at,
    updated_at
  ) values (
    new.organization_id,
    new.lead_id,
    new.session_id,
    new.conversation_id,
    v_binding_id,
    new.id,
    new.id,
    v_binding_id,
    clock_timestamp(),
    1,
    v_remote_jid,
    'pending',
    0,
    2,
    now(),
    now(),
    now()
  )
  on conflict (organization_id, lead_id) do update
  set
    session_id = case
      when job.status = 'stale' then excluded.session_id
      else job.session_id
    end,
    conversation_id = case
      when job.status = 'stale' then excluded.conversation_id
      else job.conversation_id
    end,
    binding_id = case
      when job.status = 'stale' then excluded.binding_id
      else job.binding_id
    end,
    -- Preserve contact one permanently. The claim function can fall back to
    -- contact two when contact one's exact binding is no longer current.
    source_message_id = job.source_message_id,
    last_contact_message_id = excluded.last_contact_message_id,
    last_contact_binding_id = excluded.last_contact_binding_id,
    last_contact_eligible_at = excluded.last_contact_eligible_at,
    eligible_contact_count = least(2, job.eligible_contact_count + 1)::smallint,
    last_attempt_message_id = case
      when job.status = 'stale' then null
      else job.last_attempt_message_id
    end,
    remote_jid = excluded.remote_jid,
    status = case
      when job.status = 'stale' then 'pending'
      when job.status = 'awaiting_next_contact'
        and job.last_contact_message_id is distinct from excluded.last_contact_message_id
        and job.attempts < job.max_attempts
        then 'pending'
      else job.status
    end,
    attempts = job.attempts,
    max_attempts = 2,
    next_attempt_at = case
      when job.status = 'stale' then now()
      when job.status = 'awaiting_next_contact'
        and job.last_contact_message_id is distinct from excluded.last_contact_message_id
        and job.attempts < job.max_attempts
        then now()
      else job.next_attempt_at
    end,
    last_error = case
      when job.status = 'stale' then null
      when job.status = 'awaiting_next_contact'
        and job.last_contact_message_id is distinct from excluded.last_contact_message_id
        and job.attempts < job.max_attempts
        then null
      else job.last_error
    end,
    provider_avatar_id = case when job.status = 'stale' then null else job.provider_avatar_id end,
    storage_path = case when job.status = 'stale' then null else job.storage_path end,
    completed_at = case when job.status = 'stale' then null else job.completed_at end,
    created_at = case when job.status = 'stale' then now() else job.created_at end,
    updated_at = now()
  where (
      job.status = 'stale'
      and job.last_contact_message_id is distinct from excluded.last_contact_message_id
      and job.attempts < job.max_attempts
      and job.eligible_contact_count < 2
      and excluded.last_contact_eligible_at >= job.last_contact_eligible_at
    )
    or (
      job.status not in ('completed', 'not_available', 'stale')
      and job.last_contact_message_id is distinct from excluded.last_contact_message_id
      and job.eligible_contact_count < 2
      and excluded.last_contact_eligible_at >= job.last_contact_eligible_at
    );

  return new;
end;
$$;

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
execute function private.enqueue_whatsapp_avatar_from_message();

revoke all on function private.enqueue_whatsapp_avatar_from_message()
from public, anon, authenticated, service_role;

-- Release the write-conflicting trigger DDL lock before defining the worker
-- RPCs. The trigger is already complete and only performs backend-owned DML.
commit;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function private.claim_whatsapp_avatar_job(
  p_worker_id text,
  p_lease interval default interval '1 minute'
)
returns table (
  id uuid,
  organization_id uuid,
  lead_id uuid,
  session_id uuid,
  conversation_id uuid,
  binding_id uuid,
  source_message_id uuid,
  remote_jid text,
  attempts smallint,
  lease_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'avatar worker id is required' using errcode = '22023';
  end if;
  if p_lease is null
     or p_lease < interval '30 seconds'
     or p_lease > interval '5 minutes' then
    raise exception 'avatar worker lease must be between 30 seconds and 5 minutes'
      using errcode = '22023';
  end if;

  -- Claims are serialized only while a row and its per-session slot are chosen.
  -- Provider and Storage I/O always happen after this transaction commits.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vimob:whatsapp-avatar:claim', 0)
  );

  update private.whatsapp_avatar_jobs as stale
  set
    status = case
      when stale.attempts >= stale.max_attempts then 'not_available'
      when stale.last_contact_message_id is distinct from stale.last_attempt_message_id
        then 'pending'
      when stale.eligible_contact_count >= stale.max_attempts
        then 'not_available'
      else 'awaiting_next_contact'
    end,
    next_attempt_at = now(),
    locked_at = null,
    lease_expires_at = null,
    locked_by = null,
    lease_token = null,
    last_error = 'avatar_worker_lease_expired',
    updated_at = now()
  where stale.status = 'processing'
    and stale.lease_expires_at < now();

  -- A recorded second contact is the final eligibility slot. If neither the
  -- still-unclaimed first contact nor that exact second binding can ever be
  -- claimed, terminate the job instead of polling a permanently empty join.
  -- Session connectivity and the per-session slot are deliberately excluded:
  -- both are temporary and must only delay a claim.
  update private.whatsapp_avatar_jobs as invalid
  set
    status = 'not_available',
    next_attempt_at = now(),
    last_error = 'avatar_contact_no_longer_current',
    updated_at = now()
  where invalid.status = 'pending'
    and invalid.eligible_contact_count >= 2
    and invalid.attempts < invalid.max_attempts
    and not (
      invalid.attempts = 0
      and exists (
        select 1
        from public.whatsapp_messages as source_message
        join public.whatsapp_conversations as source_conversation
          on source_conversation.organization_id = source_message.organization_id
         and source_conversation.id = source_message.conversation_id
         and source_conversation.session_id = source_message.session_id
         and source_conversation.lead_id = source_message.lead_id
         and source_conversation.deleted_at is null
         and coalesce(source_conversation.is_group, false) = false
        join public.whatsapp_conversation_lead_bindings as source_binding
          on source_binding.organization_id = source_conversation.organization_id
         and source_binding.id = invalid.binding_id
         and source_binding.conversation_id = source_conversation.id
         and source_binding.session_id = source_conversation.session_id
         and source_binding.lead_id = source_conversation.lead_id
         and source_binding.active_to is null
         and source_binding.stale = false
        where source_message.organization_id = invalid.organization_id
          and source_message.id = invalid.source_message_id
          and source_message.lead_id = invalid.lead_id
      )
    )
    and not exists (
      select 1
      from public.whatsapp_messages as remaining_message
      join public.whatsapp_conversations as remaining_conversation
        on remaining_conversation.organization_id = remaining_message.organization_id
       and remaining_conversation.id = remaining_message.conversation_id
       and remaining_conversation.session_id = remaining_message.session_id
       and remaining_conversation.lead_id = remaining_message.lead_id
       and remaining_conversation.deleted_at is null
       and coalesce(remaining_conversation.is_group, false) = false
      join public.whatsapp_conversation_lead_bindings as remaining_binding
        on remaining_binding.organization_id = remaining_conversation.organization_id
       and remaining_binding.id = invalid.last_contact_binding_id
       and remaining_binding.conversation_id = remaining_conversation.id
       and remaining_binding.session_id = remaining_conversation.session_id
       and remaining_binding.lead_id = remaining_conversation.lead_id
       and remaining_binding.active_to is null
       and remaining_binding.stale = false
      where remaining_message.organization_id = invalid.organization_id
        and remaining_message.id = invalid.last_contact_message_id
        and remaining_message.id is distinct from invalid.source_message_id
        and remaining_message.lead_id = invalid.lead_id
    );

  return query
  with candidate as materialized (
    select
      job.id,
      contact.organization_id,
      contact.lead_id,
      contact.session_id,
      contact.conversation_id,
      contact.binding_id,
      contact.message_id as source_message_id,
      case
        -- Contact one became unusable before its first claim. Contact two is
        -- the final eligible opportunity, so claiming it consumes both slots.
        when job.attempts = 0
          and contact.message_id is distinct from job.source_message_id
          then job.max_attempts
        else (job.attempts + 1)::smallint
      end as claimed_attempts,
      contact.remote_jid
    from private.whatsapp_avatar_jobs as job
    cross join lateral (
      -- Resolve validity and first/second preference before considering the
      -- per-session processing slot. A busy first-contact session must delay
      -- this job, never make contact two look like the fallback.
      select
        message.organization_id,
        message.lead_id,
        message.session_id,
        message.conversation_id,
        binding.id as binding_id,
        message.id as message_id,
        coalesce(
          nullif(btrim(message.remote_jid), ''),
          nullif(btrim(conversation.remote_jid), '')
        ) as remote_jid
      from public.whatsapp_messages as message
      join public.whatsapp_conversations as conversation
        on conversation.organization_id = message.organization_id
       and conversation.id = message.conversation_id
       and conversation.session_id = message.session_id
       and conversation.lead_id = message.lead_id
       and conversation.deleted_at is null
       and coalesce(conversation.is_group, false) = false
      join public.whatsapp_conversation_lead_bindings as binding
        on binding.organization_id = conversation.organization_id
       and binding.conversation_id = conversation.id
       and binding.session_id = conversation.session_id
       and binding.lead_id = conversation.lead_id
       and binding.active_to is null
       and binding.stale = false
      join public.whatsapp_sessions as session
        on session.organization_id = message.organization_id
       and session.id = message.session_id
       and session.provider = 'evolution_go'
      join public.leads as lead
        on lead.organization_id = message.organization_id
       and lead.id = message.lead_id
       and nullif(btrim(lead.whatsapp_avatar_storage_path), '') is null
      where message.organization_id = job.organization_id
        and message.lead_id = job.lead_id
        and (
          (
            job.attempts = 0
            and message.id = job.source_message_id
            -- A same-card relink rotates the binding row. Contact one remains
            -- valid only under the exact binding captured when it was queued.
            and binding.id = job.binding_id
          )
          or (
            message.id = job.last_contact_message_id
            and message.id is distinct from job.source_message_id
            and binding.id = job.last_contact_binding_id
            and (
              job.attempts > 0
              or (job.attempts = 0 and job.eligible_contact_count = 2)
            )
          )
        )
        and coalesce(
          nullif(btrim(message.remote_jid), ''),
          nullif(btrim(conversation.remote_jid), '')
        ) ~ '^[^[:space:]@]+@(s[.]whatsapp[.]net|lid)$'
      order by case when message.id = job.source_message_id then 0 else 1 end
      limit 1
    ) as contact
    join public.whatsapp_sessions as claim_session
      on claim_session.organization_id = contact.organization_id
     and claim_session.id = contact.session_id
     and claim_session.provider = 'evolution_go'
     and claim_session.status = 'connected'
     and coalesce(claim_session.is_active, true) = true
    where job.status = 'pending'
      and job.attempts < job.max_attempts
      and job.next_attempt_at <= now()
      and not exists (
        select 1
        from private.whatsapp_avatar_jobs as active
        where active.session_id = contact.session_id
          and active.status = 'processing'
      )
    order by
      job.next_attempt_at,
      job.created_at,
      job.id
    limit 1
    for update of job skip locked
  ), claimed as (
    update private.whatsapp_avatar_jobs as job
    set
      organization_id = candidate.organization_id,
      session_id = candidate.session_id,
      conversation_id = candidate.conversation_id,
      binding_id = candidate.binding_id,
      last_attempt_message_id = candidate.source_message_id,
      remote_jid = candidate.remote_jid,
      status = 'processing',
      attempts = candidate.claimed_attempts,
      locked_at = now(),
      lease_expires_at = now() + p_lease,
      locked_by = btrim(p_worker_id),
      lease_token = gen_random_uuid(),
      last_error = null,
      updated_at = now()
    from candidate
    where job.id = candidate.id
    returning job.*
  )
  select
    claimed.id,
    claimed.organization_id,
    claimed.lead_id,
    claimed.session_id,
    claimed.conversation_id,
    claimed.binding_id,
    claimed.last_attempt_message_id,
    claimed.remote_jid,
    claimed.attempts,
    claimed.lease_token
  from claimed;
end;
$$;

revoke all on function private.claim_whatsapp_avatar_job(text, interval)
from public, anon, authenticated, service_role;

create or replace function private.finish_whatsapp_avatar_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_storage_path text default null,
  p_provider_avatar_id text default null,
  p_error text default null
)
returns table (
  updated boolean,
  organization_id uuid,
  lead_id uuid,
  conversation_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job private.whatsapp_avatar_jobs%rowtype;
  v_binding_is_current boolean := false;
  v_remaining_contact_is_current boolean := false;
  v_lead_already_complete boolean := false;
  v_lead_updated boolean := false;
  v_next_status text;
begin
  if p_outcome not in ('completed', 'unavailable', 'transient') then
    raise exception 'unsupported avatar outcome' using errcode = '22023';
  end if;

  select job.*
  into v_job
  from private.whatsapp_avatar_jobs as job
  where job.id = p_job_id
    and job.status = 'processing'
    and job.lease_token = p_lease_token
    and job.lease_expires_at >= now();

  if not found then
    return;
  end if;

  if p_outcome = 'completed' then
    if nullif(btrim(coalesce(p_storage_path, '')), '') is null
       or p_storage_path !~ (
         '^orgs/' || v_job.organization_id::text || '/profile-pictures/' || v_job.lead_id::text ||
         '/[0-9a-f]{64}[.](jpg|png|webp)$'
       ) then
      raise exception 'completed avatar requires a tenant-scoped storage path'
        using errcode = '22023';
    end if;

    -- Serialize with every binding writer using the canonical lock order
    -- conversation -> active binding. Without these locks, a rebind could
    -- commit between an EXISTS check and the lead update below.
    perform conversation.id
    from public.whatsapp_conversations as conversation
    where conversation.organization_id = v_job.organization_id
      and conversation.id = v_job.conversation_id
      and conversation.session_id = v_job.session_id
      and conversation.lead_id = v_job.lead_id
      and conversation.deleted_at is null
      and coalesce(conversation.is_group, false) = false
    for no key update;

    if found then
      perform binding.id
      from public.whatsapp_conversation_lead_bindings as binding
      where binding.organization_id = v_job.organization_id
        and binding.id = v_job.binding_id
        and binding.conversation_id = v_job.conversation_id
        and binding.session_id = v_job.session_id
        and binding.lead_id = v_job.lead_id
        and binding.active_to is null
        and binding.stale = false
      for update;

      if found then
        -- Fence deletion/SET NULL and identity-changing updates of the exact
        -- contact that drove this claim.
        -- The order stays conversation -> binding -> message -> job, matching
        -- binding writers without holding the job while waiting on a message.
        perform message.id
        from public.whatsapp_messages as message
        where message.organization_id = v_job.organization_id
          and message.id = v_job.last_attempt_message_id
          and message.session_id = v_job.session_id
          and message.conversation_id = v_job.conversation_id
          and message.lead_id = v_job.lead_id
        for share;
        v_binding_is_current := found;
      end if;
    end if;

    -- Do not lock the job before conversation/binding: binding writers use the
    -- canonical conversation -> binding -> message-trigger/job order. Re-lock
    -- and revalidate the lease only after those rows are fenced, preventing a
    -- job/conversation deadlock from aborting message intake.
    select job.*
    into v_job
    from private.whatsapp_avatar_jobs as job
    where job.id = p_job_id
      and job.status = 'processing'
      and job.lease_token = p_lease_token
      and job.lease_expires_at >= now()
    for update;

    if not found then
      return;
    end if;

    updated := false;
    organization_id := v_job.organization_id;
    lead_id := v_job.lead_id;
    conversation_id := v_job.conversation_id;

    if v_job.attempts < v_job.max_attempts
       and v_job.eligible_contact_count >= 2
       and v_job.last_contact_message_id is distinct from v_job.last_attempt_message_id then
      select exists (
        select 1
        from public.whatsapp_messages as message
        join public.whatsapp_conversations as conversation
          on conversation.organization_id = message.organization_id
         and conversation.id = message.conversation_id
         and conversation.session_id = message.session_id
         and conversation.lead_id = message.lead_id
         and conversation.deleted_at is null
         and coalesce(conversation.is_group, false) = false
        join public.whatsapp_conversation_lead_bindings as binding
          on binding.organization_id = conversation.organization_id
         and binding.id = v_job.last_contact_binding_id
         and binding.conversation_id = conversation.id
         and binding.session_id = conversation.session_id
         and binding.lead_id = conversation.lead_id
         and binding.active_to is null
         and binding.stale = false
        where message.organization_id = v_job.organization_id
          and message.id = v_job.last_contact_message_id
          and message.lead_id = v_job.lead_id
      ) into v_remaining_contact_is_current;
    end if;

    select nullif(btrim(lead.whatsapp_avatar_storage_path), '') is not null
    into v_lead_already_complete
    from public.leads as lead
    where lead.organization_id = v_job.organization_id
      and lead.id = v_job.lead_id
    for update;

    if v_lead_already_complete then
      v_next_status := 'completed';
    elsif v_binding_is_current then
      update public.leads as lead
      set
        whatsapp_avatar_storage_path = p_storage_path,
        -- The bucket is private. A public-style URL here would be durable but
        -- unusable, while a signed URL would expire. Read models sign the
        -- canonical object path on demand instead.
        whatsapp_avatar_url = null,
        whatsapp_avatar_synced_at = now(),
        updated_at = now()
      where lead.organization_id = v_job.organization_id
        and lead.id = v_job.lead_id
        and nullif(btrim(lead.whatsapp_avatar_storage_path), '') is null;
      v_lead_updated := found;
      v_next_status := case when v_lead_updated then 'completed' else 'stale' end;
    elsif v_job.attempts >= v_job.max_attempts then
      v_next_status := 'not_available';
    elsif v_job.eligible_contact_count < 2 then
      v_next_status := 'awaiting_next_contact';
    elsif v_remaining_contact_is_current then
      -- A newer contact can arrive on a replacement binding while the provider
      -- request for the old binding is in flight. Preserve the consumed attempt
      -- and let the already-recorded contact drive the remaining attempt.
      v_next_status := 'pending';
    else
      v_next_status := 'not_available';
    end if;

    update private.whatsapp_avatar_jobs as job
    set
      status = v_next_status,
      provider_avatar_id = case
        when v_next_status = 'completed'
          then nullif(btrim(coalesce(p_provider_avatar_id, '')), '')
        else job.provider_avatar_id
      end,
      storage_path = case when v_next_status = 'completed' then p_storage_path else job.storage_path end,
      next_attempt_at = case when v_next_status = 'pending' then now() else job.next_attempt_at end,
      last_error = case
        when v_next_status = 'stale' then 'avatar_binding_changed'
        when v_next_status = 'pending' then 'avatar_binding_changed_retrying_new_contact'
        else null
      end,
      completed_at = case when v_next_status = 'completed' then now() else null end,
      locked_at = null,
      lease_expires_at = null,
      locked_by = null,
      lease_token = null,
      updated_at = now()
    where job.id = v_job.id;

    updated := v_lead_updated;
    return next;
    return;
  end if;

  -- Non-completed outcomes never touch conversation/binding rows, so they can
  -- fence the job directly without participating in the binding lock order.
  select job.*
  into v_job
  from private.whatsapp_avatar_jobs as job
  where job.id = p_job_id
    and job.status = 'processing'
    and job.lease_token = p_lease_token
    and job.lease_expires_at >= now()
  for update;

  if not found then
    return;
  end if;

  updated := false;
  organization_id := v_job.organization_id;
  lead_id := v_job.lead_id;
  conversation_id := v_job.conversation_id;

  if v_job.attempts < v_job.max_attempts
     and v_job.eligible_contact_count >= 2
     and v_job.last_contact_message_id is distinct from v_job.last_attempt_message_id then
    select exists (
      select 1
      from public.whatsapp_messages as message
      join public.whatsapp_conversations as conversation
        on conversation.organization_id = message.organization_id
       and conversation.id = message.conversation_id
       and conversation.session_id = message.session_id
       and conversation.lead_id = message.lead_id
       and conversation.deleted_at is null
       and coalesce(conversation.is_group, false) = false
      join public.whatsapp_conversation_lead_bindings as binding
        on binding.organization_id = conversation.organization_id
       and binding.id = v_job.last_contact_binding_id
       and binding.conversation_id = conversation.id
       and binding.session_id = conversation.session_id
       and binding.lead_id = conversation.lead_id
       and binding.active_to is null
       and binding.stale = false
      where message.organization_id = v_job.organization_id
        and message.id = v_job.last_contact_message_id
        and message.lead_id = v_job.lead_id
    ) into v_remaining_contact_is_current;
  end if;

  v_next_status := case
    when v_job.attempts >= v_job.max_attempts then 'not_available'
    when v_job.eligible_contact_count < 2 then 'awaiting_next_contact'
    when v_remaining_contact_is_current then 'pending'
    else 'not_available'
  end;

  update private.whatsapp_avatar_jobs as job
  set
    status = v_next_status,
    next_attempt_at = case when v_next_status = 'pending' then now() else job.next_attempt_at end,
    last_error = left(
      coalesce(nullif(btrim(p_error), ''), 'avatar_' || p_outcome),
      1000
    ),
    locked_at = null,
    lease_expires_at = null,
    locked_by = null,
    lease_token = null,
    updated_at = now()
  where job.id = v_job.id;

  return next;
end;
$$;

revoke all on function private.finish_whatsapp_avatar_job(
  uuid, uuid, text, text, text, text
)
from public, anon, authenticated, service_role;

commit;
