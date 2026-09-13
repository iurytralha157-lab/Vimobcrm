-- Organization membership mutations carry role, activation and deletion
-- semantics that are enforced by the authenticated Go API. RLS remains a
-- second line of defense for reads, but clients must not bypass the API's
-- hierarchy and lifecycle guards through the Data API.
--
-- Keep tenant-filtered reads for legacy consumers. Backend roles retain their
-- existing privileges because they are intentionally not mentioned here.
revoke all privileges on table public.organization_members from public, anon, authenticated;

grant select on table public.organization_members to anon, authenticated;
