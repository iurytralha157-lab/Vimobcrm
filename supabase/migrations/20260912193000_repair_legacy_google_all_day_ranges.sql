-- Repairs the deterministic shape produced by the former Google all-day
-- converter. It stored Google's exclusive end date as midnight of the final
-- included day (and therefore produced a zero-length interval for one day).
-- The encoded Google civil dates are recovered from the former fixed UTC-03
-- offset (not from the historical America/Sao_Paulo rules),
-- then rewritten using the organization's currently configured IANA timezone.
-- Rollout order is intentional: deploy and drain the corrected Google writer
-- before applying this repair so no legacy writer can recreate this shape.

do $legacy_google_all_day_preflight$
begin
  if exists (
    select 1
    from public.schedule_events
    where coalesce(is_all_day, false)
      and nullif(btrim(google_event_id), '') is not null
      and end_time < start_time
  ) then
    raise exception using
      errcode = '22007',
      message = 'legacy Google all-day repair preflight failed',
      hint = 'Review Google-linked all-day rows whose end_time precedes start_time before applying this migration.';
  end if;
end
$legacy_google_all_day_preflight$;

with legacy_google_all_day as materialized (
  select
    schedule_event.id,
    (
      (schedule_event.start_time at time zone 'UTC') - interval '3 hours'
    )::date as google_start_date,
    (
      (schedule_event.end_time at time zone 'UTC') - interval '3 hours'
    )::date as google_included_end_date,
    coalesce(timezone_name.name, 'America/Sao_Paulo') as organization_timezone
  from public.schedule_events schedule_event
  left join public.organization_attention_settings organization_settings
    on organization_settings.organization_id = schedule_event.organization_id
  left join pg_catalog.pg_timezone_names timezone_name
    on timezone_name.name = nullif(btrim(organization_settings.timezone), '')
  where coalesce(schedule_event.is_all_day, false)
    and nullif(btrim(schedule_event.google_event_id), '') is not null
    and schedule_event.end_time >= schedule_event.start_time
    and (
      (schedule_event.start_time at time zone 'UTC') - interval '3 hours'
    )::time = time '00:00:00'
    and (
      (schedule_event.end_time at time zone 'UTC') - interval '3 hours'
    )::time = time '00:00:00'
), repaired as (
  update public.schedule_events schedule_event
  set
    start_time = legacy.google_start_date::timestamp without time zone
      at time zone legacy.organization_timezone,
    end_time = (
      (legacy.google_included_end_date + 1)::timestamp without time zone
        at time zone legacy.organization_timezone
    ) - interval '1 millisecond'
  from legacy_google_all_day legacy
  where schedule_event.id = legacy.id
  returning schedule_event.id
)
select count(*) as repaired_legacy_google_all_day_events
from repaired;

do $legacy_google_all_day_postcheck$
begin
  if exists (
    select 1
    from public.schedule_events
    where coalesce(is_all_day, false)
      and nullif(btrim(google_event_id), '') is not null
      and end_time <= start_time
  ) then
    raise exception using
      errcode = '22007',
      message = 'legacy Google all-day repair postcheck failed',
      hint = 'The migration was rolled back; inspect the remaining non-positive Google all-day intervals.';
  end if;

  if exists (
    select 1
    from public.schedule_events schedule_event
    where coalesce(schedule_event.is_all_day, false)
      and nullif(btrim(schedule_event.google_event_id), '') is not null
      and schedule_event.end_time >= schedule_event.start_time
      and (
        (schedule_event.start_time at time zone 'UTC') - interval '3 hours'
      )::time = time '00:00:00'
      and (
        (schedule_event.end_time at time zone 'UTC') - interval '3 hours'
      )::time = time '00:00:00'
  ) then
    raise exception using
      errcode = '22007',
      message = 'legacy Google all-day repair left an encoded legacy range',
      hint = 'The migration was rolled back; stop legacy Google writers and inspect the remaining fixed UTC-03 midnight ranges.';
  end if;
end
$legacy_google_all_day_postcheck$;
