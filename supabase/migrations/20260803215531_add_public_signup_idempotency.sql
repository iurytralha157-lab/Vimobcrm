alter table public.organizations
    add column if not exists signup_attempt_id uuid,
    add column if not exists signup_attempt_email text,
    add column if not exists signup_requires_payment boolean;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'organizations_signup_attempt_fields_check'
          and conrelid = 'public.organizations'::regclass
    ) then
        alter table public.organizations
            add constraint organizations_signup_attempt_fields_check
            check (
                (signup_attempt_id is null and signup_attempt_email is null and signup_requires_payment is null)
                or
                (
                    signup_attempt_id is not null
                    and signup_attempt_email is not null
                    and btrim(signup_attempt_email) <> ''
                    and signup_attempt_email = lower(btrim(signup_attempt_email))
                    and signup_requires_payment is not null
                )
            ) not valid;
    end if;
end
$$;

alter table public.organizations
    validate constraint organizations_signup_attempt_fields_check;

create unique index if not exists organizations_signup_attempt_id_unique
    on public.organizations (signup_attempt_id)
    where signup_attempt_id is not null;

comment on column public.organizations.signup_attempt_id is
    'Client-generated UUID that makes public organization signup idempotent.';

comment on column public.organizations.signup_attempt_email is
    'Normalized signup email bound to signup_attempt_id to prevent cross-email replay.';

comment on column public.organizations.signup_requires_payment is
    'Authoritative original signup outcome used to replay the same redirect safely.';
