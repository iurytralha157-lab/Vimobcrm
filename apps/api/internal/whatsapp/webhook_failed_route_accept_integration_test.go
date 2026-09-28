package whatsapp

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Exercise the real ingress transaction against an isolated PostgreSQL with
// the PRELOAD and ACTIVATE migrations installed. This test never runs without
// an explicit loopback test DSN.
func TestFailedRouteMixedAcceptConcurrentReceipts(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set WHATSAPP_TEST_DATABASE_URL for isolated PostgreSQL")
	}
	target, err := url.Parse(databaseURL)
	if err != nil || (target.Hostname() != "localhost" && target.Hostname() != "127.0.0.1") {
		t.Fatal("WHATSAPP_TEST_DATABASE_URL must be a valid loopback URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)
	var orgID, ownerID, sessionID string
	suffix := fmt.Sprintf("failed-route-accept-%d", time.Now().UnixNano())
	if err := postgres.Pool().QueryRow(ctx, `insert into public.organizations(name,slug)
		values ($1,$1) returning id::text`, suffix).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from private.whatsapp_failed_route_mixed_envelope_raw where organization_id=$1::uuid`, orgID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.whatsapp_webhook_inbox where organization_id=$1::uuid`, orgID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.whatsapp_webhook_routing_snapshots where organization_id=$1::uuid`, orgID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.whatsapp_sessions where organization_id=$1::uuid`, orgID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.organizations where id=$1::uuid`, orgID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id=$1::uuid`, ownerID)
	})
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `insert into auth.users
		(id,aud,role,email,encrypted_password,confirmed_at,
		 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		values ($1::uuid,'authenticated','authenticated',$2,'',now(),
		 '{}'::jsonb,'{}'::jsonb,now(),now())`, ownerID, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `insert into public.users
		(id,organization_id,name,email,is_active)
		values ($1::uuid,$2::uuid,$3,$4,true)`, ownerID, orgID, suffix, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `insert into public.whatsapp_sessions
		(organization_id,instance_name,instance_id,owner_user_id,provider,status,is_active,advanced_settings)
		values ($1::uuid,$2,$2,$3::uuid,'evolution_go','connected',true,
		  '{"webhook_token":"fixture-webhook","token":"fixture-provider"}'::jsonb)
		returning id::text`, orgID, suffix, ownerID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(postgres, nil, StorageConfig{})
	mixedPayload := []byte(`{"event":"messages.upsert","messages":[{"Info":{"ID":"opaque","Chat":"5511999991111@s.whatsapp.net","Timestamp":1788966000},"Message":{"albumMessage":{"expectedImageCount":2}}}],"data":{"messages":[{"Info":{"ID":"peer","Chat":"5511999992222@s.whatsapp.net","Timestamp":1788966001},"Message":{"conversation":"mensagem valida"}}]}}`)
	reversedMixedPayload := []byte(`{"event":"messages.upsert","messages":[{"Info":{"ID":"peer-reverse","Chat":"5511999992222@s.whatsapp.net","Timestamp":1788966001},"Message":{"conversation":"mensagem valida"}}],"data":{"messages":[{"Info":{"ID":"opaque-reverse","Chat":"5511999991111@s.whatsapp.net","Timestamp":1788966000},"Message":{"albumMessage":{"expectedImageCount":2}}}]}}`)
	singlePayload := []byte(`{"event":"messages.upsert","data":{"Info":{"ID":"single","Chat":"5511999991111@s.whatsapp.net","Timestamp":1788966002},"Message":{"conversation":"mensagem valida"}}}`)
	envelope := func(key string, payload []byte) evolutionWebhookEnvelope {
		return evolutionWebhookEnvelope{
			SessionID: sessionID, InstanceID: suffix, EventType: "message",
			InstanceToken: "fixture-provider", WebhookHeaderTokens: []string{"fixture-webhook"},
			EventKey: key, Payload: payload, ReceivedAt: time.Now().UTC(),
		}
	}
	assertCounts := func(key string, wantRaw, wantInbox, wantRoutes int) {
		t.Helper()
		var raw, inbox, routes int
		if err := postgres.Pool().QueryRow(ctx, `select count(*) from private.whatsapp_failed_route_mixed_envelope_raw where organization_id=$1::uuid and event_key=$2`, orgID, key).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		if err := postgres.Pool().QueryRow(ctx, `select count(*) from public.whatsapp_webhook_inbox where organization_id=$1::uuid and event_key=$2`, orgID, key).Scan(&inbox); err != nil {
			t.Fatal(err)
		}
		if err := postgres.Pool().QueryRow(ctx, `select count(*) from public.whatsapp_webhook_routing_snapshots where organization_id=$1::uuid and inbox_event_key=$2`, orgID, key).Scan(&routes); err != nil {
			t.Fatal(err)
		}
		if raw != wantRaw || inbox != wantInbox || routes != wantRoutes {
			t.Fatalf("event %q counts raw/inbox/routes=%d/%d/%d, want %d/%d/%d", key, raw, inbox, routes, wantRaw, wantInbox, wantRoutes)
		}
	}

	// Two copies of one unsplittable callback race through capture. Exactly one
	// raw receipt commits and the second ACKs the immutable duplicate.
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			receipt, acceptErr := repo.AcceptEvolutionWebhook(ctx, envelope(suffix+":same", mixedPayload))
			if acceptErr == nil && (receipt.Status != "dead" || !receipt.Inline) {
				acceptErr = fmt.Errorf("unexpected mixed receipt: %#v", receipt)
			}
			results <- acceptErr
		}()
	}
	wg.Wait()
	close(results)
	for acceptErr := range results {
		if acceptErr != nil {
			t.Fatalf("concurrent mixed Accept: %v", acceptErr)
		}
	}
	assertCounts(suffix+":same", 1, 0, 0)
	// Reverse member order in a second callback while both are in flight.
	// Neither callback can take per-route capture locks before raw isolation.
	results = make(chan error, 2)
	for index, payload := range [][]byte{mixedPayload, reversedMixedPayload} {
		wg.Add(1)
		go func(index int, payload []byte) {
			defer wg.Done()
			_, acceptErr := repo.AcceptEvolutionWebhook(ctx,
				envelope(fmt.Sprintf("%s:reverse:%d", suffix, index), payload))
			results <- acceptErr
		}(index, payload)
	}
	wg.Wait()
	close(results)
	for acceptErr := range results {
		if acceptErr != nil {
			t.Fatalf("reverse-order mixed Accept: %v", acceptErr)
		}
	}
	assertCounts(suffix+":reverse:0", 1, 0, 0)
	assertCounts(suffix+":reverse:1", 1, 0, 0)

	// A changed callback cannot reuse the committed raw receipt.
	if _, err := repo.AcceptEvolutionWebhook(ctx, envelope(suffix+":same", singlePayload)); err == nil {
		t.Fatal("changed payload reused an immutable raw event key")
	}
	assertCounts(suffix+":same", 1, 0, 0)

	// Race raw and public destinations for the same event key. The winner may
	// depend on scheduling, but both destinations must never ACK/commit.
	results = make(chan error, 2)
	for _, payload := range [][]byte{mixedPayload, singlePayload} {
		wg.Add(1)
		go func(payload []byte) {
			defer wg.Done()
			_, acceptErr := repo.AcceptEvolutionWebhook(ctx, envelope(suffix+":cross", payload))
			results <- acceptErr
		}(payload)
	}
	wg.Wait()
	close(results)
	successes := 0
	for acceptErr := range results {
		if acceptErr == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("cross-destination race ACKed %d callbacks, want exactly one", successes)
	}
	var raw, inbox int
	if err := postgres.Pool().QueryRow(ctx, `select
		(select count(*) from private.whatsapp_failed_route_mixed_envelope_raw where organization_id=$1::uuid and event_key=$2),
		(select count(*) from public.whatsapp_webhook_inbox where organization_id=$1::uuid and event_key=$2)`, orgID, suffix+":cross").Scan(&raw, &inbox); err != nil {
		t.Fatal(err)
	}
	if raw+inbox != 1 {
		t.Fatalf("cross-destination race persisted %d raw + %d inbox, want one total", raw, inbox)
	}
}
