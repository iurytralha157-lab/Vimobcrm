begin;
set local lock_timeout='5s';
set local statement_timeout='5min';

-- Stored only by authenticated server admission. It is an identity pin, never
-- a client-supplied timestamp or an ordering authority between sessions.
alter table public.push_tokens add column registration_sid uuid;
comment on column public.push_tokens.registration_sid is
  'Verified JWT session_id that registered the device. A different session cannot deactivate this binding; no chronological ordering is inferred from SID.';

-- Match the existing sender's fallback for legacy endpoint-less native/web
-- tokens. This derives a physical device key, not a user or tenant identity.
create function private.push_device_endpoint_key(p_endpoint text,p_platform text,p_token text)
returns text language sql immutable parallel safe set search_path = ''
as $$
  select case when lower(btrim(coalesce(p_platform,''))) in ('android','ios')
    and nullif(btrim(p_token),'') is not null then 'native:'||btrim(p_token)
    when btrim(coalesce(p_endpoint,'')) like 'native:%' then
      'native:'||coalesce(nullif(btrim(p_token),''),substring(btrim(p_endpoint) from '^native:[^:]+:(.*)$'))
    else coalesce(nullif(btrim(p_endpoint),''),nullif(btrim(p_token),'')) end;
$$;
revoke all on function private.push_device_endpoint_key(text,text,text) from public,anon,authenticated;
grant execute on function private.push_device_endpoint_key(text,text,text) to service_role;

-- Report duplicate groups by count only. Do not guess a device owner or disable
-- existing production tokens during migration. Deployment requires review.
do $$ declare v_duplicates integer; begin
  select count(*) into v_duplicates from (
    select private.push_device_endpoint_key(endpoint,platform,token) from public.push_tokens
    where is_active is true and private.push_device_endpoint_key(endpoint,platform,token) is not null
    group by private.push_device_endpoint_key(endpoint,platform,token) having count(*)>1
  ) duplicate_groups;
  if v_duplicates>0 then
    raise exception using message='push_device_duplicate_active_endpoints',
      detail='Duplicate groups: '||v_duplicates::text||'. Review ownership before migration; no tokens were modified.';
  end if;
end; $$;
create unique index push_tokens_one_active_endpoint_idx
  on public.push_tokens(private.push_device_endpoint_key(endpoint,platform,token))
  where is_active is true and private.push_device_endpoint_key(endpoint,platform,token) is not null;

commit;
