-- Cover every Google Agenda foreign-key path used during tenant/user cleanup.

create index if not exists google_calendar_tokens_user_fk_idx
  on public.google_calendar_tokens(user_id);

create index if not exists google_calendar_event_links_org_fk_idx
  on public.google_calendar_event_links(organization_id);

create index if not exists google_calendar_channels_org_fk_idx
  on public.google_calendar_channels(organization_id);

create index if not exists google_calendar_sync_jobs_org_fk_idx
  on public.google_calendar_sync_jobs(organization_id);

create index if not exists google_calendar_sync_jobs_event_fk_idx
  on public.google_calendar_sync_jobs(schedule_event_id)
  where schedule_event_id is not null;

create index if not exists google_calendar_sync_jobs_created_by_fk_idx
  on public.google_calendar_sync_jobs(created_by)
  where created_by is not null;

create index if not exists google_calendar_oauth_states_org_fk_idx
  on public.google_calendar_oauth_states(organization_id);

create index if not exists google_calendar_oauth_states_user_fk_idx
  on public.google_calendar_oauth_states(user_id);
