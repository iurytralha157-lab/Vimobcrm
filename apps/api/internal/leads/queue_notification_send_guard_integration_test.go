package leads

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Pause real worker I/O after the first policy check, change the current
// audience, and then let the same worker continue to its loopback provider.
func TestNotificationQueueRevocationDuringTemplateLookupReachesNoHTTPIntegration(t *testing.T) {
	for _, mode := range []string{"pool_membership_revoked", "pool_claimed", "warning_queue_closed", "prepared_metadata_changed", "prepared_content_changed", "delivery_receipt_changed"} {
		t.Run(mode, func(t *testing.T) {
			pool := mode != "warning_queue_closed"
			f := newQueueDeliveryFixture(t, pool)
			event := "lead_redistribution_warning"
			if pool {
				event = queuePoolAvailableEvent
			}
			f.notify(t, event)
			requests := f.fakeProvider(t, false, nil, nil)
			blocker, err := f.repo.db.Pool().Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer blocker.Rollback(context.Background())
			var blockerPID int
			if err := blocker.QueryRow(f.ctx, "select pg_backend_pid()").Scan(&blockerPID); err != nil {
				t.Fatal(err)
			}
			if _, err := blocker.Exec(f.ctx, "lock table public.notification_templates in access exclusive mode"); err != nil {
				t.Fatal(err)
			}
			finished := make(chan error, 1)
			go func() { _, err := f.repo.processOneNormalizedNotificationDelivery(f.ctx, nil); finished <- err }()
			deadline := time.NewTimer(10 * time.Second)
			defer deadline.Stop()
			tick := time.NewTicker(20 * time.Millisecond)
			defer tick.Stop()
		waiting:
			for {
				var waiting bool
				if err := f.repo.db.Pool().QueryRow(f.ctx, `select exists(select 1 from pg_stat_activity
				 where datname=current_database() and $1::integer=any(pg_blocking_pids(pid))
				 and query like '%from public.notification_templates%')`, blockerPID).Scan(&waiting); err != nil {
					t.Fatal(err)
				}
				if waiting {
					break waiting
				}
				select {
				case err := <-finished:
					t.Fatalf("worker ended before the controlled template barrier: %v", err)
				case <-deadline.C:
					t.Fatal("worker did not reach the controlled template barrier")
				case <-tick.C:
				}
			}
			switch mode {
			case "pool_membership_revoked":
				f.exec(t, `update public.organization_members set is_active=false where organization_id=$1::uuid and user_id=$2::uuid`, f.org, f.actor)
			case "pool_claimed":
				// The prepared recipient is the broker. A legitimate administrator
				// claims while its historical pool alert is still in preparation.
				var claimed bool
				if err := f.repo.db.Pool().QueryRow(f.ctx, `select coalesce((private.claim_queue_pool($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,1,'notification-send-race')->>'success')::boolean,false)`, f.org, f.lead, f.admin, f.queue, f.episode).Scan(&claimed); err != nil || !claimed {
					t.Fatalf("legitimate claim did not commit during preparation: claimed=%v error=%v", claimed, err)
				}
			case "warning_queue_closed":
				f.exec(t, `update public.round_robins set is_active=false where organization_id=$1::uuid and id=$2::uuid`, f.org, f.queue)
			case "prepared_metadata_changed":
				f.exec(t, `update public.notifications set metadata=metadata||'{"variables":{"synthetic_payload_version":"new"}}'::jsonb where id=$1::uuid`, f.notification)
			case "prepared_content_changed":
				f.exec(t, `update public.notifications set content='Changed after sender preparation' where id=$1::uuid`, f.notification)
			case "delivery_receipt_changed":
				f.exec(t, `update public.notifications set metadata=metadata||'{"email_dispatch":{"status":"accepted"}}'::jsonb where id=$1::uuid`, f.notification)
			}
			if err := blocker.Commit(f.ctx); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-finished:
				if err != nil {
					t.Fatal(err)
				}
			case <-f.ctx.Done():
				t.Fatal("worker did not finish after releasing template lookup")
			}
			if mode == "delivery_receipt_changed" {
				if requests.Load() != 1 {
					t.Fatal("an unrelated channel receipt must not cancel an unchanged prepared payload")
				}
				assertQueueDeliveryState(t, f, "accepted", 1)
				return
			}
			if requests.Load() != 0 {
				t.Fatal("revocation during preparation reached provider")
			}
			assertQueueDeliveryState(t, f, "permanent_failed", 1)
			t.Log("policy valid at first preflight, revoked while template lookup waited: HTTP=0, historical delivery terminal")
		})
	}
}

func TestNotificationQueueRevocationWhilePushGateWaitsReachesNoHTTPIntegration(t *testing.T) {
	for _, mode := range []string{"pool_claimed", "warning_queue_closed", "warning_deadline_elapsed", "push_device_revoked", "unchanged_payload"} {
		t.Run(mode, func(t *testing.T) {
			pool := mode == "pool_claimed" || mode == "push_device_revoked" || mode == "unchanged_payload"
			f := newQueueDeliveryFixture(t, pool)
			var tokenID string
			if err := f.repo.db.Pool().QueryRow(f.ctx, `insert into public.push_tokens(organization_id,user_id,token,platform,is_active)
			 values($1::uuid,$2::uuid,'synthetic-queue-push-'||gen_random_uuid()::text,'android',true) returning id::text`, f.org, f.actor).Scan(&tokenID); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				if _, err := f.repo.db.Pool().Exec(cleanup, `delete from private.notification_deliveries where notification_id=$2::uuid and push_token_id=$1::uuid;
				 delete from public.push_tokens where id=$1::uuid`, tokenID, f.notification); err != nil {
					t.Errorf("cleanup synthetic queue push token: %v", err)
				}
			})
			event := "lead_redistribution_warning"
			if pool {
				event = queuePoolAvailableEvent
			}
			f.notify(t, event)
			f.exec(t, `update public.notifications set metadata=jsonb_set(metadata,'{dispatch}',
			 '{"whatsapp":{"required":false},"push":{"required":true},"email":{"required":false}}'::jsonb) where id=$1::uuid`, f.notification)
			requests := fakeQueuePushProvider(t, f)
			gate, err := f.repo.db.Pool().Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer gate.Rollback(context.Background())
			var gatePID int
			if err := gate.QueryRow(f.ctx, "select pg_backend_pid()").Scan(&gatePID); err != nil {
				t.Fatal(err)
			}
			var actorID string
			if err := gate.QueryRow(f.ctx, `select id::text from public.users where id=$1::uuid for update`, f.actor).Scan(&actorID); err != nil {
				t.Fatal(err)
			}
			finished := make(chan error, 1)
			go func() { _, err := f.repo.processOneNormalizedNotificationDelivery(f.ctx, nil); finished <- err }()
			waitQueueNotificationBarrier(t, f, gatePID, "%start_queue_authorized_notification_delivery%", finished)
			switch mode {
			case "pool_claimed":
				var claimed bool
				if err := f.repo.db.Pool().QueryRow(f.ctx, `select coalesce((private.claim_queue_pool($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,1,'notification-push-gate-race')->>'success')::boolean,false)`, f.org, f.lead, f.admin, f.queue, f.episode).Scan(&claimed); err != nil || !claimed {
					t.Fatalf("legitimate claim did not commit during push gate wait: claimed=%v error=%v", claimed, err)
				}
			case "warning_queue_closed":
				f.exec(t, `update public.round_robins set is_active=false where organization_id=$1::uuid and id=$2::uuid`, f.org, f.queue)
			case "warning_deadline_elapsed":
				f.exec(t, `update private.queue_lead_runtime set due_at=clock_timestamp()+interval '100 milliseconds' where organization_id=$1::uuid and lead_id=$2::uuid`, f.org, f.lead)
				time.Sleep(250 * time.Millisecond)
			case "push_device_revoked":
				f.exec(t, `update public.push_tokens set is_active=false where id=$1::uuid`, tokenID)
			}
			if err := gate.Commit(f.ctx); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-finished:
				if err != nil && !(mode == "push_device_revoked" && errors.Is(err, errNotificationDeliveryClaimLost)) {
					t.Fatal(err)
				}
			case <-f.ctx.Done():
				t.Fatal("worker did not finish after the push gate was released")
			}
			wantStatus, wantAttempts, wantHTTP := "permanent_failed", 1, int32(0)
			if mode == "push_device_revoked" {
				wantStatus, wantAttempts = "cancelled", 0
			} else if mode == "unchanged_payload" {
				wantStatus, wantHTTP = "delivered", 1
			}
			if requests.Load() != wantHTTP {
				t.Fatalf("push provider calls: got=%d want=%d", requests.Load(), wantHTTP)
			}
			var status string
			var attempts int
			if err := f.repo.db.Pool().QueryRow(f.ctx, `select status,attempt_count from private.notification_deliveries
			 where notification_id=$1::uuid and channel='push'`, f.notification).Scan(&status, &attempts); err != nil || status != wantStatus || attempts != wantAttempts {
				t.Fatalf("push delivery state: got=%s/%d want=%s/%d error=%v", status, attempts, wantStatus, wantAttempts, err)
			}
		})
	}
}

func fakeQueuePushProvider(t *testing.T, f *queueDeliveryFixture) *atomic.Int32 {
	t.Helper()
	requests := &atomic.Int32{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != "POST" || r.URL.Path != "/fcm/send" {
			t.Errorf("unexpected synthetic queue push request: %s %s", r.Method, r.URL.Path)
		}
		raw, _ := io.ReadAll(r.Body)
		if strings.Contains(string(raw), "Private synthetic customer") {
			t.Error("queue push leaked private customer name")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"success":1,"failure":0,"results":[{"message_id":"synthetic-queue-push"}]}`)
	}))
	t.Cleanup(server.Close)
	loopback, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	f.repo.notificationPush = &notificationPushClient{fcmServerKey: "synthetic-queue-only",
		httpClient: &http.Client{Timeout: 4 * time.Second, Transport: whatsappLocalPushTransport(func(r *http.Request) (*http.Response, error) {
			if r.URL.Scheme != "https" || r.URL.Host != "fcm.googleapis.com" {
				return nil, errors.New("external queue push HTTP is forbidden")
			}
			clone := r.Clone(r.Context())
			target := *r.URL
			target.Scheme, target.Host = loopback.Scheme, loopback.Host
			clone.URL = &target
			return http.DefaultTransport.RoundTrip(clone)
		})}}
	return requests
}

func TestQueueNotificationSendSnapshotKeepsPreparedBusinessPayload(t *testing.T) {
	leadID := "synthetic-lead"
	notification := pendingNotification{ID: "notification", OrganizationID: "org", UserID: "user", LeadID: &leadID,
		Title: "Original title", Content: "Original body", Type: "lead", TargetURL: "/leads/synthetic",
		Metadata: map[string]any{"event_key": queuePoolAvailableEvent, "episode_id": "episode", "variables": map[string]any{"version": "original"},
			"dispatch": map[string]any{"push": true}, "email_dispatch": map[string]any{"status": "accepted"}}}
	snapshot, err := queueNotificationSendSnapshot(notification)
	if err != nil {
		t.Fatal(err)
	}
	var actual map[string]any
	if err := json.Unmarshal(snapshot, &actual); err != nil {
		t.Fatal(err)
	}
	metadata := actual["metadata"].(map[string]any)
	if actual["lead_id"] != leadID || actual["content"] != notification.Content || metadata["episode_id"] != "episode" ||
		metadata["variables"].(map[string]any)["version"] != "original" {
		t.Fatal("prepared business payload was not retained")
	}
	if _, exists := metadata["dispatch"]; exists {
		t.Fatal("delivery bookkeeping must not be part of business snapshot equality")
	}
	if _, exists := metadata["email_dispatch"]; exists {
		t.Fatal("another channel receipt must not invalidate an unchanged payload")
	}
	if _, exists := notification.Metadata["dispatch"]; !exists {
		t.Fatal("snapshot construction mutated the loaded notification")
	}
}

func TestNotificationQueueRevocationWhileAttemptStartWaitsReachesNoHTTPIntegration(t *testing.T) {
	for _, mode := range []string{"pool_membership_revoked", "pool_claimed", "warning_queue_closed", "warning_deadline_elapsed"} {
		t.Run(mode, func(t *testing.T) {
			pool := mode == "pool_membership_revoked" || mode == "pool_claimed"
			f := newQueueDeliveryFixture(t, pool)
			event := "lead_redistribution_warning"
			if pool {
				event = queuePoolAvailableEvent
			}
			f.notify(t, event)
			requests := f.fakeProvider(t, false, nil, nil)
			templates, err := f.repo.db.Pool().Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer templates.Rollback(context.Background())
			var templatePID int
			if err := templates.QueryRow(f.ctx, "select pg_backend_pid()").Scan(&templatePID); err != nil {
				t.Fatal(err)
			}
			if _, err := templates.Exec(f.ctx, "lock table public.notification_templates in access exclusive mode"); err != nil {
				t.Fatal(err)
			}
			finished := make(chan error, 1)
			go func() { _, err := f.repo.processOneNormalizedNotificationDelivery(f.ctx, nil); finished <- err }()
			waitQueueNotificationBarrier(t, f, templatePID, "%from public.notification_templates%", finished)
			deliveryLock, err := f.repo.db.Pool().Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer deliveryLock.Rollback(context.Background())
			var deliveryPID int
			if err := deliveryLock.QueryRow(f.ctx, "select pg_backend_pid()").Scan(&deliveryPID); err != nil {
				t.Fatal(err)
			}
			var deliveryID string
			if err := deliveryLock.QueryRow(f.ctx, `select id::text from private.notification_deliveries
			 where notification_id=$1::uuid and channel='whatsapp' and status='leased' for update`, f.notification).Scan(&deliveryID); err != nil {
				t.Fatal(err)
			}
			if err := templates.Commit(f.ctx); err != nil {
				t.Fatal(err)
			}
			waitQueueNotificationBarrier(t, f, deliveryPID, "%start_queue_authorized_notification_delivery%", finished)
			switch mode {
			case "pool_membership_revoked":
				f.exec(t, `update public.organization_members set is_active=false where organization_id=$1::uuid and user_id=$2::uuid`, f.org, f.actor)
			case "pool_claimed":
				var claimed bool
				if err := f.repo.db.Pool().QueryRow(f.ctx, `select coalesce((private.claim_queue_pool($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,1,'notification-start-race')->>'success')::boolean,false)`, f.org, f.lead, f.admin, f.queue, f.episode).Scan(&claimed); err != nil || !claimed {
					t.Fatalf("legitimate claim did not commit at start barrier: claimed=%v error=%v", claimed, err)
				}
			case "warning_queue_closed":
				f.exec(t, `update public.round_robins set is_active=false where organization_id=$1::uuid and id=$2::uuid`, f.org, f.queue)
			case "warning_deadline_elapsed":
				f.exec(t, `update private.queue_lead_runtime set due_at=clock_timestamp()+interval '100 milliseconds' where organization_id=$1::uuid and lead_id=$2::uuid`, f.org, f.lead)
				time.Sleep(250 * time.Millisecond)
			}
			if err := deliveryLock.Commit(f.ctx); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-finished:
				if err != nil {
					t.Fatal(err)
				}
			case <-f.ctx.Done():
				t.Fatal("worker did not complete after the attempt-start barrier")
			}
			if requests.Load() != 0 {
				t.Fatal("authorization became stale while attempt start waited; provider must not be called")
			}
			assertQueueDeliveryState(t, f, "permanent_failed", 1)
			t.Log("real delivery-row wait observed, then current policy revoked before attempt start: HTTP=0")
		})
	}
}

func waitQueueNotificationBarrier(t *testing.T, f *queueDeliveryFixture, blockerPID int, query string, finished <-chan error) {
	t.Helper()
	deadline := time.NewTimer(10 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(20 * time.Millisecond)
	defer tick.Stop()
	for {
		var waiting bool
		if err := f.repo.db.Pool().QueryRow(f.ctx, `select exists(select 1 from pg_stat_activity
		 where datname=current_database() and $1::integer=any(pg_blocking_pids(pid)) and query like $2)`, blockerPID, query).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
		select {
		case err := <-finished:
			t.Fatalf("worker completed before controlled barrier: %v", err)
		case <-deadline.C:
			t.Fatal("worker did not reach controlled database barrier")
		case <-tick.C:
		}
	}
}
