package leads

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/settings"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// All provider calls use the fixture's loopback httptest transport. The fixture
// rejects every URL except the explicitly label-verified disposable database.
func TestNotificationPushDeviceAccountScopeIntegration(t *testing.T) {
	for _, mode := range []string{"original_and_calendar", "boot_secondary", "delete_registration_org", "membership_removed", "token_revoked", "other_account", "started_membership_change"} {
		t.Run(mode, func(t *testing.T) {
			f := newWhatsAppPushDispatchFixture(t, mode == "boot_secondary")
			secondary := newPushDeviceSecondaryOrganization(t, f)
			if mode != "started_membership_change" {
				f.exec(t, `update public.push_tokens set organization_id=$2::uuid,is_active=true where id=$1::uuid`, f.firstTokenID, secondary)
			}
			f.exec(t, `select private.materialize_notification_deliveries($1::uuid,false)`, f.notificationID)
			if mode == "delete_registration_org" {
				calendarID := insertPushDeviceCalendarNotification(t, f, secondary)
				f.exec(t, `delete from public.organizations where id=$1::uuid`, secondary)
				var retained bool
				if err := f.repo.db.Pool().QueryRow(f.ctx, `select exists(select 1 from public.push_tokens where id=$1::uuid and user_id=$2::uuid and is_active and organization_id is null)
				 and not exists(select 1 from public.notifications where id=$3::uuid)`, f.firstTokenID, f.firstID, calendarID).Scan(&retained); err != nil || !retained {
					t.Fatalf("registration-org delete removed the account device or retained secondary notification: %v %v", retained, err)
				}
			}
			var deliveries int
			if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int from private.notification_deliveries where notification_id=$1::uuid and channel='push'`, f.notificationID).Scan(&deliveries); err != nil || deliveries != 1 {
				t.Fatalf("original organization lost the account-owned device: deliveries=%d error=%v", deliveries, err)
			}
			onRequest := func() {}
			if mode == "started_membership_change" {
				onRequest = func() {
					ctx, cancel := context.WithTimeout(f.ctx, 2*time.Second)
					defer cancel()
					if _, err := f.repo.db.Pool().Exec(ctx, `update public.organization_members set is_active=false where organization_id=$1::uuid and user_id=$2::uuid`, f.organizationID, f.firstID); err != nil {
						t.Errorf("provider HTTP retained account/membership locks: %v", err)
					}
				}
			}
			requests := f.fakeHTTP(t, "fake-first-"+f.firstTokenID, onRequest)
			switch mode {
			case "membership_removed":
				f.exec(t, `update public.organization_members set is_active=false where organization_id=$1::uuid and user_id=$2::uuid`, f.organizationID, f.firstID)
			case "token_revoked":
				f.exec(t, `update public.push_tokens set is_active=false where id=$1::uuid`, f.firstTokenID)
			case "other_account":
				f.exec(t, `update public.push_tokens set user_id=$2::uuid where id=$1::uuid`, f.firstTokenID, f.nextID)
			}
			f.dispatch(t)
			if mode == "membership_removed" || mode == "token_revoked" || mode == "other_account" {
				if requests.Load() != 0 {
					t.Fatalf("revoked account/device reached provider: %d", requests.Load())
				}
				f.assertUnstarted(t)
				return
			}
			if requests.Load() != 1 {
				t.Fatalf("original attendant did not receive exactly one push: %d", requests.Load())
			}
			if f.dispatch(t) {
				t.Fatal("accepted push was replayed")
			}
			if mode == "original_and_calendar" {
				insertPushDeviceCalendarNotification(t, f, secondary)
				if !f.dispatch(t) || requests.Load() != 2 {
					t.Fatalf("secondary calendar lost the same device: %d", requests.Load())
				}
				if f.dispatch(t) {
					t.Fatal("calendar push was replayed")
				}
			}
		})
	}
}

func newPushDeviceSecondaryOrganization(t *testing.T, f *whatsappPushFixture) string {
	t.Helper()
	var id string
	if err := f.repo.db.Pool().QueryRow(f.ctx, `insert into public.organizations(name,is_active) values('Synthetic device secondary',true) returning id::text`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		// RED runs use the old CASCADE registration FK. Remove this fixture's
		// original-org deliveries first so its cross-org token cannot orphan a
		// non-null delivery reference during cleanup after the expected failure.
		if _, err := f.repo.db.Pool().Exec(ctx, `delete from public.notifications where organization_id=$2::uuid;delete from public.organizations where id=$1::uuid`, id, f.organizationID); err != nil {
			t.Errorf("cleanup device secondary: %v", err)
		}
	})
	f.exec(t, `insert into public.organization_members(organization_id,user_id,role,is_active) values($1::uuid,$2::uuid,'user',true)`, id, f.firstID)
	return id
}

func insertPushDeviceCalendarNotification(t *testing.T, f *whatsappPushFixture, organizationID string) string {
	t.Helper()
	var id string
	if err := f.repo.db.Pool().QueryRow(f.ctx, `insert into public.notifications(organization_id,user_id,title,content,type,target_url,metadata)
	 values($1::uuid,$2::uuid,'Synthetic calendar','Reminder','info','/agenda',jsonb_build_object('event_key','schedule_reminder','dispatch',jsonb_build_object('push',jsonb_build_object('required',true)))) returning id::text`, organizationID, f.firstID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestNotificationPushDeviceProtocolAndStartFenceIntegration(t *testing.T) {
	for _, mode := range []string{"v1_cross_org", "v2_cross_org", "v1_same_org", "start_member_revoked", "start_token_revoked", "start_owner_changed"} {
		t.Run(mode, func(t *testing.T) {
			f := newWhatsAppPushDispatchFixture(t)
			secondary := newPushDeviceSecondaryOrganization(t, f)
			// A generic secondary notification proves this protocol does not rely
			// on the WhatsApp-specific authorization reducer.
			f.exec(t, `delete from public.notifications where id=$1::uuid`, f.notificationID)
			if mode == "v1_same_org" {
				f.exec(t, `update public.push_tokens set organization_id=$2::uuid where id=$1::uuid`, f.firstTokenID, secondary)
			}
			id := insertPushDeviceCalendarNotification(t, f, secondary)
			worker := normalizedNotificationWorkerID()
			if strings.HasPrefix(mode, "v1") {
				worker = "vimob-api:legacy:1"
			}
			if strings.HasPrefix(mode, "v2") {
				worker = "vimob-api:previous:1|wa_push_v2"
			}
			var claimed int
			if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int from private.claim_notification_deliveries($1,1,interval '2 minutes',array['push'])`, worker).Scan(&claimed); err != nil {
				t.Fatal(err)
			}
			if mode == "v1_cross_org" || mode == "v2_cross_org" {
				if claimed != 0 {
					t.Fatal("old worker consumed a cross-organization device delivery")
				}
				f.assertUnstarted(t)
				return
			}
			if claimed != 1 {
				t.Fatalf("current/compatible worker failed to claim: %d", claimed)
			}
			if mode == "v1_same_org" {
				f.assertUnstarted(t)
				return
			}
			switch mode {
			case "start_member_revoked":
				f.exec(t, `update public.organization_members set is_active=false where organization_id=$1::uuid and user_id=$2::uuid`, secondary, f.firstID)
			case "start_token_revoked":
				f.exec(t, `update public.push_tokens set is_active=false where id=$1::uuid`, f.firstTokenID)
			case "start_owner_changed":
				f.exec(t, `update public.push_tokens set user_id=$2::uuid where id=$1::uuid`, f.firstTokenID, f.nextID)
			}
			var started bool
			if err := f.repo.db.Pool().QueryRow(f.ctx, `select private.start_notification_delivery(id,lease_token,'fcm') from private.notification_deliveries where notification_id=$1::uuid`, id).Scan(&started); err != nil {
				t.Fatal(err)
			}
			if started {
				t.Fatal("revoked current account/device acquired provider-start marker")
			}
			var attempts int
			var status string
			if err := f.repo.db.Pool().QueryRow(f.ctx, `select attempt_count,status from private.notification_deliveries where notification_id=$1::uuid`, id).Scan(&attempts, &status); err != nil || attempts != 0 || status != "cancelled" {
				t.Fatalf("revoked delivery was not terminal before HTTP: attempts=%d status=%s error=%v", attempts, status, err)
			}
			f.assertUnstarted(t)
		})
	}
}

func TestNotificationPushDeviceGenericRevocationBeforeDispatchIntegration(t *testing.T) {
	for _, mode := range []string{"membership", "device", "account_owner"} {
		t.Run(mode, func(t *testing.T) {
			f := newWhatsAppPushDispatchFixture(t)
			secondary := newPushDeviceSecondaryOrganization(t, f)
			f.exec(t, `delete from public.notifications where id=$1::uuid`, f.notificationID)
			id := insertPushDeviceCalendarNotification(t, f, secondary)
			var materialized int
			if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int from private.notification_deliveries where notification_id=$1::uuid and channel='push'`, id).Scan(&materialized); err != nil || materialized != 1 {
				t.Fatalf("negative must begin with one real materialized push job: %d %v", materialized, err)
			}
			requests := f.fakeHTTP(t, "fake-first-"+f.firstTokenID, nil)
			switch mode {
			case "membership":
				f.exec(t, `update public.organization_members set is_active=false where organization_id=$1::uuid and user_id=$2::uuid`, secondary, f.firstID)
			case "device":
				f.exec(t, `update public.push_tokens set is_active=false where id=$1::uuid`, f.firstTokenID)
			case "account_owner":
				f.exec(t, `update public.push_tokens set user_id=$2::uuid where id=$1::uuid`, f.firstTokenID, f.nextID)
			}
			if f.dispatch(t) || requests.Load() != 0 {
				t.Fatal("revoked generic recipient/device reached provider")
			}
			var attempts int
			if err := f.repo.db.Pool().QueryRow(f.ctx, `select coalesce(sum(attempt_count),0)::int from private.notification_deliveries where notification_id=$1::uuid`, id).Scan(&attempts); err != nil || attempts != 0 {
				t.Fatalf("zero HTTP consumed an attempt: %d %v", attempts, err)
			}
		})
	}
}

func TestNotificationPushDeviceActorLockOrderAndTransferIntegration(t *testing.T) {
	for _, mode := range []string{"writer_lead_session", "transfer_during_actor_wait"} {
		t.Run(mode, func(t *testing.T) {
			f := newWhatsAppPushDispatchFixture(t)
			requests := f.fakeHTTP(t, "fake-first-"+f.firstTokenID, nil)
			writer, err := f.repo.db.Pool().Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer writer.Rollback(context.Background())
			if _, err := writer.Exec(f.ctx, `set local lock_timeout='350ms';select id from public.users where id=$1::uuid for update`, f.firstID); err != nil {
				t.Fatal(err)
			}
			type outcome struct {
				processed bool
				err       error
			}
			finished := make(chan outcome, 1)
			go func() {
				processed, err := f.repo.processOneNormalizedNotificationDelivery(f.ctx, nil)
				finished <- outcome{processed, err}
			}()
			waiting := false
			deadline := time.Now().Add(1500 * time.Millisecond)
			for time.Now().Before(deadline) {
				if err := f.repo.db.Pool().QueryRow(f.ctx, `select exists(select 1 from pg_catalog.pg_stat_activity where datname=current_database()
				 and query like '%prepare_whatsapp_inbound_attendant_push%' and wait_event_type='Lock')`).Scan(&waiting); err != nil {
					t.Fatal(err)
				}
				if waiting {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if !waiting {
				_ = writer.Rollback(f.ctx)
				<-finished
				t.Fatal("push did not reach the real actor lock wait")
			}
			if requests.Load() != 0 {
				t.Fatal("provider started while actor writer held authorization")
			}
			if mode == "writer_lead_session" {
				if _, err := writer.Exec(f.ctx, `select id from public.leads where id=$1::uuid for update;select id from public.whatsapp_sessions where id=$2::uuid for update`, f.leadID, f.sessionID); err != nil {
					_ = writer.Rollback(f.ctx)
					<-finished
					t.Fatalf("push acquired resources before actor locks: %v", err)
				}
				if err := writer.Rollback(f.ctx); err != nil {
					t.Fatal(err)
				}
				result := <-finished
				if result.err != nil || !result.processed || requests.Load() != 1 {
					t.Fatalf("authorized dispatch after writer release: %+v HTTP=%d", result, requests.Load())
				}
				return
			}
			if _, err := writer.Exec(f.ctx, `update public.leads set assigned_user_id=$2::uuid where id=$1::uuid`, f.leadID, f.nextID); err != nil {
				_ = writer.Rollback(f.ctx)
				<-finished
				t.Fatalf("transfer blocked behind resources held by actor waiter: %v", err)
			}
			if err := writer.Commit(f.ctx); err != nil {
				t.Fatal(err)
			}
			result := <-finished
			if result.err != nil || !result.processed || requests.Load() != 0 {
				t.Fatalf("changed snapshot reached provider: %+v HTTP=%d", result, requests.Load())
			}
			f.assertUnstarted(t)
			var state, errorMessage string
			if err := f.repo.db.Pool().QueryRow(f.ctx, `select status,coalesce(last_error_message,'') from private.notification_deliveries where notification_id=$1::uuid`, f.notificationID).Scan(&state, &errorMessage); err != nil || state != "retry_wait" || !strings.Contains(errorMessage, "whatsapp_push_actor_changed_during_lock") {
				t.Fatalf("actor CAS did not preserve retryable pending alert: %s %s %v", state, errorMessage, err)
			}
			f.exec(t, `update private.notification_deliveries set next_attempt_at=now() where notification_id=$1::uuid`, f.notificationID)
			if !f.dispatch(t) || requests.Load() != 0 {
				t.Fatal("pending alert did not redirect before provider")
			}
			f.assertRedirected(t)
			currentRequests := f.fakeHTTP(t, "fake-next-"+f.nextTokenID, nil)
			if !f.dispatch(t) || currentRequests.Load() != 1 {
				t.Fatalf("current attendant was not delivered after actor CAS: %d", currentRequests.Load())
			}
		})
	}
}

func TestNotificationPushDeviceSettingsAccountCompatibilityIntegration(t *testing.T) {
	f := newWhatsAppPushDispatchFixture(t)
	secondary := newPushDeviceSecondaryOrganization(t, f)
	repo := settings.NewRepository(f.repo.db, settings.ExternalConfig{})
	firstA := tenant.Context{OrganizationID: f.organizationID, UserID: f.firstID}
	firstB := tenant.Context{OrganizationID: secondary, UserID: f.firstID}
	nextA := tenant.Context{OrganizationID: f.organizationID, UserID: f.nextID}
	firstContext := pushDeviceFixtureSession(t, f, f.firstID, f.firstID)
	nextContext := pushDeviceFixtureSession(t, f, f.nextID, f.nextID)
	endpoint := "native:android:synthetic-shared-" + f.sessionID
	request := settings.PushTokenRequest{Endpoint: endpoint}
	if result, err := repo.SavePushToken(firstContext, firstA, request); err != nil || !result.Active {
		t.Fatalf("original registration: %+v %v", result, err)
	}
	var originalID, afterMoveID string
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select id::text from public.push_tokens where user_id=$1::uuid and endpoint=$2`, f.firstID, endpoint).Scan(&originalID); err != nil {
		t.Fatal(err)
	}
	if result, err := repo.SavePushToken(firstContext, firstB, request); err != nil || !result.Active {
		t.Fatalf("secondary registration: %+v %v", result, err)
	}
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select id::text from public.push_tokens where user_id=$1::uuid and endpoint=$2`, f.firstID, endpoint).Scan(&afterMoveID); err != nil || originalID != afterMoveID {
		t.Fatalf("legacy UPDATE changed stable token identity: %s %s %v", originalID, afterMoveID, err)
	}
	for _, scope := range []tenant.Context{firstA, firstB} {
		devices, err := repo.ListPushDevices(f.ctx, scope)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, device := range devices {
			if device.ID == originalID {
				found = true
			}
			if device.ID == f.nextTokenID {
				t.Fatal("device catalogue leaked another account")
			}
		}
		if !found {
			t.Fatalf("own device hidden in organization %s", scope.OrganizationID)
		}
	}
	if err := repo.DeactivatePushToken(firstContext, firstA, settings.DeactivatePushTokenRequest{Endpoint: &endpoint}); err != nil {
		t.Fatal(err)
	}
	syncOnly := true
	request.SyncOnly = &syncOnly
	if result, err := repo.SavePushToken(firstContext, firstB, request); err != nil || result.Active || !result.RequiresResubscribe {
		t.Fatalf("background sync resurrected revoked device: %+v %v", result, err)
	}
	request.SyncOnly = nil
	if result, err := repo.SavePushToken(firstContext, firstB, request); err != nil || !result.Active {
		t.Fatalf("intentional current registration was blocked: %+v %v", result, err)
	}
	if result, err := repo.SavePushToken(nextContext, nextA, request); err != nil || !result.Active {
		t.Fatalf("new account device registration: %+v %v", result, err)
	}
	if err := repo.DeactivatePushToken(firstContext, firstA, settings.DeactivatePushTokenRequest{Endpoint: &endpoint}); err != nil {
		t.Fatal(err)
	}
	var protected bool
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select exists(select 1 from public.push_tokens where user_id=$1::uuid and endpoint=$2 and is_active)
	 and not exists(select 1 from public.push_tokens where user_id=$3::uuid and endpoint=$2 and is_active)`, f.nextID, endpoint, f.firstID).Scan(&protected); err != nil || !protected {
		t.Fatalf("previous account cleanup changed the new device owner: %v %v", protected, err)
	}
}
