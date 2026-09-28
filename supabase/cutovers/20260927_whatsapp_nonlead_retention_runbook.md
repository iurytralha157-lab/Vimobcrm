# WhatsApp nonlead retention: guarded cutover

This is a local proposal. No migration, deletion, or cron activation from this
package has been applied to production by this work. On 2026-09-28 at 02:12 UTC,
the PostgreSQL host had 125 GB free on `/` (57% used). Read-only database checks
found no WhatsApp named cron job, and `public.cleanup_whatsapp_retention()` was
already an inert wrapper; the private cleanup, its indexes, and DELETE guard were
still absent. Those observations can change and must be repeated before cutover.

## What the first cutover can expire

The new bounded function deletes only old QR/connection inbox controls whose
**exact event name and entire JSON payload** pass
`private.whatsapp_legacy_is_nonlead_control` and the independent stricter
`private.whatsapp_nonlead_retention_payload_safe` envelope check. Unknown
`text`, `body`, `phone`, `from`, `to`, nested fields, and unrecognized state
shapes fail closed. It skips every row in
`private.whatsapp_webhook_legacy_routing_freeze`, whether still pending or
already terminalized. Processed and dead controls wait seven days after both
creation and terminal state; stale pending QR controls keep the prior two-minute
window. Every call removes at most 500 rows from each of these three classes.

It does not delete canonical `whatsapp_messages`, `whatsapp_outbox`, receipts,
message-shaped inbox events, `media_jobs`, Storage objects, or lead history.
The old `public.cleanup_whatsapp_retention()` entry point is redefined as an
inert compatibility wrapper. An existing `whatsapp-retention-daily` cron may
still call it every five minutes after the migration commits; those calls delete nothing,
including `media_jobs` and `meta_webhook_events`. Only the private cleanup can
delete proven controls after an explicit manual canary or cron activation.

The source migrations are:

1. `20260927_prepare_whatsapp_nonlead_retention_indexes.sql` builds two narrow
   inbox indexes concurrently in an **autocommit** SQL client before migrations.
   It must not run inside `BEGIN` or a migration transaction. The subsequent
   `20260927223239_whatsapp_nonlead_retention_guard.sql` migration verifies
   index structure and readiness. Its in-transaction fallback is allowed only
   on completely empty local databases. This phase does not index
   `whatsapp_messages`: canonical deletion is HOLD, so its write cost has no
   current cleanup benefit. The production volume was 96% full on 2026-09-27,
   then measured 57% used with 125 GB free after a storage relocation on
   2026-09-28. Do not run either index build until the operator measures enough
   free space for the index build, temporary
   files, WAL growth, and ongoing ingress, with a margin for failed builds.
2. `20260927223519_whatsapp_nonlead_retention_function.sql` installs the bounded
   private function and makes the public legacy wrapper inert. Installation
   deletes no rows and creates no cron job. A legacy cron execution that begins
   before this migration commits can still run the old definition; pause that
   job and wait for any running invocation to finish before applying migrations.
3. `20260927231221_whatsapp_inbox_terminal_delete_guard.sql` installs a
   `BEFORE DELETE` guard on inbox rows. An older API binary with its broad
   expiry query will fail the whole unsafe batch instead of deleting lead or
   receipt evidence. The updated API stops deleting inbox rows and leaves
   control retention to the private function. Stop every old API cleanup
   process before starting this ordered migration sequence; the guard comes
   after its classifier and function dependencies, so there is an installation
   window before it exists. Resume with the updated API only after trigger and
   privilege readback. The guard then protects against a stale instance or
   manual DELETE under ordinary API privileges.

Before the migration sequence, unschedule or deactivate the old
`whatsapp-retention-daily` job and verify no active invocation remains in
`cron.job_run_details`. The wrapper remains inert afterward as defense against
an old scheduler configuration returning. The installed order is freeze, the `20260927204508` classifier, the
`20260927223239` index verification migration, the `20260927223519` bounded
function, the separate `20260927223657` v1 claim migration, and the
`20260927231221` DELETE guard. The v1 claim index does not replace either
retention index or classifier.
The prepared cron cutover is
`20260927_activate_whatsapp_nonlead_control_retention.sql` and is intentionally
separate from migrations.

## Operator sequence after migration validation

1. Check actual free space and WAL growth on the database host, active index
   builds, lock/ingress health, and capacity for autovacuum. The 2026-09-28
   125 GB free observation is historical; remeasure before index construction,
   DELETE canary, and cron activation. A successful DELETE may
   leave the relation/TOAST files allocated; it is not a disk-recovery plan.
2. Verify migration order, both inbox indexes `indisvalid=true` and
   `indisready=true`, the installed function, the enabled DELETE guard, and
   `service_role_can_truncate=false`. The baseline granted `ALL` on inbox to
   `service_role`; the guard migration revokes its `TRUNCATE` privilege because
   a row-level DELETE trigger cannot intercept TRUNCATE.
3. Run `20260927_whatsapp_nonlead_retention_preview.sql` read-only. Its sample
   counts are not total backlog counts. Any timeout or mismatched function/
   index is HOLD.
4. Run one manual transaction with
   `select * from private.cleanup_whatsapp_nonlead_control_retention(10);`
   after approval. This can delete up to ten per class. Read back per-status
   counts and confirm frozen-row count and message/receipt counts did not move.
5. If the canary and database load are acceptable, verify the legacy
   `whatsapp-retention-daily` job is still inactive. Then run the separate
   activation cutover as `postgres`. It refuses an active legacy job, drifted
   existing job, invalid indexes, or missing EXECUTE permission. It schedules
   only `private.cleanup_whatsapp_nonlead_control_retention(500)` every five
   minutes and reads back the exact active job.
6. Monitor `cron.job_run_details`, duration, failures, WAL volume, autovacuum,
   table/index bloat, inbox claim latency, and new-message p95 while the first
   backlog drains. At the theoretical ceiling, 500 rows every five minutes is
   144,000 rows/day **per class**. Locks, proof rejection, and execution time
   lower actual throughput. Pause the exact job with `cron.unschedule` if
   ingress latency or database health worsens.

The user explicitly waived a backup for this scoped control cleanup. Backup
absence is therefore not an absolute blocker for this cutover. The waiver does
not prove reversibility: an eligible DELETE is irreversible. The classification,
host capacity/WAL, transactional PostgreSQL fixture, migration/index preflight,
read-only preview, bounded canary, and post-delete readback remain mandatory
gates. This release has not applied the canary or cron in production. Do not
set `restore_point_verified=true` in the separate legacy frozen-row cutover to
simulate a backup; its current apply scripts still require a real restore
point and need a separately reviewed waiver path if ever run without one.

The inbox trigger accepts only proven stale pending/retry QR or seven-day-old
processed/dead QR/connection controls. It rejects processing rows, message
and receipt payloads, unknown shapes, and frozen rows. `service_role` can bypass
RLS but cannot bypass an enabled trigger in ordinary SQL, and the migration
removes its direct `TRUNCATE` privilege. The `postgres` table owner, a role
able to disable triggers or change `session_replication_role`, or a privileged
table rewrite remains outside this guard. An API role allowed to rewrite an
unfrozen row's event type/payload before DELETE can also alter the proof seen
by the guard; this migration protects the old broad DELETE path, not a
compromised write credential. Deployment/readback must confirm the trigger is
enabled and API roles have no TRUNCATE grant. Explicit organization
or session deletion uses its existing FK cascade and can remove related lead
data; a nested inbox DELETE bypasses this guard only when the parent
organization or session is already gone. This is not a general protection
against deliberate tenant/session deletion. The transactional fixture checks
that an unrelated nested trigger cannot bypass while parents still exist.

## Why canonical nonlead-message deletion is still HOLD

`whatsapp_messages.lead_id IS NULL` is not proof of a nonlead message. The
historical `capture_state IS NULL` rows were visible before the attendance
gate, and a conversation or lead may since have been unlinked or deleted.
Current conversation state and the post-2026-09-19 binding ledger cannot prove
that older rows never belonged to a lead. The read-only
`20260927_whatsapp_suppressed_message_retention_audit.sql` classifies at most
500 seven-day-old `capture_state='suppressed'` rows into HOLD reasons without
returning PII. Suppressed rows are already inserted with text and media fields
redacted by the native intake, but still keep provider identity for deduplication.
Because this phase deliberately adds no index to the hot `whatsapp_messages`
table, inspect `EXPLAIN` and database load before running that optional audit
against a large production table; its ten-second timeout means timeout is HOLD.

Deleting even a proven leadless suppressed row would remove the
`(session_id,message_id)` uniqueness evidence. A late provider retry could
then reinsert it under a newer lead or attendance epoch. A safe future cleanup
requires all of the following in one reviewed release:

1. A private immutable tombstone keyed by exact tenant, session, and provider
   message ID. It records the original suppression decision and survives the
   seven-day payload deletion for the full supported replay horizon. Reuse the
   established route/advisory lock and make insertion of the tombstone and
   deletion of the canonical row atomic.
2. Native and Edge message, receipt, and reaction ingress must consult the
   tombstone before any insert, relink, media queue, or lead side effect. A
   tombstone hit must finish as an idempotent terminal outcome and never
   resurrect the old message under another tenant/lead. Test same-phone,
   different-queue, lead rebind, and historical replay paths.
3. A deletion candidate must have positive `capture_state='suppressed'`
   provenance, no lead on the message or conversation, no binding/attendance/
   route-head history, exact org/session/conversation agreement, completed
   routing outcome, no unfinished inbox or outbox work, and no references from
   media jobs, reactions, lead attachments, AI outbox, or avatar jobs. Unknown
   provenance or any query timeout is HOLD.
4. Media remains HOLD until a backend Storage API deletion job removes and
   verifies the object before deleting its DB pointer. SQL deletion alone can
   orphan private Storage objects. Existing suppressed rows should have null
   content/media, but the cleanup must still check this per row.
5. Processed message/receipt inbox payloads need exact provider-ID
   reconciliation to a durable canonical outcome or tombstone before their
   seven-day expiry. Frozen rows retain their separate freeze contract.

Until that release, the seven-day guarantee applies only to proven nonlead
control payloads. Full nonlead-message and receipt retention is not complete.

## Local verification on 2026-09-27

An isolated PostgreSQL 17 container ran the classifier SQL test with valid
legacy/v1 QR and connection envelopes plus negative `text`, `body`, `phone`,
`from`, `to`, nonempty routing messages, wrong version, wrong route, and unknown
keys. All 14 cases matched. On a populated two-tenant fixture, the index
migration refused to build before the autocommit cutover; the two concurrent
indexes then built and passed migration readback. The bounded cleanup removed
one stale QR, two processed controls, and one dead control. It preserved the
frozen row in one tenant, the lead-shaped payload, the nonempty v1 message
envelope, and the receipt. A second cleanup call removed zero rows. This tests
the SQL contract on a minimal schema, not the full production data distribution
or `pg_cron` execution.

`supabase/tests/whatsapp_nonlead_retention_delete_guard.test.sql` persists a
rollback-only two-tenant fixture for the installed trigger and cleanup. It
tests safe QR/connection expiration, lead-shaped and receipt preservation,
frozen preservation, pending/processing protection, nested DELETE rejection,
and idempotent second execution. Run it with `psql -v ON_ERROR_STOP=1 -f` on
an isolated, fully migrated test database; it ends with `ROLLBACK`. The same
fixture passed against the actual four retention SQL files on a minimal
PostgreSQL 17 schema. A post-rollback query found zero synthetic inbox rows.
This smoke did not execute all 157 application migrations or `pg_cron`. A
separate isolated PostgreSQL 17 role check confirmed that the baseline
`GRANT ALL` gives `service_role` TRUNCATE, while the new `REVOKE TRUNCATE`
removes it and preserves DELETE permission. The full transactional fixture
must be rerun against the final migration set before a production canary.
