begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

select has_table(
  'private',
  'realtime_events',
  'durable realtime cursor log is kept in the private schema'
);

select is(
  (select relrowsecurity from pg_class where oid = 'private.realtime_events'::regclass),
  true,
  'durable realtime log keeps RLS as defense in depth'
);

select has_column('private', 'realtime_events', 'id', 'realtime event has a global cursor');
select has_column('private', 'realtime_events', 'organization_id', 'realtime event is tenant scoped');
select has_column('private', 'realtime_events', 'user_id', 'realtime event records its actor or public target');
select has_column('private', 'realtime_events', 'audience_user_id', 'target audience is separate from actor');
select has_column('private', 'realtime_events', 'event_type', 'realtime event has a bounded type');
select has_column('private', 'realtime_events', 'data', 'realtime event has a compact invalidation payload');
select has_column('private', 'realtime_events', 'created_at', 'realtime event has a retention timestamp');

select has_index(
  'private',
  'realtime_events',
  'realtime_events_organization_cursor_idx',
  'tenant replay uses a cursor index'
);

select has_index(
  'private',
  'realtime_events',
  'realtime_events_created_at_brin_idx',
  'retention pruning uses a compact created-at index'
);

select is(
  has_table_privilege('anon', 'private.realtime_events', 'select'),
  false,
  'anonymous clients cannot read the durable event log'
);

select is(
  has_table_privilege('authenticated', 'private.realtime_events', 'select'),
  false,
  'authenticated clients cannot read the durable event log directly'
);

select is(
  has_table_privilege('service_role', 'private.realtime_events', 'select'),
  false,
  'the Data API service role cannot bypass the authorized replay endpoint'
);

insert into public.organizations (id, name, subscription_status)
values (
  'c1000000-0000-4000-8000-000000000001',
  'Durable Realtime Test',
  'active'
);

insert into private.realtime_events (
  organization_id,
  user_id,
  audience_user_id,
  event_type,
  data
)
values (
  'c1000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000002',
  'access.permissions.changed',
  '{"targetUserId":"c2000000-0000-4000-8000-000000000002"}'::jsonb
);

select is(
  (
    select event_type
    from private.realtime_events
    where organization_id = 'c1000000-0000-4000-8000-000000000001'
  ),
  'access.permissions.changed',
  'backend can append a durable invalidation event'
);

select is(
  (
    select audience_user_id
    from private.realtime_events
    where organization_id = 'c1000000-0000-4000-8000-000000000001'
  ),
  'c2000000-0000-4000-8000-000000000002'::uuid,
  'durable replay retains explicit user audience'
);

select * from finish();
rollback;
