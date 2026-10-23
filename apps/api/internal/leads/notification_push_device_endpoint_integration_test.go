package leads

import (
	"context"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/settings"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
	"strings"
	"sync"
	"testing"
	"time"
)

func pushDeviceFixtureSession(t *testing.T, f *whatsappPushFixture, userID, sid string) context.Context {
	t.Helper()
	f.exec(t, `insert into auth.sessions(id,user_id,created_at,updated_at) values($1::uuid,$2::uuid,now(),now())`, sid, userID)
	return httpserver.ContextWithUser(f.ctx, authpkg.User{ID: userID, SessionID: sid})
}

func TestNotificationPushDeviceEndpointAdmissionIntegration(t *testing.T) {
	for _, mode := range []string{"concurrent_accounts", "stale_sid_deactivation", "revoked_sid_waiting_endpoint", "legacy_active_adoption", "legacy_inactive_intentional_registration", "legacy_writer_exclusivity"} {
		t.Run(mode, func(t *testing.T) {
			f := newWhatsAppPushDispatchFixture(t)
			repo := settings.NewRepository(f.repo.db, settings.ExternalConfig{})
			first := tenant.Context{OrganizationID: f.organizationID, UserID: f.firstID}
			next := tenant.Context{OrganizationID: f.organizationID, UserID: f.nextID}
			firstContext := pushDeviceFixtureSession(t, f, f.firstID, f.firstID)
			nextContext := pushDeviceFixtureSession(t, f, f.nextID, f.nextID)
			endpoint := "native:android:synthetic-exclusive-" + f.sessionID
			request := settings.PushTokenRequest{Endpoint: endpoint}
			save := func(ctx context.Context, actor tenant.Context) error {
				result, err := repo.SavePushToken(ctx, actor, request)
				if err == nil && !result.Active {
					t.Errorf("registration unexpectedly inactive: %+v", result)
				}
				return err
			}
			assertOwner := func(userID string) {
				t.Helper()
				var n int
				var owner string
				if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int,coalesce(min(user_id::text),'') from public.push_tokens where is_active is true and private.push_device_endpoint_key(endpoint,platform,token)=private.push_device_endpoint_key($1,'android',$2)`, endpoint, strings.TrimPrefix(endpoint, "native:android:")).Scan(&n, &owner); err != nil || n != 1 || owner != userID {
					t.Fatalf("physical endpoint owner: count=%d owner=%s want=%s err=%v", n, owner, userID, err)
				}
			}
			switch mode {
			case "concurrent_accounts":
				barrier := make(chan struct{})
				results := make(chan error, 2)
				var launched sync.WaitGroup
				launched.Add(2)
				for _, actor := range []struct {
					ctx   context.Context
					actor tenant.Context
				}{{firstContext, first}, {nextContext, next}} {
					go func() { launched.Done(); <-barrier; results <- save(actor.ctx, actor.actor) }()
				}
				launched.Wait()
				close(barrier)
				for range 2 {
					if err := <-results; err != nil {
						t.Fatal(err)
					}
				}
				var n int
				if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*)::int from public.push_tokens where endpoint=$1 and is_active is true`, endpoint).Scan(&n); err != nil || n != 1 {
					t.Fatalf("concurrent registrations retained %d active owners: %v", n, err)
				}
			case "stale_sid_deactivation":
				if err := save(firstContext, first); err != nil {
					t.Fatal(err)
				}
				newContext := pushDeviceFixtureSession(t, f, f.firstID, f.firstTokenID)
				if err := save(newContext, first); err != nil {
					t.Fatal(err)
				}
				if err := repo.DeactivatePushToken(firstContext, first, settings.DeactivatePushTokenRequest{Endpoint: &endpoint}); err != nil {
					t.Fatal(err)
				}
				assertOwner(f.firstID)
				if err := save(newContext, first); err != nil {
					t.Fatalf("same SID refresh rejected: %v", err)
				}
				if err := repo.DeactivatePushToken(newContext, first, settings.DeactivatePushTokenRequest{Endpoint: &endpoint}); err != nil {
					t.Fatal(err)
				}
				var active bool
				if err := f.repo.db.Pool().QueryRow(f.ctx, `select is_active from public.push_tokens where user_id=$1::uuid and endpoint=$2`, f.firstID, endpoint).Scan(&active); err != nil || active {
					t.Fatalf("current SID failed to deactivate: %v %v", active, err)
				}
			case "revoked_sid_waiting_endpoint":
				if err := save(nextContext, next); err != nil {
					t.Fatal(err)
				}
				writer, err := f.repo.db.Pool().Begin(f.ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer writer.Rollback(context.Background())
				if _, err = writer.Exec(f.ctx, `select pg_advisory_xact_lock(hashtextextended('push-device:'||private.push_device_endpoint_key($1,'android',$2),0))`, endpoint, strings.TrimPrefix(endpoint, "native:android:")); err != nil {
					t.Fatal(err)
				}
				finished := make(chan error, 1)
				go func() { finished <- save(firstContext, first) }()
				waiting := false
				deadline := time.Now().Add(1500 * time.Millisecond)
				for time.Now().Before(deadline) {
					if err = f.repo.db.Pool().QueryRow(f.ctx, `select exists(select 1 from pg_stat_activity where datname=current_database() and query like '%pg_advisory_xact_lock%' and wait_event_type='Lock')`).Scan(&waiting); err != nil {
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
					t.Fatal("registration did not reach endpoint lock")
				}
				if _, err = writer.Exec(f.ctx, `delete from auth.sessions where id=$1::uuid`, f.firstID); err != nil {
					t.Fatal(err)
				}
				if err = writer.Commit(f.ctx); err != nil {
					t.Fatal(err)
				}
				if err = <-finished; err == nil {
					t.Fatal("revoked session registered after endpoint wait")
				}
				assertOwner(f.nextID)
			case "legacy_active_adoption", "legacy_inactive_intentional_registration":
				f.exec(t, `update public.push_tokens set endpoint=null,token=$2,platform='android' where id=$1::uuid`, f.firstTokenID, strings.TrimPrefix(endpoint, "native:android:"))
				if mode == "legacy_inactive_intentional_registration" {
					f.exec(t, `update public.push_tokens set is_active=false where id=$1::uuid`, f.firstTokenID)
				}
				if err := save(firstContext, first); err != nil {
					t.Fatal(err)
				}
				assertOwner(f.firstID)
				var id string
				if err := f.repo.db.Pool().QueryRow(f.ctx, `select id::text from public.push_tokens where user_id=$1::uuid and endpoint=$2`, f.firstID, endpoint).Scan(&id); err != nil || id != f.firstTokenID {
					t.Fatalf("legacy row identity changed: %s %v", id, err)
				}
			case "legacy_writer_exclusivity":
				if err := save(firstContext, first); err != nil {
					t.Fatal(err)
				}
				_, err := f.repo.db.Pool().Exec(f.ctx, `insert into public.push_tokens(organization_id,user_id,token,platform,is_active) values($1::uuid,$2::uuid,$3,'ios',true)`, f.organizationID, f.nextID, strings.TrimPrefix(endpoint, "native:android:"))
				if err == nil {
					t.Fatal("legacy writer bypassed active endpoint exclusivity")
				}
				assertOwner(f.firstID)
			}
		})
	}
}
