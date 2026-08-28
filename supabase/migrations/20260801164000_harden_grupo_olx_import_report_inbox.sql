-- Grupo OLX import reports are delivered with a 30-second timeout and no
-- provider retry. Keep raw receipt independent from asynchronous annotation,
-- and make poison items bounded so they cannot starve later reports.

alter table public.portal_import_reports
  add column if not exists provider_occurred_at timestamptz,
  add column if not exists raw_body bytea,
  add column if not exists annotation_status text,
  add column if not exists annotation_attempts integer,
  add column if not exists annotation_next_attempt_at timestamptz,
  add column if not exists annotation_processed_at timestamptz,
  add column if not exists annotation_last_error text;

-- jsonb cannot represent otherwise syntactically valid provider payloads such
-- as strings containing \u0000 or numbers outside float64/Postgres numeric
-- range. Keep the exact HTTP body in bytea before any shape normalization.
update public.portal_import_reports
set raw_body = convert_to(raw_payload::text, 'UTF8')
where raw_body is null;

alter table public.portal_import_reports
  alter column raw_body set not null;

-- Rows created before the async inbox were already applied synchronously in
-- the same transaction. Do not enqueue that history on deploy. Only explicit
-- legacy pending/failure markers are recoverable queue work.
update public.portal_import_reports
set annotation_status = case
      when error = 'annotation_pending' then 'pending'
      when error like 'annotation_failed:%' then 'retry'
      else 'succeeded'
    end,
    annotation_attempts = case when error like 'annotation_failed:%' then 1 else 0 end,
    annotation_next_attempt_at = case
      when error = 'annotation_pending' or error like 'annotation_failed:%' then clock_timestamp()
      else created_at
    end,
    annotation_processed_at = case
      when error = 'annotation_pending' or error like 'annotation_failed:%' then null
      else coalesce(annotation_processed_at, created_at)
    end,
    annotation_last_error = case
      when error like 'annotation_failed:%' then nullif(substr(error, length('annotation_failed:') + 1), '')
      else annotation_last_error
    end
where annotation_status is null;

alter table public.portal_import_reports
  alter column annotation_status set default 'pending',
  alter column annotation_status set not null,
  alter column annotation_attempts set default 0,
  alter column annotation_attempts set not null,
  alter column annotation_next_attempt_at set default now(),
  alter column annotation_next_attempt_at set not null;

do $add_portal_report_annotation_status_check$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.portal_import_reports'::regclass
      and conname = 'portal_import_reports_annotation_status_check'
  ) then
    alter table public.portal_import_reports
      add constraint portal_import_reports_annotation_status_check
      check (annotation_status in ('pending', 'retry', 'succeeded', 'dead'));
  end if;
end;
$add_portal_report_annotation_status_check$;

do $add_portal_report_annotation_attempts_check$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.portal_import_reports'::regclass
      and conname = 'portal_import_reports_annotation_attempts_check'
  ) then
    alter table public.portal_import_reports
      add constraint portal_import_reports_annotation_attempts_check
      check (annotation_attempts between 0 and 12);
  end if;
end;
$add_portal_report_annotation_attempts_check$;

create index if not exists portal_import_reports_annotation_queue_idx
  on public.portal_import_reports (
    annotation_next_attempt_at,
    created_at,
    id
  )
  where annotation_status in ('pending', 'retry');

create index if not exists portal_import_reports_integration_created_idx
  on public.portal_import_reports (integration_id, created_at desc, id desc);

create index if not exists portal_import_reports_provider_feedback_gin_idx
  on public.portal_import_reports
  using gin ((summary->'provider_feedback') jsonb_path_ops);

comment on column public.portal_import_reports.provider_occurred_at is
  'Provider timestamp used only as unversioned feedback metadata, never as a canonical publication fence.';
comment on column public.portal_import_reports.raw_body is
  'Exact syntactically valid JSON request bytes; authoritative durable inbox payload.';
comment on column public.portal_import_reports.annotation_status is
  'Durable asynchronous normalization state for the raw Grupo OLX report inbox.';
