package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	leadsrepo "github.com/vimob-crm/vimob-crm/apps/api/internal/leads"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	usersrepo "github.com/vimob-crm/vimob-crm/apps/api/internal/users"
)

func TestLocalDeepMediaResponseRejectsAccessLostDuringStorageIO(t *testing.T) {
	for _, scenario := range []struct {
		name, kind, change string
		status             int
		denied             bool
	}{
		{"GET transfer", "get", "transfer", 200, true},
		{"GET read revoked", "get", "permission", 200, true},
		{"GET path replaced", "get", "path", 200, true},
		{"retry ready transfer", "retry", "transfer", 200, true},
		{"retry enqueue transfer", "retry", "transfer", 503, true},
		{"GET still authorized", "get", "none", 200, false},
		{"retry still authorized", "retry", "none", 200, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			entered, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			defer once.Do(func() { close(release) })
			var pixels bytes.Buffer
			if err := png.Encode(&pixels, image.NewNRGBA(image.Rect(0, 0, 1, 1))); err != nil {
				t.Fatal(err)
			}
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.Contains(r.URL.Path, "/object/sign/") {
					close(entered)
					select {
					case <-release:
					case <-ctx.Done():
						return
					}
					if scenario.status != 200 {
						w.WriteHeader(scenario.status)
						return
					}
					_ = json.NewEncoder(w).Encode(map[string]string{"signedURL": server.URL + "/synthetic-private.png?token=synthetic"})
					return
				}
				w.Header().Set("Content-Type", "image/png")
				_, _ = w.Write(pixels.Bytes())
			}))
			defer server.Close()
			repo := NewRepository(db, nil, StorageConfig{ProjectURL: server.URL, APIKey: "synthetic"})
			f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "deep-media-"+strings.ReplaceAll(scenario.name, " ", "-"))
			path := "orgs/" + f.organizationID + "/sessions/" + f.sessionID + "/incoming/synthetic.png"
			id := insertOutboundMediaSource(t, ctx, db.Pool(), f, path, "image", "image/png")
			t.Cleanup(func() {
				cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				_, err := db.Pool().Exec(cleanupCtx, `delete from public.media_jobs where organization_id=$1::uuid`, f.organizationID)
				if err != nil {
					t.Errorf("cleanup manual jobs: %v", err)
				}
			})
			done := make(chan error, 1)
			go func() {
				if scenario.kind == "get" {
					_, err := repo.GetMessageMediaURL(ctx, f.tenant, id)
					done <- err
				} else {
					_, err := repo.RetryMediaDownload(ctx, f.tenant, id)
					done <- err
				}
			}()
			select {
			case <-entered:
			case <-ctx.Done():
				t.Fatal("signing did not start")
			}
			switch scenario.change {
			case "transfer":
				_, err := db.Pool().Exec(ctx, `update public.leads set assigned_user_id=$2::uuid where id=$1::uuid`, f.leadID, f.userID)
				if err != nil {
					t.Fatal(err)
				}
			case "permission":
				_, err := db.Pool().Exec(ctx, `insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1::uuid,$2::uuid,'lead_view_own',false)`, f.organizationID, f.tenant.UserID)
				if err != nil {
					t.Fatal(err)
				}
			case "path":
				_, err := db.Pool().Exec(ctx, `update public.whatsapp_messages set media_storage_path=$2 where id=$1::uuid`, id, path+".repaired")
				if err != nil {
					t.Fatal(err)
				}
			}
			once.Do(func() { close(release) })
			select {
			case err := <-done:
				if scenario.denied {
					if !errors.Is(err, ErrMessageNotFound) {
						t.Fatalf("late capability/job was not denied: %v", err)
					}
				} else if err != nil {
					t.Fatalf("authorized media was denied: %v", err)
				}
			case <-ctx.Done():
				t.Fatal("media response did not finish")
			}
			var jobs int
			if err := db.Pool().QueryRow(ctx, `select count(*) from public.media_jobs where organization_id=$1::uuid`, f.organizationID).Scan(&jobs); err != nil || jobs != 0 {
				t.Fatalf("late retry admitted repair jobs: %d %v", jobs, err)
			}
		})
	}
}

func TestLocalDeepMediaSecondaryReadAndManualDeleteOrder(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"signedURL": "/object/sign/synthetic?token=synthetic"})
	}))
	defer server.Close()
	repo := NewRepository(db, nil, StorageConfig{ProjectURL: server.URL, APIKey: "synthetic"})
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "deep-media-delete")
	id := insertOutboundMediaSource(t, ctx, db.Pool(), f, "orgs/"+f.organizationID+"/incoming/synthetic.png", "image", "image/png")
	other := createSessionConversationLockFixture(t, ctx, db.Pool(), "deep-media-home-org")
	t.Cleanup(func() { cleanupSessionConversationLockFixture(t, db.Pool(), other) })
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := db.Pool().Exec(cleanupCtx, `update public.users set organization_id=$2::uuid where id=$1::uuid;delete from public.media_jobs where organization_id=$2::uuid`, f.tenant.UserID, f.organizationID)
		if err != nil {
			t.Error(err)
		}
	})
	if _, err := db.Pool().Exec(ctx, `update public.users set organization_id=$2::uuid where id=$1::uuid`, f.tenant.UserID, other.organizationID); err != nil {
		t.Fatal(err)
	}
	if result, err := repo.GetMessageMediaURL(ctx, f.tenant, id); err != nil || result.URL == "" {
		t.Fatalf("authorized secondary history READ lost: %+v %v", result, err)
	}
	if _, err := db.Pool().Exec(ctx, `update public.users set organization_id=$2::uuid where id=$1::uuid`, f.tenant.UserID, f.organizationID); err != nil {
		t.Fatal(err)
	}
	message, err := repo.loadRetryMediaMessage(ctx, f.tenant, id)
	if err != nil {
		t.Fatal(err)
	}
	message.ReadScope, err = loadMessageMediaReadScope(ctx, db.Pool(), f.tenant, id, false)
	if err != nil {
		t.Fatal(err)
	}
	blocker, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback(context.Background())
	var pid int
	if err := blocker.QueryRow(ctx, `select pg_backend_pid() from public.whatsapp_conversations where id=$1::uuid for update`, f.conversationID).Scan(&pid); err != nil {
		t.Fatal(err)
	}
	admin := tenant.Context{OrganizationID: f.organizationID, UserID: f.userID, MemberRole: "admin", UserRole: "admin", Permissions: []string{"*"}}
	deleteDone := make(chan error, 1)
	go func() { deleteDone <- leadsrepo.NewRepository(db, nil).Delete(ctx, admin, f.leadID) }()
	waitDeepConversationLock(t, ctx, db.Pool(), pid)
	manualDone := make(chan error, 1)
	go func() { _, _, err := repo.enqueueManualWhatsAppMediaJob(ctx, message, f.tenant); manualDone <- err }()
	waitDeepConversationLock(t, ctx, db.Pool(), pid, 2)
	probe, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := probe.Exec(ctx, `select id from public.whatsapp_messages where id=$1::uuid for update nowait;select id from public.leads where id=$2::uuid for update nowait`, id, f.leadID); err != nil {
		_ = probe.Rollback(context.Background())
		t.Fatalf("manual owned WM/lead before waiting for route: %v", err)
	}
	if err := probe.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if err := blocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-deleteDone:
		if err != nil {
			t.Fatalf("canonical delete failed/deadlocked: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("delete did not settle")
	}
	select {
	case err := <-manualDone:
		if !errors.Is(err, ErrMessageNotFound) {
			t.Fatalf("deleted lead admitted manual retry: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("manual retry did not settle")
	}
	var jobs int
	if err := db.Pool().QueryRow(ctx, `select count(*) from public.media_jobs where organization_id=$1::uuid`, f.organizationID).Scan(&jobs); err != nil || jobs != 0 {
		t.Fatalf("deleted route admitted jobs%d %v", jobs, err)
	}
}

func TestLocalDeepManualRetrySerializesWithCanonicalUserRemoval(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "deep-media-user-remove")
	id := insertOutboundMediaSource(t, ctx, db.Pool(), f, "orgs/"+f.organizationID+"/incoming/synthetic.png", "image", "image/png")
	message, err := repo.loadRetryMediaMessage(ctx, f.tenant, id)
	if err != nil {
		t.Fatal(err)
	}
	message.ReadScope, err = loadMessageMediaReadScope(ctx, db.Pool(), f.tenant, id, false)
	if err != nil {
		t.Fatal(err)
	}
	blocker, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback(context.Background())
	var pid int
	if err := blocker.QueryRow(ctx, `select pg_backend_pid() from public.users where id=$1::uuid for update`, f.tenant.UserID).Scan(&pid); err != nil {
		t.Fatal(err)
	}
	waitActor := func(want int) {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			var n int
			if err := db.Pool().QueryRow(ctx, `select count(*) from pg_stat_activity where datname=current_database() and pid<>$1 and wait_event_type='Lock' and query like '%public.users%'`, pid).Scan(&n); err != nil {
				t.Fatal(err)
			}
			if n >= want {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatal("actual actor lock wait not reached")
	}
	admin := tenant.Context{OrganizationID: f.organizationID, UserID: f.userID, MemberRole: "admin", UserRole: "admin", Permissions: []string{"*"}}
	removed := make(chan error, 1)
	go func() {
		_, err := usersrepo.NewRepository(db, usersrepo.AuthAdminConfig{}).DeleteOrganizationUser(ctx, admin, f.tenant.UserID, usersrepo.DeleteUserInput{TransferLeadsToUserID: &f.userID})
		removed <- err
	}()
	waitActor(1)
	manual := make(chan error, 1)
	go func() { _, _, err := repo.enqueueManualWhatsAppMediaJob(ctx, message, f.tenant); manual <- err }()
	waitActor(2)
	probe, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := probe.Exec(ctx, `select id from public.whatsapp_conversations where id=$1::uuid for update nowait;select id from public.leads where id=$2::uuid for update nowait;select id from public.whatsapp_messages where id=$3::uuid for update nowait`, f.conversationID, f.leadID, id); err != nil {
		_ = probe.Rollback(context.Background())
		t.Fatalf("manual retry owned CRM/media before actor serialization: %v", err)
	}
	if err := probe.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if err := blocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-removed:
		if err != nil {
			t.Fatalf("canonical user removal failed/deadlocked: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("removal did not settle")
	}
	select {
	case err := <-manual:
		if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
			t.Fatalf("removed actor admitted retry: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("manual retry did not settle")
	}
	var jobs int
	if err := db.Pool().QueryRow(ctx, `select count(*) from public.media_jobs where organization_id=$1::uuid`, f.organizationID).Scan(&jobs); err != nil || jobs != 0 {
		t.Fatalf("removed user admitted jobs%d %v", jobs, err)
	}
}

type mediaPermissionInterleaveRower struct {
	base  whatsappQueryRower
	after func() error
	once  sync.Once
}

func (rower *mediaPermissionInterleaveRower) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	row := rower.base.QueryRow(ctx, query, args...)
	if strings.HasPrefix(query, "select coalesce(member.role") {
		return mediaPermissionInterleaveRow{row: row, rower: rower}
	}
	return row
}

type mediaPermissionInterleaveRow struct {
	row   pgx.Row
	rower *mediaPermissionInterleaveRower
}

func (row mediaPermissionInterleaveRow) Scan(values ...any) error {
	if err := row.row.Scan(values...); err != nil {
		return err
	}
	var err error
	row.rower.once.Do(func() { err = row.rower.after() })
	return err
}

func TestLocalDeepMediaAuthorizationPinsPermissionSnapshot(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "deep-media-rbac-snapshot")
	id := insertOutboundMediaSource(t, ctx, db.Pool(), f, "orgs/"+f.organizationID+"/incoming/synthetic.png", "image", "image/png")
	rower := &mediaPermissionInterleaveRower{base: db.Pool(), after: func() error {
		_, err := db.Pool().Exec(ctx, `insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1::uuid,$2::uuid,'lead_view_own',false)`, f.organizationID, f.tenant.UserID)
		return err
	}}
	if _, err := loadMessageMediaReadScope(ctx, rower, f.tenant, id, true); !errors.Is(err, ErrMessageNotFound) {
		t.Fatalf("resource query borrowed old permission flags: %v", err)
	}
}

func TestLocalDeepInlineHydrationFiltersMediaAfterReadLoss(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	defer once.Do(func() { close(release) })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		select {
		case <-release:
		case <-ctx.Done():
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"signedURL": "/object/sign/whatsapp-media/synthetic?token=synthetic"})
	}))
	defer server.Close()
	repo := NewRepository(db, nil, StorageConfig{ProjectURL: server.URL, APIKey: "synthetic"})
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "deep-inline-hydration")
	id := insertOutboundMediaSource(t, ctx, db.Pool(), f, "orgs/"+f.organizationID+"/incoming/synthetic.png", "image", "image/png")
	type result struct {
		page MessagePage
		err  error
	}
	done := make(chan result, 1)
	go func() {
		page, err := repo.ListMessages(ctx, f.tenant, f.conversationID, MessageFilter{Limit: 20, OrderingVersion: 2, IncludeMediaURLs: true, ExpectedLeadID: f.leadID})
		done <- result{page, err}
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("inline hydration did not start")
	}
	if _, err := db.Pool().Exec(ctx, `update public.leads set assigned_user_id=$2::uuid where id=$1::uuid`, f.leadID, f.userID); err != nil {
		t.Fatal(err)
	}
	once.Do(func() { close(release) })
	select {
	case result := <-done:
		if result.err != nil || len(result.page.Messages) != 1 || result.page.Messages[0].ID != id || result.page.Messages[0].MediaURL != nil {
			t.Fatalf("inline history must preserve its row without a late capability: %+v %v", result.page, result.err)
		}
	case <-ctx.Done():
		t.Fatal("hydration did not settle")
	}
}
