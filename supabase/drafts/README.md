# Vimob CRM database draft

These files are review drafts only. Do not run them in Supabase before a manual review.

Current objective:

- map the frontend route/page needs into Supabase tables, storage buckets, RPCs and RLS;
- keep organization isolation as the default security rule;
- keep sensitive integrations behind backend/Edge Functions whenever possible;
- avoid optional/legacy modules becoming part of the core schema.

Review order:

1. `20260621_001_security_helpers.sql`
2. `20260621_002_crm_core.sql`
3. `20260621_003_properties_public_site.sql`
4. `20260621_004_communications_integrations.sql`
5. `20260621_005_schedule_financial.sql`
6. `20260621_006_automations_gamification_admin.sql`
7. `20260621_007_storage_buckets.sql`
8. `20260621_008_frontend_rpc_compatibility.sql`

The last file intentionally contains compatibility RPCs for the current frontend. It should not be used to send Evolution, Meta, Resend or other external-provider actions directly from Postgres.

Static frontend scan status:

- Current frontend RPC calls are covered by the draft SQL files.
- Current frontend table/view calls are covered, except storage bucket names detected through `.from(...)`.
- Bucket names such as `avatars`, `logos`, `whatsapp-media`, `automation-media` and `contract-documents` are handled by `20260621_007_storage_buckets.sql`, not as Postgres tables.
- `telephony_calls` is intentionally excluded because Telecom is not part of the core schema.

Important Supabase note for new projects:

- New tables may not be exposed to the Data API by default.
- Every table intended for `supabase-js` must have explicit `grant` statements and RLS enabled.
- Sensitive server-only tables should not be granted to `anon` or `authenticated`.
