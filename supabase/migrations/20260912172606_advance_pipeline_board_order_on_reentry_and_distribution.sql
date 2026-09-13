-- Keep the pipeline ordering clock independent from the real stage-entry clock.
-- A new reentry or assignment is an operational event even when the lead stays
-- in the same stage. Provider messages, attribution refreshes and tag automation
-- do not touch any of the columns used by this rule and therefore do not reorder
-- the board.

create or replace function private.guard_lead_clocks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_event boolean;
  v_board_event_at timestamptz;
  v_reentry_event boolean;
begin
  if tg_op = 'INSERT' then
    new.attention_eligible := true;
    new.attention_enrolled_at := coalesce(new.attention_enrolled_at, now());
    if new.stage_id is not null then
      new.stage_entered_at := coalesce(
        new.stage_entered_at,
        new.created_at,
        now()
      );
    end if;
    if new.assigned_user_id is not null then
      new.assigned_at := coalesce(new.assigned_at, new.created_at, now());
    end if;
    new.board_order_at := coalesce(
      new.board_order_at,
      new.last_entry_at,
      new.stage_entered_at,
      new.created_at,
      now()
    );
    return new;
  end if;

  v_assignment_event :=
    new.assigned_user_id is distinct from old.assigned_user_id
    or new.team_id is distinct from old.team_id
    or new.assigned_at is distinct from old.assigned_at;
  v_reentry_event :=
    coalesce(new.reentry_count, 0) > coalesce(old.reentry_count, 0);

  new.attention_eligible := old.attention_eligible;
  new.attention_enrolled_at := old.attention_enrolled_at;

  if new.stage_id is not distinct from old.stage_id
     and new.pipeline_id is not distinct from old.pipeline_id then
    new.stage_entered_at := old.stage_entered_at;
  elsif new.stage_id is null then
    new.stage_entered_at := null;
    new.board_order_at := null;
  else
    new.stage_entered_at := now();
    if new.board_order_at is not distinct from old.board_order_at then
      new.board_order_at := new.stage_entered_at;
    end if;
  end if;

  if new.assigned_user_id is distinct from old.assigned_user_id then
    new.assigned_at := case
      when new.assigned_user_id is null then null
      else now()
    end;
  end if;

  if new.stage_id is not null
     and (v_assignment_event or v_reentry_event) then
    v_board_event_at := clock_timestamp();
    new.board_order_at := greatest(
      coalesce(
        new.board_order_at,
        old.board_order_at,
        new.stage_entered_at,
        new.created_at,
        v_board_event_at
      ),
      v_board_event_at
    );
  end if;

  new.board_order_at := coalesce(
    new.board_order_at,
    old.board_order_at,
    new.stage_entered_at,
    new.created_at,
    now()
  );
  return new;
end;
$$;

comment on function private.guard_lead_clocks() is
  'Preserves real stage-entry time while advancing the independent pipeline order for stage moves, reentries and assignment events.';

revoke all on function private.guard_lead_clocks()
from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_lead_clocks on public.leads;
create trigger trg_guard_lead_clocks
before insert or update of
  stage_id,
  pipeline_id,
  stage_entered_at,
  board_order_at,
  assigned_user_id,
  assigned_at,
  team_id,
  reentry_count,
  source,
  attention_eligible,
  attention_enrolled_at
on public.leads
for each row
execute function private.guard_lead_clocks();

-- The board now orders by the indexed column directly. Repair only boardable
-- legacy rows that still have no ordering clock; this predicate also makes a
-- reviewed replay of the migration a no-op after the first successful pass.
update public.leads
set board_order_at = coalesce(
  last_entry_at,
  stage_entered_at,
  created_at,
  now()
)
where stage_id is not null
  and board_order_at is null;
