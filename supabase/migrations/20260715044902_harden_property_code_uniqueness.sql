-- Harden property code generation after prefix sequences were introduced.
-- The data repair keeps the oldest property for each code and moves later
-- duplicates to the next available number for the same prefix.

do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  if exists (
    with duplicate_rows as (
      select
        id,
        organization_id,
        code,
        row_number() over (
          partition by organization_id, lower(btrim(code))
          order by created_at asc, id asc
        ) as duplicate_order
      from public.properties
      where nullif(btrim(code), '') is not null
    )
    select 1
    from duplicate_rows
    where duplicate_order > 1
      and code !~ '^[A-Z]+[0-9]+$'
  ) then
    raise exception 'Cannot automatically repair non-standard duplicate property codes';
  end if;

  with duplicate_rows as (
    select
      p.id,
      p.organization_id,
      p.code,
      p.created_at,
      row_number() over (
        partition by p.organization_id, lower(btrim(p.code))
        order by p.created_at asc, p.id asc
      ) as duplicate_order
    from public.properties p
    where nullif(btrim(p.code), '') is not null
  ),
  extras as (
    select
      id,
      organization_id,
      code as old_code,
      (regexp_match(code, '^([A-Z]+)([0-9]+)$'))[1] as prefix,
      created_at
    from duplicate_rows
    where duplicate_order > 1
  ),
  max_by_prefix as (
    select
      e.organization_id,
      e.prefix,
      max((regexp_match(p.code, '^' || e.prefix || '([0-9]+)$'))[1]::integer) as max_existing_number
    from extras e
    join public.properties p
      on p.organization_id = e.organization_id
     and p.code ~ ('^' || e.prefix || '[0-9]+$')
    group by e.organization_id, e.prefix
  ),
  planned as (
    select
      e.id,
      e.prefix || lpad(
        (
          mbp.max_existing_number
          + row_number() over (
            partition by e.organization_id, e.prefix
            order by e.created_at asc, e.id asc
          )
        )::text,
        4,
        '0'
      ) as new_code
    from extras e
    join max_by_prefix mbp
      on mbp.organization_id = e.organization_id
     and mbp.prefix = e.prefix
  )
  update public.properties p
  set code = planned.new_code,
      updated_at = now()
  from planned
  where p.id = planned.id;
end $$;

with ranked_sequences as (
  select
    id,
    organization_id,
    upper(btrim(prefix)) as normalized_prefix,
    max(coalesce(last_number, 0)) over (
      partition by organization_id, upper(btrim(prefix))
    ) as max_last_number,
    row_number() over (
      partition by organization_id, upper(btrim(prefix))
      order by coalesce(last_number, 0) desc, created_at asc, id asc
    ) as row_order
  from public.property_sequences
  where nullif(btrim(prefix), '') is not null
),
keepers as (
  update public.property_sequences ps
  set prefix = ranked_sequences.normalized_prefix,
      last_number = ranked_sequences.max_last_number
  from ranked_sequences
  where ps.id = ranked_sequences.id
    and ranked_sequences.row_order = 1
  returning ps.id
),
deleted as (
  delete from public.property_sequences ps
  using ranked_sequences
  where ps.id = ranked_sequences.id
    and ranked_sequences.row_order > 1
  returning ps.id
)
select
  (select count(*) from keepers) as kept_sequences,
  (select count(*) from deleted) as deleted_duplicate_sequences;

with generated_prefixes(prefix) as (
  values ('AP'), ('CA'), ('CO'), ('GA'), ('TE'), ('SI'), ('FA'), ('IM')
),
catalog as (
  select
    p.organization_id,
    gp.prefix,
    max((regexp_match(p.code, '^' || gp.prefix || '([0-9]+)$'))[1]::bigint) as max_existing_number
  from public.properties p
  join generated_prefixes gp
    on p.code ~ ('^' || gp.prefix || '[0-9]+$')
  group by p.organization_id, gp.prefix
)
update public.property_sequences ps
set prefix = catalog.prefix,
    last_number = greatest(coalesce(ps.last_number, 0), catalog.max_existing_number)
from catalog
where ps.organization_id = catalog.organization_id
  and upper(btrim(ps.prefix)) = catalog.prefix;

with generated_prefixes(prefix) as (
  values ('AP'), ('CA'), ('CO'), ('GA'), ('TE'), ('SI'), ('FA'), ('IM')
),
catalog as (
  select
    p.organization_id,
    gp.prefix,
    max((regexp_match(p.code, '^' || gp.prefix || '([0-9]+)$'))[1]::bigint) as max_existing_number
  from public.properties p
  join generated_prefixes gp
    on p.code ~ ('^' || gp.prefix || '[0-9]+$')
  group by p.organization_id, gp.prefix
)
insert into public.property_sequences (organization_id, prefix, last_number)
select catalog.organization_id, catalog.prefix, catalog.max_existing_number
from catalog
where not exists (
  select 1
  from public.property_sequences ps
  where ps.organization_id = catalog.organization_id
    and upper(btrim(ps.prefix)) = catalog.prefix
);

create unique index if not exists idx_properties_org_code_unique
on public.properties (organization_id, lower(btrim(code)))
where nullif(btrim(code), '') is not null;

create unique index if not exists idx_property_sequences_org_prefix_unique
on public.property_sequences (organization_id, upper(btrim(prefix)))
where nullif(btrim(prefix), '') is not null;
