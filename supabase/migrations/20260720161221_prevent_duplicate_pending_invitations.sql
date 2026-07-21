-- Pending invitations are single-use per organization and normalized e-mail.
-- Clean invalid historical rows before adding the concurrency guard.

delete from public.invitations
where used_at is null
  and expires_at <= now();

delete from public.invitations as invitation
using public.users as app_user
where invitation.used_at is null
  and invitation.email is not null
  and lower(btrim(app_user.email)) = lower(btrim(invitation.email))
  and (
    app_user.organization_id = invitation.organization_id
    or exists (
      select 1
      from public.organization_members as membership
      where membership.user_id = app_user.id
        and membership.organization_id = invitation.organization_id
    )
  );

with ranked_pending as (
  select
    id,
    row_number() over (
      partition by organization_id, lower(btrim(email))
      order by created_at desc, id desc
    ) as duplicate_position
  from public.invitations
  where used_at is null
    and email is not null
    and btrim(email) <> ''
)
delete from public.invitations as invitation
using ranked_pending
where invitation.id = ranked_pending.id
  and ranked_pending.duplicate_position > 1;

create unique index if not exists invitations_pending_org_email_uidx
  on public.invitations (organization_id, lower(btrim(email)))
  where used_at is null
    and email is not null
    and btrim(email) <> '';
