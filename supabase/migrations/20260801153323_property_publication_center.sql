-- Canonical publication state shared by the site and future channel adapters.
-- Legacy flags and portal_listing_publications remain compatibility surfaces;
-- the absence of a canonical row deliberately preserves their fallback flow.

create table public.property_channel_publications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  property_id uuid not null,
  channel text not null,
  channel_account_key text not null default 'default',
  desired_state text not null default 'unpublished',
  observed_state text not null default 'draft',
  readiness_state text not null default 'unknown',
  current_version integer not null default 0,
  published_version integer,
  validation_errors jsonb not null default '[]'::jsonb,
  provider_listing_id text,
  provider_revision text,
  public_url text,
  last_error_code text,
  last_error_message text,
  last_requested_at timestamptz,
  last_attempt_at timestamptz,
  last_succeeded_at timestamptz,
  published_at timestamptz,
  unpublished_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_channel_publications_property_fkey
    foreign key (organization_id, property_id)
    references public.properties(organization_id, id)
    on delete cascade,
  constraint property_channel_publications_scope_unique
    unique (organization_id, property_id, channel, channel_account_key),
  constraint property_channel_publications_identity_unique
    unique (
      organization_id,
      id,
      property_id,
      channel,
      channel_account_key
    ),
  constraint property_channel_publications_channel_check
    check (
      channel = lower(channel)
      and char_length(channel) between 1 and 64
      and channel ~ '^[a-z][a-z0-9_.-]*$'
    ),
  constraint property_channel_publications_account_check
    check (
      channel_account_key = btrim(channel_account_key)
      and char_length(channel_account_key) between 1 and 160
      and channel_account_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
    ),
  constraint property_channel_publications_desired_check
    check (desired_state in ('published', 'paused', 'unpublished')),
  constraint property_channel_publications_observed_check
    check (
      observed_state in (
        'draft',
        'queued',
        'publishing',
        'published',
        'pausing',
        'paused',
        'unpublishing',
        'unpublished',
        'error'
      )
    ),
  constraint property_channel_publications_readiness_check
    check (readiness_state in ('unknown', 'ready', 'blocked')),
  constraint property_channel_publications_versions_check
    check (
      current_version >= 0
      and (
        published_version is null
        or published_version between 1 and current_version
      )
    ),
  constraint property_channel_publications_published_state_check
    check (observed_state <> 'published' or published_version is not null),
  constraint property_channel_publications_validation_errors_check
    check (jsonb_typeof(validation_errors) = 'array'),
  constraint property_channel_publications_provider_id_check
    check (
      provider_listing_id is null
      or char_length(btrim(provider_listing_id)) between 1 and 512
    ),
  constraint property_channel_publications_provider_revision_check
    check (
      provider_revision is null
      or char_length(btrim(provider_revision)) between 1 and 512
    ),
  constraint property_channel_publications_public_url_check
    check (
      public_url is null
      or (
        char_length(public_url) between 8 and 2048
        and public_url ~* '^https?://'
      )
    ),
  constraint property_channel_publications_error_code_check
    check (
      last_error_code is null
      or char_length(last_error_code) between 1 and 160
    ),
  constraint property_channel_publications_error_message_check
    check (
      last_error_message is null
      or char_length(last_error_message) between 1 and 4000
    )
);

comment on table public.property_channel_publications is
  'Authoritative desired and observed publication state per property/channel account.';

create table public.property_channel_publication_versions (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  property_id uuid not null,
  channel text not null,
  channel_account_key text not null default 'default',
  version integer not null,
  source_property_updated_at timestamptz not null,
  payload_schema_version integer not null default 1,
  payload jsonb not null,
  payload_hash text not null,
  readiness_errors jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint property_channel_versions_publication_fkey
    foreign key (
      organization_id,
      publication_id,
      property_id,
      channel,
      channel_account_key
    )
    references public.property_channel_publications (
      organization_id,
      id,
      property_id,
      channel,
      channel_account_key
    )
    on delete cascade,
  constraint property_channel_versions_number_unique
    unique (organization_id, publication_id, version),
  constraint property_channel_versions_identity_unique
    unique (
      organization_id,
      id,
      publication_id,
      property_id,
      channel,
      channel_account_key
    ),
  constraint property_channel_versions_channel_check
    check (
      channel = lower(channel)
      and char_length(channel) between 1 and 64
      and channel ~ '^[a-z][a-z0-9_.-]*$'
    ),
  constraint property_channel_versions_account_check
    check (
      channel_account_key = btrim(channel_account_key)
      and char_length(channel_account_key) between 1 and 160
      and channel_account_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
    ),
  constraint property_channel_versions_number_check
    check (version >= 1),
  constraint property_channel_versions_schema_check
    check (payload_schema_version >= 1),
  constraint property_channel_versions_payload_check
    check (jsonb_typeof(payload) = 'object'),
  constraint property_channel_versions_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint property_channel_versions_errors_check
    check (jsonb_typeof(readiness_errors) = 'array')
);

comment on table public.property_channel_publication_versions is
  'Immutable payload and readiness evidence for one publication version.';

alter table public.property_channel_publications
  add constraint property_channel_publications_published_version_fkey
  foreign key (organization_id, id, published_version)
  references public.property_channel_publication_versions (
    organization_id,
    publication_id,
    version
  )
  deferrable initially immediate;

create table public.property_channel_publication_jobs (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null,
  version_id uuid,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  property_id uuid not null,
  channel text not null,
  channel_account_key text not null default 'default',
  action text not null,
  status text not null default 'pending',
  idempotency_key text not null,
  request_hash text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 12,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  lease_token uuid,
  last_error_code text,
  last_error_message text,
  requested_by uuid references public.users(id) on delete set null,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_channel_jobs_publication_fkey
    foreign key (
      organization_id,
      publication_id,
      property_id,
      channel,
      channel_account_key
    )
    references public.property_channel_publications (
      organization_id,
      id,
      property_id,
      channel,
      channel_account_key
    )
    on delete cascade,
  constraint property_channel_jobs_version_fkey
    foreign key (
      organization_id,
      version_id,
      publication_id,
      property_id,
      channel,
      channel_account_key
    )
    references public.property_channel_publication_versions (
      organization_id,
      id,
      publication_id,
      property_id,
      channel,
      channel_account_key
    )
    deferrable initially deferred,
  constraint property_channel_jobs_idempotency_unique
    unique (organization_id, idempotency_key),
  constraint property_channel_jobs_channel_check
    check (
      channel = lower(channel)
      and char_length(channel) between 1 and 64
      and channel ~ '^[a-z][a-z0-9_.-]*$'
    ),
  constraint property_channel_jobs_account_check
    check (
      channel_account_key = btrim(channel_account_key)
      and char_length(channel_account_key) between 1 and 160
      and channel_account_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
    ),
  constraint property_channel_jobs_action_check
    check (action in ('publish', 'update', 'unpublish', 'revalidate')),
  constraint property_channel_jobs_status_check
    check (
      status in (
        'pending',
        'processing',
        'retry',
        'succeeded',
        'superseded',
        'dead'
      )
    ),
  constraint property_channel_jobs_version_required_check
    check (
      action not in ('publish', 'update', 'revalidate')
      or version_id is not null
    ),
  constraint property_channel_jobs_idempotency_check
    check (
      idempotency_key = btrim(idempotency_key)
      and char_length(idempotency_key) between 1 and 200
    ),
  constraint property_channel_jobs_request_hash_check
    check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint property_channel_jobs_attempts_check
    check (
      attempts >= 0
      and max_attempts between 1 and 50
      and attempts <= max_attempts
    ),
  constraint property_channel_jobs_lock_check
    check (
      (
        status = 'processing'
        and locked_at is not null
        and nullif(btrim(locked_by), '') is not null
        and lease_token is not null
      )
      or (
        status <> 'processing'
        and locked_at is null
        and locked_by is null
        and lease_token is null
      )
    ),
  constraint property_channel_jobs_terminal_check
    check (
      (
        status in ('succeeded', 'superseded', 'dead')
        and completed_at is not null
      )
      or (
        status not in ('succeeded', 'superseded', 'dead')
        and completed_at is null
      )
    ),
  constraint property_channel_jobs_dead_letter_check
    check (
      (status = 'dead' and dead_lettered_at is not null)
      or (status <> 'dead' and dead_lettered_at is null)
    ),
  constraint property_channel_jobs_error_code_check
    check (
      last_error_code is null
      or char_length(last_error_code) between 1 and 160
    ),
  constraint property_channel_jobs_error_message_check
    check (
      last_error_message is null
      or char_length(last_error_message) between 1 and 4000
    )
);

comment on table public.property_channel_publication_jobs is
  'Backend-only durable publication work with retry, lease and fencing state.';

create unique index property_channel_publications_provider_uidx
  on public.property_channel_publications (
    organization_id,
    channel,
    channel_account_key,
    provider_listing_id
  )
  where provider_listing_id is not null;

create index property_channel_publications_property_idx
  on public.property_channel_publications (
    organization_id,
    property_id,
    updated_at desc
  );

create index property_channel_publications_state_idx
  on public.property_channel_publications (
    organization_id,
    channel,
    desired_state,
    observed_state,
    updated_at desc
  );

create index property_channel_publications_blocked_idx
  on public.property_channel_publications (
    organization_id,
    channel,
    updated_at desc
  )
  where readiness_state = 'blocked';

create index property_channel_publications_created_by_idx
  on public.property_channel_publications (created_by)
  where created_by is not null;

create index property_channel_publications_updated_by_idx
  on public.property_channel_publications (updated_by)
  where updated_by is not null;

create index property_channel_versions_property_idx
  on public.property_channel_publication_versions (
    organization_id,
    property_id,
    channel,
    created_at desc
  );

create index property_channel_versions_created_by_idx
  on public.property_channel_publication_versions (created_by)
  where created_by is not null;

create index property_channel_jobs_due_idx
  on public.property_channel_publication_jobs (
    next_attempt_at,
    created_at,
    id
  )
  where status in ('pending', 'retry');

create index property_channel_jobs_processing_idx
  on public.property_channel_publication_jobs (locked_at, id)
  where status = 'processing';

create index property_channel_jobs_history_idx
  on public.property_channel_publication_jobs (
    organization_id,
    publication_id,
    created_at desc,
    id desc
  );

create index property_channel_jobs_property_state_idx
  on public.property_channel_publication_jobs (
    organization_id,
    property_id,
    channel,
    status,
    created_at desc
  );

create index property_channel_jobs_version_idx
  on public.property_channel_publication_jobs (version_id)
  where version_id is not null;

create index property_channel_jobs_requested_by_idx
  on public.property_channel_publication_jobs (requested_by)
  where requested_by is not null;

create index property_channel_jobs_dead_idx
  on public.property_channel_publication_jobs (dead_lettered_at, id)
  where status = 'dead';

create or replace function private.enforce_property_publication_actor_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_column text;
  actor_text text;
  actor_id uuid;
begin
  foreach actor_column in array array[
    'created_by',
    'updated_by',
    'requested_by'
  ]::text[]
  loop
    actor_text := nullif(btrim(to_jsonb(new) ->> actor_column), '');
    if actor_text is null then
      continue;
    end if;

    actor_id := private.safe_uuid(actor_text);
    if actor_id is null
       or not private.property_user_belongs_to_organization(
         new.organization_id,
         actor_id
       ) then
      raise exception using
        errcode = '23514',
        message = format(
          'property_publication_user_cross_tenant_reference:%s',
          actor_column
        );
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function private.enforce_property_publication_actor_scope()
  from public, anon, authenticated, service_role;

create or replace function private.prevent_property_publication_version_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.created_by is not null
     and new.created_by is null
     and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
    return new;
  end if;

  raise exception using
    errcode = '23514',
    message = 'property_publication_version_immutable';
end;
$$;

revoke all on function private.prevent_property_publication_version_update()
  from public, anon, authenticated, service_role;

create or replace function private.enforce_property_publication_current_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.current_version > 0
     and not exists (
       select 1
       from public.property_channel_publication_versions as version
       where version.organization_id = new.organization_id
         and version.publication_id = new.id
         and version.version = new.current_version
     ) then
    raise exception using
      errcode = '23503',
      message = 'property_publication_current_version_missing';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_property_publication_current_version()
  from public, anon, authenticated, service_role;

create trigger property_channel_publications_set_updated_at
before update on public.property_channel_publications
for each row execute function public.update_updated_at_column();

create trigger property_channel_publications_actor_scope
before insert or update of organization_id, created_by, updated_by
on public.property_channel_publications
for each row execute function private.enforce_property_publication_actor_scope();

create constraint trigger property_channel_publications_current_version_exists
after insert or update on public.property_channel_publications
deferrable initially immediate
for each row execute function private.enforce_property_publication_current_version();

create trigger property_channel_versions_actor_scope
before insert or update of organization_id, created_by
on public.property_channel_publication_versions
for each row execute function private.enforce_property_publication_actor_scope();

create trigger property_channel_versions_immutable
before update on public.property_channel_publication_versions
for each row execute function private.prevent_property_publication_version_update();

create trigger property_channel_jobs_set_updated_at
before update on public.property_channel_publication_jobs
for each row execute function public.update_updated_at_column();

create trigger property_channel_jobs_actor_scope
before insert or update of organization_id, requested_by
on public.property_channel_publication_jobs
for each row execute function private.enforce_property_publication_actor_scope();

create or replace function private.claim_property_channel_publication_jobs(
  p_worker_id text,
  p_limit integer default 50,
  p_lease interval default interval '5 minutes'
)
returns setof public.property_channel_publication_jobs
language plpgsql
set search_path = ''
as $$
declare
  claim_time timestamptz := clock_timestamp();
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception using
      errcode = '22023',
      message = 'property_publication_worker_id_required';
  end if;
  if coalesce(p_limit, 0) < 1 then
    raise exception using
      errcode = '22023',
      message = 'property_publication_claim_limit_invalid';
  end if;
  if p_lease is null or p_lease <= interval '0 seconds' then
    raise exception using
      errcode = '22023',
      message = 'property_publication_lease_invalid';
  end if;

  update public.property_channel_publication_jobs as exhausted
  set status = 'dead',
      locked_at = null,
      locked_by = null,
      lease_token = null,
      completed_at = claim_time,
      dead_lettered_at = claim_time,
      last_error_code = coalesce(
        exhausted.last_error_code,
        'retry_exhausted'
      ),
      last_error_message = coalesce(
        exhausted.last_error_message,
        'Publication retry limit exhausted.'
      ),
      updated_at = claim_time
  where exhausted.attempts >= exhausted.max_attempts
    and (
      (
        exhausted.status in ('pending', 'retry')
        and exhausted.next_attempt_at <= claim_time
      )
      or (
        exhausted.status = 'processing'
        and exhausted.locked_at < claim_time - p_lease
      )
    );

  return query
  with candidates as (
    select queued.id
    from public.property_channel_publication_jobs as queued
    where queued.attempts < queued.max_attempts
      and (
        (
          queued.status in ('pending', 'retry')
          and queued.next_attempt_at <= claim_time
        )
        or (
          queued.status = 'processing'
          and queued.locked_at < claim_time - p_lease
        )
      )
    order by
      case
        when queued.status = 'processing' then queued.locked_at
        else queued.next_attempt_at
      end,
      queued.created_at,
      queued.id
    for update skip locked
    limit greatest(1, least(p_limit, 500))
  )
  update public.property_channel_publication_jobs as claimed
  set status = 'processing',
      attempts = claimed.attempts + 1,
      locked_at = claim_time,
      locked_by = btrim(p_worker_id),
      lease_token = gen_random_uuid(),
      last_error_code = null,
      last_error_message = null,
      completed_at = null,
      dead_lettered_at = null,
      updated_at = claim_time
  from candidates
  where claimed.id = candidates.id
  returning claimed.*;
end;
$$;

create or replace function private.complete_property_channel_publication_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_completed_at timestamptz default null
)
returns boolean
language sql
set search_path = ''
as $$
  with completed as (
    update public.property_channel_publication_jobs
    set status = 'succeeded',
        locked_at = null,
        locked_by = null,
        lease_token = null,
        last_error_code = null,
        last_error_message = null,
        completed_at = coalesce(p_completed_at, clock_timestamp()),
        dead_lettered_at = null,
        updated_at = clock_timestamp()
    where id = p_job_id
      and status = 'processing'
      and locked_by = btrim(p_worker_id)
      and lease_token = p_lease_token
    returning id
  )
  select exists(select 1 from completed);
$$;

create or replace function private.fail_property_channel_publication_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_error_code text,
  p_error_message text,
  p_retry_at timestamptz default null,
  p_permanent boolean default false
)
returns boolean
language sql
set search_path = ''
as $$
  with failed as (
    update public.property_channel_publication_jobs
    set status = case
          when p_permanent or attempts >= max_attempts then 'dead'
          else 'retry'
        end,
        next_attempt_at = case
          when p_permanent or attempts >= max_attempts then next_attempt_at
          else coalesce(
            p_retry_at,
            clock_timestamp() + make_interval(
              secs => least(
                3600,
                5 * power(2, least(attempts, 9))::integer
              )
            )
          )
        end,
        locked_at = null,
        locked_by = null,
        lease_token = null,
        last_error_code = left(
          coalesce(nullif(btrim(p_error_code), ''), 'unknown_error'),
          160
        ),
        last_error_message = left(
          coalesce(nullif(p_error_message, ''), 'Unknown publication error.'),
          4000
        ),
        completed_at = case
          when p_permanent or attempts >= max_attempts
            then clock_timestamp()
          else null
        end,
        dead_lettered_at = case
          when p_permanent or attempts >= max_attempts
            then clock_timestamp()
          else null
        end,
        updated_at = clock_timestamp()
    where id = p_job_id
      and status = 'processing'
      and locked_by = btrim(p_worker_id)
      and lease_token = p_lease_token
    returning id
  )
  select exists(select 1 from failed);
$$;

revoke all on function private.claim_property_channel_publication_jobs(
  text,
  integer,
  interval
) from public, anon, authenticated, service_role;
revoke all on function private.complete_property_channel_publication_job(
  uuid,
  text,
  uuid,
  timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.fail_property_channel_publication_job(
  uuid,
  text,
  uuid,
  text,
  text,
  timestamptz,
  boolean
) from public, anon, authenticated, service_role;

grant execute on function private.claim_property_channel_publication_jobs(
  text,
  integer,
  interval
) to service_role;
grant execute on function private.complete_property_channel_publication_job(
  uuid,
  text,
  uuid,
  timestamptz
) to service_role;
grant execute on function private.fail_property_channel_publication_job(
  uuid,
  text,
  uuid,
  text,
  text,
  timestamptz,
  boolean
) to service_role;

alter table public.property_channel_publications
  enable row level security;
alter table public.property_channel_publications
  force row level security;
alter table public.property_channel_publication_versions
  enable row level security;
alter table public.property_channel_publication_versions
  force row level security;
alter table public.property_channel_publication_jobs
  enable row level security;
alter table public.property_channel_publication_jobs
  force row level security;

revoke all on table public.property_channel_publications
  from public, anon, authenticated, service_role;
revoke all on table public.property_channel_publication_versions
  from public, anon, authenticated, service_role;
revoke all on table public.property_channel_publication_jobs
  from public, anon, authenticated, service_role;

grant select, insert, update
  on table public.property_channel_publications
  to service_role;
grant select, insert
  on table public.property_channel_publication_versions
  to service_role;
grant select, insert, update
  on table public.property_channel_publication_jobs
  to service_role;
