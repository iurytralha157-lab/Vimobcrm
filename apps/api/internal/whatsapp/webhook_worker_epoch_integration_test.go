package whatsapp

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestClaimCurrentEpochBacklogRootRequiredByLive(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse WHATSAPP_TEST_DATABASE_URL: %v", err)
	}
	if host := strings.ToLower(target.Hostname()); host != "localhost" && host != "127.0.0.1" && host != "::1" {
		t.Fatalf("webhook claim fixture requires loopback, got %q", host)
	}
	if strings.TrimPrefix(target.Path, "/") != "vimob_whatsapp_test" {
		t.Fatal("webhook claim fixture requires the disposable vimob_whatsapp_test database")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)
	fixture := createSessionConversationLockFixture(t, ctx, postgres.Pool(), "epoch-dependent-root")
	t.Cleanup(func() { cleanupSessionConversationLockFixture(t, postgres.Pool(), fixture) })

	// This old row stays pending after activation. A fresh root for the same
	// route must still advance within the current epoch.
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.whatsapp_webhook_inbox (
			organization_id, session_id, event_key, event_type, provider,
			payload, processing_lane, status, attempts, next_attempt_at, created_at
		) values (
			$1::uuid, $2::uuid, $3, 'message', 'evolution_go',
			jsonb_build_object('__vimob_ingress', jsonb_build_object(
				'routing_key', 'jid:dependent-contact',
				'routing_snapshot', jsonb_build_object('version', 1, 'messages', '[]'::jsonb)
			)),
			'backlog', 'pending', 0, now() - interval '1 day', now() - interval '1 day'
		)
	`, fixture.organizationID, fixture.sessionID, fixture.suffix+"-retained-epoch-zero"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into private.whatsapp_webhook_session_cutovers (
			session_id, active_epoch, cutover_at
		) values ($1::uuid, 1, now() - interval '10 minutes')
	`, fixture.sessionID); err != nil {
		t.Fatal(err)
	}

	insertCurrentEpoch := func(eventKey, route, lane, snapshots, createdAgo string) string {
		t.Helper()
		var id string
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_webhook_inbox (
				organization_id, session_id, event_key, event_type, provider,
				payload, processing_epoch, processing_lane, status, attempts,
				next_attempt_at, created_at
			) values (
				$1::uuid, $2::uuid, $3, 'message', 'evolution_go',
				jsonb_build_object('__vimob_ingress', jsonb_build_object(
					'epoch_capable', true,
					'routing_key', $4::text,
					'routing_snapshot', jsonb_build_object('version', 1, 'messages', $6::jsonb)
				)),
				1, $5, 'pending', 0, now() - interval '1 minute', now() - $7::interval
			)
			returning id::text
		`, fixture.organizationID, fixture.sessionID, eventKey, route, lane, snapshots, createdAgo).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	rootKey := fixture.suffix + "-backlog-root-epoch-one"
	rootID := insertCurrentEpoch(rootKey, "jid:dependent-contact", evolutionWebhookLaneBacklog,
		`[{"provider_message_id":"root-provider","binding_eligible":true,"processing_epoch":1}]`, "3 minutes")
	childID := insertCurrentEpoch(fixture.suffix+"-live-dependent-epoch-one", "jid:dependent-contact", evolutionWebhookLaneLive,
		fmt.Sprintf(`[{"provider_message_id":"child-provider","binding_eligible":true,"processing_epoch":1,"predecessor_inbox_event_key":%q,"predecessor_provider_message_id":"root-provider"}]`, rootKey),
		"2 minutes")
	insertCurrentEpoch(fixture.suffix+"-live-unrelated-epoch-one", "jid:other-contact", evolutionWebhookLaneLive,
		`[]`, "1 minute")

	repo := NewRepository(postgres, nil, StorageConfig{})
	claimedRoot, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
	if err != nil {
		t.Fatalf("claim current-epoch backlog root: %v", err)
	}
	if len(claimedRoot) != 1 || claimedRoot[0].ID != rootID {
		t.Fatalf("backlog root claim = %#v, want %s", claimedRoot, rootID)
	}
	var retainedStatus string
	if err := postgres.Pool().QueryRow(ctx, `
		select status from public.whatsapp_webhook_inbox where event_key = $1
	`, fixture.suffix+"-retained-epoch-zero").Scan(&retainedStatus); err != nil {
		t.Fatal(err)
	}
	if retainedStatus != "pending" {
		t.Fatalf("retained epoch-zero row status = %q, want pending", retainedStatus)
	}
	insertCurrentEpoch(fixture.suffix+"-backlog-unrelated-epoch-one", "jid:another-contact", evolutionWebhookLaneBacklog,
		`[{"provider_message_id":"other-root","binding_eligible":true,"processing_epoch":1}]`, "30 seconds")
	blockedBacklog, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
	if err != nil {
		t.Fatalf("claim unrelated backlog while live is due: %v", err)
	}
	if len(blockedBacklog) != 0 {
		t.Fatalf("unrelated backlog bypassed live priority: %#v", blockedBacklog)
	}

	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set status = 'processed', locked_at = null, locked_by = null
		where id = $1::uuid
	`, rootID); err != nil {
		t.Fatal(err)
	}
	claimedChild, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
	if err != nil {
		t.Fatalf("claim live dependent after root: %v", err)
	}
	if len(claimedChild) != 1 || claimedChild[0].ID != childID {
		t.Fatalf("live dependent claim = %#v, want %s", claimedChild, childID)
	}
}
