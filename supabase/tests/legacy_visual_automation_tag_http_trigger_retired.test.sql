begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

select ok(
  to_regprocedure('private.capture_automation_tag_event()') is not null,
  'canonical durable tag event producer exists'
);

select is(
  (
    select count(*)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'lead_tags'
      and t.tgname = 'zz_automation_tag_added'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ),
  1::bigint,
  'canonical durable tag event trigger remains enabled'
);

select is(
  (
    select count(*)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'lead_tags'
      and t.tgname = 'tr_visual_automation_tag_added'
      and not t.tgisinternal
  ),
  0::bigint,
  'legacy HTTP tag trigger is retired'
);

select ok(
  to_regprocedure('public.trigger_visual_automations_on_tag_added()') is null,
  'legacy HTTP tag trigger function is retired'
);

select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f'
      and n.nspname not in ('pg_catalog', 'information_schema')
      and pg_get_functiondef(p.oid) ilike '%/functions/v1/automation-trigger%'
  ),
  0::bigint,
  'database functions no longer call the protected automation trigger over HTTP'
);

select * from finish();
rollback;
