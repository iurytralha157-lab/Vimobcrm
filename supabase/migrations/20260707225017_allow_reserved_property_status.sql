update public.properties
set status = case lower(trim(status))
  when 'ativo' then 'active'
  when 'disponivel' then 'active'
  when 'available' then 'active'
  when 'reservado' then 'reserved'
  when 'vendido' then 'sold'
  when 'alugado' then 'rented'
  when 'locado' then 'rented'
  when 'inativo' then 'inactive'
  when 'arquivado' then 'archived'
  when 'rascunho' then 'draft'
  when 'privado' then 'draft'
  when 'private' then 'draft'
  else status
end
where status is not null
  and lower(trim(status)) in (
    'ativo',
    'disponivel',
    'available',
    'reservado',
    'vendido',
    'alugado',
    'locado',
    'inativo',
    'arquivado',
    'rascunho',
    'privado',
    'private'
  );

alter table public.properties
drop constraint if exists properties_status_check;

alter table public.properties
add constraint properties_status_check
check (status in ('draft', 'active', 'reserved', 'sold', 'rented', 'inactive', 'archived'));
