create or replace function public.create_commission_on_won()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commission_percentage numeric;
  v_commission_amount numeric;
  v_property_commission numeric;
  v_org_commission numeric;
begin
  if new.deal_status = 'won'
     and old.deal_status is distinct from 'won'
     and coalesce(new.valor_interesse, 0) > 0 then

    if new.assigned_user_id is not null
       and not exists (
         select 1
         from public.commissions
         where organization_id = new.organization_id
           and lead_id = new.id
       ) then
      select commission_percentage
      into v_property_commission
      from public.properties
      where organization_id = new.organization_id
        and id = new.property_id;

      select default_commission_percentage
      into v_org_commission
      from public.organizations
      where id = new.organization_id;

      v_commission_percentage := coalesce(
        nullif(new.commission_percentage, 0),
        nullif(v_property_commission, 0),
        nullif(v_org_commission, 0),
        5.0
      );
      v_commission_amount := new.valor_interesse * (v_commission_percentage / 100);

      insert into public.commissions (
        organization_id,
        lead_id,
        user_id,
        property_id,
        base_value,
        amount,
        percentage,
        status,
        notes
      ) values (
        new.organization_id,
        new.id,
        new.assigned_user_id,
        new.property_id,
        new.valor_interesse,
        v_commission_amount,
        v_commission_percentage,
        'forecast',
        'Comissao gerada automaticamente'
      );
    end if;

    if not exists (
      select 1
      from public.financial_entries
      where organization_id = new.organization_id
        and lead_id = new.id
        and type = 'receivable'
    ) then
      insert into public.financial_entries (
        organization_id,
        lead_id,
        type,
        amount,
        due_date,
        status,
        description
      ) values (
        new.organization_id,
        new.id,
        'receivable',
        new.valor_interesse,
        (current_date + interval '30 days')::date,
        'pending',
        'Venda - ' || new.name
      );
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.create_commission_on_won() from public, anon, authenticated;
