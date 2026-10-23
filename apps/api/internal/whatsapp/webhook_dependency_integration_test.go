package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// These tests mutate only synthetic fixtures in an explicitly selected local
// disposable database. An absent database is a skip, not evidence of SQL safety.
func webhookDependencyDatabase(t *testing.T) (context.Context, *dbpkg.Postgres) {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("real webhook dependency SQL not verified: WHATSAPP_TEST_DATABASE_URL is not set")
	}
	if os.Getenv("VIMOB_LOCAL_WHATSAPP_CLONE_VERIFIED") == whatsappCIFixtureMarker && databaseURL != verifiedWhatsAppCITarget() {
		t.Fatal("CI webhook fixture target does not match its verified opt-in")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal("invalid WHATSAPP_TEST_DATABASE_URL")
	}
	if target.Scheme != "postgres" && target.Scheme != "postgresql" {
		t.Fatal("webhook dependency fixtures require a PostgreSQL URL")
	}
	host := strings.ToLower(target.Hostname())
	databaseName := strings.TrimPrefix(target.Path, "/")
	if (host != "localhost" && host != "127.0.0.1" && host != "::1") ||
		(databaseName != "vimob_whatsapp_test" && databaseName != "vimob_whatsapp_clone") {
		t.Fatal("webhook dependency fixtures require loopback and an explicitly named disposable WhatsApp database")
	}
	for _, parameter := range []string{"host", "hostaddr", "dbname", "database", "service"} {
		if target.Query().Has(parameter) {
			t.Fatal("webhook dependency fixtures reject target overrides in URL query parameters")
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)
	if os.Getenv("VIMOB_LOCAL_WHATSAPP_CLONE_VERIFIED") == whatsappCIFixtureMarker {
		verifyWhatsAppCICluster(t, ctx, postgres.Pool())
	}
	return ctx, postgres
}

type webhookDependencyEvent struct {
	key, providerID, route, lane, status string
	eventType, provider, version         string
	predecessorKey, predecessorProvider  string
	age                                  time.Duration
	epoch                                int
	attempts, maxAttempts                int
	due                                  time.Duration
	snapshots                            []map[string]any
	withoutLedger                        bool
	expectSnapshotAdmissionError         bool
}

func insertWebhookDependencyEvent(t *testing.T, ctx context.Context, postgres *dbpkg.Postgres,
	fixture sessionConversationLockFixture, event webhookDependencyEvent,
) string {
	t.Helper()
	if event.status == "" {
		event.status = "pending"
	}
	if event.eventType == "" {
		event.eventType = "message"
	}
	if event.provider == "" {
		event.provider = "evolution_go"
	}
	if event.version == "" {
		event.version = "1"
	}
	if event.maxAttempts == 0 {
		event.maxAttempts = 12
	}
	if event.due == 0 {
		event.due = -time.Minute
	}
	if event.snapshots == nil {
		snapshot := map[string]any{
			"provider_message_id": event.providerID, "binding_eligible": true,
			"processing_epoch": event.epoch,
		}
		if event.predecessorKey != "" {
			snapshot["predecessor_inbox_event_key"] = event.predecessorKey
			snapshot["predecessor_provider_message_id"] = event.predecessorProvider
		}
		event.snapshots = []map[string]any{snapshot}
	}
	snapshots, err := json.Marshal(event.snapshots)
	if err != nil {
		t.Fatal(err)
	}
	var id string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_webhook_inbox (
			organization_id, session_id, event_key, event_type, provider, payload,
			processing_epoch, processing_lane, status, attempts, max_attempts,
			next_attempt_at, created_at
		) values (
			$1::uuid, $2::uuid, $3, $13, $14,
			jsonb_build_object('__vimob_ingress', jsonb_build_object(
				'epoch_capable', true, 'routing_key', $4::text,
				'routing_snapshot', jsonb_build_object('version', $15::text, 'messages', $5::jsonb)
			)), $6, $7, $8, $9, $10,
			now() + $11 * interval '1 second', now() - $12 * interval '1 second'
		) returning id::text
	`, fixture.organizationID, fixture.sessionID, event.key, event.route, string(snapshots),
		event.epoch, event.lane, event.status, event.attempts, event.maxAttempts,
		event.due.Seconds(), event.age.Seconds(), event.eventType, event.provider, event.version).Scan(&id); err != nil {
		var checkError *pgconn.PgError
		if event.expectSnapshotAdmissionError && errors.As(err, &checkError) &&
			checkError.Code == "23514" && checkError.ConstraintName == "whatsapp_webhook_active_routing_snapshot_v1_check" {
			t.Log("canonical B2 rejects legacy snapshot admission; no inbox/ledger row was created")
			return ""
		}
		t.Fatal(err)
	}
	if event.expectSnapshotAdmissionError {
		t.Fatal("canonical B2 unexpectedly admitted a legacy routing snapshot")
	}
	if !event.withoutLedger {
		for _, snapshot := range event.snapshots {
			encoded, err := json.Marshal(snapshot)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := postgres.Pool().Exec(ctx, `
				insert into public.whatsapp_webhook_routing_snapshots (
					organization_id, session_id, provider_message_id, inbox_event_key,
					processing_lane, routing_key, binding_eligible, target_mode,
					snapshot, processing_epoch
				) values ($1::uuid, $2::uuid, $3, $4, $5, $6, true, 'snapshot', $7::jsonb, $8)
			`, fixture.organizationID, fixture.sessionID, snapshot["provider_message_id"],
				event.key, event.lane, event.route, string(encoded), event.epoch); err != nil {
				t.Fatal(err)
			}
		}
	}
	return id
}

func newWebhookDependencyFixture(t *testing.T, ctx context.Context, postgres *dbpkg.Postgres,
	label string,
) sessionConversationLockFixture {
	t.Helper()
	fixture := createSessionConversationLockFixture(t, ctx, postgres.Pool(), label)
	t.Cleanup(func() { cleanupSessionConversationLockFixture(t, postgres.Pool(), fixture) })
	if _, err := postgres.Pool().Exec(ctx, `
		insert into private.whatsapp_webhook_session_cutovers (session_id, active_epoch, cutover_at)
		values ($1::uuid, 1, now() - interval '10 minutes')
	`, fixture.sessionID); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func TestClaimTransitiveBacklogDependencyPreservesLivePriority(t *testing.T) {
	ctx, postgres := webhookDependencyDatabase(t)
	fixture := newWebhookDependencyFixture(t, ctx, postgres, "transitive-dependency")
	repo := NewRepository(postgres, nil, StorageConfig{})
	const route = "jid:dependent-contact"
	// An older backlog head from another route must retain live priority, while
	// the required dependency root from this route can still be selected.
	insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: fixture.suffix + "-older-unrelated-backlog", providerID: "older-unrelated-backlog", route: "jid:older-other",
		lane: evolutionWebhookLaneBacklog, epoch: 1, age: 5 * time.Minute,
	})
	rootKey, middleKey := fixture.suffix+"-root", fixture.suffix+"-middle"
	rootID := insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: rootKey, providerID: "root", route: route, lane: evolutionWebhookLaneBacklog,
		epoch: 1, age: 4 * time.Minute,
	})
	middleID := insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: middleKey, providerID: "middle", route: route, lane: evolutionWebhookLaneBacklog,
		predecessorKey: rootKey, predecessorProvider: "root", epoch: 1, age: 3 * time.Minute,
	})
	liveID := insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: fixture.suffix + "-live", providerID: "live", route: route, lane: evolutionWebhookLaneLive,
		predecessorKey: middleKey, predecessorProvider: "middle", epoch: 1, age: 2 * time.Minute,
	})
	insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: fixture.suffix + "-unrelated-live", providerID: "unrelated-live", route: "jid:other",
		lane: evolutionWebhookLaneLive, epoch: 1, age: time.Minute,
	})
	insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: fixture.suffix + "-unrelated-backlog", providerID: "unrelated-backlog", route: "jid:another",
		lane: evolutionWebhookLaneBacklog, epoch: 1, age: 30 * time.Second,
	})
	for step, want := range []string{rootID, middleID, liveID} {
		lane := evolutionWebhookLaneBacklog
		if step == 2 {
			lane = evolutionWebhookLaneLive
		}
		claimed, _, err := repo.claimEvolutionWebhooksForLane(ctx, lane, 1, "")
		if err != nil {
			t.Fatal(err)
		}
		if len(claimed) != 1 || claimed[0].ID != want {
			t.Fatalf("dependency step %d claim = %#v, want %s", step, claimed, want)
		}
		// This exercises the real atomic completion/outcome SQL, not a fixture
		// UPDATE to processed. It does not claim to exercise provider dispatch.
		if err := repo.markEvolutionWebhookProcessed(ctx, claimed[0]); err != nil {
			t.Fatalf("complete dependency step %d: %v", step, err)
		}
	}
	claimed, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(claimed) != 0 {
		t.Fatal("unrelated backlog bypassed ready live work")
	}
	var outcomes int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*) from public.whatsapp_webhook_routing_outcomes
		where organization_id = $1::uuid and session_id = $2::uuid
	`, fixture.organizationID, fixture.sessionID).Scan(&outcomes); err != nil || outcomes != 3 {
		t.Fatalf("completed outcomes = %d, error = %v, want 3", outcomes, err)
	}
}
