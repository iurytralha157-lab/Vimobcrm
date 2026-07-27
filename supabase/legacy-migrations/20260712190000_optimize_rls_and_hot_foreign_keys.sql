-- Cache auth lookups as init plans instead of evaluating them once per row.
-- ALTER POLICY preserves command, roles and permissive/restrictive behavior.
do $optimize_auth_policy_calls$
declare
  policy_row record;
  optimized_using text;
  optimized_check text;
  statement text;
begin
  for policy_row in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
  loop
    optimized_using := policy_row.qual;
    optimized_check := policy_row.with_check;

    if optimized_using is not null then
      optimized_using := replace(optimized_using, 'auth.uid()', '(select auth.uid())');
      optimized_using := replace(optimized_using, 'auth.role()', '(select auth.role())');
      optimized_using := replace(
        optimized_using,
        'current_setting(''request.jwt.claim.role''::text, true)',
        '(select current_setting(''request.jwt.claim.role''::text, true))'
      );
      optimized_using := replace(
        optimized_using,
        'current_setting(''request.jwt.claims''::text, true)',
        '(select current_setting(''request.jwt.claims''::text, true))'
      );
    end if;

    if optimized_check is not null then
      optimized_check := replace(optimized_check, 'auth.uid()', '(select auth.uid())');
      optimized_check := replace(optimized_check, 'auth.role()', '(select auth.role())');
      optimized_check := replace(
        optimized_check,
        'current_setting(''request.jwt.claim.role''::text, true)',
        '(select current_setting(''request.jwt.claim.role''::text, true))'
      );
      optimized_check := replace(
        optimized_check,
        'current_setting(''request.jwt.claims''::text, true)',
        '(select current_setting(''request.jwt.claims''::text, true))'
      );
    end if;

    if optimized_using is not distinct from policy_row.qual
       and optimized_check is not distinct from policy_row.with_check then
      continue;
    end if;

    statement := format(
      'alter policy %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );

    if optimized_using is not null then
      statement := statement || format(' using (%s)', optimized_using);
    end if;
    if optimized_check is not null then
      statement := statement || format(' with check (%s)', optimized_check);
    end if;

    execute statement;
  end loop;
end;
$optimize_auth_policy_calls$;

-- Cover foreign keys used by the highest-volume CRM workflows. Several are
-- ordered to also serve history/list queries, not only referential checks.
do $hot_foreign_key_indexes$
declare
  index_row record;
begin
  for index_row in
    select ddl
    from (values
      ('create index if not exists idx_activities_user_id on public.activities(user_id)'),
      ('create index if not exists idx_audit_logs_org_created on public.audit_logs(organization_id, created_at desc)'),
      ('create index if not exists idx_audit_logs_user_created on public.audit_logs(user_id, created_at desc)'),
      ('create index if not exists idx_lead_timeline_org_event on public.lead_timeline_events(organization_id, event_at desc)'),
      ('create index if not exists idx_lead_timeline_user_event on public.lead_timeline_events(user_id, event_at desc)'),
      ('create index if not exists idx_leads_created_by on public.leads(created_by) where created_by is not null'),
      ('create index if not exists idx_leads_first_touch_actor_user on public.leads(first_touch_actor_user_id) where first_touch_actor_user_id is not null'),
      ('create index if not exists idx_leads_owner_last_activity_user on public.leads(owner_last_activity_user_id) where owner_last_activity_user_id is not null'),
      ('create index if not exists idx_leads_property on public.leads(property_id) where property_id is not null'),
      ('create index if not exists idx_lead_entry_events_pipeline on public.lead_entry_events(pipeline_id) where pipeline_id is not null'),
      ('create index if not exists idx_lead_entry_events_stage on public.lead_entry_events(stage_id) where stage_id is not null'),
      ('create index if not exists idx_lead_entry_events_property on public.lead_entry_events(property_id) where property_id is not null'),
      ('create index if not exists idx_notifications_lead on public.notifications(lead_id) where lead_id is not null'),
      ('create index if not exists idx_whatsapp_conversations_assigned_user on public.whatsapp_conversations(assigned_user_id) where assigned_user_id is not null'),
      ('create index if not exists idx_schedule_event_assignees_org on public.schedule_event_assignees(organization_id)'),
      ('create index if not exists idx_schedule_events_lead on public.schedule_events(lead_id) where lead_id is not null'),
      ('create index if not exists idx_schedule_events_property on public.schedule_events(property_id) where property_id is not null'),
      ('create index if not exists idx_schedule_events_user on public.schedule_events(user_id) where user_id is not null'),
      ('create index if not exists idx_automation_executions_lead on public.automation_executions(lead_id) where lead_id is not null'),
      ('create index if not exists idx_lead_stage_history_lead on public.lead_stage_history(lead_id)'),
      ('create index if not exists idx_lead_assignment_history_lead on public.lead_assignment_history(lead_id)'),
      ('create index if not exists idx_round_robin_logs_assigned_user on public.round_robin_logs(assigned_user_id) where assigned_user_id is not null'),
      ('create index if not exists idx_round_robin_members_team on public.round_robin_members(team_id) where team_id is not null'),
      ('create index if not exists idx_round_robin_members_user on public.round_robin_members(user_id) where user_id is not null'),
      ('create index if not exists idx_outbox_messages_conversation on public.outbox_messages(conversation_id) where conversation_id is not null'),
      ('create index if not exists idx_outbox_messages_org on public.outbox_messages(organization_id)')
    ) as indexes(ddl)
  loop
    begin
      execute index_row.ddl;
    exception
      when undefined_table or undefined_column then
        raise notice 'Skipping unavailable local index target: %', index_row.ddl;
    end;
  end loop;
end;
$hot_foreign_key_indexes$;

-- Remove only byte-for-byte duplicate indexes that do not back constraints.
drop index if exists public.idx_activities_lead_id;
drop index if exists public.idx_gamification_participants_org;
drop index if exists public.gamification_participants_org_user_key;
drop index if exists public.idx_member_availability_member_day;
drop index if exists public.idx_team_members_user;
drop index if exists public.telecom_customers_org_external_id_idx;
drop index if exists public.idx_conv_lead;
drop index if exists public.idx_whatsapp_sessions_org;
