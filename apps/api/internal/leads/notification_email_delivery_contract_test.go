package leads

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestTransactionalEmailSubjectsMatchPreflightAndProviderRequest(t *testing.T) {
	t.Parallel()

	tests := []struct {
		eventKey string
		title    string
		want     string
	}{
		{eventKey: "deal_won", want: "Lead ganho no Vimob"},
		{eventKey: "onboarding_welcome", want: "Confirme seu e-mail para acessar o Vimob"},
		{eventKey: "billing_payment_receipt", title: "Comprovante de pagamento Vimob", want: "Comprovante de pagamento Vimob"},
		{eventKey: "billing_due_today", want: "Atualizacao da sua assinatura Vimob"},
	}

	for _, test := range tests {
		test := test
		t.Run(test.eventKey, func(t *testing.T) {
			t.Parallel()
			if got := transactionalEmailSubject(test.eventKey, test.title); got != test.want {
				t.Fatalf("expected %q, got %q", test.want, got)
			}
		})
	}
}

func TestNotificationWorkerPersistsProcessingLogBeforeResend(t *testing.T) {
	t.Parallel()

	payload, err := os.ReadFile("notification_dispatch_worker.go")
	if err != nil {
		t.Fatalf("read notification worker: %v", err)
	}
	source := string(payload)
	start := strings.Index(source, "func (repo Repository) dispatchPendingEmailNotification")
	if start < 0 {
		t.Fatal("transactional email dispatch function must exist")
	}
	prepareRelative := strings.Index(source[start:], "func (repo Repository) prepareNotificationEmailDelivery")
	if prepareRelative < 0 {
		t.Fatal("transactional email dispatch and preflight functions must exist")
	}
	prepareStart := start + prepareRelative
	dispatch := source[start:prepareStart]
	preflight := strings.Index(dispatch, "repo.prepareNotificationEmailDelivery(")
	firstProviderCall := strings.Index(dispatch, "repo.notificationEmail.send")
	if preflight < 0 || firstProviderCall < 0 || preflight > firstProviderCall {
		t.Fatal("email_logs preflight must succeed before any Resend client call")
	}
	if beforePreflight := dispatch[:preflight]; strings.Contains(beforePreflight, "repo.notificationEmail.send") {
		t.Fatal("the worker must not contact Resend before the processing log is durable")
	}

	prepareEndRelative := strings.Index(source[prepareStart:], "func (repo Repository) markNotificationDelivery")
	if prepareEndRelative < 0 {
		t.Fatal("unable to isolate email log preflight")
	}
	prepare := source[prepareStart : prepareStart+prepareEndRelative]
	for _, required := range []string{
		"'processing'",
		"'provider_request_pending'",
		"on conflict (notification_id) where notification_id is not null",
		"idempotency_key = coalesce(email_logs.idempotency_key, excluded.idempotency_key)",
		"email_logs.status_event_at is not null",
		"email_log_prepare_failed",
		"pg_catalog.pg_advisory_xact_lock(",
		"pg_catalog.hashtextextended('resend:' || $1, 0)",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("email preflight contract is missing %q", required)
		}
	}
	if strings.Contains(prepare, "notificationEmail.send") {
		t.Fatal("the persistence preflight must not perform network delivery")
	}
}

func TestResendReconciliationMigrationIsMonotonicAndServiceOnly(t *testing.T) {
	t.Parallel()

	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to resolve test source path")
	}
	migrationPath := filepath.Clean(filepath.Join(
		filepath.Dir(sourceFile),
		"..", "..", "..", "..",
		"supabase", "migrations", "20260803213359_reconcile_resend_email_delivery.sql",
	))
	payload, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read Resend reconciliation migration: %v", err)
	}
	sql := strings.ToLower(strings.Join(strings.Fields(string(payload)), " "))

	for _, required := range []string{
		"add column if not exists status_event_at timestamptz",
		"add column if not exists reconciled_at timestamptz",
		"create index if not exists email_delivery_events_reconcile_order_idx on public.email_delivery_events ( provider, provider_message_id, occurred_at, created_at, provider_event_id )",
		"create or replace function private.reconcile_resend_email_events_for_log",
		"create trigger reconcile_resend_email_events_after_log",
		"after insert or update of provider, provider_message_id, organization_id, user_id",
		"order by events.occurred_at asc, events.created_at asc, events.provider_event_id asc",
		"v_candidate_rank > v_current_rank",
		"v_event.occurred_at >= coalesce(v_current_status_event_at, '-infinity'::timestamptz)",
		"perform private.reconcile_resend_email_events_for_log(v_email_log_id)",
		"perform pg_catalog.pg_advisory_xact_lock( pg_catalog.hashtextextended('resend:' || v_provider_message_id, 0) )",
		"and logs.provider_message_id = v_provider_message_id limit 1 for update",
		"revoke all on function public.record_resend_email_event(text, text, text, timestamptz, jsonb) from public, anon, authenticated",
		"grant execute on function public.record_resend_email_event(text, text, text, timestamptz, jsonb) to service_role",
		"revoke all on table public.email_delivery_events from public, anon, authenticated, service_role",
		"grant select on table public.email_delivery_events to service_role",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("Resend reconciliation contract is missing %q", required)
		}
	}

	bouncedRank := strings.Index(sql, "when 'bounced' then 70")
	deliveredRank := strings.Index(sql, "when 'delivered' then 90")
	complainedRank := strings.Index(sql, "when 'complained' then 100")
	if bouncedRank < 0 || deliveredRank < 0 || complainedRank < 0 ||
		bouncedRank > deliveredRank || deliveredRank > complainedRank {
		t.Fatal("terminal delivery states must have explicit monotonic precedence")
	}
}
