-- P0: reduce timeout pressure from PostgREST fallback reads during launch ramp.

create index if not exists idx_whatsapp_conversations_session_visible_recent
  on public.whatsapp_conversations (session_id, last_message_at desc nulls last, created_at desc, id desc)
  where deleted_at is null and archived_at is null;

create index if not exists idx_whatsapp_sessions_owner_provider_org_active
  on public.whatsapp_sessions (owner_user_id, provider, organization_id, id)
  where coalesce(is_active, true) = true
    and coalesce(status, '') <> 'deleted';

create index if not exists idx_leads_org_pipeline_stage_entered_desc
  on public.leads (organization_id, pipeline_id, stage_id, stage_entered_at desc nulls last, created_at desc, id desc);

create index if not exists idx_leads_org_pipeline_stage_assignee_entered_desc
  on public.leads (organization_id, pipeline_id, stage_id, assigned_user_id, stage_entered_at desc nulls last, created_at desc, id desc)
  where assigned_user_id is not null;

create index if not exists idx_lead_tags_lead_org
  on public.lead_tags (lead_id, organization_id);

create index if not exists idx_lead_tasks_lead_org_done
  on public.lead_tasks (lead_id, organization_id, is_done);

create index if not exists idx_activities_org_created_desc
  on public.activities (organization_id, created_at desc, id desc)
  where organization_id is not null;

create index if not exists idx_activities_lead_created_desc
  on public.activities (lead_id, created_at desc, id desc)
  where lead_id is not null;

alter policy "whatsapp_conversations_select_owner_only"
  on public.whatsapp_conversations
  using (
    deleted_at is null
    and session_id is not null
    and exists (
      select 1
      from public.whatsapp_sessions ws
      where ws.id = whatsapp_conversations.session_id
        and ws.organization_id = whatsapp_conversations.organization_id
        and coalesce(ws.is_active, true) = true
        and coalesce(ws.status, '') <> 'deleted'
        and ws.provider = 'evolution_go'
        and ws.owner_user_id = (select auth.uid())
        and (
          exists (
            select 1
            from public.users u
            where u.id = (select auth.uid())
              and u.organization_id = ws.organization_id
              and coalesce(u.is_active, true) = true
          )
          or exists (
            select 1
            from public.organization_members om
            where om.organization_id = ws.organization_id
              and om.user_id = (select auth.uid())
              and om.is_active = true
          )
        )
    )
  );

analyze public.whatsapp_conversations;
analyze public.whatsapp_messages;
analyze public.whatsapp_sessions;
analyze public.leads;
analyze public.lead_tags;
analyze public.lead_meta;
analyze public.lead_tasks;
analyze public.activities;
