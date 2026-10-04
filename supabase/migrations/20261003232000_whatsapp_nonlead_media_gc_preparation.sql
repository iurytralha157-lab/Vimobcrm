-- Preparation for a separate Storage delete worker. Applying this migration
-- does not activate seven-day retention, claim an item, or call Storage.
-- It replaces the first migration's activation stub with an operator-only
-- function after the purge/GC primitives exist. The worker must call
-- mark_started before its HTTP DELETE.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table private.whatsapp_nonlead_media_delete_outbox
  add column delete_started_at timestamptz;

-- Repair replaces a message's old Storage path with a new asset. Keep every
-- displaced source until this conversation is purged, including repeated
-- repairs and bounded sibling fan-out; message_key remains retry state only.
-- A deduplicated sibling may be in another session of the same organization;
-- session_id records that conversation's session, not the legacy path owner.
create table private.whatsapp_media_repair_source_paths (
  conversation_id uuid not null
    references public.whatsapp_conversations(id) on delete cascade,
  organization_id uuid not null,
  session_id uuid not null,
  storage_path text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (conversation_id, storage_path),
  constraint whatsapp_media_repair_source_path_scope_check check (
    octet_length(storage_path) between 43 and 1024
    and storage_path = btrim(storage_path)
    and position('%' in storage_path) = 0
    and position(E'\\' in storage_path) = 0
    and storage_path !~ '(^|/)\.{1,2}(/|$)'
    and (
      (
        left(storage_path, length('orgs/' || organization_id::text || '/assets/v2/'))
          = 'orgs/' || organization_id::text || '/assets/v2/'
        and length(storage_path) > length('orgs/' || organization_id::text || '/assets/v2/')
      )
      or storage_path ~ (
        '^orgs/' || organization_id::text ||
        '/sessions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/incoming/[^/]+$'
      )
    )
  )
);
create index whatsapp_media_repair_source_org_path_idx
  on private.whatsapp_media_repair_source_paths (organization_id, storage_path);
alter table private.whatsapp_media_repair_source_paths enable row level security;
revoke all on private.whatsapp_media_repair_source_paths
  from public, anon, authenticated, service_role;

-- A failed physical purge must be retried durably. The due query excludes a
-- temporarily deferred candidate, so one bad conversation cannot starve all
-- later deadlines. No candidate is created or activated by this ALTER.
alter table private.whatsapp_nonlead_retention_candidates
  add column purge_next_attempt_at timestamptz not null default clock_timestamp(),
  add column purge_attempts integer not null default 0 check (purge_attempts >= 0),
  add column purge_last_sqlstate text;
create index whatsapp_nonlead_retention_retry_due_idx
  on private.whatsapp_nonlead_retention_candidates
    (purge_next_attempt_at, expires_at, conversation_id)
  where state = 'pending';
create index whatsapp_nonlead_media_delete_dead_idx
  on private.whatsapp_nonlead_media_delete_outbox (created_at, id)
  where status = 'dead';
create index whatsapp_media_path_unknown_delete_idx
  on private.whatsapp_media_path_operations (started_at)
  where operation = 'delete' and outcome_unknown = true;
create index whatsapp_media_path_active_delete_org_idx
  on private.whatsapp_media_path_operations (organization_id)
  where operation = 'delete';

create function private.defer_whatsapp_nonlead_purge(
  p_conversation_id uuid, p_sqlstate text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_conversation_id is null or p_sqlstate is null
     or p_sqlstate !~ '^[0-9A-Z]{5}$' then
    raise exception using errcode = '22023', message = 'whatsapp_nonlead_purge_retry_invalid';
  end if;
  update private.whatsapp_nonlead_retention_candidates as candidate
  set purge_attempts = least(candidate.purge_attempts + 1, 30),
      purge_next_attempt_at = clock_timestamp()
        + (interval '1 minute' * least(
          60, power(2, least(candidate.purge_attempts, 6))::integer
        )),
      purge_last_sqlstate = p_sqlstate
  where candidate.conversation_id = p_conversation_id
    and candidate.state = 'pending'
    and candidate.expires_at <= clock_timestamp();
  return found;
end;
$$;
alter function private.defer_whatsapp_nonlead_purge(uuid, text) owner to postgres;
revoke all on function private.defer_whatsapp_nonlead_purge(uuid, text)
  from public, anon, authenticated, service_role;

-- A path may be attached without a fresh upload (content-addressed media
-- deduplication). These write guards use the same transaction-scoped path
-- lock as claim, then reject an attachment during a Storage DELETE.
create function private.guard_whatsapp_media_path_reference(
  p_bucket_id text, p_storage_path text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_storage_path), '') is null then
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_bucket_id), pg_catalog.hashtext(p_storage_path)
  );
  if exists (
    select 1
    from private.whatsapp_media_path_operations as operation
    where operation.bucket_id = p_bucket_id
      and operation.storage_path = p_storage_path
      and operation.operation = 'delete'
  ) then
    raise exception using errcode = '55000',
      message = 'whatsapp_media_path_delete_in_progress';
  end if;
end;
$$;
alter function private.guard_whatsapp_media_path_reference(text, text) owner to postgres;
revoke all on function private.guard_whatsapp_media_path_reference(text, text)
  from public, anon, authenticated, service_role;

create function private.guard_whatsapp_message_media_reference()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(new.media_storage_path), '') is not null then
    perform private.guard_whatsapp_media_path_reference(
      'whatsapp-media', new.media_storage_path
    );
  end if;
  return new;
end;
$$;
alter function private.guard_whatsapp_message_media_reference() owner to postgres;
revoke all on function private.guard_whatsapp_message_media_reference()
  from public, anon, authenticated, service_role;
create trigger aa_guard_whatsapp_message_media_reference
before insert or update of media_storage_path, conversation_id, organization_id
on public.whatsapp_messages
for each row execute function private.guard_whatsapp_message_media_reference();

create function private.guard_whatsapp_media_job_path_references()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  for v_path in
    select distinct paths.path
    from pg_catalog.unnest(array[
      nullif(btrim(new.storage_path), ''),
      nullif(btrim(new.message_key->>'upload_intent_path'), ''),
      nullif(btrim(new.message_key->>'repair_storage_path'), '')
    ]) as paths(path)
    where paths.path is not null
    order by paths.path
  loop
    perform private.guard_whatsapp_media_path_reference('whatsapp-media', v_path);
  end loop;
  return new;
end;
$$;
alter function private.guard_whatsapp_media_job_path_references() owner to postgres;
revoke all on function private.guard_whatsapp_media_job_path_references()
  from public, anon, authenticated, service_role;
create trigger aa_guard_whatsapp_media_job_path_references
before insert or update of storage_path, message_key, conversation_id, organization_id
on public.media_jobs
for each row execute function private.guard_whatsapp_media_job_path_references();

create function private.guard_whatsapp_media_repair_source_path_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.guard_whatsapp_media_path_reference('whatsapp-media', new.storage_path);
  return new;
end;
$$;
alter function private.guard_whatsapp_media_repair_source_path_reference() owner to postgres;
revoke all on function private.guard_whatsapp_media_repair_source_path_reference()
  from public, anon, authenticated, service_role;
create trigger aa_guard_whatsapp_media_repair_source_path_reference
before insert or update on private.whatsapp_media_repair_source_paths
for each row execute function private.guard_whatsapp_media_repair_source_path_reference();

create function private.guard_whatsapp_outbox_media_reference()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  v_path := nullif(btrim(coalesce(
    new.payload #>> '{body,mediaStoragePath}',
    new.payload->>'mediaStoragePath'
  )), '');
  if v_path is not null then
    perform private.guard_whatsapp_media_path_reference('whatsapp-media', v_path);
  end if;
  return new;
end;
$$;
alter function private.guard_whatsapp_outbox_media_reference() owner to postgres;
revoke all on function private.guard_whatsapp_outbox_media_reference()
  from public, anon, authenticated, service_role;
create trigger aa_guard_whatsapp_outbox_media_reference
before insert or update of payload, conversation_id, organization_id
on public.whatsapp_outbox
for each row execute function private.guard_whatsapp_outbox_media_reference();

-- Release is for upload operations only. A generic uploader must never be
-- able to release a delete fence using a token copied from worker state.
create or replace function public.whatsapp_media_path_release(
  p_owner_token uuid, p_outcome text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_owner_token is null or p_outcome is null
     or p_outcome not in ('committed', 'not_started', 'unknown') then
    raise exception using errcode = '22023', message = 'whatsapp_media_path_release_invalid';
  end if;
  if p_owner_token = '00000000-0000-0000-0000-000000000001'::uuid then
    return true;
  end if;
  if p_outcome = 'unknown' then
    update private.whatsapp_media_path_operations as operation
    set outcome_unknown = true
    where operation.owner_token = p_owner_token
      and operation.operation = 'upload';
  else
    delete from private.whatsapp_media_path_operations as operation
    where operation.owner_token = p_owner_token
      and operation.operation = 'upload';
  end if;
  -- Repeated acknowledgements after a lost RPC response are idempotent.
  return true;
end;
$$;
alter function public.whatsapp_media_path_release(uuid, text) owner to postgres;
revoke all on function public.whatsapp_media_path_release(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.whatsapp_media_path_release(uuid, text)
  to service_role;

-- Legacy rows can contain a Storage URL instead of media_storage_path. A
-- parseable URL for a different object must not hold every delete in its
-- organization. Any ambiguous encoding or URL shape still holds the delete.
create function private.whatsapp_media_url_could_reference_path(
  p_url text, p_storage_path text
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_match text[];
  v_path text;
begin
  if pg_catalog.strpos(pg_catalog.lower(p_url), 'whatsapp-media') = 0
     and pg_catalog.strpos(pg_catalog.lower(p_url), 'whatsapp%2dmedia') = 0 then
    return false;
  end if;
  v_match := pg_catalog.regexp_match(
    p_url,
    '/storage/v1/object/(public|sign)/whatsapp-media/([^?#]+)',
    'i'
  );
  if v_match is null then
    return true;
  end if;
  v_path := pg_catalog.replace(
    pg_catalog.replace(v_match[2], '%2F', '/'), '%2f', '/'
  );
  if pg_catalog.strpos(v_path, '%') > 0 then
    return true;
  end if;
  return v_path = p_storage_path;
end;
$$;
alter function private.whatsapp_media_url_could_reference_path(text, text) owner to postgres;
revoke all on function private.whatsapp_media_url_could_reference_path(text, text)
  from public, anon, authenticated, service_role;

-- Serialize legacy URL writes with the claim's reference check. The path
-- reservation remains after claim commits and while the Storage call runs.
create function private.guard_whatsapp_legacy_media_url()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  if tg_table_name = 'whatsapp_messages' then
    v_url := new.media_url;
  elsif tg_table_name = 'whatsapp_conversations' then
    v_url := new.contact_picture;
  elsif tg_table_name = 'outbox_messages' then
    v_url := new.media_url;
  else
    raise exception using errcode = '55000', message = 'whatsapp_media_url_guard_table_invalid';
  end if;
  if nullif(pg_catalog.btrim(v_url), '') is null
     or (pg_catalog.strpos(pg_catalog.lower(v_url), 'whatsapp-media') = 0
         and pg_catalog.strpos(pg_catalog.lower(v_url), 'whatsapp%2dmedia') = 0) then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('whatsapp_legacy_media_url'),
    pg_catalog.hashtext(new.organization_id::text)
  );
  if exists (
    select 1
    from private.whatsapp_media_path_operations as operation
    where operation.organization_id = new.organization_id
      and operation.operation = 'delete'
      and private.whatsapp_media_url_could_reference_path(
        v_url, operation.storage_path
      )
  ) then
    raise exception using errcode = '55000',
      message = 'whatsapp_media_path_delete_in_progress';
  end if;
  return new;
end;
$$;
alter function private.guard_whatsapp_legacy_media_url() owner to postgres;
revoke all on function private.guard_whatsapp_legacy_media_url()
  from public, anon, authenticated, service_role;
create trigger ab_guard_whatsapp_message_legacy_media_url
before insert or update of media_url, organization_id
on public.whatsapp_messages
for each row execute function private.guard_whatsapp_legacy_media_url();
create trigger ab_guard_whatsapp_conversation_legacy_media_url
before insert or update of contact_picture, organization_id
on public.whatsapp_conversations
for each row execute function private.guard_whatsapp_legacy_media_url();
create trigger ab_guard_whatsapp_outbox_legacy_media_url
before insert or update of media_url, organization_id
on public.outbox_messages
for each row execute function private.guard_whatsapp_legacy_media_url();

-- The outbox stores an object path only until Storage removal is confirmed,
-- or until a surviving conversation proves that the object is shared.
-- Only two inbound namespaces have end-to-end upload fences at present.
create function private.claim_whatsapp_nonlead_media_delete(p_worker_id text)
returns table (
  id uuid,
  organization_id uuid,
  bucket_id text,
  storage_path text,
  lease_token uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item private.whatsapp_nonlead_media_delete_outbox%rowtype;
  v_operation private.whatsapp_media_path_operations%rowtype;
  v_token uuid := gen_random_uuid();
  v_asset_prefix text;
  v_has_reference boolean;
  v_has_repair_source boolean;
  v_unproven_local_url boolean;
  v_scan integer;
begin
  if nullif(btrim(p_worker_id), '') is null or octet_length(p_worker_id) > 128 then
    raise exception using errcode = '22023', message = 'whatsapp_nonlead_media_worker_invalid';
  end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_media_isolation_unsupported';
  end if;

  -- A held or malformed item must not stop the whole batch. Keep this bounded
  -- so legacy-reference scans cannot monopolize one database transaction.
  for v_scan in 1..10 loop
    select item.* into v_item
    from private.whatsapp_nonlead_media_delete_outbox as item
    where (
        item.status in ('pending', 'retry', 'held_shared')
        or (item.status = 'processing'
            and item.delete_started_at is null
            and item.locked_at < clock_timestamp() - interval '5 minutes')
      )
      and item.delete_started_at is null
      and item.next_attempt_at <= clock_timestamp()
    order by item.next_attempt_at, item.created_at, item.id
    limit 1
    for update skip locked;
    if not found then
      return;
    end if;

  v_asset_prefix := 'orgs/' || v_item.organization_id::text || '/assets/v2/';
  if v_item.bucket_id <> 'whatsapp-media'
     or octet_length(v_item.storage_path) not between 43 and 1024
     or position('..' in v_item.storage_path) > 0
     or position('%' in v_item.storage_path) > 0
     or position(E'\\' in v_item.storage_path) > 0
     or not (
       left(v_item.storage_path, length(v_asset_prefix)) = v_asset_prefix
        or v_item.storage_path ~ (
          '^orgs/' || v_item.organization_id::text ||
          '/sessions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/incoming/[^/]+$'
        )
     ) then
    update private.whatsapp_nonlead_media_delete_outbox as item
    set status = 'dead', last_error = 'media_path_scope_unproven',
        locked_at = null, locked_by = null, lease_token = null,
        updated_at = clock_timestamp()
    where item.id = v_item.id;
    continue;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_item.bucket_id), pg_catalog.hashtext(v_item.storage_path)
  );
  select operation.* into v_operation
  from private.whatsapp_media_path_operations as operation
  where operation.bucket_id = v_item.bucket_id
    and operation.storage_path = v_item.storage_path
  for update;
  if found then
    if v_operation.operation = 'delete'
       and v_operation.owner_token = v_item.lease_token
       and v_item.status = 'processing'
       and v_item.delete_started_at is null
       and v_item.locked_at < clock_timestamp() - interval '5 minutes' then
      -- An old worker never obtained mark_started, so it is fenced by its
      -- old token. Do not steal a lease after HTTP has possibly begun.
      delete from private.whatsapp_media_path_operations as operation
      where operation.bucket_id = v_item.bucket_id
        and operation.storage_path = v_item.storage_path
        and operation.owner_token = v_item.lease_token;
    else
      update private.whatsapp_nonlead_media_delete_outbox as item
      set status = 'retry', next_attempt_at = clock_timestamp() + interval '1 minute',
          locked_at = null, locked_by = null, lease_token = null,
          last_error = 'media_path_operation_in_flight',
          updated_at = clock_timestamp()
      where item.id = v_item.id;
      continue;
    end if;
  end if;

  -- Serialize this check with legacy URL writes. A different parseable path
  -- no longer holds this object; ambiguous URLs still fail closed.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('whatsapp_legacy_media_url'),
    pg_catalog.hashtext(v_item.organization_id::text)
  );
  v_unproven_local_url := exists (
    select 1 from public.whatsapp_messages as message
    where message.organization_id = v_item.organization_id
      and message.media_url is not null
      and private.whatsapp_media_url_could_reference_path(
        message.media_url, v_item.storage_path
      )
  ) or exists (
    select 1 from public.whatsapp_conversations as conversation
    where conversation.organization_id = v_item.organization_id
      and conversation.contact_picture is not null
      and private.whatsapp_media_url_could_reference_path(
        conversation.contact_picture, v_item.storage_path
      )
  ) or exists (
    select 1 from public.outbox_messages as outbox
    where outbox.organization_id = v_item.organization_id
      and outbox.media_url is not null
      and private.whatsapp_media_url_could_reference_path(
        outbox.media_url, v_item.storage_path
      )
  );
  if v_unproven_local_url then
    update private.whatsapp_nonlead_media_delete_outbox as item
    set status = 'held_shared',
        next_attempt_at = clock_timestamp() + interval '1 hour',
        locked_at = null, locked_by = null, lease_token = null,
        last_error = 'legacy_storage_url_reference_unproven',
        updated_at = clock_timestamp()
    where item.id = v_item.id;
    continue;
  end if;

  -- Every known durable reference outside the purged conversation is still
  -- live here. Triggers prevent a new canonical reference between this SELECT
  -- and the external DELETE reservation below.
  v_has_repair_source := exists (
    select 1 from private.whatsapp_media_repair_source_paths as source
    where source.organization_id = v_item.organization_id
      and source.storage_path = v_item.storage_path
  );
  v_has_reference := exists (
    select 1 from public.whatsapp_messages as message
    where message.organization_id = v_item.organization_id
      and message.media_storage_path = v_item.storage_path
  ) or exists (
    select 1 from public.media_jobs as job
    where job.organization_id = v_item.organization_id
      and (job.storage_path = v_item.storage_path
           or job.message_key->>'upload_intent_path' = v_item.storage_path
           or job.message_key->>'repair_storage_path' = v_item.storage_path)
  ) or v_has_repair_source or exists (
    select 1 from public.whatsapp_outbox as outbox
    where outbox.organization_id = v_item.organization_id
      and (outbox.payload #>> '{body,mediaStoragePath}' = v_item.storage_path
           or outbox.payload->>'mediaStoragePath' = v_item.storage_path)
  );
  if v_has_reference then
    if v_has_repair_source then
      -- A repair source ledger in another conversation is not a current
      -- message reference. Keep this ticket until that ledger has itself
      -- become a durable delete ticket (or its conversation is purged).
      update private.whatsapp_nonlead_media_delete_outbox as item
      set status = 'held_shared',
          next_attempt_at = clock_timestamp() + interval '1 hour',
          locked_at = null, locked_by = null, lease_token = null,
          last_error = 'media_repair_source_still_held',
          updated_at = clock_timestamp()
      where item.id = v_item.id;
    elsif left(v_item.storage_path, length(v_asset_prefix)) = v_asset_prefix then
      -- The object is a content-addressed shared asset. Its surviving owner
      -- now keeps it; remove this nonlead deletion ticket and its path data.
      delete from private.whatsapp_nonlead_media_delete_outbox as item
      where item.id = v_item.id;
    else
      -- A per-message incoming object must not be shared. Keep the ticket for
      -- manual investigation instead of deleting another conversation's copy.
      update private.whatsapp_nonlead_media_delete_outbox as item
      set status = 'held_shared',
          next_attempt_at = clock_timestamp() + interval '1 hour',
          locked_at = null, locked_by = null, lease_token = null,
          last_error = 'incoming_media_path_shared_unproven',
          updated_at = clock_timestamp()
      where item.id = v_item.id;
    end if;
    continue;
  end if;

  insert into private.whatsapp_media_path_operations (
    bucket_id, storage_path, organization_id, conversation_id,
    operation, owner_token
  ) values (
    v_item.bucket_id, v_item.storage_path, v_item.organization_id,
    v_item.conversation_id, 'delete', v_token
  );
  update private.whatsapp_nonlead_media_delete_outbox as item
  set status = 'processing', attempts = item.attempts + 1,
      locked_at = clock_timestamp(), locked_by = p_worker_id,
      lease_token = v_token, delete_started_at = null,
      last_error = null, updated_at = clock_timestamp()
  where item.id = v_item.id;

  id := v_item.id;
  organization_id := v_item.organization_id;
  bucket_id := v_item.bucket_id;
  storage_path := v_item.storage_path;
  lease_token := v_token;
  return next;
  return;
  end loop;
end;
$$;
alter function private.claim_whatsapp_nonlead_media_delete(text) owner to postgres;
revoke all on function private.claim_whatsapp_nonlead_media_delete(text)
  from public, anon, authenticated, service_role;

create function private.mark_whatsapp_nonlead_media_delete_started(
  p_id uuid, p_lease_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_id is null or p_lease_token is null then
    raise exception using errcode = '22023', message = 'whatsapp_nonlead_media_lease_required';
  end if;
  update private.whatsapp_nonlead_media_delete_outbox as item
  set delete_started_at = clock_timestamp(), updated_at = clock_timestamp()
  where item.id = p_id
    and item.status = 'processing'
    and item.lease_token = p_lease_token
    and item.delete_started_at is null
    and exists (
      select 1 from private.whatsapp_media_path_operations as operation
      where operation.bucket_id = item.bucket_id
        and operation.storage_path = item.storage_path
        and operation.operation = 'delete'
        and operation.owner_token = p_lease_token
    );
  return found;
end;
$$;
alter function private.mark_whatsapp_nonlead_media_delete_started(uuid, uuid) owner to postgres;
revoke all on function private.mark_whatsapp_nonlead_media_delete_started(uuid, uuid)
  from public, anon, authenticated, service_role;

create function private.finish_whatsapp_nonlead_media_delete(
  p_id uuid, p_lease_token uuid, p_outcome text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item private.whatsapp_nonlead_media_delete_outbox%rowtype;
begin
  if p_id is null or p_lease_token is null or p_outcome is null
     or p_outcome not in ('confirmed_deleted', 'unknown', 'not_started') then
    raise exception using errcode = '22023', message = 'whatsapp_nonlead_media_finish_invalid';
  end if;
  select item.* into v_item
  from private.whatsapp_nonlead_media_delete_outbox as item
  where item.id = p_id
  for update;
  if not found then
    -- Success may have committed before the response was lost. No path is
    -- retained after confirmed deletion, so repeat confirmation is safe.
    return p_outcome = 'confirmed_deleted';
  end if;
  if v_item.status <> 'processing' or v_item.lease_token <> p_lease_token then
    return false;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_item.bucket_id), pg_catalog.hashtext(v_item.storage_path)
  );
  if not exists (
    select 1 from private.whatsapp_media_path_operations as operation
    where operation.bucket_id = v_item.bucket_id
      and operation.storage_path = v_item.storage_path
      and operation.operation = 'delete'
      and operation.owner_token = p_lease_token
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_media_delete_fence_missing';
  end if;

  if p_outcome = 'confirmed_deleted' then
    if v_item.delete_started_at is null then
      return false;
    end if;
    delete from private.whatsapp_nonlead_media_delete_outbox as item
    where item.id = p_id and item.lease_token = p_lease_token;
    -- Several repaired conversations can have owned the same content-addressed
    -- object. One confirmed Storage DELETE settles their remaining tickets.
    delete from private.whatsapp_nonlead_media_delete_outbox as item
    where item.organization_id = v_item.organization_id
      and item.bucket_id = v_item.bucket_id
      and item.storage_path = v_item.storage_path
      and item.status in ('pending', 'retry', 'held_shared');
    delete from private.whatsapp_media_path_operations as operation
    where operation.bucket_id = v_item.bucket_id
      and operation.storage_path = v_item.storage_path
      and operation.owner_token = p_lease_token;
    return true;
  end if;
  if p_outcome = 'unknown' then
    -- A timeout/crash cannot prove the external request stopped. Neither an
    -- elapsed lease nor Storage HEAD automatically releases this path.
    update private.whatsapp_media_path_operations as operation
    set outcome_unknown = true
    where operation.bucket_id = v_item.bucket_id
      and operation.storage_path = v_item.storage_path
      and operation.owner_token = p_lease_token;
    update private.whatsapp_nonlead_media_delete_outbox as item
    set status = 'dead', locked_at = null, locked_by = null,
        last_error = 'storage_delete_outcome_unknown',
        updated_at = clock_timestamp()
    where item.id = p_id and item.lease_token = p_lease_token;
    return true;
  end if;

  if v_item.delete_started_at is not null then
    return false;
  end if;
  delete from private.whatsapp_media_path_operations as operation
  where operation.bucket_id = v_item.bucket_id
    and operation.storage_path = v_item.storage_path
    and operation.owner_token = p_lease_token;
  update private.whatsapp_nonlead_media_delete_outbox as item
  set status = 'retry', next_attempt_at = clock_timestamp() + interval '1 minute',
      locked_at = null, locked_by = null, lease_token = null,
      last_error = 'storage_delete_not_started', updated_at = clock_timestamp()
  where item.id = p_id and item.lease_token = p_lease_token;
  return true;
end;
$$;
alter function private.finish_whatsapp_nonlead_media_delete(uuid, uuid, text) owner to postgres;
revoke all on function private.finish_whatsapp_nonlead_media_delete(uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- A confirmed repair moves only its own displaced source path into the same
-- durable Storage-delete outbox used by nonlead purge. No historical ledger is
-- swept: only the bounded media jobs in this completion can contribute rows.
-- The caller is still inside the transaction that repoints message and job.
create function private.stage_whatsapp_repair_source_media_delete(
  p_organization_id uuid, p_job_ids uuid[],
  p_source_paths text[], p_replacement_path text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_moved integer;
  v_enqueued integer;
begin
  if p_organization_id is null or p_job_ids is null
     or cardinality(p_job_ids) not between 1 and 100
     or p_source_paths is null
     or cardinality(p_source_paths) not between 1 and 400
     or exists (
       select 1 from pg_catalog.unnest(p_source_paths) as source(path)
       where nullif(btrim(source.path), '') is null
          or source.path = p_replacement_path
     )
     or nullif(btrim(p_replacement_path), '') is null
  then
    raise exception using errcode = '22023',
      message = 'whatsapp_repair_source_gc_invalid';
  end if;
  if (
    select count(*)
    from public.media_jobs as job
    join public.whatsapp_messages as message
      on message.id = job.message_id
     and message.organization_id = job.organization_id
     and message.conversation_id = job.conversation_id
    where job.id = any(p_job_ids)
      and job.organization_id = p_organization_id
      and job.status = 'completed'
      and job.storage_path = p_replacement_path
      and message.media_storage_path = p_replacement_path
  ) <> cardinality(p_job_ids) then
    raise exception using errcode = '55000',
      message = 'whatsapp_repair_source_gc_completion_unproven';
  end if;

  with moved as (
    delete from private.whatsapp_media_repair_source_paths as source
    where source.organization_id = p_organization_id
      and source.storage_path = any(p_source_paths)
      and exists (
        select 1 from public.media_jobs as job
        where job.id = any(p_job_ids)
          and job.organization_id = source.organization_id
          and job.conversation_id = source.conversation_id
      )
    returning source.organization_id, source.conversation_id, source.storage_path
  ), enqueued as (
    insert into private.whatsapp_nonlead_media_delete_outbox (
      organization_id, conversation_id, bucket_id, storage_path
    )
    select moved.organization_id, moved.conversation_id,
           'whatsapp-media', moved.storage_path
    from moved
    on conflict (conversation_id, bucket_id, storage_path) do nothing
    returning 1
  )
  select count(*)::integer, (select count(*)::integer from enqueued)
  into v_moved, v_enqueued
  from moved;
  if v_moved = 0 then
    raise exception using errcode = '55000',
      message = 'whatsapp_repair_source_gc_source_unproven';
  end if;
  return v_moved;
end;
$$;
alter function private.stage_whatsapp_repair_source_media_delete(
  uuid, uuid[], text[], text
) owner to postgres;
revoke all on function private.stage_whatsapp_repair_source_media_delete(
  uuid, uuid[], text[], text
) from public, anon, authenticated, service_role;

-- The operator calls this only after the native ingress, purge worker and
-- Storage delete worker are deployed and observed healthy. The database cannot
-- prove which binary is running; applying this migration never calls it.
-- Session UPDATE fences a concurrent Go ingress KEY SHARE before choosing a
-- fresh capture boundary. No pre-existing conversation is enrolled.
create or replace function private.activate_whatsapp_nonlead_retention(
  p_session_id uuid
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_cutoff_at timestamptz;
  v_policy_organization_id uuid;
  v_capture_from timestamptz;
  v_purge_enabled boolean;
  v_policy_exists boolean;
begin
  if p_session_id is null then
    raise exception using errcode = '22023',
      message = 'whatsapp_nonlead_retention_session_required';
  end if;

  select session.organization_id into v_organization_id
  from public.whatsapp_sessions as session
  where session.id = p_session_id
    and session.provider = 'evolution_go'
    and coalesce(session.is_active, true) = true
  for update of session;
  if not found then
    raise exception using errcode = '22023',
      message = 'whatsapp_nonlead_retention_session_not_found';
  end if;

  select cutover.cutoff_at into v_cutoff_at
  from private.whatsapp_webhook_session_cutovers as cutover
  where cutover.session_id = p_session_id;
  if v_cutoff_at is null or v_cutoff_at > clock_timestamp() then
    raise exception using errcode = '55000',
      message = 'whatsapp_nonlead_retention_cutover_required';
  end if;

  select policy.organization_id, policy.capture_from, policy.purge_enabled
  into v_policy_organization_id, v_capture_from, v_purge_enabled
  from private.whatsapp_nonlead_retention_sessions as policy
  where policy.session_id = p_session_id
  for update of policy;
  v_policy_exists := found;
  if v_policy_exists and v_policy_organization_id is distinct from v_organization_id then
    raise exception using errcode = '55000',
      message = 'whatsapp_nonlead_retention_policy_scope_mismatch';
  end if;
  if v_purge_enabled is true then
    if v_capture_from < v_cutoff_at then
      raise exception using errcode = '55000',
        message = 'whatsapp_nonlead_retention_policy_cutoff_mismatch';
    end if;
    return v_capture_from;
  end if;

  -- An old processing callback could finish after activation without a new
  -- immutable snapshot. Let it finish before creating the boundary.
  if exists (
    select 1 from public.whatsapp_webhook_inbox as inbox
    where inbox.session_id = p_session_id
      and inbox.status = 'processing'
  ) then
    raise exception using errcode = '55000',
      message = 'whatsapp_nonlead_retention_inflight_webhooks';
  end if;
  if exists (
    select 1 from private.whatsapp_nonlead_retention_candidates as candidate
    where candidate.session_id = p_session_id
  ) or exists (
    select 1 from private.whatsapp_nonlead_retention_route_generations as generation
    where generation.session_id = p_session_id
  ) or exists (
    select 1 from private.whatsapp_nonlead_retention_candidate_routes as route
    where route.session_id = p_session_id
  ) then
    raise exception using errcode = '55000',
      message = 'whatsapp_nonlead_retention_old_state_present';
  end if;

  v_capture_from := clock_timestamp();
  if v_policy_exists then
    update private.whatsapp_nonlead_retention_sessions as policy
    set capture_from = v_capture_from, purge_enabled = true
    where policy.session_id = p_session_id
      and policy.organization_id = v_organization_id;
  else
    insert into private.whatsapp_nonlead_retention_sessions (
      session_id, organization_id, capture_from, purge_enabled
    ) values (p_session_id, v_organization_id, v_capture_from, true);
  end if;
  return v_capture_from;
end;
$$;
alter function private.activate_whatsapp_nonlead_retention(uuid) owner to postgres;
revoke all on function private.activate_whatsapp_nonlead_retention(uuid)
  from public, anon, authenticated, service_role;

-- Disabling an armed policy would immediately re-expose conversations whose
-- deadline has passed, before their asynchronous physical purge finishes.
-- Keep this legacy setter for prepared rows only; activation uses the fenced
-- function above. Direct privileged changes receive the same one-way guard.
-- A hard session DELETE also cascades to this policy, while conversations use
-- ON DELETE SET NULL for session_id. It is intentionally refused once active;
-- the normal API session removal is a soft update, and hard teardown needs a
-- separate verified data-erasure procedure.
create or replace function private.set_whatsapp_nonlead_purge_enabled(
  p_session_id uuid, p_enabled boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  if p_session_id is null or p_enabled is null then
    raise exception using errcode = '22023',
      message = 'whatsapp_nonlead_retention_policy_argument_invalid';
  end if;
  if p_enabled then
    raise exception using errcode = '55000',
      message = 'whatsapp_nonlead_retention_use_activation';
  end if;
  select policy.purge_enabled into v_enabled
  from private.whatsapp_nonlead_retention_sessions as policy
  where policy.session_id = p_session_id
  for update of policy;
  if not found then
    return false;
  end if;
  if v_enabled then
    raise exception using errcode = '55000',
      message = 'whatsapp_nonlead_retention_one_way';
  end if;
  return true;
end;
$$;
alter function private.set_whatsapp_nonlead_purge_enabled(uuid, boolean) owner to postgres;
revoke all on function private.set_whatsapp_nonlead_purge_enabled(uuid, boolean)
  from public, anon, authenticated, service_role;

create function private.guard_whatsapp_nonlead_retention_policy_regression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.purge_enabled then
      raise exception using errcode = '55000',
        message = 'whatsapp_nonlead_retention_one_way';
    end if;
    return old;
  end if;
  if new.session_id is distinct from old.session_id
     or new.organization_id is distinct from old.organization_id
     or (old.purge_enabled and (
       new.purge_enabled is not true
       or new.capture_from is distinct from old.capture_from
     )) then
    raise exception using errcode = '55000',
      message = 'whatsapp_nonlead_retention_one_way';
  end if;
  return new;
end;
$$;
alter function private.guard_whatsapp_nonlead_retention_policy_regression() owner to postgres;
revoke all on function private.guard_whatsapp_nonlead_retention_policy_regression()
  from public, anon, authenticated, service_role;
create trigger guard_whatsapp_nonlead_retention_policy_regression
before update or delete on private.whatsapp_nonlead_retention_sessions
for each row execute function private.guard_whatsapp_nonlead_retention_policy_regression();

commit;
