-- Signup attempt identifiers are recovery capabilities, not organization
-- profile data. A tenant member must not be able to replay another signup and
-- recover its hidden checkout capability through the idempotency endpoint.

revoke select (
  signup_attempt_id,
  signup_attempt_email
) on table public.organizations from PUBLIC, anon, authenticated;

comment on column public.organizations.signup_attempt_id is
  'Service-only public-signup idempotency capability; never expose to browser roles.';
comment on column public.organizations.signup_attempt_email is
  'Service-only public-signup recovery proof; never expose to browser roles.';
