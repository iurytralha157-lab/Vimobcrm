# Supabase Security Advisor exceptions

## `0014_extension_in_public`: `pg_net`

- Status: accepted false positive
- Reviewed: 2026-07-19
- Project: `iemalzlfnbouobyjwlwi`
- Installed version: `0.19.5`

The extension registry reports `pg_net` with `extnamespace = public`, but the
extension does not create callable objects in `public`. The production audit
found all 15 extension member objects in its dedicated `net` schema:

- 12 functions in `net`
- 2 tables in `net`
- 1 sequence in `net`
- 0 extension member objects in `public`

`pg_net` declares itself non-relocatable in both `pg_extension` and
`pg_available_extension_versions`. This matches the Supabase installation
contract: the extension creates and uses its own `net` schema.

Do not run any of the following solely to silence this advisor finding:

- `alter extension pg_net set schema ...`
- direct updates to `pg_extension`
- `drop extension pg_net cascade`

The first operation is unsupported for this version, direct catalog updates
would make future extension upgrades unsafe, and dropping with `cascade` can
remove dependent automation/webhook objects. At review time the database had
one active `pg_net` worker, no queued requests, five active cron jobs using
`net.http_*`, and one application automation function referencing
`net.http_post`.

Revisit this exception only if Supabase makes `pg_net` relocatable, changes its
installation contract, or provides a supported maintenance procedure for
changing the extension registry namespace without moving the `net` objects.

## `0008_rls_enabled_no_policy`: backend-only tables

- Status: intentional default deny
- Reviewed: 2026-07-20
- Project: `iemalzlfnbouobyjwlwi`
- Enforcement migrations: `20260720002516_harden_default_deny_tables.sql`,
  `20260720011830_harden_public_site_tracking_and_lead_intake.sql`

The Advisor reports an informational notice when RLS is enabled without a
policy. For the tables below this is intentional: they are queues, outboxes,
credential stores, internal state, audit/incident data, or backend-owned
catalogs. PostgreSQL denies every client row when no applicable policy exists.
The enforcement migration also revokes every table privilege from `anon` and
`authenticated`, so protection does not depend on RLS alone.

- `automation_circuit_breakers`
- `automation_effect_dispatches`
- `automation_event_outbox`
- `automation_execution_steps`
- `automation_flow_versions`
- `automation_message_dispatches`
- `automation_schedule_state`
- `chatbot_conversation_state`
- `chatbot_inbound_messages`
- `conversation_ai_state`
- `edge_rate_limits`
- `error_events`
- `events`
- `gamification_activity_logs`
- `gamification_outbox`
- `imoview_integrations`
- `incident_20260701_pool_redistribution_backup`
- `jobs`
- `media_jobs`
- `meta_oauth_flows`
- `organization_api_keys`
- `outbox_messages`
- `property_feature_catalog`
- `property_proximity_catalog`
- `site_lead_submissions`
- `subscription_logs`
- `telephony_calls`
- `user_mission_progress`
- `user_permission_overrides`
- `vista_integrations`
- `whatsapp_contact_identity_aliases`
- `whatsapp_message_reactions`
- `whatsapp_outbox`
- `whatsapp_webhook_inbox`

Do not add a `using (false)` policy merely to silence the notice. Such a policy
does not strengthen the current deny-all behavior and would add maintenance
noise. Revisit an entry only when a browser client needs direct access; that
change must include an organization-scoped policy, minimal grants, and a pgTAP
cross-tenant test.
