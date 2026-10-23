package leads

import (
	"context"
	"testing"
	"time"
)

func TestWhatsAppInboundPushRealDispatcherRedirectsBeforeOldTokenPreflight(t *testing.T) {
	for _, mode := range []string{"inactive_token", "blocked_configuration", "legacy_zero_sender", "legacy_zero_tokens", "current_zero_tokens"} {
		t.Run(mode, func(t *testing.T) {
			f := newWhatsAppPushDispatchFixture(t)
			requests := f.fakeHTTP(t, "fake-next-"+f.nextTokenID, nil)
			switch mode {
			case "inactive_token":
				f.exec(t, `update public.push_tokens set is_active=false where id=$1::uuid`, f.firstTokenID)
				f.exec(t, `select private.materialize_notification_deliveries($1::uuid,false)`, f.notificationID)
				var status string
				if err := f.repo.db.Pool().QueryRow(f.ctx, `select status from private.notification_deliveries where notification_id=$1::uuid`, f.notificationID).Scan(&status); err != nil || status != "queued" {
					t.Fatalf("materializer cancelled untouched alert: %s %v", status, err)
				}
			case "blocked_configuration":
				f.repo.notificationPush = nil
				if !f.dispatch(t) {
					t.Fatal("new pending alert not claimed")
				}
				f.assertUnstarted(t)
				// Same-recipient configuration failure must not create a worker loop.
				if f.dispatch(t) {
					t.Fatal("unchanged blocked dependency reclaimed")
				}
			case "legacy_zero_sender":
				f.repo.notificationPush = nil
				result := f.repo.dispatchLegacyWhatsAppInboundPush(f.ctx, f.notification(t))
				if result.Error != "push_sender_not_configured" {
					t.Fatalf("unexpected legacy result %+v", result)
				}
				f.assertUnstarted(t)
			case "legacy_zero_tokens":
				f.exec(t, `update public.push_tokens set is_active=false where id=$1::uuid`, f.firstTokenID)
				result := f.repo.dispatchLegacyWhatsAppInboundPush(f.ctx, f.notification(t))
				if result.Error != "push_tokens_missing" {
					t.Fatalf("unexpected legacy result %+v", result)
				}
				f.assertUnstarted(t)
			case "current_zero_tokens":
				f.exec(t, `update public.push_tokens set is_active=false where id=$1::uuid`, f.firstTokenID)
				if !f.dispatch(t) {
					t.Fatal("inactive current token blocked authorization preflight")
				}
				f.assertUnstarted(t)
				f.exec(t, `update private.notification_deliveries set next_attempt_at=now() where organization_id=$1::uuid and status='retry_wait'`, f.organizationID)
			}
			f.transfer(t)
			if !f.dispatch(t) {
				t.Fatal("pending original alert was not routed to current attendant")
			}
			f.assertRedirected(t)
			if requests.Load() != 0 {
				t.Fatal("old recipient reached HTTP")
			}
			// Restore configuration only after redirection has committed.
			if f.repo.notificationPush == nil {
				requests = f.fakeHTTP(t, "fake-next-"+f.nextTokenID, nil)
			}
			if !f.dispatch(t) || requests.Load() != 1 {
				t.Fatalf("current recipient was not sent exactly once: %d", requests.Load())
			}
			if f.dispatch(t) {
				t.Fatal("delivered notification was claimed again")
			}
		})
	}
}

func TestWhatsAppInboundPushRealHTTPStartNeverRedirects(t *testing.T) {
	for _, mode := range []string{"normalized", "legacy"} {
		t.Run(mode, func(t *testing.T) {
			f := newWhatsAppPushDispatchFixture(t)
			requests := f.fakeHTTP(t, "fake-first-"+f.firstTokenID, func() {
				// Actual provider HTTP is local, but the marker and transfer use a
				// second DB connection. No authorization locks may survive into I/O.
				var started bool
				sql := `select exists(select 1 from private.notification_deliveries where notification_id=$1::uuid and attempt_count=1 and status='sending')`
				if mode == "legacy" {
					sql = `select metadata->>'whatsapp_inbound_provider_started'='true' from public.notifications where id=$1::uuid`
				}
				if err := f.repo.db.Pool().QueryRow(f.ctx, sql, f.notificationID).Scan(&started); err != nil || !started {
					t.Errorf("marker not committed before HTTP: %v %v", started, err)
				}
				transferCtx, cancel := context.WithTimeout(f.ctx, 2*time.Second)
				defer cancel()
				if _, err := f.repo.db.Pool().Exec(transferCtx, `update public.leads set assigned_user_id=$2::uuid where id=$1::uuid`, f.leadID, f.nextID); err != nil {
					t.Errorf("HTTP retained locks: %v", err)
				}
				var outcome string
				if err := f.repo.db.Pool().QueryRow(f.ctx, `select private.prepare_whatsapp_inbound_attendant_push($1::uuid)`, f.notificationID).Scan(&outcome); err != nil || outcome != "revoked" {
					t.Errorf("started alert rerouted: %s %v", outcome, err)
				}
			})
			if mode == "normalized" {
				if !f.dispatch(t) {
					t.Fatal("normalized delivery not claimed")
				}
			} else if result := f.repo.dispatchLegacyWhatsAppInboundPush(f.ctx, f.notification(t)); !result.Push.OK {
				t.Fatalf("legacy fake HTTP failed %+v", result)
			}
			if requests.Load() != 1 {
				t.Fatalf("unexpected HTTP count %d", requests.Load())
			}
			var count int
			if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int from public.notifications where organization_id=$1::uuid and user_id=$2::uuid and metadata->>'event_key'='whatsapp_inbound_attendant'`, f.organizationID, f.nextID).Scan(&count); err != nil || count != 0 {
				t.Fatalf("started alert duplicated for B: %d %v", count, err)
			}
		})
	}
}

func TestWhatsAppInboundPushWithoutInitialDeviceRecovers(t *testing.T) {
	for _, mode := range []string{"transfer_to_device", "same_actor_device_activated"} {
		t.Run(mode, func(t *testing.T) {
			f := newWhatsAppPushDispatchFixture(t, true)
			var initialJobs int
			if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int from private.notification_deliveries where organization_id=$1::uuid`, f.organizationID).Scan(&initialJobs); err != nil || initialJobs != 0 {
				t.Fatalf("fixture did not start without a device job: %d %v", initialJobs, err)
			}
			expected := "fake-next-" + f.nextTokenID
			if mode == "transfer_to_device" {
				f.transfer(t)
			} else {
				f.exec(t, `update public.push_tokens set is_active=true where id=$1::uuid`, f.firstTokenID)
				expected = "fake-first-" + f.firstTokenID
			}
			requests := f.fakeHTTP(t, expected, nil)
			if !f.dispatch(t) || requests.Load() != 1 {
				t.Fatalf("zero-job pending alert was lost: HTTP=%d", requests.Load())
			}
			if f.dispatch(t) {
				t.Fatal("accepted zero-job alert was replayed")
			}
			var waiting int
			if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int from private.whatsapp_inbound_push_waiting where organization_id=$1::uuid`, f.organizationID).Scan(&waiting); err != nil || waiting != 0 {
				t.Fatalf("waiting queue not drained: %d %v", waiting, err)
			}
		})
	}
}

func TestWhatsAppInboundPushWaitingExpiryAndStartedFences(t *testing.T) {
	t.Run("original_expiry_zero_http", func(t *testing.T) {
		f := newWhatsAppPushDispatchFixture(t, true)
		requests := f.fakeHTTP(t, "fake-next-"+f.nextTokenID, nil)
		f.exec(t, `update private.whatsapp_inbound_push_waiting set expires_at=now()-interval '1 second' where organization_id=$1::uuid`, f.organizationID)
		f.transfer(t)
		if f.dispatch(t) || requests.Load() != 0 {
			t.Fatal("expired zero-job alert reached a provider")
		}
		var waiting int
		if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int from private.whatsapp_inbound_push_waiting where organization_id=$1::uuid`, f.organizationID).Scan(&waiting); err != nil || waiting != 0 {
			t.Fatalf("expired row was not removed: %d %v", waiting, err)
		}
	})
	t.Run("legacy_http_started_waiting_never_redirects", func(t *testing.T) {
		f := newWhatsAppPushDispatchFixture(t, true)
		f.exec(t, `update public.push_tokens set is_active=true where id=$1::uuid`, f.firstTokenID)
		requests := f.fakeHTTP(t, "fake-first-"+f.firstTokenID, func() { f.transfer(t) })
		result := f.repo.dispatchLegacyWhatsAppInboundPush(f.ctx, f.notification(t))
		if !result.Push.OK || requests.Load() != 1 {
			t.Fatalf("fake legacy HTTP failed: %+v %d", result, requests.Load())
		}
		// The metadata-triggered generic job has not itself started. The legacy
		// marker must still block it from rerouting to a different attendant.
		_ = f.dispatch(t)
		var duplicates int
		if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int from public.notifications where organization_id=$1::uuid and user_id=$2::uuid and metadata->>'event_key'='whatsapp_inbound_attendant'`, f.organizationID, f.nextID).Scan(&duplicates); err != nil || duplicates != 0 || requests.Load() != 1 {
			t.Fatalf("started zero-job alert repeated: new=%d HTTP=%d %v", duplicates, requests.Load(), err)
		}
	})
}

func TestWhatsAppInboundPushWaitingConcurrentMaterializeDoesNotInvertLocks(t *testing.T) {
	f := newWhatsAppPushDispatchFixture(t, true)
	f.exec(t, `update public.push_tokens set is_active=false where id=$1::uuid`, f.nextTokenID)
	var nextNotification string
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select private.create_whatsapp_inbound_attendant_notification(
		$1::uuid,message.id,$2::uuid,entry.id,binding.id,access.id,$3::uuid)::text
		from public.whatsapp_messages message
		join public.whatsapp_conversation_lead_bindings binding on binding.conversation_id=message.conversation_id and binding.active_to is null
		join public.whatsapp_attendance_entries entry on entry.binding_id=binding.id and entry.user_id=$2::uuid
		join public.whatsapp_session_access access on access.session_id=message.session_id and access.user_id=$2::uuid
		where message.organization_id=$1::uuid and message.session_id=$4::uuid`, f.organizationID, f.nextID, f.notificationID, f.sessionID).Scan(&nextNotification); err != nil {
		t.Fatal(err)
	}
	f.exec(t, `update private.whatsapp_inbound_push_waiting set next_check_at=now()+interval '1 hour' where notification_id=$1::uuid`, nextNotification)
	f.transfer(t)
	materializeTx, err := f.repo.db.Pool().Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer materializeTx.Rollback(context.Background())
	if _, err := materializeTx.Exec(f.ctx, `select 1 from public.notifications where id=$1::uuid for update`, nextNotification); err != nil {
		t.Fatal(err)
	}
	worker, err := f.repo.db.Pool().Acquire(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer worker.Release()
	var workerPID int
	if err := worker.QueryRow(f.ctx, `select pg_backend_pid()`).Scan(&workerPID); err != nil {
		t.Fatal(err)
	}
	completed := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(f.ctx, 5*time.Second)
		defer cancel()
		var count int
		err := worker.QueryRow(ctx, `select count(*)::int from private.claim_notification_deliveries('waiting-concurrency-fixture|wa_push_v2',1,interval '2 minutes',array['push'])`).Scan(&count)
		completed <- err
	}()
	// Confirm the real recovery transaction is waiting on the held parent
	// notification, rather than trusting a timing sleep as a concurrency proof.
	deadline := time.Now().Add(2 * time.Second)
	blocked := false
	for time.Now().Before(deadline) {
		if err := f.repo.db.Pool().QueryRow(f.ctx, `select coalesce(wait_event_type='Lock',false) from pg_stat_activity where pid=$1`, workerPID).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !blocked {
		t.Fatal("recovery did not reach the deterministic parent-lock boundary")
	}
	ctx, cancel := context.WithTimeout(f.ctx, 2*time.Second)
	defer cancel()
	if _, err := materializeTx.Exec(ctx, `select private.materialize_notification_deliveries($1::uuid,false)`, f.notificationID); err != nil {
		t.Fatalf("recover held queue lock before parent: %v", err)
	}
	if err := materializeTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-completed; err != nil {
		t.Fatalf("concurrent recovery failed: %v", err)
	}
	f.assertUnstarted(t)
	var oldWaiting int
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int from private.whatsapp_inbound_push_waiting where notification_id=$1::uuid`, f.notificationID).Scan(&oldWaiting); err != nil || oldWaiting != 0 {
		t.Fatalf("old waiting row survived reroute: %d %v", oldWaiting, err)
	}
}

func TestWhatsAppInboundPushWaitingSeedIsBoundedAndResumable(t *testing.T) {
	f := newWhatsAppPushDispatchFixture(t, true)
	other := newWhatsAppPushDispatchFixture(t, true)
	tx, err := f.repo.db.Pool().Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(f.ctx, `delete from private.whatsapp_inbound_push_waiting where notification_id=any($1::uuid[]);
		update private.whatsapp_inbound_push_waiting_seed set created_after=now()-interval '1 minute',created_until=now()+interval '1 minute',
		cursor_created_at=null,cursor_notification_id=null,completed=false where singleton`, []string{f.notificationID, other.notificationID}); err != nil {
		t.Fatal(err)
	}
	for step := range 3 {
		var processed, waiting int
		var completed bool
		if err := tx.QueryRow(f.ctx, `select private.seed_whatsapp_inbound_push_waiting(1)`).Scan(&processed); err != nil {
			t.Fatal(err)
		}
		if err := tx.QueryRow(f.ctx, `select (select count(*)::int from private.whatsapp_inbound_push_waiting),completed from private.whatsapp_inbound_push_waiting_seed where singleton`).Scan(&waiting, &completed); err != nil {
			t.Fatal(err)
		}
		want := 1
		if step == 2 {
			want = 0
		}
		if processed != want || waiting != min(step+1, 2) || completed != (step == 2) {
			t.Fatalf("seed did not advance bounded cursor: step=%d processed=%d waiting=%d completed=%v", step, processed, waiting, completed)
		}
	}
	var secured bool
	if err := tx.QueryRow(f.ctx, `select relrowsecurity
		and not has_table_privilege('authenticated',oid,'select')
		and not has_table_privilege('anon',oid,'select')
		from pg_class where oid='private.whatsapp_inbound_push_waiting'::regclass`).Scan(&secured); err != nil || !secured {
		t.Fatalf("waiting Data API isolation missing: %v %v", secured, err)
	}
}

func TestWhatsAppInboundPushWaitingExpiredOrphanNeedsNoMessageJoin(t *testing.T) {
	f := newWhatsAppPushDispatchFixture(t, true)
	requests := f.fakeHTTP(t, "fake-first-"+f.firstTokenID, nil)
	f.exec(t, `delete from public.whatsapp_messages where organization_id=$1::uuid;
		update private.whatsapp_inbound_push_waiting set expires_at=now()-interval '1 second' where organization_id=$1::uuid`, f.organizationID)
	if f.dispatch(t) || requests.Load() != 0 {
		t.Fatal("expired orphan reached a provider")
	}
	var waiting int
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int from private.whatsapp_inbound_push_waiting where organization_id=$1::uuid`, f.organizationID).Scan(&waiting); err != nil || waiting != 0 {
		t.Fatalf("orphan waiting entry never expired: %d %v", waiting, err)
	}
}
