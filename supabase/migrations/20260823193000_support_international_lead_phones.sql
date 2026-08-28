begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Preserve explicit international prefixes when deriving the tenant-scoped
-- lead identity. Brazilian local numbers remain backwards compatible.
create or replace function public.normalize_phone(phone_input text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  raw_input text;
  cleaned text;
begin
  raw_input := btrim(phone_input);
  if phone_input is null or raw_input = '' then
    return null;
  end if;

  cleaned := regexp_replace(raw_input, '[^0-9]', '', 'g');
  if cleaned = '' then
    return null;
  end if;

  -- E.164 entered with "+" must not be reinterpreted as a Brazilian local
  -- number merely because its total length happens to be 10 or 11 digits.
  if raw_input ~ '^\+' then
    return cleaned;
  end if;

  -- Accept the standard international dial-out prefix as an alias for "+".
  if raw_input ~ '^00' then
    cleaned := substring(cleaned from 3);
    return nullif(cleaned, '');
  end if;

  -- Keep the historical Brazilian storage formats compatible.
  if length(cleaned) > 11 and substring(cleaned, 1, 2) = '55' then
    return cleaned;
  end if;

  if length(cleaned) between 10 and 11 then
    return '55' || cleaned;
  end if;

  return cleaned;
end;
$$;

comment on function public.normalize_phone(text) is
  'Normalizes lead/contact phones for matching: explicit +/00 is international; unprefixed 10/11 digit values default to Brazil.';

-- Replacing an immutable function does not rewrite existing expression-index
-- entries. Fail closed if the corrected identity reveals pre-existing
-- duplicates, then rebuild the index in the same migration transaction.
do $$
begin
  if exists (
    select 1
    from public.leads as lead
    where lead.phone is not null
      and btrim(lead.phone) <> ''
      and public.normalize_phone(lead.phone) is not null
      and public.normalize_phone(lead.phone) <> ''
    group by lead.organization_id, public.normalize_phone(lead.phone)
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'international phone normalization found duplicate lead identities; reconcile them before retrying this migration';
  end if;
end;
$$;

drop index if exists public.leads_org_phone_unique;

create unique index leads_org_phone_unique
  on public.leads using btree (
    organization_id,
    public.normalize_phone(phone)
  )
  where phone is not null
    and btrim(phone) <> ''
    and public.normalize_phone(phone) is not null
    and public.normalize_phone(phone) <> '';

commit;
