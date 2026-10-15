begin;
create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
select plan(8);

select has_function('private','ensure_round_robin_ticket_sequence',array['uuid'],
  'ticket sequence helper retains its existing signature');
select is((select md5(regexp_replace(prosrc,'\s','','g')) from pg_proc
  where oid='private.ensure_round_robin_ticket_sequence(uuid)'::regprocedure),
  '04e2f165d04c6806c496e874b1977537','helper matches the reviewed ACL and cold-creation fix');
select ok((select prosecdef and prorettype='regclass'::regtype and provolatile='v'
  and 'search_path=""'=any(proconfig) from pg_proc
  where oid='private.ensure_round_robin_ticket_sequence(uuid)'::regprocedure),
  'ticket helper keeps its definer boundary and empty search path');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) role
  where has_function_privilege(role,'private.ensure_round_robin_ticket_sequence(uuid)','EXECUTE')),
  'ticket helper remains callable only through its owner boundary');
select is((select (length(prosrc)-length(replace(prosrc,
  'revoke all on sequence private.%I from public, anon, authenticated, service_role','')))
  /length('revoke all on sequence private.%I from public, anon, authenticated, service_role')
  from pg_proc where oid='private.ensure_round_robin_ticket_sequence(uuid)'::regprocedure),
  1,'only the initial sequence creation still revokes privileges');
select ok((select prosrc like '%pg_catalog.pg_advisory_xact_lock(%'
  and prosrc like '%pg_catalog.to_regclass(%' and prosrc like '%create sequence private.%I as bigint start with %s%'
  and prosrc like '%from pg_catalog.pg_class relation%'
  and prosrc like '%where namespace.nspname=''private'' and relation.relname=v_name%'
  and prosrc like '%and relation.relkind = ''S''%'
  and prosrc not like '%setval%' and prosrc not like '%restart%'
  from pg_proc where oid='private.ensure_round_robin_ticket_sequence(uuid)'::regprocedure),
  'cold creation refreshes catalog after its lock while preserving type guard and ticket values');
select is((select md5(regexp_replace(prosrc,'\s','','g')) from pg_proc
  where oid='private.round_robin_ticket_sequence_name(uuid)'::regprocedure),
  '5cdc0b9758c195fb8bfc6c6213f4cb41','the deterministic sequence naming function is unchanged');
select ok(not exists(select 1 from pg_class sequence join pg_namespace namespace
  on namespace.oid=sequence.relnamespace cross join unnest(array['anon','authenticated','service_role']) role
  where namespace.nspname='private' and sequence.relkind='S'
    and sequence.relname ~ '^lead_distribution_ticket_[0-9a-f]{32}$'
    and has_sequence_privilege(role,sequence.oid,'USAGE,SELECT,UPDATE')),
  'existing ticket sequences expose no permissions to Data API roles');

select * from finish();
rollback;
