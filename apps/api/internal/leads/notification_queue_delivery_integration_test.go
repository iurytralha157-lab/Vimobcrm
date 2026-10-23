package leads

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestNotificationQueueTargetGuardRejectsProductionAndImplicitWrites(t *testing.T) {
	if !isPlatformTransactionalNotificationEvent(queuePoolAvailableEvent) || !errors.Is(validatePublicNotificationEvent(queuePoolAvailableEvent), tenant.ErrOrganizationAccessDenied) {
		t.Fatal("pool event lost its backend-owned public authorization fence")
	}
	if !usesOrganizationNotificationWhatsAppSender(queuePoolAvailableEvent) || usesOrganizationNotificationWhatsAppSender("billing_due_today") || !usesOrganizationNotificationWhatsAppSender("new_lead_received") {
		t.Fatal("pool sender selection changed unrelated event routing")
	}
	if queueNotificationIsolationRequired(1) == nil {
		t.Fatal("unfenced global dispatcher accepted nonempty outbox")
	}
	if err := queueNotificationIsolationRequired(0); err != nil {
		t.Fatal(err)
	}
	valid := "postgresql://postgres:synthetic@127.0.0.1:57422/vimob_queue_notify20261016_11111111?sslmode=disable"
	run := "11111111-1111-4111-8111-111111111111"
	for _, test := range []struct{ raw, optIn, run, environment string }{
		{valid, "", run, "test"}, {valid, "LOCAL_WRITE_TEST", run, "production"},
		{"postgresql://postgres:synthetic@production.example:5432/postgres", "LOCAL_WRITE_TEST", run, "test"},
		{"postgresql://postgres:synthetic@127.0.0.1:5432/postgres", "LOCAL_WRITE_TEST", run, "test"},
		{"postgresql://postgres:synthetic@127.0.0.1:57422/postgres", "LOCAL_WRITE_TEST", run, "test"},
		{valid + "&options=-csearch_path=public", "LOCAL_WRITE_TEST", run, "test"},
		{valid, "LOCAL_WRITE_TEST", "", "test"},
	} {
		if _, err := queueNotificationTestTarget(test.raw, test.optIn, test.run, test.environment); err == nil {
			t.Fatal("unsafe target accepted")
		}
	}
	if _, err := queueNotificationTestTarget(valid, "LOCAL_WRITE_TEST", run, "test"); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{"https://production.example/send/text", "http://localhost:1234/send/text", "http://127.0.0.1:9999/send/text"} {
		target, _ := url.Parse(raw)
		if _, err := (queueNotificationLoopbackTransport{allowed: "http://127.0.0.1:1234"}).RoundTrip(&http.Request{URL: target}); err == nil {
			t.Fatal("external HTTP accepted")
		}
	}
}

func TestNotificationQueueConcurrentWorkersUseOneRealHTTPAttemptIntegration(t *testing.T) {
	f := newQueueDeliveryFixture(t, false)
	f.notify(t, "new_lead_received")
	entered, release := make(chan struct{}), make(chan struct{})
	requests := f.fakeProvider(t, false, entered, release)
	finished := make(chan error, 1)
	go func() { _, err := f.repo.processOneNormalizedNotificationDelivery(f.ctx, nil); finished <- err }()
	select {
	case <-entered:
	case <-f.ctx.Done():
		t.Fatal("first worker never reached synthetic provider")
	}
	processed, err := f.repo.processOneNormalizedNotificationDelivery(f.ctx, nil)
	close(release)
	if err != nil || processed {
		t.Fatalf("second worker reclaimed an in-flight notification: processed=%v error=%v", processed, err)
	}
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 1 || f.dispatch(t) {
		t.Fatalf("notification replayed: HTTP=%d", requests.Load())
	}
	assertQueueDeliveryState(t, f, "accepted", 1)
	t.Log("two overlapping workers: HTTP=1, accepted delivery=1, attempt_count=1, replay HTTP=0")
}

func TestNotificationQueueOutcomeUnknownNeverResendsIntegration(t *testing.T) {
	f := newQueueDeliveryFixture(t, false)
	f.notify(t, "new_lead_received")
	requests := f.fakeProvider(t, true, nil, nil)
	if !f.dispatch(t) {
		t.Fatal("first dispatcher did not claim notification")
	}
	assertQueueDeliveryState(t, f, "accepted", 1)
	var code string
	var unknown, attemptUnknown bool
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select coalesce(d.metadata->>'error_code',''),d.metadata->>'outcome_unknown'='true',
	 exists(select 1 from private.notification_delivery_attempts a where a.delivery_id=d.id and a.metadata->>'outcome_unknown'='true')
	 from private.notification_deliveries d where notification_id=$1::uuid and channel='whatsapp'`, f.notification).Scan(&code, &unknown, &attemptUnknown); err != nil || code != "notification_delivery_outcome_unknown" || !unknown || !attemptUnknown {
		t.Fatalf("unknown outcome lost: code=%s marker=%v attempt=%v error=%v", code, unknown, attemptUnknown, err)
	}
	if f.dispatch(t) || requests.Load() != 1 {
		t.Fatal("uncertain provider result was blindly resent")
	}
	t.Log("outcome_unknown: HTTP=1, durable delivery/attempt markers=true, subsequent dispatch HTTP=0")
}

func TestNotificationQueueStaleWarningOwnerAndRevokedAudienceReachNoHTTPIntegration(t *testing.T) {
	for _, mode := range []string{"timeout_at_five", "warning_expired", "old_owner", "membership_revoked", "pool_membership_revoked", "pool_episode_changed", "pool_sender_admin_revoked", "pool_foreign_sender_only"} {
		t.Run(mode, func(t *testing.T) {
			pool := mode == "pool_membership_revoked" || mode == "pool_episode_changed" || mode == "pool_sender_admin_revoked" || mode == "pool_foreign_sender_only"
			f := newQueueDeliveryFixture(t, pool)
			event := "lead_redistribution_warning"
			if pool {
				event = "queue_pool_available"
			}
			f.notify(t, event)
			switch mode {
			case "timeout_at_five":
				f.exec(t, `update public.round_robins set settings=settings||'{"redistribution_timeout_minutes":5,"redistribution_warning_minutes":0}'::jsonb where id=$1::uuid`, f.queue)
			case "warning_expired":
				f.exec(t, `update private.queue_lead_runtime set due_at=clock_timestamp()-interval '1 second' where organization_id=$1::uuid and lead_id=$2::uuid`, f.org, f.lead)
			case "old_owner":
				f.exec(t, `select private.prepare_queue_manual_transfer($1::uuid,$2::uuid,$3::uuid,$3::uuid);update public.leads set assigned_user_id=$3::uuid where organization_id=$1::uuid and id=$2::uuid`, f.org, f.lead, f.admin)
			case "membership_revoked", "pool_membership_revoked":
				f.exec(t, `update public.organization_members set is_active=false where organization_id=$1::uuid and user_id=$2::uuid`, f.org, f.actor)
			case "pool_episode_changed":
				f.exec(t, `update private.queue_lead_runtime set revision=revision+1 where organization_id=$1::uuid and lead_id=$2::uuid`, f.org, f.lead)
			case "pool_sender_admin_revoked":
				f.exec(t, `update public.organization_members set is_active=false where organization_id=$1::uuid and user_id=$2::uuid`, f.org, f.admin)
			case "pool_foreign_sender_only":
				f.exec(t, `update public.whatsapp_sessions set is_notification_session=false where organization_id=$1::uuid`, f.org)
				f.addForeignSyntheticSender(t)
			}
			// A legitimate transfer may enqueue another fixture event. This scenario
			// dispatches only the historical notification whose policy changed.
			f.exec(t, `delete from public.notifications where organization_id=$1::uuid and id<>$2::uuid`, f.org, f.notification)
			requests := f.fakeProvider(t, false, nil, nil)
			f.dispatch(t)
			if requests.Load() != 0 {
				t.Fatal("stale or revoked notification reached provider")
			}
			if mode == "pool_sender_admin_revoked" || mode == "pool_foreign_sender_only" {
				assertQueueDeliveryState(t, f, "blocked_dependency", 0)
				t.Log("no authorized organization sender: HTTP=0, attempt_count=0; foreign sender cannot satisfy dependency")
			} else {
				assertQueueDeliveryState(t, f, "permanent_failed", 1)
				t.Log("stale/revoked notification: HTTP=0, terminal delivery=permanent_failed")
			}
		})
	}
}

func TestNotificationQueuePoolAlertDedupeAndThrottleIntegration(t *testing.T) {
	f := newQueueDeliveryFixture(t, true)
	var first, duplicate, throttled int
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select private.enqueue_queue_pool_alert($1::uuid,$2::uuid,$3::uuid,1)`, f.org, f.lead, f.episode).Scan(&first); err != nil {
		t.Fatal(err)
	}
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select private.enqueue_queue_pool_alert($1::uuid,$2::uuid,$3::uuid,1)`, f.org, f.lead, f.episode).Scan(&duplicate); err != nil {
		t.Fatal(err)
	}
	var secondLead string
	if err := f.repo.db.Pool().QueryRow(f.ctx, `insert into public.leads(organization_id,name,source,origin_round_robin_id,pipeline_id,stage_id)
	 values($1::uuid,'Second private synthetic customer','manual',$2::uuid,$3::uuid,$4::uuid) returning id::text`, f.org, f.queue, f.pipeline, f.stage).Scan(&secondLead); err != nil {
		t.Fatal(err)
	}
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select private.enqueue_queue_pool_alert(organization_id,lead_id,episode_id,revision) from private.queue_lead_runtime where organization_id=$1::uuid and lead_id=$2::uuid`, f.org, secondLead).Scan(&throttled); err != nil {
		t.Fatal(err)
	}
	if first != 2 || duplicate != 0 || throttled != 0 {
		t.Fatalf("pool recipients/dedupe/throttle mismatch: first=%d duplicate=%d throttled=%d", first, duplicate, throttled)
	}
	requests := f.fakeProvider(t, false, nil, nil)
	var diagnostic string
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select jsonb_build_object(
	 'notifications',(select jsonb_agg(jsonb_build_object('event',n.metadata->>'event_key','policy',private.queue_notification_delivery_allowed(n.organization_id,n.lead_id,n.user_id,n.metadata->>'event_key',n.metadata),'dispatch',n.metadata->'dispatch')) from public.notifications n where n.organization_id=$1::uuid),
	 'deliveries',(select jsonb_agg(jsonb_build_object('channel',d.channel,'status',d.status,'error',d.last_error_code)) from private.notification_deliveries d where d.organization_id=$1::uuid))::text`, f.org).Scan(&diagnostic); err != nil {
		t.Fatal(err)
	}
	t.Logf("pool delivery preflight: %s", diagnostic)
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select coalesce(jsonb_agg(jsonb_build_object('notification_session',s.is_notification_session,'active',s.is_active,'status',s.status,'owner_role',m.role,'owner_member_active',m.is_active,'owner_account_active',u.is_active,'selected_actor_present',s.advanced_settings ? 'notification_sender_selected_by_user_id')),'[]')::text from public.whatsapp_sessions s left join public.organization_members m on m.organization_id=s.organization_id and m.user_id=s.owner_user_id left join public.users u on u.id=s.owner_user_id where s.organization_id=$1::uuid`, f.org).Scan(&diagnostic); err != nil {
		t.Fatal(err)
	}
	t.Logf("pool sender selection: %s", diagnostic)
	for count := 0; count < 5 && f.dispatch(t); count++ {
	}
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select jsonb_agg(jsonb_build_object('channel',d.channel,'status',d.status,'error',d.last_error_code,'metadata_error',d.metadata->>'error_code','attempts',d.attempt_count))::text from private.notification_deliveries d where d.organization_id=$1::uuid`, f.org).Scan(&diagnostic); err != nil {
		t.Fatal(err)
	}
	t.Logf("pool delivery after dispatch: %s", diagnostic)
	if requests.Load() != 2 || f.dispatch(t) {
		t.Fatalf("pool alert duplicated HTTP: %d", requests.Load())
	}
	var count int
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int from private.notification_deliveries where organization_id=$1::uuid and channel='whatsapp' and status='accepted' and attempt_count=1`, f.org).Scan(&count); err != nil || count != 2 {
		t.Fatalf("pool final delivery invariant: %d %v", count, err)
	}
	t.Log("pool alert: recipients=2, duplicate enqueue=0, second lead throttled=0, HTTP=2, accepted deliveries=2, one attempt each")
}

func TestNotificationQueueClaimCancellationReleasesItsTransactionIntegration(t *testing.T) {
	f := newQueueDeliveryFixture(t, true)
	blocker, err := f.repo.db.Pool().Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackRedistributionTransaction(f.ctx, blocker)
	if _, err := blocker.Exec(f.ctx, `select lead_id from private.queue_lead_runtime where organization_id=$1::uuid and lead_id=$2::uuid for update`, f.org, f.lead); err != nil {
		t.Fatal(err)
	}
	actor := tenant.Context{OrganizationID: f.org, UserID: f.actor, MemberRole: "user", Permissions: []string{permissions.LeadOperate, permissions.LeadViewOwn}}
	ctx, cancel := context.WithCancel(f.ctx)
	defer cancel()
	type outcome struct {
		changed bool
		err     error
	}
	finished := make(chan outcome, 1)
	go func() {
		_, changed, err := f.repo.ClaimQueuePool(ctx, actor, f.lead, claimQueuePoolInput{RoundRobinID: f.queue, EpisodeID: f.episode, ExpectedRevision: 1, IdempotencyKey: "synthetic-cancelled-claim"})
		finished <- outcome{changed, err}
	}()
	locked := false
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline) && !locked; {
		if err := f.repo.db.Pool().QueryRow(f.ctx, `select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%private.claim_queue_pool%')`).Scan(&locked); err != nil {
			cancel()
			<-finished
			t.Fatal(err)
		}
		if !locked {
			time.Sleep(20 * time.Millisecond)
		}
	}
	cancel()
	var result outcome
	select {
	case result = <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("cancelled claim failed to finish and release its transaction")
	}
	if !locked {
		t.Fatal("claim never reached the independently held PostgreSQL runtime lock")
	}
	if result.err == nil || result.changed {
		t.Fatal("cancelled blocked claim returned success")
	}
	var receipts int
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int from private.queue_pool_claim_receipts where organization_id=$1::uuid`, f.org).Scan(&receipts); err != nil || receipts != 0 {
		t.Fatalf("cancelled claim persisted a receipt: %d %v", receipts, err)
	}
	for deadline := time.Now().Add(2 * time.Second); f.repo.db.Pool().Stat().AcquiredConns() != 1 && time.Now().Before(deadline); {
		time.Sleep(20 * time.Millisecond)
	}
	if f.repo.db.Pool().Stat().AcquiredConns() != 1 {
		t.Fatal("cancelled claim retained a pooled connection/transaction")
	}
	var idleInTransaction int
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int from pg_stat_activity where datname=current_database() and state like 'idle in transaction%'`).Scan(&idleInTransaction); err != nil || idleInTransaction != 1 {
		t.Fatalf("cancelled claim left an idle transaction beyond the deliberate blocker: %d %v", idleInTransaction, err)
	}
	t.Log("claim wait_event_type=Lock observed, then cancelled: no success/receipt and only the deliberate blocker retains a connection")
}

func assertQueueDeliveryState(t *testing.T, f *queueDeliveryFixture, want string, attempts int) {
	t.Helper()
	var status string
	var actual int
	if err := f.repo.db.Pool().QueryRow(context.Background(), `select status,attempt_count from private.notification_deliveries where notification_id=$1::uuid and channel='whatsapp'`, f.notification).Scan(&status, &actual); err != nil || status != want || actual != attempts {
		t.Fatalf("delivery state: got=%s/%d want=%s/%d error=%v", status, actual, want, attempts, err)
	}
}
