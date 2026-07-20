-- The durable automation outbox supersedes this legacy fire-and-forget HTTP
-- trigger. Refuse to retire the old path unless the canonical producer exists
-- and is enabled in this environment.
do $$
begin
  if to_regprocedure('private.capture_automation_tag_event()') is null then
    raise exception 'canonical automation tag producer is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'lead_tags'
      and t.tgname = 'zz_automation_tag_added'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception 'canonical automation tag trigger is missing or disabled';
  end if;
end;
$$;

drop trigger if exists tr_visual_automation_tag_added on public.lead_tags;
drop function if exists public.trigger_visual_automations_on_tag_added();
