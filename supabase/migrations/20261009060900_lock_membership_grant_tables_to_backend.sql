-- A removed member's grants are cleared on removal and reinvite. Keep grant
-- writes behind the API so a browser cannot recreate them after that cleanup.
-- Reads retain their existing ACL and RLS behavior.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

revoke insert, update, delete, truncate
on table public.user_organization_roles, public.user_permission_overrides
from public, anon, authenticated;

-- PostgreSQL can authorize column-level INSERT/UPDATE independently of table
-- privileges. Remove any such legacy grants as well, without touching the
-- explicit service_role grants or the tables' SELECT privileges.
do $migration$
declare
  target_relation regclass;
  target_column name;
begin
  for target_relation in
    select relation_name
    from (values
      ('public.user_organization_roles'::regclass),
      ('public.user_permission_overrides'::regclass)
    ) as target(relation_name)
  loop
    for target_column in
      select attribute.attname
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = target_relation
        and attribute.attnum > 0
        and not attribute.attisdropped
        and attribute.attacl is not null
    loop
      execute pg_catalog.format(
        'revoke insert (%I), update (%I) on table %s from public, anon, authenticated',
        target_column, target_column, target_relation
      );
    end loop;
  end loop;
end;
$migration$;

commit;
