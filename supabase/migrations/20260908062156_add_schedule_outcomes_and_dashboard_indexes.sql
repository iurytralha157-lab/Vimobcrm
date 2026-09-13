-- Adds durable attribution and outcome snapshots for Agenda analytics.
-- Legacy attribution remains NULL because user_id identifies the assignee, not
-- necessarily the author or performer. Final appointment outcomes are the one
-- safe deterministic backfill: their existing type + status already state what
-- happened and must conform before any later metadata-only update.

alter table public.schedule_events
  add column if not exists created_by uuid,
  add column if not exists team_id uuid,
  add column if not exists lead_source_snapshot text,
  add column if not exists outcome text,
  add column if not exists outcome_notes text,
  add column if not exists performed_by uuid,
  add column if not exists outcome_recorded_at timestamptz,
  add column if not exists rescheduled_from_event_id uuid,
  add column if not exists rescheduled_to_event_id uuid;

-- Preserve the best timestamp already available for every historical terminal
-- state. In particular, the legacy writer cleared completed_at on cancellation,
-- so updated_at is the only deterministic fallback for those rows. This must
-- run before assigning outcomes: a legacy updated_at trigger may stamp the
-- outcome update with the migration time.
update public.schedule_events
set outcome_recorded_at = coalesce(completed_at, updated_at, start_time)
where outcome_recorded_at is null
  and lower(btrim(status)) in ('completed', 'cancelled', 'canceled', 'no_show');

-- Canonicalize only values whose meaning is already unambiguous. This keeps
-- legacy casing/spacing from being interpreted differently by the backfill,
-- database constraints and the dashboard.
update public.schedule_events
set status = case lower(btrim(status))
  when 'canceled' then 'cancelled'
  else lower(btrim(status))
end
where lower(btrim(status)) in ('scheduled', 'completed', 'cancelled', 'canceled', 'no_show')
  and status is distinct from case lower(btrim(status))
    when 'canceled' then 'cancelled'
    else lower(btrim(status))
  end;

update public.schedule_events
set event_type = lower(btrim(event_type))
where lower(btrim(event_type)) in ('call', 'email', 'meeting', 'task', 'message', 'visit')
  and event_type is distinct from lower(btrim(event_type));

update public.schedule_events
set outcome = case lower(btrim(outcome))
  when 'canceled' then 'cancelled'
  else lower(btrim(outcome))
end
where lower(btrim(outcome)) in (
  'contacted',
  'activity_completed',
  'qualified',
  'proposal',
  'visit_completed',
  'meeting_completed',
  'follow_up',
  'no_show',
  'rescheduled',
  'cancelled',
  'canceled',
  'other'
)
  and outcome is distinct from case lower(btrim(outcome))
    when 'canceled' then 'cancelled'
    else lower(btrim(outcome))
  end;

update public.schedule_events
set
  outcome = case
    when status = 'completed' and lower(btrim(event_type)) = 'visit' then 'visit_completed'
    when status = 'completed' and lower(btrim(event_type)) = 'meeting' then 'meeting_completed'
    when status = 'no_show' then 'no_show'
    else outcome
  end
where outcome is null
  and (
    (status = 'completed' and lower(btrim(event_type)) in ('visit', 'meeting'))
    or status = 'no_show'
  );

-- Do not hide incompatible legacy rows behind NOT VALID constraints. A
-- deployment must first review any value outside the supported product
-- contract; this migration deliberately does not invent a replacement.
do $schedule_legacy_preflight$
declare
  invalid_reminder_count bigint;
  invalid_status_count bigint;
  invalid_outcome_state_count bigint;
begin
  select count(*)
    into invalid_reminder_count
  from public.schedule_events
  where reminder_minutes is not null
    and reminder_minutes not between 0 and 120;

  if invalid_reminder_count > 0 then
    raise exception using
      errcode = '23514',
      message = 'schedule reminder preflight failed',
      detail = format('%s schedule_events rows have reminder_minutes outside 0..120', invalid_reminder_count),
      hint = 'Review and correct those Agenda reminders explicitly before applying this migration.';
  end if;

  select count(*)
    into invalid_status_count
  from public.schedule_events
  where status is null
     or status not in ('scheduled', 'completed', 'cancelled', 'canceled', 'no_show');

  if invalid_status_count > 0 then
    raise exception using
      errcode = '23514',
      message = 'schedule status preflight failed',
      detail = format('%s schedule_events rows have a null or unsupported status', invalid_status_count),
      hint = 'Classify those legacy Agenda states explicitly before applying this migration.';
  end if;

  select count(*)
    into invalid_outcome_state_count
  from public.schedule_events
  where not coalesce(
    case
      when status = 'scheduled' then
        outcome is null and rescheduled_to_event_id is null
      when status = 'completed' and lower(btrim(event_type)) = 'visit' then
        outcome = 'visit_completed'
      when status = 'completed' and lower(btrim(event_type)) = 'meeting' then
        outcome = 'meeting_completed'
      when status = 'completed' and lower(btrim(event_type)) in ('call', 'email', 'message') then
        outcome is null or outcome in ('contacted', 'activity_completed')
      when status = 'completed' then
        outcome is null or outcome = 'activity_completed'
      when status = 'no_show' then
        lower(btrim(event_type)) in ('visit', 'meeting') and outcome = 'no_show'
      when status in ('cancelled', 'canceled') and outcome = 'rescheduled' then
        lower(btrim(event_type)) in ('visit', 'meeting') and rescheduled_to_event_id is not null
      when status in ('cancelled', 'canceled') then
        outcome is null or outcome = 'cancelled'
      else false
    end
    and (
      rescheduled_from_event_id is null
      or (lower(btrim(event_type)) in ('visit', 'meeting') and rescheduled_from_event_id <> id)
    )
    and (
      rescheduled_to_event_id is null
      or (lower(btrim(event_type)) in ('visit', 'meeting') and rescheduled_to_event_id <> id)
    ),
    false
  );

  if invalid_outcome_state_count > 0 then
    raise exception using
      errcode = '23514',
      message = 'schedule outcome-state preflight failed',
      detail = format('%s schedule_events rows do not map to a supported Agenda outcome state', invalid_outcome_state_count),
      hint = 'Review and classify those legacy Agenda outcomes explicitly before applying this migration.';
  end if;
end;
$schedule_legacy_preflight$;

do $schedule_outcomes_constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.schedule_events'::regclass
      and conname = 'schedule_events_created_by_fkey'
  ) then
    alter table public.schedule_events
      add constraint schedule_events_created_by_fkey
      foreign key (created_by)
      references public.users (id)
      on delete set null
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.schedule_events'::regclass
      and conname = 'schedule_events_rescheduled_from_event_id_fkey'
  ) then
    alter table public.schedule_events
      add constraint schedule_events_rescheduled_from_event_id_fkey
      foreign key (rescheduled_from_event_id)
      references public.schedule_events (id)
      on delete restrict
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.schedule_events'::regclass
      and conname = 'schedule_events_rescheduled_to_event_id_fkey'
  ) then
    alter table public.schedule_events
      add constraint schedule_events_rescheduled_to_event_id_fkey
      foreign key (rescheduled_to_event_id)
      references public.schedule_events (id)
      on delete restrict
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.schedule_events'::regclass
      and conname = 'schedule_events_team_id_fkey'
  ) then
    alter table public.schedule_events
      add constraint schedule_events_team_id_fkey
      foreign key (team_id)
      references public.teams (id)
      on delete set null
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.schedule_events'::regclass
      and conname = 'schedule_events_performed_by_fkey'
  ) then
    alter table public.schedule_events
      add constraint schedule_events_performed_by_fkey
      foreign key (performed_by)
      references public.users (id)
      on delete set null
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.schedule_events'::regclass
      and conname = 'schedule_events_lead_source_snapshot_length_check'
  ) then
    alter table public.schedule_events
      add constraint schedule_events_lead_source_snapshot_length_check
      check (
        lead_source_snapshot is null
        or char_length(btrim(lead_source_snapshot)) between 1 and 160
      )
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.schedule_events'::regclass
      and conname = 'schedule_events_reminder_minutes_supported_check'
  ) then
    alter table public.schedule_events
      add constraint schedule_events_reminder_minutes_supported_check
      check (reminder_minutes is null or reminder_minutes between 0 and 120);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.schedule_events'::regclass
      and conname = 'schedule_events_outcome_check'
  ) then
    alter table public.schedule_events
      add constraint schedule_events_outcome_check
      check (
        outcome is null
        or outcome in (
          'contacted',
          'activity_completed',
          'qualified',
          'proposal',
          'visit_completed',
          'meeting_completed',
          'follow_up',
          'no_show',
          'rescheduled',
          'cancelled',
          'other'
        )
      )
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.schedule_events'::regclass
      and conname = 'schedule_events_outcome_notes_length_check'
  ) then
    alter table public.schedule_events
      add constraint schedule_events_outcome_notes_length_check
      check (
        outcome_notes is null
        or char_length(btrim(outcome_notes)) between 1 and 2000
      )
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.schedule_events'::regclass
      and conname = 'schedule_events_status_check'
  ) then
    alter table public.schedule_events
      add constraint schedule_events_status_check
      check (status is not null and status in ('scheduled', 'completed', 'cancelled', 'canceled', 'no_show'));
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.schedule_events'::regclass
      and conname = 'schedule_events_outcome_state_check'
  ) then
    alter table public.schedule_events
      add constraint schedule_events_outcome_state_check
      check (
        coalesce(
          (
            case
              when status = 'scheduled' then
                outcome is null
                and rescheduled_to_event_id is null
              when status = 'completed' and lower(btrim(event_type)) = 'visit' then
                outcome = 'visit_completed'
              when status = 'completed' and lower(btrim(event_type)) = 'meeting' then
                outcome = 'meeting_completed'
              when status = 'completed' and lower(btrim(event_type)) in ('call', 'email', 'message') then
                outcome is null or outcome in ('contacted', 'activity_completed')
              when status = 'completed' then
                outcome is null or outcome = 'activity_completed'
              when status = 'no_show' then
                lower(btrim(event_type)) in ('visit', 'meeting')
                and outcome = 'no_show'
              when status in ('cancelled', 'canceled') and outcome = 'rescheduled' then
                lower(btrim(event_type)) in ('visit', 'meeting')
                and rescheduled_to_event_id is not null
              when status in ('cancelled', 'canceled') then
                outcome is null or outcome = 'cancelled'
              else false
            end
            and (
              rescheduled_from_event_id is null
              or (
                lower(btrim(event_type)) in ('visit', 'meeting')
                and rescheduled_from_event_id <> id
              )
            )
            and (
              rescheduled_to_event_id is null
              or (
                lower(btrim(event_type)) in ('visit', 'meeting')
                and rescheduled_to_event_id <> id
              )
            )
          ),
          false
        )
      )
      not valid;
  end if;
end
$schedule_outcomes_constraints$;

alter table public.schedule_events
  validate constraint schedule_events_outcome_check;
alter table public.schedule_events
  validate constraint schedule_events_outcome_notes_length_check;
alter table public.schedule_events
  validate constraint schedule_events_outcome_state_check;

create or replace function private.stamp_schedule_event_outcome_recorded_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'INSERT' then
    if new.status in ('completed', 'cancelled', 'canceled', 'no_show')
       and new.outcome_recorded_at is null then
      new.outcome_recorded_at := statement_timestamp();
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'scheduled' then
      new.outcome_recorded_at := null;
    elsif new.status in ('completed', 'cancelled', 'canceled', 'no_show') then
      new.outcome_recorded_at := coalesce(new.outcome_recorded_at, statement_timestamp());
    end if;
  elsif new.outcome is distinct from old.outcome
        and new.status in ('completed', 'cancelled', 'canceled', 'no_show') then
    new.outcome_recorded_at := statement_timestamp();
  end if;

  return new;
end
$function$;

drop trigger if exists stamp_schedule_event_outcome_recorded_at on public.schedule_events;
create trigger stamp_schedule_event_outcome_recorded_at
before insert or update of status, outcome on public.schedule_events
for each row execute function private.stamp_schedule_event_outcome_recorded_at();

comment on column public.schedule_events.created_by is
  'Auth user who created the event. Legacy rows remain NULL.';
comment on column public.schedule_events.team_id is
  'Team attributed to the event at scheduling time.';
comment on column public.schedule_events.lead_source_snapshot is
  'Lead source captured at scheduling time so later lead edits do not rewrite historical analytics. __none__ means the linked lead had no source.';
comment on column public.schedule_events.outcome is
  'Durable result. Visits and meetings use completed/no-show/rescheduled outcomes; ordinary activities may be completed or cancelled without an appointment outcome.';
comment on column public.schedule_events.outcome_notes is
  'Optional user-entered details about the recorded outcome.';
comment on column public.schedule_events.performed_by is
  'Auth user who performed the scheduled activity.';
comment on column public.schedule_events.outcome_recorded_at is
  'Timestamp when the outcome was recorded.';
comment on column public.schedule_events.rescheduled_from_event_id is
  'Previous finalized visit or meeting replaced by this event. Unique for retry-safe rescheduling.';
comment on column public.schedule_events.rescheduled_to_event_id is
  'Replacement event created atomically when this visit or meeting was rescheduled.';

-- The baseline already defines this index. IF NOT EXISTS keeps this migration
-- compatible with installations where that baseline index is absent.
create index if not exists idx_schedule_events_org_start_time
  on public.schedule_events (organization_id, start_time);

create index if not exists idx_schedule_events_org_created_at
  on public.schedule_events (organization_id, created_at desc);

create index if not exists idx_schedule_events_org_completed_at
  on public.schedule_events (organization_id, completed_at desc)
  where completed_at is not null;

create index if not exists idx_schedule_events_org_outcome_basis
  on public.schedule_events (
    organization_id,
    (coalesce(outcome_recorded_at, completed_at)) desc
  )
  where outcome_recorded_at is not null or completed_at is not null;

create index if not exists idx_schedule_events_org_user_start_time
  on public.schedule_events (organization_id, user_id, start_time desc);

create index if not exists idx_schedule_events_org_completed_by_completed_at
  on public.schedule_events (organization_id, completed_by, completed_at desc)
  where completed_by is not null and completed_at is not null;

create index if not exists idx_schedule_events_org_performed_by_completed_at
  on public.schedule_events (organization_id, performed_by, completed_at desc)
  where performed_by is not null and completed_at is not null;

create index if not exists idx_schedule_events_org_team_start_time
  on public.schedule_events (organization_id, team_id, start_time desc)
  where team_id is not null;

create index if not exists idx_schedule_events_org_source_start_time
  on public.schedule_events (organization_id, lead_source_snapshot, start_time desc)
  where lead_source_snapshot is not null;

create index if not exists idx_schedule_events_org_open_end_time
  on public.schedule_events (organization_id, end_time)
  where status = 'scheduled';

create index if not exists idx_schedule_events_pending_outcome_end_time
  on public.schedule_events (end_time)
  include (organization_id, user_id, lead_id, event_type)
  where status = 'scheduled'
    and event_type in ('visit', 'meeting');

create unique index if not exists idx_schedule_events_rescheduled_from_unique
  on public.schedule_events (rescheduled_from_event_id)
  where rescheduled_from_event_id is not null;

create unique index if not exists idx_schedule_events_rescheduled_to_unique
  on public.schedule_events (rescheduled_to_event_id)
  where rescheduled_to_event_id is not null;

-- PostgreSQL does not create supporting indexes on referencing FK columns.
-- These narrow indexes keep user/team deletion from scanning every event.
create index if not exists idx_schedule_events_created_by_fk
  on public.schedule_events (created_by)
  where created_by is not null;

create index if not exists idx_schedule_events_team_id_fk
  on public.schedule_events (team_id)
  where team_id is not null;

create index if not exists idx_schedule_events_performed_by_fk
  on public.schedule_events (performed_by)
  where performed_by is not null;

insert into public.notification_templates as system_template (
  name,
  slug,
  category,
  event_key,
  channel,
  channels,
  title,
  message,
  variables,
  is_active,
  editable_by_admin,
  organization_id,
  dedupe_window_seconds
)
values
  (
    'Lembrete de compromisso da agenda',
    'system_appointment_reminder_v1',
    'reminder',
    'appointment_reminder',
    'system',
    array['system', 'push', 'whatsapp']::text[],
    'Lembrete: {titulo}',
    '{tipo}: {titulo}, marcado para {horario}. Lead: {nome_lead}. {quando}',
    array['titulo', 'tipo', 'horario', 'nome_lead', 'schedule_event_id', 'minutos', 'quando']::text[],
    true,
    false,
    null,
    300
  ),
  (
    'Resultado pendente da agenda',
    'system_appointment_outcome_pending_v1',
    'reminder',
    'appointment_outcome_pending',
    'system',
    array['system', 'push']::text[],
    'Como foi: {titulo}?',
    '{tipo}: {titulo}, de {horario}, terminou. Registre se foi realizado ou se o cliente nao compareceu.',
    array['titulo', 'tipo', 'horario', 'nome_lead', 'schedule_event_id']::text[],
    true,
    false,
    null,
    3600
  )
on conflict (slug) do update
set name = excluded.name,
    category = excluded.category,
    event_key = excluded.event_key,
    channel = excluded.channel,
    channels = excluded.channels,
    title = excluded.title,
    message = excluded.message,
    variables = excluded.variables,
    is_active = excluded.is_active,
    editable_by_admin = excluded.editable_by_admin,
    dedupe_window_seconds = excluded.dedupe_window_seconds,
    updated_at = now()
where system_template.organization_id is null
  and excluded.organization_id is null;
