package whatsapp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// The two claims use independent pools and the real SQL. The test is restricted
// to a disposable loopback database; it never starts webhook dispatch.
func TestWebhookCutoverNewEventClaimsAcrossTwoConnections(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if target.Scheme != "postgres" && target.Scheme != "postgresql" {
		t.Fatal("WHATSAPP_TEST_DATABASE_URL must be a PostgreSQL URL")
	}
	switch strings.ToLower(target.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
	default:
		t.Fatalf("WHATSAPP_TEST_DATABASE_URL must point to loopback, got %q", target.Hostname())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	firstDB, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(firstDB.Close)
	secondDB, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(secondDB.Close)

	var compatible bool
	if err := firstDB.Pool().QueryRow(ctx, evolutionWebhookSchemaCompatibilityQuery).Scan(&compatible); err != nil || !compatible {
		t.Fatalf("disposable database needs the WhatsApp cutover migrations: compatible=%v error=%v", compatible, err)
	}

	suffix := fmt.Sprintf("wa-cutover-%d", time.Now().UnixNano())
	segment := randomHex(4)
	sessionID := fmt.Sprintf("ffffffff-ffff-4fff-8fff-%s0001", segment)
	cursorBefore := fmt.Sprintf("ffffffff-ffff-4fff-8fff-%s0000", segment)
	var organizationID, userID, oldID, newID, routingEpoch string
	if err := firstDB.Pool().QueryRow(ctx, `select gen_random_uuid()::text, gen_random_uuid()::text`).Scan(&organizationID, &userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		for _, removal := range []struct {
			statement string
			args      []any
		}{
			{`delete from public.whatsapp_sessions
				where id = $1::uuid and organization_id = $2::uuid and instance_name = $3`,
				[]any{sessionID, organizationID, suffix}},
			{`delete from public.users
				where id = $1::uuid and organization_id = $2::uuid and email = $3`,
				[]any{userID, organizationID, suffix + "@example.invalid"}},
			{`delete from auth.users where id = $1::uuid and email = $2`,
				[]any{userID, suffix + "@example.invalid"}},
			{`delete from public.organizations where id = $1::uuid and slug = $2`,
				[]any{organizationID, suffix}},
		} {
			if _, err := firstDB.Pool().Exec(cleanupCtx, removal.statement, removal.args...); err != nil {
				t.Errorf("clean local cutover fixture: %v", err)
			}
		}
	})
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`insert into public.organizations (id, name, slug) values ($1::uuid, $2, $2)`, []any{organizationID, suffix}},
		{`insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now()
		)`, []any{userID, suffix + "@example.invalid"}},
		{`update public.users
			set organization_id = $2::uuid, name = $3, email = $4, role = 'user', is_active = true
			where id = $1::uuid`, []any{userID, organizationID, suffix, suffix + "@example.invalid"}},
		{`insert into public.whatsapp_sessions (
			id, organization_id, owner_user_id, instance_name, instance_id,
			provider, status, is_active, advanced_settings
		) values ($1::uuid, $2::uuid, $3::uuid, $4, $4,
			'evolution_go', 'connected', true, jsonb_build_object('token', 'cutover-test-token'))`, []any{sessionID, organizationID, userID, suffix}},
	} {
		if _, err := firstDB.Pool().Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}

	if err := firstDB.Pool().QueryRow(ctx, `
		insert into public.whatsapp_webhook_inbox (
			organization_id, session_id, provider, event_key, event_type, payload,
			processing_lane, status, attempts, next_attempt_at, created_at
		) values (
			$1::uuid, $2::uuid, 'evolution_go', $3, 'message',
			jsonb_build_object('__vimob_ingress', jsonb_build_object(
				'routing_key', '__session__',
				'routing_snapshot', jsonb_build_object('version', 1, 'messages', '[]'::jsonb)
			)), 'live', 'pending', 0, now() - interval '1 minute', now() - interval '1 day'
		) returning id::text
	`, organizationID, sessionID, suffix+"-old").Scan(&oldID); err != nil {
		t.Fatal(err)
	}
	if err := firstDB.Pool().QueryRow(ctx, `
		select private.activate_whatsapp_webhook_session_cutover($1::uuid)
	`, sessionID).Scan(new(time.Time)); err != nil {
		t.Fatalf("activate disposable fixture: %v", err)
	}
	if err := firstDB.Pool().QueryRow(ctx, `
		select routing_epoch::text from private.whatsapp_webhook_session_cutovers
		where session_id = $1::uuid
	`, sessionID).Scan(&routingEpoch); err != nil {
		t.Fatal(err)
	}
	if err := firstDB.Pool().QueryRow(ctx, `
		insert into public.whatsapp_webhook_inbox (
			organization_id, session_id, provider, event_key, event_type, payload,
			processing_lane, status, attempts, next_attempt_at, created_at
		) values (
			$1::uuid, $2::uuid, 'evolution_go', $3, 'message',
			jsonb_build_object('__vimob_ingress', jsonb_build_object(
				'routing_key', '__session__', 'cutover_epoch', $4,
				'routing_snapshot', jsonb_build_object('version', 1, 'messages', '[]'::jsonb)
			)), 'live', 'pending', 0, now() - interval '1 minute', clock_timestamp()
		) returning id::text
	`, organizationID, sessionID, suffix+"-new", routingEpoch).Scan(&newID); err != nil {
		t.Fatal(err)
	}

	type result struct {
		items []string
		err   error
	}
	start := make(chan struct{})
	results := make(chan result, 2)
	for _, replica := range []struct {
		pool     *pgxpool.Pool
		workerID string
	}{
		{firstDB.Pool(), "vimob-api-evolution-webhook-cutover1-test-a"},
		{secondDB.Pool(), "vimob-api-evolution-webhook-cutover1-test-b"},
	} {
		go func() {
			<-start
			items, claimErr := claimCutoverCanary(ctx, replica.pool, replica.workerID, cursorBefore)
			results <- result{items: items, err: claimErr}
		}()
	}
	close(start)
	claimed := 0
	for range 2 {
		r := <-results
		if r.err != nil {
			t.Fatal(r.err)
		}
		for _, id := range r.items {
			if id != newID {
				t.Fatalf("claimed retained or unrelated event %s, want %s", id, newID)
			}
			claimed++
		}
	}
	if claimed != 1 {
		t.Fatalf("two replicas claimed %d events, want exactly one", claimed)
	}
	var oldStatus, newStatus string
	var oldAttempts, newAttempts int
	if err := firstDB.Pool().QueryRow(ctx, `
		select old.status, old.attempts, newer.status, newer.attempts
		from public.whatsapp_webhook_inbox old
		cross join public.whatsapp_webhook_inbox newer
		where old.id = $1::uuid and newer.id = $2::uuid
	`, oldID, newID).Scan(&oldStatus, &oldAttempts, &newStatus, &newAttempts); err != nil {
		t.Fatal(err)
	}
	if oldStatus != "pending" || oldAttempts != 0 || newStatus != "processing" || newAttempts != 1 {
		t.Fatalf("retained=%s/%d new=%s/%d", oldStatus, oldAttempts, newStatus, newAttempts)
	}

	// A newly received provider message dated before the cutover has no CRM
	// effect even if its provider ID was never seen. A real customer response
	// without a provider clock still gets a durable pending receipt before any
	// seven-day route expiration, as required for ButtonClick replies.
	var cutoffAt time.Time
	if err := firstDB.Pool().QueryRow(ctx, `
		select cutoff_at from private.whatsapp_webhook_session_cutovers
		where session_id = $1::uuid
	`, sessionID).Scan(&cutoffAt); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(firstDB, nil, StorageConfig{})
	for _, scenario := range []struct {
		name         string
		providerTime *time.Time
		buttonClick  bool
		wantStatus   string
		wantReason   string
		wantRawBody  bool
	}{
		{
			name:         "older-provider-message",
			providerTime: func() *time.Time { at := cutoffAt.Add(-time.Hour); return &at }(),
			wantStatus:   "processed",
			wantReason:   "pre_cutover_provider_replay",
		},
		{
			name:        "customer-reply-without-provider-time",
			buttonClick: true,
			wantStatus:  "pending",
			wantRawBody: true,
		},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			providerID := suffix + "-" + scenario.name
			content := "canary " + scenario.name
			info := map[string]any{
				"ID": providerID, "Chat": "5511999991111@s.whatsapp.net",
				"SenderPN": "5511999991111@s.whatsapp.net", "IsFromMe": false,
			}
			if scenario.providerTime != nil {
				info["Timestamp"] = scenario.providerTime.Unix()
			}
			event := "messages.upsert"
			data := any(map[string]any{"messages": []any{map[string]any{
				"Info": info, "Message": map[string]any{"conversation": content},
			}}})
			if scenario.buttonClick {
				event = "ButtonClick"
				data = map[string]any{
					"messageId": providerID, "jid": "5511999991111@s.whatsapp.net",
					"buttonText": content, "fromMe": false,
				}
			}
			body, err := json.Marshal(map[string]any{
				"event": event, "instanceToken": "cutover-test-token", "instanceId": suffix,
				"data": data,
			})
			if err != nil {
				t.Fatal(err)
			}
			envelope, err := parseEvolutionWebhookEnvelope(
				url.Values{"session_id": {sessionID}, "instance_id": {suffix}}, http.Header{}, body,
			)
			if err != nil {
				t.Fatal(err)
			}
			receipt, err := repo.AcceptEvolutionWebhook(ctx, envelope)
			if err != nil {
				t.Fatal(err)
			}
			if receipt.Status != scenario.wantStatus {
				t.Fatalf("receipt status = %s, want %s", receipt.Status, scenario.wantStatus)
			}
			var status, reason, payload string
			if err := firstDB.Pool().QueryRow(ctx, `
				select status, coalesce(ignored_reason, ''), payload::text
				from public.whatsapp_webhook_inbox where id = $1::uuid
			`, receipt.ID).Scan(&status, &reason, &payload); err != nil {
				t.Fatal(err)
			}
			if status != scenario.wantStatus || reason != scenario.wantReason ||
				strings.Contains(payload, content) != scenario.wantRawBody {
				t.Fatalf("stored status=%q reason=%q rawBody=%v", status, reason, strings.Contains(payload, content))
			}
		})
	}
}

func claimCutoverCanary(ctx context.Context, pool *pgxpool.Pool, workerID, cursor string) ([]string, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(context.Background())
	rows, err := tx.Query(ctx, claimEvolutionWebhooksQuery, 1, workerID, cursor, evolutionWebhookLaneLive)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, 1)
	for rows.Next() {
		var id, organizationID, sessionID, instanceID, eventType, webhookToken, payload, lane string
		var attempts, maxAttempts int
		var createdAt time.Time
		if err := rows.Scan(&id, &organizationID, &sessionID, &instanceID, &eventType,
			&webhookToken, &payload, &attempts, &maxAttempts, &lane, &createdAt); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return ids, nil
}
