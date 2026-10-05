package whatsapp

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestDisabledAutoReconnectStillObservesDisconnect(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if (target.Scheme != "postgres" && target.Scheme != "postgresql") ||
		(target.Hostname() != "localhost" && target.Hostname() != "127.0.0.1" && target.Hostname() != "::1") {
		t.Fatal("WHATSAPP_TEST_DATABASE_URL must point to a loopback PostgreSQL fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	suffix := fmt.Sprintf("wa-passive-disconnect-%d", time.Now().UnixNano())
	var organizationID, ownerID, sessionID string
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text, gen_random_uuid()::text`).Scan(&organizationID, &ownerID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.organizations where id = $1::uuid`, organizationID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id = $1::uuid`, ownerID)
	})
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`insert into public.organizations (id, name, slug) values ($1::uuid, $2, $2)`, []any{organizationID, suffix}},
		{`insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
		  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
		  values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())`,
			[]any{ownerID, suffix + "@example.invalid"}},
		{`insert into public.users (id, organization_id, name, email, role, is_active)
		  values ($1::uuid, $2::uuid, $3, $4, 'user', true)
		  on conflict (id) do update set organization_id = excluded.organization_id,
		    name = excluded.name, email = excluded.email, role = excluded.role, is_active = true`,
			[]any{ownerID, organizationID, suffix, suffix + "@example.invalid"}},
		{`insert into public.organization_members (organization_id, user_id, role, is_active)
		  values ($1::uuid, $2::uuid, 'user', true)
		  on conflict (user_id, organization_id) do update set role = 'user', is_active = true, deleted_at = null`,
			[]any{organizationID, ownerID}},
	} {
		if _, err := postgres.Pool().Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
		  organization_id, instance_name, instance_id, owner_user_id,
		  provider, status, is_active, last_connected_at, advanced_settings
		) values (
		  $1::uuid, $2, $2, $3::uuid, 'evolution_go', 'connected', true, now(),
		  '{"auto_reconnect_enabled":false,"token":"local-test-token"}'::jsonb
		) returning id::text
	`, organizationID, suffix, ownerID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}

	// The migrated claim must include this connected session. Rollback leaves
	// claims on other disposable fixture sessions untouched.
	tx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	claimToken := "passive-disconnect-test-claim-123456"
	rows, err := tx.Query(ctx, `
		select session_id::text from private.claim_whatsapp_sessions_for_supervision(
		  $1::text, 100, interval '30 seconds', interval '5 minutes'
		)
	`, claimToken)
	if err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	found := false
	for rows.Next() {
		var claimedSession string
		if err := rows.Scan(&claimedSession); err != nil {
			rows.Close()
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		found = found || claimedSession == sessionID
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	rows.Close()
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("connected session with auto_reconnect_enabled=false was not eligible for passive claim")
	}

	var reads, mutations atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodGet && request.URL.Path == "/instance/status" {
			reads.Add(1)
			response.Header().Set("Content-Type", "application/json")
			_, _ = response.Write([]byte(`{"state":"disconnected"}`))
			return
		}
		mutations.Add(1)
		http.Error(response, "unexpected provider mutation", http.StatusBadRequest)
	}))
	t.Cleanup(provider.Close)
	repo := NewRepository(postgres, nil, StorageConfig{})
	repo.functions.evolutionGoAPIURL = provider.URL
	repo.functions.evolutionGoAPIKey = "local-backend-key"
	repo.functions.httpClient = provider.Client()

	// Use a private lease on only this session; no background service runs.
	if _, err := postgres.Pool().Exec(ctx, `
		insert into private.whatsapp_session_supervisor_state (
		  session_id, organization_id, provider_instance_key, claim_token, lease_expires_at
		) values ($1::uuid, $2::uuid, $3, $4, now() + interval '5 minutes')
	`, sessionID, organizationID, suffix, claimToken); err != nil {
		t.Fatal(err)
	}
	session, ok, err := repo.getSupervisorSession(ctx, organizationID, sessionID, claimToken)
	if err != nil || !ok {
		t.Fatalf("passive supervisor session: found=%v error=%v", ok, err)
	}
	if err := repo.superviseSessionLocked(ctx, session, time.Now().UTC(), []string{"*"}, claimToken); err != nil {
		t.Fatalf("passive disconnect observation: %v", err)
	}
	var status string
	var autoReconnectEnabled bool
	if err := postgres.Pool().QueryRow(ctx, `
		select status, coalesce((advanced_settings->>'auto_reconnect_enabled')::boolean, true)
		from public.whatsapp_sessions where id = $1::uuid
	`, sessionID).Scan(&status, &autoReconnectEnabled); err != nil {
		t.Fatal(err)
	}
	if status != "disconnected" || autoReconnectEnabled || reads.Load() != 1 || mutations.Load() != 0 {
		t.Fatalf("passive result: status=%q autoReconnect=%v reads=%d mutations=%d",
			status, autoReconnectEnabled, reads.Load(), mutations.Load())
	}
	var notices int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*) from public.notifications
		where organization_id = $1::uuid and user_id = $2::uuid
		  and metadata->>'event_key' = 'whatsapp_disconnected'
	`, organizationID, ownerID).Scan(&notices); err != nil {
		t.Fatal(err)
	}
	if notices != 1 {
		t.Fatalf("owner disconnect notices = %d, want 1", notices)
	}

	// A timestamp-less LoggedOut is also reconciled when recovery is disabled.
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set status = 'connected', last_connected_at = clock_timestamp() + interval '1 second',
		    updated_at = clock_timestamp()
		where id = $1::uuid
	`, sessionID); err != nil {
		t.Fatal(err)
	}
	disposition, err := repo.reconcileTimestampLessLoggedOut(ctx, pendingEvolutionWebhook{
		OrganizationID: organizationID, SessionID: sessionID,
	})
	if err != nil || disposition != "" {
		t.Fatalf("timestamp-less LoggedOut: disposition=%q error=%v", disposition, err)
	}
	if err := postgres.Pool().QueryRow(ctx, `select status from public.whatsapp_sessions where id = $1::uuid`, sessionID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "disconnected" || reads.Load() != 2 || mutations.Load() != 0 {
		t.Fatalf("timestamp-less logout: status=%q reads=%d mutations=%d", status, reads.Load(), mutations.Load())
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*) from public.notifications
		where organization_id = $1::uuid and user_id = $2::uuid
		  and metadata->>'event_key' = 'whatsapp_disconnected'
	`, organizationID, ownerID).Scan(&notices); err != nil {
		t.Fatal(err)
	}
	if notices != 2 {
		t.Fatalf("owner notices after a new disconnect episode = %d, want 2", notices)
	}

	// Once disconnected, a session with recovery disabled must leave the
	// supervisor claim domain instead of reserving its provider instance key.
	tx, err = postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	rows, err = tx.Query(ctx, `
		select session_id::text from private.claim_whatsapp_sessions_for_supervision(
		  $1::text, 100, interval '30 seconds', interval '5 minutes'
		)
	`, claimToken)
	if err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	for rows.Next() {
		var claimedSession string
		if err := rows.Scan(&claimedSession); err != nil {
			rows.Close()
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		if claimedSession == sessionID {
			rows.Close()
			_ = tx.Rollback(ctx)
			t.Fatal("disconnected session with recovery disabled remained eligible for supervisor claim")
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	rows.Close()
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
}
