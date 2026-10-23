package stageconfig

import (
	"os"
	"regexp"
	"strings"
)

// Execute the real normalized notification producer and current forward-only
// patches, rather than infer external delivery from absence of metadata alone.
// Unrelated provider handlers/claims/workers are never installed or started.
func installInactivityNotificationHooks(f inactivityPostgresFixture) {
	tx, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rollbackInactivityTransaction(tx)
	f.seedTx = tx
	normalized := inactivityFixtureSource(f, "20260905093544_normalize_notification_delivery_outbox.sql")
	waiting := inactivityFixtureSource(f, "20261012053044_whatsapp_inbound_push_preflight_order.sql")
	device := inactivityFixtureSource(f, "20261012223833_push_device_user_owned_delivery_scope.sql")
	distribution := inactivityFixtureSource(f, "20260903045350_refine_managed_whatsapp_reentry_and_queue_tags.sql")
	f.exec(`create schema extensions; create extension pgcrypto with schema extensions;
 create table public.push_tokens(id uuid primary key,organization_id uuid,user_id uuid,is_active boolean default true)`)
	f.exec(inactivityFixtureSpan(f, normalized, "create table if not exists private.notification_deliveries", "create unique index if not exists notification_delivery_attempts_number_uidx"))
	for _, name := range []string{
		"notification_safe_integer", "notification_safe_timestamptz", "notification_dispatch_required",
		"notification_delivery_expected_message_id", "notification_delivery_idempotency_key", "notification_delivery_expiry",
		"materialize_notification_deliveries", "sync_notification_deliveries_from_notification",
	} {
		f.exec(inactivityFixtureFunction(f, normalized, name))
	}
	f.exec(inactivityFixtureSpan(f, waiting, "create table private.whatsapp_inbound_push_waiting (", "create index whatsapp_inbound_push_waiting_due_idx"))
	f.exec(inactivityFixtureFunction(f, waiting, "register_whatsapp_inbound_push_waiting"))
	const materializePatchStart = "select replace(pg_catalog.pg_get_functiondef('private.materialize_notification_deliveries(uuid,boolean)'::regprocedure)"
	for _, patch := range []string{
		inactivityFixtureSpan(f, waiting, materializePatchStart, "select replace(pg_catalog.pg_get_functiondef('private.create_whatsapp_inbound_attendant_notification"),
		inactivityFixtureSpan(f, device, materializePatchStart, "select replace(pg_catalog.pg_get_functiondef('private.claim_notification_deliveries"),
	} {
		f.exec("do $fixture_patch$ declare v_definition text; v_old text; v_new text; begin " + patch + " end; $fixture_patch$;")
	}
	f.exec(inactivityFixtureFunction(f, distribution, "scope_distribution_notification_dedupe"))
	f.exec(`create trigger sync_notification_deliveries_from_notification
 after insert or update of metadata,user_id,organization_id on public.notifications
 for each row execute function private.sync_notification_deliveries_from_notification();
 create trigger trg_scope_distribution_notification_dedupe before insert on public.notifications
 for each row execute function private.scope_distribution_notification_dedupe()`)
	if err := tx.Commit(f.ctx); err != nil {
		f.t.Fatal(err)
	}
}

func inactivityFixtureSource(f inactivityPostgresFixture, filename string) string {
	f.t.Helper()
	source, err := os.ReadFile("../../../../supabase/migrations/" + filename)
	if err != nil {
		f.t.Fatal(err)
	}
	return strings.ReplaceAll(string(source), "\r\n", "\n")
}

func inactivityFixtureSpan(f inactivityPostgresFixture, source, start, end string) string {
	f.t.Helper()
	begin := strings.Index(source, start)
	if begin < 0 {
		f.t.Fatalf("notification fixture source drift: missing %q", start)
	}
	finish := strings.Index(source[begin:], end)
	if finish < 0 {
		f.t.Fatalf("notification fixture source drift: missing %q", end)
	}
	return source[begin : begin+finish]
}

func inactivityFixtureFunction(f inactivityPostgresFixture, source, name string) string {
	f.t.Helper()
	pattern := regexp.MustCompile(`(?is)create or replace function private\.` + regexp.QuoteMeta(name) + `\b[\s\S]*?as\s+(\$[a-zA-Z0-9_]*\$)`)
	match := pattern.FindStringSubmatchIndex(source)
	if match == nil {
		f.t.Fatalf("notification fixture source drift: missing function %q", name)
	}
	tag := source[match[2]:match[3]]
	finish := strings.Index(source[match[1]:], tag+";")
	if finish < 0 {
		f.t.Fatalf("notification fixture source drift: missing terminator for %q", name)
	}
	return source[match[0] : match[1]+finish+len(tag)+1]
}
