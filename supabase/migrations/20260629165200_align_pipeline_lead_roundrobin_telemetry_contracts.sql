-- Aligns the new Supabase project with the backend contracts used by
-- pipelines, leads/dashboard, distribution queues, and error telemetry.

alter table if exists public.pipelines
  add column if not exists is_active boolean default true,
  add column if not exists position integer default 0,
  add column if not exists updated_at timestamptz default now();

with ranked as (
  select
    id,
    row_number() over (
      partition by organization_id
      order by coalesce(created_at, now()), id
    ) - 1 as next_position
  from public.pipelines
)
update public.pipelines p
set
  is_active = coalesce(p.is_active, true),
  position = coalesce(p.position, ranked.next_position),
  updated_at = coalesce(p.updated_at, p.created_at, now())
from ranked
where ranked.id = p.id;

create index if not exists idx_pipelines_org_active_position
  on public.pipelines (organization_id, is_active, position);

alter table if exists public.leads
  add column if not exists status text default 'new',
  add column if not exists priority text default 'normal',
  add column if not exists last_contact_at timestamptz,
  add column if not exists next_follow_up_at timestamptz;

update public.leads
set
  status = coalesce(
    nullif(status, ''),
    case
      when deal_status = 'won' then 'won'
      when deal_status = 'lost' then 'lost'
      else 'new'
    end
  ),
  priority = coalesce(nullif(priority, ''), 'normal'),
  last_contact_at = coalesce(last_contact_at, first_response_at, first_touch_at);

create index if not exists idx_leads_org_status
  on public.leads (organization_id, status);

create index if not exists idx_leads_org_next_follow_up
  on public.leads (organization_id, next_follow_up_at);

alter table if exists public.round_robins
  add column if not exists pipeline_id uuid,
  add column if not exists current_position integer default 0,
  add column if not exists rules jsonb default '{}'::jsonb,
  add column if not exists updated_at timestamptz default now();

update public.round_robins rr
set
  pipeline_id = coalesce(
    rr.pipeline_id,
    rr.target_pipeline_id,
    (
      select p.id
      from public.pipelines p
      where p.organization_id = rr.organization_id
        and p.default_round_robin_id = rr.id
      order by p.created_at asc
      limit 1
    )
  ),
  current_position = coalesce(rr.current_position, rr.last_assigned_index, 0),
  rules = coalesce(
    nullif(rr.rules, '{}'::jsonb),
    jsonb_strip_nulls(jsonb_build_object(
      'strategy', coalesce(nullif(rr.strategy, ''), 'simple'),
      'target_stage_id', rr.target_stage_id::text,
      'settings', coalesce(rr.settings, '{}'::jsonb),
      'reentry_behavior', coalesce(nullif(rr.reentry_behavior, ''), 'redistribute')
    )),
    '{}'::jsonb
  ),
  updated_at = coalesce(rr.updated_at, rr.created_at, now());

create index if not exists idx_round_robins_org_pipeline_active
  on public.round_robins (organization_id, pipeline_id, is_active);

alter table if exists public.round_robin_rules
  add column if not exists organization_id uuid,
  add column if not exists name text,
  add column if not exists conditions jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

update public.round_robin_rules r
set
  organization_id = coalesce(r.organization_id, rr.organization_id),
  name = coalesce(nullif(r.name, ''), nullif(r.match_type, ''), 'rule'),
  conditions = coalesce(
    nullif(r.conditions, '{}'::jsonb),
    jsonb_strip_nulls(jsonb_build_object(
      'match_type', r.match_type,
      'match_value', r.match_value,
      'match', coalesce(r.match, '{}'::jsonb)
    )),
    '{}'::jsonb
  ),
  created_at = coalesce(r.created_at, now()),
  updated_at = coalesce(r.updated_at, r.created_at, now())
from public.round_robins rr
where rr.id = r.round_robin_id;

create index if not exists idx_round_robin_rules_org_queue
  on public.round_robin_rules (organization_id, round_robin_id);

alter table if exists public.round_robin_members
  add column if not exists organization_id uuid,
  add column if not exists is_active boolean default true,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

update public.round_robin_members m
set
  organization_id = coalesce(m.organization_id, rr.organization_id),
  is_active = coalesce(m.is_active, true),
  created_at = coalesce(m.created_at, now()),
  updated_at = coalesce(m.updated_at, m.created_at, now())
from public.round_robins rr
where rr.id = m.round_robin_id;

create index if not exists idx_round_robin_members_org_queue
  on public.round_robin_members (organization_id, round_robin_id);

alter table if exists public.round_robin_logs
  add column if not exists metadata jsonb default '{}'::jsonb;

update public.round_robin_logs
set metadata = coalesce(metadata, '{}'::jsonb);

alter table if exists public.error_events
  add column if not exists request_id text,
  add column if not exists source text default 'frontend',
  add column if not exists severity text default 'error',
  add column if not exists category text,
  add column if not exists error_code text,
  add column if not exists http_status integer,
  add column if not exists method text,
  add column if not exists path text,
  add column if not exists route text,
  add column if not exists component text,
  add column if not exists stack text,
  add column if not exists stack_hash text,
  add column if not exists fingerprint text,
  add column if not exists url text,
  add column if not exists user_agent text,
  add column if not exists browser_context jsonb default '{}'::jsonb,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid,
  add column if not exists resolution_note text;

update public.error_events
set
  source = coalesce(nullif(source, ''), 'frontend'),
  severity = coalesce(nullif(severity, ''), 'error'),
  fingerprint = coalesce(nullif(fingerprint, ''), md5(coalesce(message, id::text))),
  browser_context = coalesce(browser_context, '{}'::jsonb),
  metadata = coalesce(metadata, '{}'::jsonb);

create index if not exists idx_error_events_org_created
  on public.error_events (organization_id, created_at desc);

create index if not exists idx_error_events_fingerprint
  on public.error_events (fingerprint);
