# Dashboard RLS release — 2026-09-26

The production database received
`supabase/migrations/20260926232717_restrict_assigned_lead_reads_to_active_assignee_team.sql`
through a single guarded transaction. The normalized migration SHA-256 is
`80642021c4e530bdd4425a12009e071c8073a56fbb31d5e0110a37dd4de8695b`.
The migration was committed and read back from a fresh connection.

The database does not contain a `supabase_migrations` schema or migration
ledger. Do not run `supabase db push` or `migration repair` to represent this
application. This record documents the direct application; a later migration
workflow must reconcile the existing database state before using a ledger.

## Verification

- The isolated PostgreSQL fixture applied the migration and passed all 30
  pgTAP assertions for active assignee teams, attachments, global grants,
  inactive memberships, administrators and brokers.
- Production readback confirmed the new unassigned-only recorded-team guard,
  removal of the three legacy global-read clauses, and unchanged function
  owner, grants and policies.
- Read-only authenticated RLS queries in Vetter returned 125 leads for the
  administrator, 5 for the test leader and 1 for the test broker.
- The same Vetter sessions returned matching totals from Dashboard, Contacts,
  sales funnel and Pipeline: 125/125/125/125, 5/5/5/5 and 1/1/1/1.

The complete local historical migration chain stops at the earlier
`20260921115616_add_silent_historical_lead_import.sql` fixture because its
trigger precondition is not present in a fresh database. This release
migration was tested with its required preceding schema in isolation.
