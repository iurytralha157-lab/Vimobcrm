package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// This reuses the existing exact-port, cluster-identity and disposable DB guard.
// It creates only synthetic organizations/users/saved text, never a provider send.
func TestQuickReplyPersistenceAndHTTPIsolation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	database := openLocalOutboundDatabase(t, ctx)
	actors := createQuickReplyFixture(t, ctx, database.Pool())
	repo := NewRepository(database, nil, StorageConfig{})
	mux := quickReplyTestMux(NewHandler(repo))
	var saved QuickReply
	for i, actor := range actors {
		response := quickReplyHTTP(mux, actor, http.MethodPost, "", `{"shortcut":" /HeLLo ","content":"  Olá 🧡\nVisita.  "}`)
		if response.Code != http.StatusCreated {
			t.Fatalf("actor%d: %d %s", i, response.Code, response.Body.String())
		}
		var envelope Envelope[QuickReply]
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.Data.Shortcut != "hello" || envelope.Data.Content != "  Olá 🧡\nVisita.  " {
			t.Fatal(envelope.Data)
		}
		if strings.Contains(response.Body.String(), "organization_id") || strings.Contains(response.Body.String(), "user_id") || strings.Contains(response.Body.String(), "owner_slot") {
			t.Fatal("private ownership leaked")
		}
		if i == 0 {
			saved = envelope.Data
		}
	}
	duplicate := quickReplyHTTP(mux, actors[0], http.MethodPost, "", `{"shortcut":"HELLO","content":"Other"}`)
	if duplicate.Code != 409 || !strings.Contains(duplicate.Body.String(), "shortcut_conflict") {
		t.Fatal(duplicate.Body.String())
	}
	// A new repository instance must read the committed value, not an in-memory success.
	fresh := NewRepository(database, nil, StorageConfig{})
	for _, actor := range actors {
		items, err := fresh.ListQuickReplies(ctx, actor)
		if err != nil || len(items) != 1 {
			t.Fatalf("persisted own list=%+v err=%v", items, err)
		}
	}
	for _, actor := range actors[1:] {
		for _, method := range []string{http.MethodPatch, http.MethodDelete} {
			response := quickReplyHTTP(mux, actor, method, saved.ID, `{"content":"Foreign update"}`)
			if response.Code != 404 {
				t.Fatalf("foreign %s status=%d %s", method, response.Code, response.Body.String())
			}
		}
	}
	patched := quickReplyHTTP(mux, actors[0], http.MethodPatch, saved.ID, `{"content":"  Updated\n🧡  "}`)
	var updated Envelope[QuickReply]
	if patched.Code != 200 || json.Unmarshal(patched.Body.Bytes(), &updated) != nil {
		t.Fatal(patched.Body.String())
	}
	if updated.Data.Content != "  Updated\n🧡  " || updated.Data.Shortcut != "hello" || !updated.Data.CreatedAt.Equal(saved.CreatedAt) || updated.Data.UpdatedAt.Before(saved.UpdatedAt) {
		t.Fatal(updated.Data)
	}
	missing := quickReplyHTTP(mux, actors[0], http.MethodPatch, "not-a-uuid", `{"content":"Valid"}`)
	if missing.Code != 404 {
		t.Fatalf("malformed ID status=%d", missing.Code)
	}
	deleted := quickReplyHTTP(mux, actors[0], http.MethodDelete, saved.ID, "")
	if deleted.Code != 204 {
		t.Fatal(deleted.Body.String())
	}
	if repeated := quickReplyHTTP(mux, actors[0], http.MethodDelete, saved.ID, ""); repeated.Code != 404 {
		t.Fatal("repeat delete must be 404")
	}
	for i, actor := range actors {
		response := quickReplyHTTP(mux, actor, http.MethodGet, "", "")
		var envelope Envelope[[]QuickReply]
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &envelope) != nil || envelope.Data == nil {
			t.Fatal(response.Body.String())
		}
		want := 1
		if i == 0 {
			want = 0
		}
		if len(envelope.Data) != want {
			t.Fatalf("owner%d list length=%d want%d", i, len(envelope.Data), want)
		}
	}
}

func TestQuickReplyConcurrentOwnerLimitAndSlotReuse(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	database := openLocalOutboundDatabase(t, ctx)
	actors := createQuickReplyFixture(t, ctx, database.Pool())
	repo := NewRepository(database, nil, StorageConfig{})
	if _, err := database.Pool().Exec(ctx, `insert into private.whatsapp_quick_replies(organization_id,user_id,shortcut,content)
		select $1::uuid,$2::uuid,'saved-'||n::text,'Synthetic saved message' from generate_series(1,199) n`, actors[0].OrganizationID, actors[0].UserID); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 8)
	var wait sync.WaitGroup
	for i := range 8 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			_, err := repo.CreateQuickReply(ctx, actors[0], quickReplyInput{Shortcut: fmt.Sprintf("race-%d", i), Content: "Concurrent synthetic message"})
			results <- err
		}()
	}
	close(start)
	wait.Wait()
	close(results)
	success, limited := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, ErrQuickReplyLimit) {
			limited++
		} else {
			t.Fatalf("unexpected concurrent result: %v", err)
		}
	}
	if success != 1 || limited != 7 {
		t.Fatalf("success=%d limit=%d", success, limited)
	}
	items, err := repo.ListQuickReplies(ctx, actors[0])
	if err != nil || len(items) != quickReplyLimit {
		t.Fatalf("count=%d err=%v", len(items), err)
	}
	if err := repo.DeleteQuickReply(ctx, actors[0], items[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateQuickReply(ctx, actors[0], quickReplyInput{Shortcut: "reused-slot", Content: "After delete"}); err != nil {
		t.Fatal(err)
	}
	for _, actor := range actors[1:] {
		if _, err := repo.CreateQuickReply(ctx, actor, quickReplyInput{Shortcut: "independent", Content: "Another owner or organization"}); err != nil {
			t.Fatal(err)
		}
	}
}

func quickReplyTestMux(handler Handler) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/whatsapp/quick-replies", handler.ListQuickReplies)
	mux.HandleFunc("POST /v1/whatsapp/quick-replies", handler.CreateQuickReply)
	mux.HandleFunc("PATCH /v1/whatsapp/quick-replies/{id}", handler.UpdateQuickReply)
	mux.HandleFunc("DELETE /v1/whatsapp/quick-replies/{id}", handler.DeleteQuickReply)
	return mux
}

func quickReplyHTTP(mux *http.ServeMux, actor tenant.Context, method, id, body string) *httptest.ResponseRecorder {
	path := "/v1/whatsapp/quick-replies"
	if id != "" {
		path += "/" + id
	}
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r = r.WithContext(tenant.ContextWithTenant(r.Context(), actor))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func createQuickReplyFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) []tenant.Context {
	t.Helper()
	suffix := fmt.Sprintf("wa-quick-reply-%d", time.Now().UnixNano())
	var orgA, orgB, userA, userB string
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text`).Scan(&orgA, &orgB, &userA, &userB); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		// The full local DDL clone has many legacy cascading FKs. Delete the
		// fixture's exact scopes explicitly and identify any failing cleanup step.
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		for _, step := range []struct {
			name, query string
			ids         []string
		}{
			{"personal rows", `delete from private.whatsapp_quick_replies where organization_id=any($1::uuid[])`, []string{orgA, orgB}},
			{"memberships", `delete from public.organization_members where organization_id=any($1::uuid[])`, []string{orgA, orgB}},
			{"user organization", `update public.users set organization_id=null where id=any($1::uuid[])`, []string{userA, userB}},
			{"profiles", `delete from public.users where id=any($1::uuid[])`, []string{userA, userB}},
			{"auth users", `delete from auth.users where id=any($1::uuid[])`, []string{userA, userB}},
			{"organizations", `delete from public.organizations where id=any($1::uuid[])`, []string{orgA, orgB}},
		} {
			started := time.Now()
			if _, err := pool.Exec(cleanupCtx, step.query, step.ids); err != nil {
				t.Errorf("cleanup saved-message fixture %s: %v", step.name, err)
				return
			}
			t.Logf("synthetic cleanup %s: %s", step.name, time.Since(started).Round(time.Millisecond))
		}
	})
	if _, err := pool.Exec(ctx, `insert into public.organizations(id,name,slug) values($1::uuid,$3||'-a',$3||'-a'),($2::uuid,$3||'-b',$3||'-b');
		insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		values($4::uuid,'authenticated','authenticated',$3||'-a@example.invalid','',now(),'{}','{}',now(),now()),
		($5::uuid,'authenticated','authenticated',$3||'-b@example.invalid','',now(),'{}','{}',now(),now());
		insert into public.users(id,organization_id,name,email,role,is_active)
		values($4::uuid,$1::uuid,'Synthetic Saved User A',$3||'-a@example.invalid','user',true),
		($5::uuid,$1::uuid,'Synthetic Saved User B',$3||'-b@example.invalid','user',true)
		on conflict(id) do update set organization_id=excluded.organization_id,role='user',is_active=true;
		insert into public.organization_members(organization_id,user_id,role,is_active)
		values($1::uuid,$4::uuid,'user',true),($1::uuid,$5::uuid,'user',true),($2::uuid,$4::uuid,'user',true)
		on conflict(user_id,organization_id) do update set is_active=true,deleted_at=null`, orgA, orgB, suffix, userA, userB); err != nil {
		t.Fatal(err)
	}
	actors := []tenant.Context{quickReplyUnitActor(), quickReplyUnitActor(), quickReplyUnitActor()}
	actors[0].OrganizationID, actors[0].UserID = orgA, userA
	actors[1].OrganizationID, actors[1].UserID = orgA, userB
	actors[2].OrganizationID, actors[2].UserID = orgB, userA
	return actors
}
