-- A provider hint cannot turn two different phone numbers into one contact.
-- Keep the established capture/binding/epoch implementation; patch only the
-- validation boundary. No historic rows, aliases, messages or routes are moved.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function private.whatsapp_contact_pn_reference(p_values text[])
returns text language sql immutable set search_path = ''
as $$
  select regexp_replace(split_part(split_part(lower(btrim(value)), '@', 1), ':', 1), '[^0-9]', '', 'g')
  from unnest(coalesce(p_values, '{}'::text[])) with ordinality as supplied(value,ordinal)
  where split_part(lower(btrim(value)), '@', 2) in ('s.whatsapp.net','c.us')
    and length(regexp_replace(split_part(split_part(value, '@', 1), ':', 1), '[^0-9]', '', 'g')) between 8 and 15
  order by ordinal limit 1;
$$;
revoke all on function private.whatsapp_contact_pn_reference(text[])
from public, anon, authenticated, service_role;

create or replace function private.whatsapp_contact_pns_conflict(p_values text[])
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  v_raw text;
  v_phone text;
  v_key text;
  v_reference_phone text;
begin
  -- A provider's explicit PN disambiguates its identical bare-digit hint,
  -- including NANP numbers whose length also resembles a Brazilian local PN.
  foreach v_raw in array coalesce(p_values, '{}'::text[]) loop
    v_raw := lower(btrim(coalesce(v_raw, '')));
    if strpos(v_raw, '@') > 0 and split_part(v_raw, '@', 2) in ('s.whatsapp.net', 'c.us') then
      v_reference_phone := regexp_replace(split_part(split_part(v_raw, '@', 1), ':', 1), '[^0-9]', '', 'g');
      if length(v_reference_phone) between 8 and 15 then exit; end if;
      v_reference_phone := null;
    end if;
  end loop;
  foreach v_raw in array coalesce(p_values, '{}'::text[]) loop
    v_raw := lower(btrim(coalesce(v_raw, '')));
    if strpos(v_raw, '@') > 0 then
      if split_part(v_raw, '@', 2) not in ('s.whatsapp.net', 'c.us') then
        continue;
      end if;
      v_phone := regexp_replace(split_part(split_part(v_raw, '@', 1), ':', 1), '[^0-9]', '', 'g');
    else
      v_phone := case when v_raw not like '+%' and v_raw not like '00%'
        and regexp_replace(v_raw, '[^0-9]', '', 'g') = v_reference_phone then v_reference_phone
        else public.normalize_phone(v_raw) end;
    end if;
    if coalesce(length(v_phone), 0) not between 8 and 15 then
      continue;
    end if;
    if left(v_phone, 2) = '55' and length(v_phone) = 13 and substring(v_phone, 5, 1) = '9' then
      v_phone := left(v_phone, 4) || substring(v_phone, 6);
    end if;
    if v_key is not null and v_key <> v_phone then
      return true;
    end if;
    v_key := v_phone;
  end loop;
  return false;
end;
$$;
revoke all on function private.whatsapp_contact_pns_conflict(text[])
from public, anon, authenticated, service_role;

create or replace function private.guard_whatsapp_contact_identity_pn()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if private.whatsapp_contact_pns_conflict(array[new.alias_jid, new.canonical_jid]) then
    raise exception using errcode = '23514', message = 'whatsapp_contact_pn_conflict';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_whatsapp_contact_identity_pn()
from public, anon, authenticated, service_role;
create or replace trigger guard_whatsapp_contact_identity_pn_before_write
before insert or update of alias_jid, canonical_jid
on public.whatsapp_contact_identity_aliases
for each row execute function private.guard_whatsapp_contact_identity_pn();

do $guard_capture_pn$
declare
  v_target regprocedure := 'private.capture_whatsapp_webhook_routing_snapshot_v2(uuid,uuid,text,text,text,text,boolean,text[],text,text,text,boolean,boolean,boolean,uuid,uuid,uuid,integer)'::regprocedure;
  v_body text;
  v_definition text;
  v_old text := '  if v_provider_message_id is null';
  v_new text := '  if private.whatsapp_contact_pns_conflict(coalesce(p_identity_aliases, ''{}''::text[]) ||
       array[case when nullif(p_contact_phone, '''') is not null then ''+'' || p_contact_phone end]) then
    raise exception using errcode = ''23514'', message = ''whatsapp_contact_pn_conflict'';
  end if;
  if v_provider_message_id is null';
  v_old_route text := E'    else\n      select binding.*';
  v_new_route text := '    else
      if private.whatsapp_contact_pns_conflict(array[v_primary_alias, v_conversation.remote_jid]) then
        raise exception using errcode = ''23514'', message = ''whatsapp_contact_pn_conflict'';
      end if;
      select binding.*';
  v_old_phone text := 'v_phone_key text := coalesce(public.normalize_phone(p_contact_phone), '''');';
  v_new_phone text := 'v_phone_key text := coalesce(private.whatsapp_contact_pn_reference(p_identity_aliases), public.normalize_phone(p_contact_phone), '''');';
begin
  select replace(proc.prosrc, E'\r\n', E'\n'), replace(pg_catalog.pg_get_functiondef(v_target), E'\r\n', E'\n')
  into v_body, v_definition from pg_catalog.pg_proc proc where proc.oid = v_target;
  if strpos(v_body, v_new) > 0 and strpos(v_body, v_new_route) > 0 then
    -- Idempotence still validates the entire patched canonical body below.
    v_body := replace(replace(replace(v_body, v_new, v_old), v_new_route, v_old_route),v_new_phone,v_old_phone);
  end if;
  if md5(v_body) not in ('c83cd66e37361bfa2188d6317cedfbd8', 'd1b2853f3158baaa6d3714426ea22bdc')
     or (length(v_body)-length(replace(v_body,v_old,'')))/length(v_old) <> 1
     or (length(v_body)-length(replace(v_body,v_old_route,'')))/length(v_old_route) <> 1 then
    raise exception using errcode = '55000', message = 'whatsapp_capture_pn_barrier_source_drift';
  end if;
  if strpos(v_definition, v_new) = 0 then
    if (length(v_body)-length(replace(v_body,v_old_phone,'')))/length(v_old_phone) <> 1 then
      raise exception using errcode='55000',message='whatsapp_capture_pn_reference_source_drift';
    end if;
    execute replace(replace(replace(v_definition, v_old, v_new), v_old_route, v_new_route),v_old_phone,v_new_phone);
  end if;
end;
$guard_capture_pn$;

commit;
