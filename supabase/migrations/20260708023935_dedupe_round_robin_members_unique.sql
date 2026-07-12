-- Keep the round-robin member contract aligned with the backend:
-- one active membership row per queue/user pair.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'round_robin_members'
      and column_name = 'leads_count'
  ) then
    execute $sql$
      with ranked_members as (
        select
          id,
          row_number() over (
            partition by round_robin_id, user_id
            order by is_active desc, created_at desc, id desc
          ) as row_rank,
          sum(coalesce(leads_count, 0)) over (
            partition by round_robin_id, user_id
          ) as merged_leads_count
        from public.round_robin_members
        where round_robin_id is not null
          and user_id is not null
      )
      update public.round_robin_members member
      set leads_count = ranked_members.merged_leads_count
      from ranked_members
      where member.id = ranked_members.id
        and ranked_members.row_rank = 1
    $sql$;
  end if;
end
$$;

with ranked_members as (
  select
    id,
    row_number() over (
      partition by round_robin_id, user_id
      order by is_active desc, created_at desc, id desc
    ) as row_rank,
    min(position) over (
      partition by round_robin_id, user_id
    ) as merged_position
  from public.round_robin_members
  where round_robin_id is not null
    and user_id is not null
),
updated_keepers as (
  update public.round_robin_members member
     set position = ranked_members.merged_position
    from ranked_members
   where member.id = ranked_members.id
     and ranked_members.row_rank = 1
  returning member.id
)
delete from public.round_robin_members member
using ranked_members
where member.id = ranked_members.id
  and ranked_members.row_rank > 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'round_robin_members_unique'
      and conrelid = 'public.round_robin_members'::regclass
  ) then
    alter table public.round_robin_members
      add constraint round_robin_members_unique unique (round_robin_id, user_id);
  end if;
end $$;
