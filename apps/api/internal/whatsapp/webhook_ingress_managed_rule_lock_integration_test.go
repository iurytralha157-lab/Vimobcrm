package whatsapp

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestManagedIngressRuleLockReselectsAfterConcurrentConfigurationChange(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set WHATSAPP_TEST_DATABASE_URL to run the managed ingress lock contract")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse WHATSAPP_TEST_DATABASE_URL: %v", err)
	}
	switch strings.ToLower(target.Hostname()) {
	case "127.0.0.1", "localhost", "::1":
	default:
		t.Fatalf("WHATSAPP_TEST_DATABASE_URL must use a loopback host, got %q", target.Hostname())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	t.Cleanup(pool.Close)

	var organizationID string
	if err := pool.QueryRow(ctx, `
		insert into public.organizations (name, slug, is_active)
		values (
		  'Managed ingress lock contract',
		  'managed-ingress-lock-' || gen_random_uuid()::text,
		  true
		)
		returning id::text
	`).Scan(&organizationID); err != nil {
		t.Fatalf("insert organization: %v", err)
	}
	var ownerID string
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&ownerID); err != nil {
		t.Fatalf("generate owner: %v", err)
	}
	ownerEmail := "managed-ingress-" + strings.ReplaceAll(ownerID, "-", "") + "@example.test"
	if _, err := pool.Exec(ctx, `
		insert into auth.users (
		  id, aud, role, email, encrypted_password, email_confirmed_at,
		  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
		  $1::uuid, 'authenticated', 'authenticated', $2, '', now(),
		  '{}'::jsonb, '{}'::jsonb, now(), now()
		)
	`, ownerID, ownerEmail); err != nil {
		t.Fatalf("insert auth owner: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into public.users (id, organization_id, name, email, is_active)
		values ($1::uuid, $3::uuid, 'Managed ingress owner', $2, true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name,
		    email = excluded.email,
		    is_active = excluded.is_active
	`, ownerID, ownerEmail, organizationID); err != nil {
		t.Fatalf("insert public owner: %v", err)
	}
	var sessionID string
	if err := pool.QueryRow(ctx, `
		insert into public.whatsapp_sessions (
		  organization_id, owner_user_id, instance_name,
		  status, is_active, provider
		) values (
		  $1::uuid, $2::uuid, 'managed-ingress-lock',
		  'connected', true, 'evolution_go'
		)
		returning id::text
	`, organizationID, ownerID).Scan(&sessionID); err != nil {
		t.Fatalf("insert session: %v", err)
	}
	var queueID string
	if err := pool.QueryRow(ctx, `
		insert into public.round_robins (
		  organization_id, name, is_active, reentry_behavior
		) values ($1::uuid, 'Managed ingress queue', true, 'keep_assignee')
		returning id::text
	`, organizationID).Scan(&queueID); err != nil {
		t.Fatalf("insert queue: %v", err)
	}

	insertManagedRule := func(value string, priority int) string {
		t.Helper()
		var ruleID string
		if err := pool.QueryRow(ctx, `
			insert into public.round_robin_rules (
			  organization_id, round_robin_id, match_type, match_value,
			  match, conditions, is_active, priority
			) values (
			  $1::uuid, $2::uuid, 'whatsapp_message_contains', $3::text,
			  jsonb_build_object('whatsapp_session_id', $4::uuid),
			  jsonb_build_object(
			    'match_type', 'whatsapp_message_contains',
			    'match_value', $3::text,
			    'match', jsonb_build_object('whatsapp_session_id', $4::uuid)
			  ),
			  true, $5
			)
			returning id::text
		`, organizationID, queueID, value, sessionID, priority).Scan(&ruleID); err != nil {
			t.Fatalf("insert managed rule %q: %v", value, err)
		}
		if _, err := pool.Exec(ctx, `
			insert into public.whatsapp_inbound_rules (
			  id, organization_id, session_id, name, priority, is_active,
			  match_type, match_value, match_field, target_round_robin_id
			) values (
			  $1::uuid, $2::uuid, $3::uuid, 'Managed ingress mirror',
			  $4, true, 'contains', $5, 'message', $6::uuid
			)
		`, ruleID, organizationID, sessionID, priority, value, queueID); err != nil {
			t.Fatalf("insert managed mirror %q: %v", value, err)
		}
		return ruleID
	}

	originalRuleID := insertManagedRule("comprar", -1000000001)
	session := nativeEvolutionSession{ID: sessionID, OrganizationID: organizationID}
	message := nativeEvolutionMessage{Content: "Quero comprar este imovel"}
	rule := nativeInboundRule{
		ID:                         originalRuleID,
		TargetRoundRobinID:         queueID,
		ManagedMessageDistribution: true,
	}

	lockTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin managed ingress lock: %v", err)
	}
	defer func() { _ = lockTx.Rollback(context.Background()) }()
	if err := lockNativeManagedInboundRuleForSnapshot(ctx, lockTx, session, message, rule); err != nil {
		t.Fatalf("lock selected managed rule: %v", err)
	}

	mutationDone := make(chan error, 1)
	go func() {
		_, mutationErr := pool.Exec(ctx, `
			update public.round_robins
			set settings = jsonb_set(
			      coalesce(settings, '{}'::jsonb),
			      '{require_checkin}',
			      'true'::jsonb,
			      true
			    ),
			    updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`, organizationID, queueID)
		mutationDone <- mutationErr
	}()
	select {
	case err := <-mutationDone:
		t.Fatalf("queue mutation escaped managed ingress lock: %v", err)
	case <-time.After(200 * time.Millisecond):
	}
	if err := lockTx.Commit(ctx); err != nil {
		t.Fatalf("commit managed ingress lock: %v", err)
	}
	select {
	case err := <-mutationDone:
		if err != nil {
			t.Fatalf("queue mutation after lock release: %v", err)
		}
	case <-ctx.Done():
		t.Fatalf("queue mutation did not resume: %v", ctx.Err())
	}

	staleTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin stale managed ingress check: %v", err)
	}
	if err := lockNativeManagedInboundRuleForSnapshot(ctx, staleTx, session, message, rule); err == nil ||
		!strings.Contains(err.Error(), "changed before durable snapshot") {
		_ = staleTx.Rollback(ctx)
		t.Fatalf("stale managed route error = %v, want changed-before-snapshot", err)
	}
	if err := staleTx.Rollback(ctx); err != nil {
		t.Fatalf("rollback stale managed ingress check: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		update public.round_robins
		set settings = coalesce(settings, '{}'::jsonb) - 'require_checkin',
		    updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, queueID); err != nil {
		t.Fatalf("restore queue configuration: %v", err)
	}
	_ = insertManagedRule("quero", -999999999)

	winnerTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin managed winner check: %v", err)
	}
	if err := lockNativeManagedInboundRuleForSnapshot(ctx, winnerTx, session, message, rule); err == nil ||
		!strings.Contains(err.Error(), "winner changed before durable snapshot") {
		_ = winnerTx.Rollback(ctx)
		t.Fatalf("changed managed winner error = %v, want winner-changed", err)
	}
	if err := winnerTx.Rollback(ctx); err != nil {
		t.Fatalf("rollback managed winner check: %v", err)
	}
}
