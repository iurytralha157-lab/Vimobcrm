-- Production predates the canonical event ledger and may still expose the
-- source_module/source_id shape. Add the canonical columns before the engine
-- migration normalizes constraints, indexes and historical totals.
alter table public.gamification_events
  add column if not exists xp_earned bigint,
  add column if not exists source text,
  add column if not exists reference_id text;

update public.gamification_events as event
set xp_earned = greatest(coalesce(event.xp_earned, event.points_earned, 0), 0),
    source = coalesce(
      nullif(btrim(event.source), ''),
      nullif(to_jsonb(event)->>'source_module', ''),
      'legacy_event'
    ),
    reference_id = coalesce(
      nullif(btrim(event.reference_id), ''),
      nullif(to_jsonb(event)->>'source_id', '')
    );

alter table public.gamification_events
  alter column xp_earned set default 0,
  alter column xp_earned set not null,
  alter column source set default 'system_action',
  alter column source set not null;
