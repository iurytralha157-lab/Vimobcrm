begin;

create extension if not exists pgtap with schema extensions;
select plan(2);

select has_index(
  'public',
  'whatsapp_sessions',
  'whatsapp_sessions_one_notification_sender_per_org_idx',
  'notification sender uniqueness guard exists'
);

select ok(
  (
    select i.indisunique
       and pg_get_expr(i.indpred, i.indrelid) = '(is_notification_session = true)'
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    join pg_class tbl on tbl.oid = i.indrelid
    join pg_namespace ns on ns.oid = tbl.relnamespace
    where ns.nspname = 'public'
      and tbl.relname = 'whatsapp_sessions'
      and idx.relname = 'whatsapp_sessions_one_notification_sender_per_org_idx'
  ),
  'guard is unique and applies only to flagged notification sessions'
);

select * from finish();
rollback;
