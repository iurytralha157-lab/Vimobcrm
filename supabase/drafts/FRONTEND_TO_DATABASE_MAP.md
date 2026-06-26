# Vimob CRM - Frontend to Database Map

Draft only. This map explains what the current frontend expects from Supabase and which SQL draft owns each area.

## Global Rules

- Every organization-owned table must include `organization_id`.
- RLS must prevent cross-organization access.
- Super Admin access is explicit and should not depend on `user_metadata`.
- Provider secrets must not be readable from the browser.
- Evolution, Meta, email dispatch, notification dispatch, AI agents and outbox delivery should run through backend/Edge Functions.
- `anon` access is only acceptable for public site/legal/help/public asset reads and public analytics inserts.

## Auth, Organization And Permissions

Routes:
- `/login`
- `/cadastro`
- `/select-organization`
- `/settings`

Draft:
- `20260621_001_security_helpers.sql`

Core tables:
- `organizations`
- `users`
- `organization_members`
- `organization_modules`
- `subscriptions`
- `legal_consents`
- `audit_logs`
- `admin_subscription_plans`
- `available_permissions`
- `organization_roles`
- `organization_role_permissions`
- `user_organization_roles`
- `user_roles` (global Super Admin compatibility only)
- `invitations`

RPC:
- `get_invitation_by_token`

Review focus:
- Keep role/permission decisions in DB, not user-editable metadata.
- Confirm default modules per plan: `crm`, `properties`, `whatsapp`, `agenda`, `site`, `automations`, `financial`, `gamification`.
- Decide if managers can manage all CRM records or only team-scoped records.
- Do not grant anonymous table reads for invitations; public invite lookup must stay token-scoped through RPC.

## Dashboard, CRM, Pipelines And Distribution

Routes:
- `/dashboard`
- `/crm/contacts`
- `/crm/pipelines`
- `/pipeline`
- `/crm/management`

Draft:
- `20260621_002_crm_core.sql`
- `20260621_008_frontend_rpc_compatibility.sql`

Tables:
- `pipelines`
- `stages`
- `tags`
- `leads`
- `lead_meta`
- `lead_tags`
- `lead_tasks`
- `activities`
- `lead_timeline_events`
- `lead_events`
- `lead_entry_events`
- `lead_attachments`
- `teams`
- `team_members`
- `team_pipelines`
- `member_availability`
- `round_robins`
- `round_robin_members`
- `round_robin_rules`
- `round_robin_logs`
- `assignments_log`
- `pipeline_sla_settings`
- `stage_operational_configs`
- `stage_automations`
- `cadence_templates`
- `cadence_tasks_template`

RPC:
- `list_contacts_paginated`
- `get_dashboard_stats`
- `get_funnel_data`
- `get_lead_sources_data`
- `get_dashboard_team_lead_ids`
- `count_unique_sessions`
- `create_default_stages_for_pipeline`
- `reorder_stages`
- `move_lead_stage`
- `transfer_lead_assignee`
- `register_lead_reentry`
- `redistribute_lead_round_robin`
- `handle_lead_intake`
- `user_has_permission`
- `is_team_leader`
- `get_user_led_team_ids`

RLS model:
- Organization members read organization configuration.
- Lead read is more restrictive: assigned user, owner/admin/manager or `lead_view_all`.
- Lead updates: assigned user, owner/admin/manager or `lead_manage`.
- Deletion: owner/admin only.
- Lead child tables inherit lead visibility for activities, tags, tasks, attachments and timeline.

Review focus:
- Validate whether team leaders should see all team leads or only assigned leads.
- Confirm whether `leads.property_id` should become a FK after properties are created.

## Properties And Public Site

Routes:
- `/properties`
- `/properties/new`
- `/properties/[id]/edit`
- `/properties/locations`
- `/properties/condominiums`
- `/properties/rentals`
- `/settings/site`

Drafts:
- `20260621_003_properties_public_site.sql`
- Existing migration `20260621120000_add_site_module_tables.sql`

Tables:
- `property_types`
- `property_sequences`
- `property_cities`
- `property_neighborhoods`
- `property_condominiums`
- `properties`
- `property_features`
- `property_proximities`
- `vista_integrations`
- `imoview_integrations`
- `organization_sites`
- `site_menu_items`
- `site_search_filters`
- `site_analytics_events`

RLS model:
- Public/anon can read only active published properties/site data.
- Public/anon property reads are column-limited and must not expose owner, commission, document or internal-comment fields.
- Organization members can read organization properties.
- Property managers/admins can create/update.
- Responsible user can update assigned properties.
- Delete remains owner/admin only.

Review focus:
- Vista/Imoview credentials should be secret references, not raw keys.
- Public site analytics insert is allowed, but read is authenticated/member only.
- Anonymous `organization_sites` reads are column-limited to presentation/SEO/contact fields. Raw script fields should stay authenticated unless explicitly approved.

## Communication, WhatsApp, Meta And Notifications

Routes:
- `/crm/conversas`
- `/settings?tab=whatsapp`
- `/settings/whatsapp/inbound-rules`
- `/settings/integrations/meta`
- `/notifications`

Draft:
- `20260621_004_communications_integrations.sql`
- `20260621_008_frontend_rpc_compatibility.sql`

Tables:
- `whatsapp_sessions`
- `whatsapp_session_access`
- `whatsapp_conversations`
- `whatsapp_messages`
- `whatsapp_groups`
- `whatsapp_labels`
- `whatsapp_chat_labels`
- `whatsapp_message_templates`
- `whatsapp_inbound_rules`
- `meta_integrations`
- `meta_integrations_public` (view without token/secret columns)
- `meta_form_configs`
- `meta_webhook_events`
- `meta_campaign_insights`
- `meta_conversations`
- `meta_messages`
- `webhooks_integrations`
- `google_calendar_tokens`
- `notifications`
- `push_tokens`

RLS model:
- Organization members can read communication records for their organization.
- Management requires owner/admin or communication/settings permission.
- Users can read/update their own notifications.
- Notifications are internal only; they do not send WhatsApp by themselves.

Backend-required:
- Evolution API secret.
- Meta tokens and webhook verification.
- Google OAuth tokens.
- Notification dispatcher.
- Outbound WhatsApp/outbox delivery.

RPC:
- `rebind_whatsapp_conversation_session`

Review focus:
- Current `webhooks_integrations.api_token` is frontend-compatible but sensitive. Prefer hashing/server-side generation before production.
- `meta_integrations_public` intentionally exposes only safe integration status/config; Meta access tokens stay in `meta_integrations.*_secret_ref` and backend/Edge Functions.
- WhatsApp media should use signed URLs, not public URLs.
- Database RPCs must not send WhatsApp messages automatically. External sends stay in backend/Evolution flow.

## Schedule And Financial

Routes:
- `/agenda`
- `/financeiro`
- `/financeiro/contas`
- `/financeiro/contratos`
- `/financeiro/contratos/[id]`
- `/financeiro/comissoes`
- `/financeiro/corretor`
- `/financeiro/dre`

Draft:
- `20260621_005_schedule_financial.sql`

Tables:
- `schedule_events`
- `schedule_event_assignees`
- `schedule_event_comments`
- `financial_categories`
- `contract_sequences`
- `contracts`
- `contract_brokers`
- `financial_entries`
- `commission_rules`
- `commissions`
- `dre_account_groups`
- `dre_account_mappings`

RPC:
- `get_schedule_events_secure`
- `copy_default_dre_groups`

RLS model:
- Agenda members can read visible events.
- Private agenda events require participant/admin/manager.
- Financial data requires `financial_manage` or owner/admin.
- Brokers can read their own commissions and related contracts.

Review focus:
- Confirm whether schedule "public busy" masking is acceptable via RPC while direct row select remains limited.
- Confirm broker visibility for contract details.

## Automations, Gamification, Support And Super Admin

Routes:
- `/automations`
- `/gamificacao`
- `/suporte`
- `/admin/*`
- `/settings?tab=api`

Draft:
- `20260621_006_automations_gamification_admin.sql`
- `20260621_008_frontend_rpc_compatibility.sql`

Tables:
- `automations`
- `automation_nodes`
- `automation_connections`
- `automation_templates`
- `automation_executions`
- `gamification_events`
- `gamification_missions`
- `user_gamification_stats`
- `setup_guide_progress`
- `announcements`
- `help_articles`
- `feature_requests`
- `onboarding_requests`
- `email_templates`
- `email_logs`
- `organization_api_keys`
- `password_change_events`
- `password_change_lockouts`
- Future backend-owned: `ai_agents`, `conversation_ai_state`, `events`, `jobs`, `outbox_messages`

RPC:
- `get_user_organization_role`
- `generate_organization_api_key`
- `admin_dashboard_overview`
- `admin_dashboard_timeseries`
- `admin_dashboard_pending_boards`
- `admin_dashboard_feed`
- `admin_list_organizations`
- `get_database_stats_admin`
- `list_all_organizations_admin`
- `list_all_users_admin`
- `find_orphan_team_members`
- `find_orphan_rr_members`
- `cleanup_orphan_members`

RLS model:
- Automations read by organization members; management by owner/admin or `automations_edit`.
- Gamification read by organization members; management by owner/admin or `gamification_manage`.
- Support requests are own-user read/write; Super Admin can answer.
- Admin tables are Super Admin scoped.
- API keys store only hash plus prefix; full key returned once by RPC.

Review focus:
- Finalize Super Admin metric RPCs after the schema is approved.
- Decide how much AI/outbox belongs in Supabase versus Go backend.

## Storage

Draft:
- `20260621_007_storage_buckets.sql`

Buckets:
- Public: `avatars`, `logos`, `properties`, `site-images`
- Private: `whatsapp-media`, `automation-media`, `contract-documents`

Review focus:
- Normalize site image paths to include `organization_id`.
- Replace public URL usage for WhatsApp/private media with signed URLs.
- Confirm property images are intentionally public for public site/listings.
- Frontend `.storage.from(...)` references to `avatars`, `logos`, `whatsapp-media`, `automation-media` and `contract-documents` are covered here, not as SQL tables.

## Excluded From Core

- Telecom and obras are not mapped as core.
- `telephony_calls` should remain out of this base schema unless intentionally reintroduced as an optional module.
