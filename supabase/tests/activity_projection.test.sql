-- Runs only in the exclusive synthetic PostgreSQL owned by the activity runner.
create function fixture.denied(query text,label text) returns void language plpgsql as $$
begin
  begin
    execute query;
  exception when insufficient_privilege then
    raise notice 'PASS: %',label;
    return;
  end;
  raise exception 'FAIL: % (statement unexpectedly succeeded)',label;
end $$;

set role authenticated;
do $$
declare actor integer;
begin
  foreach actor in array array[1,2,4,5] loop
    perform fixture.actor(actor);
    perform fixture.denied('select content from public.activities','content denied for actor '||actor);
    perform fixture.denied('select metadata from public.activities','metadata denied for actor '||actor);
    perform fixture.denied('select * from public.activities','wildcard denied for actor '||actor);
    perform fixture.denied('select row_to_json(a) from public.activities a','row_to_json denied for actor '||actor);
    perform fixture.denied('select to_jsonb(a) from public.activities a','whole-row to_jsonb denied for actor '||actor);
  end loop;
end $$;
select fixture.actor(1);
select fixture.check((select count(id)=3 from public.activities), 'safe user projection preserves own, no-lead and legacy-null-tenant rows');
select fixture.check(not exists(select id from public.activities where id=fixture.id(213)), 'safe projection remains isolated from second tenant');
select fixture.check(not exists(select id from public.activities where id=fixture.id(215)), 'safe projection preserves private pool ceiling');
select fixture.denied('select id from public.activities where content is not null', 'content predicates cannot probe restricted fields');
select fixture.denied('select id from public.activities where metadata->>''commission_percentage''=''7.5''', 'metadata predicates cannot probe restricted fields');
select fixture.denied('select id from public.activities order by metadata->>''property_price''', 'metadata ordering cannot probe restricted fields');
select fixture.denied('update public.activities set content=''blocked'' where id=fixture.id(211) returning content', 'UPDATE RETURNING content is denied');
select fixture.denied('update public.activities set content=''blocked'' where id=fixture.id(211) returning metadata', 'UPDATE RETURNING metadata is denied');
select fixture.denied('update public.activities set content=''blocked'' where id=fixture.id(211) returning *', 'UPDATE RETURNING wildcard is denied');
with changed as (update public.activities set content='safe-returning-update' where id=fixture.id(211) returning id,lead_id)
select fixture.check((select count(*)=1 from changed), 'authorized UPDATE with safe RETURNING still succeeds');
with changed as (update public.activities set content='forbidden' where id=fixture.id(212) returning id)
select fixture.check((select count(*)=0 from changed), 'safe UPDATE remains limited by lead RLS');
with created as (insert into public.activities(id,organization_id,lead_id,user_id,type,content,metadata)
  values(fixture.id(299),fixture.id(1001),fixture.id(11),fixture.id(1),'note','synthetic insert','{}') returning id)
select fixture.check((select count(*)=1 from created), 'authorized INSERT with safe RETURNING still succeeds');
with removed as (delete from public.activities where id=fixture.id(299) returning id)
select fixture.check((select count(*)=1 from removed), 'authorized DELETE with safe RETURNING still succeeds');

select fixture.actor(2);
select fixture.check(exists(select id from public.activities where id=fixture.id(212)), 'leader keeps team invalidation identifiers');
select fixture.check(not exists(select id from public.activities where id=fixture.id(211)), 'leader cannot see unrelated broker identifiers');
select fixture.actor(4);
select fixture.check((select count(id)=8 from public.activities), 'admin keeps all authorized organization identifiers');
select fixture.check(not exists(select id from public.activities where id=fixture.id(233)), 'admin cannot cross mismatched parent tenant');
select fixture.actor(5);
select fixture.check((select count(id)=2 from public.activities), 'second organization keeps only its identifiers');
select fixture.actor(1,'recovery');
select fixture.check(not exists(select id from public.activities), 'recovery session cannot read safe identifiers');
select fixture.actor(1);
reset role;
delete from auth.sessions where user_id=fixture.id(1);
set role authenticated;
select fixture.check(not exists(select id from public.activities), 'revoked session cannot read safe identifiers');
reset role;
set role anon;
select fixture.denied('select id from public.activities','anonymous role cannot read even identifiers');
select fixture.denied('select content,metadata from public.activities','anonymous role cannot read sensitive columns');
reset role;
set role service_role;
select fixture.check((select count(*)=11 from public.activities), 'server role retains complete activity reads');
select fixture.check((select metadata->>'commission_percentage'='7.5' and content='safe-returning-update'
  from public.activities where id=fixture.id(211)), 'server role retains raw fields needed for canonical projection');
reset role;
select fixture.check((select array_agg(attname::text order by attname) =
  array['created_at','id','lead_id','organization_id','type','user_id']
  from pg_attribute where attrelid='public.activities'::regclass and attnum>0 and not attisdropped
    and has_column_privilege('authenticated',attrelid,attnum,'SELECT')),
  'only the explicit invalidation projection is granted to authenticated');
select fixture.check(not has_table_privilege('authenticated','public.activities','SELECT'), 'table SELECT does not override column restrictions');
