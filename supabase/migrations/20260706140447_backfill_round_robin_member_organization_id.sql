update public.round_robin_members rrm
set organization_id = rr.organization_id,
    updated_at = now()
from public.round_robins rr
where rr.id = rrm.round_robin_id
  and rrm.organization_id is distinct from rr.organization_id;

alter table public.round_robin_members
  alter column organization_id set not null;
