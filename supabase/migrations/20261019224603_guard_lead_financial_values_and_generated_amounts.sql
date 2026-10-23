-- Validate Pipeline financial inputs without making unrelated edits depend on
-- cleaning legacy rows. This is a local forward migration, never a data repair.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create temporary table pg_temp.lead_financial_function_acl on commit drop as
select proowner, proacl from pg_catalog.pg_proc
where oid=pg_catalog.to_regprocedure('public.create_commission_on_won()');

do $preflight$
begin
  if (select count(*) from pg_temp.lead_financial_function_acl) <> 1
     -- Do not silently replace a customized or independently fixed producer.
     -- This is the normalized prosrc of the canonical baseline function.
     or not exists (
       select 1 from pg_catalog.pg_proc
       where oid=pg_catalog.to_regprocedure('public.create_commission_on_won()')
         and prosecdef and proconfig=array['search_path=public']::text[]
         and pg_catalog.has_schema_privilege(proowner,'private','USAGE')
         and pg_catalog.md5(pg_catalog.replace(prosrc,E'\r\n',E'\n'))='55788e7e117d4c071b23e2bc82ea9479'
     )
     or pg_catalog.to_regprocedure('private.lead_financial_number_is_valid(numeric,boolean)') is not null
     or pg_catalog.to_regprocedure('private.guard_lead_financial_values()') is not null
     or exists (select 1 from pg_catalog.pg_trigger
                where tgrelid='public.leads'::regclass and tgname='zzzz_guard_lead_financial_values')
     or not exists (
       select 1 from pg_catalog.pg_trigger
       where tgrelid='public.leads'::regclass and tgname='trigger_create_commission_on_won'
         and tgfoid='public.create_commission_on_won()'::regprocedure
         and not tgisinternal and tgenabled in ('O','A')
         and tgtype=17
         and pg_catalog.regexp_replace(pg_catalog.pg_get_triggerdef(oid),
           '^.* FOR EACH ROW WHEN (.*) EXECUTE FUNCTION .*$',E'\\1')=
           '(((NOT private.historical_import_effects_suppressed()) AND (new.operational_effects_suppressed = false) AND (new.deal_status = ''won''::text) AND (old.deal_status IS DISTINCT FROM ''won''::text)))'
     )
     or exists (
       select 1 from (values
         ('public.leads','valor_interesse','numeric'),
         ('public.leads','commission_percentage','numeric'),
         ('public.commissions','amount','numeric(12,2)'),
         ('public.commissions','percentage','numeric(5,2)'),
         ('public.financial_entries','amount','numeric(12,2)')
       ) expected(relation_name,column_name,type_name)
       where not exists (
         select 1 from pg_catalog.pg_attribute attribute
         where attribute.attrelid=pg_catalog.to_regclass(expected.relation_name)
           and attribute.attname=expected.column_name and not attribute.attisdropped
           and pg_catalog.format_type(attribute.atttypid,attribute.atttypmod)=expected.type_name
       )
     ) then
    raise exception using errcode='55000', message='lead_financial_contract_preflight_failed';
  end if;
end;
$preflight$;

-- SQL numeric accepts NaN/Infinity, and a simple >=0 check accepts NaN.
-- Match finite float64 transport support without imposing a business price cap.
-- A nonzero decimal that becomes zero in float64 is rejected, not changed to 0.
create function private.lead_financial_number_is_valid(p_value numeric,p_percentage boolean)
returns boolean language plpgsql immutable set search_path = '' as $function$
declare v_float double precision;
begin
  if p_value is null then return true; end if;
  if p_value < 0 or p_value >= 'Infinity'::numeric
     or (p_percentage and p_value > 100) then return false; end if;
  begin
    v_float := p_value::double precision;
  exception when numeric_value_out_of_range then
    return false;
  end;
  return v_float < 'Infinity'::double precision
     and (p_value = 0 or v_float <> 0);
end;
$function$;
revoke all on function private.lead_financial_number_is_valid(numeric,boolean)
  from public,anon,authenticated,service_role;

create function private.guard_lead_financial_values()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare check_value boolean; check_percentage boolean;
begin
  if tg_op='INSERT' then
    check_value := true;
    check_percentage := true;
  else
    check_value := new.valor_interesse is distinct from old.valor_interesse
      or (new.deal_status='won' and old.deal_status is distinct from 'won');
    check_percentage := new.commission_percentage is distinct from old.commission_percentage
      or (new.deal_status='won' and old.deal_status is distinct from 'won');
  end if;
  if (check_value and not private.lead_financial_number_is_valid(new.valor_interesse,false))
     or (check_percentage and not private.lead_financial_number_is_valid(new.commission_percentage,true)) then
    raise exception using errcode='23514', constraint='lead_financial_values_contract',
      message='lead_financial_values_invalid';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_lead_financial_values()
  from public,anon,authenticated,service_role;

-- Replacing a function keeps its existing owner and ACL. New private helpers
-- have that same owner so the existing definer can call them without a new
-- browser/service_role EXECUTE grant.
do $ownership$
declare owner_name name;
begin
  select role.rolname into strict owner_name from pg_catalog.pg_roles role
  join pg_temp.lead_financial_function_acl snapshot on snapshot.proowner=role.oid;
  execute pg_catalog.format('alter function private.lead_financial_number_is_valid(numeric,boolean) owner to %I',owner_name);
  execute pg_catalog.format('alter function private.guard_lead_financial_values() owner to %I',owner_name);
end;
$ownership$;

create trigger zzzz_guard_lead_financial_values
before insert or update on public.leads
for each row execute function private.guard_lead_financial_values();

create or replace function public.create_commission_on_won() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_commission_percentage numeric;
  v_commission_amount numeric;
  v_property_commission numeric;
  v_org_commission numeric;
begin
  -- Recheck the effective NEW row after every BEFORE trigger has run. Only a
  -- real win transition is checked here; ordinary legacy edits stay unaffected.
  if new.deal_status='won' and old.deal_status is distinct from 'won'
     and (not private.lead_financial_number_is_valid(new.valor_interesse,false)
          or not private.lead_financial_number_is_valid(new.commission_percentage,true)) then
    raise exception using errcode='23514', constraint='lead_financial_values_contract',
      message='lead_financial_values_invalid';
  end if;
  if new.deal_status = 'won'
     and old.deal_status is distinct from 'won'
     and coalesce(new.valor_interesse, 0) > 0 then

    if new.assigned_user_id is not null
       and not exists (
         select 1 from public.commissions
         where organization_id = new.organization_id and lead_id = new.id
       ) then
      select commission_percentage into v_property_commission
      from public.properties
      where organization_id = new.organization_id and id = new.property_id;

      select default_commission_percentage into v_org_commission
      from public.organizations where id = new.organization_id;

      -- Zero remains the existing fallback sentinel, including the default 5.
      v_commission_percentage := coalesce(
        nullif(new.commission_percentage, 0),
        nullif(v_property_commission, 0),
        nullif(v_org_commission, 0),
        5.0
      );
      if not private.lead_financial_number_is_valid(v_commission_percentage,true) then
        raise exception using errcode='23514', constraint='lead_financial_values_contract',
          message='lead_financial_values_invalid';
      end if;
      v_commission_amount := new.valor_interesse * (v_commission_percentage / 100);
      -- Check the same numeric expression INSERT will round to numeric(12,2).
      if v_commission_amount < 0 or v_commission_amount >= 'Infinity'::numeric
         or pg_catalog.round(v_commission_amount,2) >= 10000000000 then
        raise exception using errcode='23514', constraint='lead_financial_generated_amount_contract',
          message='lead_financial_generated_amount_invalid';
      end if;
      insert into public.commissions (
        organization_id, lead_id, user_id, property_id,
        base_value, amount, percentage, status, notes
      ) values (
        new.organization_id, new.id, new.assigned_user_id, new.property_id,
        new.valor_interesse, v_commission_amount, v_commission_percentage,
        'forecast', 'Comissao gerada automaticamente'
      );
    end if;

    if not exists (
      select 1 from public.financial_entries
      where organization_id = new.organization_id and lead_id = new.id and type = 'receivable'
    ) then
      if new.valor_interesse < 0 or new.valor_interesse >= 'Infinity'::numeric
         or pg_catalog.round(new.valor_interesse,2) >= 10000000000 then
        raise exception using errcode='23514', constraint='lead_financial_generated_amount_contract',
          message='lead_financial_generated_amount_invalid';
      end if;
      insert into public.financial_entries (
        organization_id, lead_id, type, amount, due_date, status, description
      ) values (
        new.organization_id, new.id, 'receivable', new.valor_interesse,
        (current_date + interval '30 days')::date, 'pending', 'Venda - ' || new.name
      );
    end if;
  end if;
  return new;
end;
$function$;

do $postflight$
begin
  if not exists (
    select 1 from pg_catalog.pg_proc current_function
    join pg_temp.lead_financial_function_acl snapshot
      on current_function.proowner=snapshot.proowner and current_function.proacl is not distinct from snapshot.proacl
    where current_function.oid='public.create_commission_on_won()'::regprocedure
      and current_function.prosecdef and current_function.proconfig=array['search_path=public']::text[]
  ) or exists (
    select 1 from (values('anon'),('authenticated'),('service_role')) caller(role_name)
    cross join (values('private.lead_financial_number_is_valid(numeric,boolean)'),
                     ('private.guard_lead_financial_values()')) helper(signature)
    where pg_catalog.has_function_privilege(caller.role_name,helper.signature,'EXECUTE')
  ) then
    raise exception using errcode='55000', message='lead_financial_contract_postflight_failed';
  end if;
end;
$postflight$;
commit;
