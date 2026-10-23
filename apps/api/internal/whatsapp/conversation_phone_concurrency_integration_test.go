package whatsapp

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestLocalWhatsAppSharedPhoneChangeAndDeactivationDoNotDeadlock(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "shared-phone-user-fence")
	phone := "5511444499999"
	if _, err := db.Pool().Exec(ctx, `update public.leads set phone=$2 where id=$1::uuid`, f.leadID, phone); err != nil {
		t.Fatal(err)
	}
	blocker, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback(context.Background())
	if _, err := blocker.Exec(ctx, `set local lock_timeout='3s';select id from public.users where id=$1::uuid for update`, f.tenant.UserID); err != nil {
		t.Fatal(err)
	}
	var blockerPID int
	if err := blocker.QueryRow(ctx, `select pg_backend_pid()`).Scan(&blockerPID); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := repo.StartConversation(ctx, f.tenant, phoneConfirmationRequest(f, phone))
		done <- err
	}()
	// Actor admission precedes the route helper. Observe this exact blocker's
	// users FOR SHARE wait before the operation's three-second lock timeout.
	deadline := time.Now().Add(2 * time.Second)
	blocked := false
	for time.Now().Before(deadline) {
		select {
		case err := <-done:
			t.Fatalf("correction settled before actor fence was released: %v", err)
		default:
		}
		if err := db.Pool().QueryRow(ctx, `select exists(select 1 from pg_stat_activity activity
			where activity.datname=current_database() and activity.state='active' and activity.wait_event_type='Lock'
			and activity.query ilike '%from public.users%' and activity.query ilike '%for share%'
			and $1::integer=any(pg_blocking_pids(activity.pid)))`, blockerPID).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !blocked {
		t.Fatal("correction did not wait on the specific shared actor fence")
	}
	probe, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer probe.Rollback(context.Background())
	if _, err := probe.Exec(ctx, `select id from public.whatsapp_sessions where id=$1::uuid for update nowait;
		select id from public.whatsapp_conversations where id=$2::uuid for update nowait`, f.sessionID, f.conversationID); err != nil {
		t.Fatalf("correction locked session/conversation while still waiting for actor: %v", err)
	}
	if err := probe.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	// Deactivation's real trigger deletes grants while holding the actor row.
	// The correction must not hold that grant while waiting for this actor.
	if _, err := blocker.Exec(ctx, `update public.users set is_active=false where id=$1::uuid`, f.tenant.UserID); err != nil {
		t.Fatalf("deactivation/grant inversion: %v", err)
	}
	if err := blocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if !errors.Is(err, tenant.ErrOrganizationAccessDenied) && !errors.Is(err, ErrSessionAccessRevoked) && !errors.Is(err, ErrSessionNotFound) {
			t.Fatalf("deactivated shared actor correction: %v", err)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("correction did not finish after deactivation; possible deadlock")
	}
	assertPhoneOldRouteUntouched(t, ctx, db.Pool(), f)
}

func TestLocalWhatsAppSharedNewStartRechecksAssignmentUnderSessionFence(t *testing.T) {
	for _, scenario := range []string{"unassigned", "transferred"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			repo := NewRepository(db, nil, StorageConfig{})
			f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "shared-start-race-"+scenario)
			var leadID string
			phone := "5511555566666"
			if err := db.Pool().QueryRow(ctx, `insert into public.leads(organization_id,assigned_user_id,name,phone,source)values($1::uuid,$2::uuid,'Synthetic start assignment race',$3,'whatsapp')returning id::text`, f.organizationID, f.tenant.UserID, phone).Scan(&leadID); err != nil {
				t.Fatal(err)
			}
			blocker := holdSessionForUpdate(t, ctx, db.Pool(), f.sessionID)
			defer blocker.Rollback(context.Background())
			done := make(chan error, 1)
			go func() {
				_, err := repo.StartConversation(ctx, f.tenant, StartConversationRequest{Phone: phone, LeadID: leadID, SessionID: f.sessionID, ExpectedPreviousLeadID: unlinkedConversationLeadSnapshot})
				done <- err
			}()
			waitForSessionConversationBlockedQueries(t, ctx, db.Pool(), 1)
			if scenario == "unassigned" {
				if _, err := blocker.Exec(ctx, `update public.leads set assigned_user_id=null where id=$1::uuid`, leadID); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := blocker.Exec(ctx, `update public.leads set assigned_user_id=$2::uuid where id=$1::uuid`, leadID, f.userID); err != nil {
					t.Fatal(err)
				}
			}
			if err := blocker.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-done:
				if !errors.Is(err, ErrInvalidReference) && !errors.Is(err, ErrSessionAccessRevoked) {
					t.Fatalf("changed assignment authorized new shared start: %v", err)
				}
			case <-time.After(8 * time.Second):
				t.Fatal("new shared start did not settle after lead transfer")
			}
			var routes int
			if err := db.Pool().QueryRow(ctx, `select count(*)::int from public.whatsapp_conversations where organization_id=$1::uuid and session_id=$2::uuid and remote_jid=$3`, f.organizationID, f.sessionID, phone+"@s.whatsapp.net").Scan(&routes); err != nil || routes != 0 {
				t.Fatalf("changed assignment persisted a route: %d %v", routes, err)
			}
		})
	}
}
