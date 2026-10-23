-- Forward-only local preparation. Old APIs and silent historical imports do
-- not set these transaction-local values and keep their existing behavior.
-- The Go API defers only stage status, preserving assignee automation, then
-- locks the final lead/property and performs the real UPDATE into won.
create function private.set_lead_creation_status_phase(p_organization_id uuid, p_lead_id uuid, p_phase text)
returns void language plpgsql security invoker
set search_path = 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  request_role text := coalesce(nullif(pg_catalog.current_setting('role', true), 'none'), session_user);
begin
  if not (pg_catalog.pg_has_role(request_role, 'postgres', 'member')
    or pg_catalog.pg_has_role(request_role, 'service_role', 'member')) then
    raise exception using errcode = '42501', message = 'lead_creation_status_backend_only';
  end if;
  if p_organization_id is null or p_lead_id is null or p_phase is null
     or p_phase not in ('defer', 'apply', 'done') then
    raise exception using errcode = '22023', message = 'invalid_lead_creation_status_phase';
  end if;
  perform pg_catalog.set_config('vimob.lead_creation_status_scope',
    p_organization_id::text || '/' || p_lead_id::text, true);
  perform pg_catalog.set_config('vimob.lead_creation_status_phase', p_phase, true);
end;
$$;
alter function private.set_lead_creation_status_phase(uuid,uuid,text) owner to postgres;
revoke all on function private.set_lead_creation_status_phase(uuid,uuid,text) from public, anon, authenticated;
grant execute on function private.set_lead_creation_status_phase(uuid,uuid,text) to service_role;

-- Keep legacy stage automation rows from aborting lead writes or assigning a
-- lead across tenant/inactive-user boundaries. New API writes validate the
-- same contract before persistence; this function is the compatibility guard.
create or replace function public.execute_stage_automations()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  automation record;
  action_config jsonb;
  next_status text;
  creation_scope text := pg_catalog.current_setting('vimob.lead_creation_status_scope', true);
  creation_phase text := pg_catalog.current_setting('vimob.lead_creation_status_phase', true);
  request_role text := coalesce(nullif(pg_catalog.current_setting('role', true), 'none'), session_user);
  scoped_creation boolean;
  apply_status boolean;
  target_user_text text;
  target_user_id uuid;
begin
  scoped_creation := creation_scope = new.organization_id::text || '/' || new.id::text
    and (pg_catalog.pg_has_role(request_role, 'postgres', 'member')
      or pg_catalog.pg_has_role(request_role, 'service_role', 'member'));
  apply_status := coalesce(scoped_creation and creation_phase = 'apply', false);
  if tg_op = 'INSERT' then
    if new.stage_id is null then
      return new;
    end if;
  elsif old.stage_id is not distinct from new.stage_id and not apply_status then
    return new;
  end if;

  for automation in
    select stage_automation.*
    from public.stage_automations stage_automation
    where stage_automation.stage_id = new.stage_id
      and stage_automation.organization_id = new.organization_id
      and coalesce(stage_automation.is_active, false) = true
      and stage_automation.trigger_type = 'on_enter'
    order by stage_automation.created_at, stage_automation.id
  loop
    action_config := coalesce(automation.action_config, '{}'::jsonb);

    if automation.automation_type = 'change_deal_status_on_enter' then
      if scoped_creation and creation_phase = 'defer' then continue; end if;
      next_status := lower(btrim(action_config->>'deal_status'));
      if next_status in ('open', 'won', 'lost') then
        new.deal_status := next_status;
        if next_status = 'won' then
          if tg_op = 'INSERT' then
            new.won_at := now();
          elsif old.deal_status is distinct from 'won' then
            new.won_at := now();
          else
            new.won_at := coalesce(old.won_at, new.won_at, now());
          end if;
          new.lost_at := null;
          new.lost_reason := null;
        elsif next_status = 'lost' then
          if tg_op = 'INSERT' then
            new.lost_at := now();
          elsif old.deal_status is distinct from 'lost' then
            new.lost_at := now();
          else
            new.lost_at := coalesce(old.lost_at, new.lost_at, now());
          end if;
          new.won_at := null;
        else
          new.won_at := null;
          new.lost_at := null;
          new.lost_reason := null;
        end if;
      end if;
    elsif automation.automation_type = 'change_assignee_on_enter' then
      if apply_status then continue; end if; -- Already applied on actual INSERT/stage entry.
      target_user_text := btrim(coalesce(action_config->>'target_user_id', ''));
      target_user_id := null;
      if target_user_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        target_user_id := target_user_text::uuid;
      end if;

      if target_user_id is not null and exists (
        select 1
        from public.organization_members member
        join public.users app_user on app_user.id = member.user_id
        where member.organization_id = new.organization_id
          and member.user_id = target_user_id
          and coalesce(member.is_active, false) = true
          and coalesce(app_user.is_active, false) = true
      ) then
        new.assigned_user_id := target_user_id;
      end if;
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.execute_stage_automations() from public, anon, authenticated;
grant execute on function public.execute_stage_automations() to service_role;
