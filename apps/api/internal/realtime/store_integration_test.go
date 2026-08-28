package realtime

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strconv"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestDurableHubAcrossDatabaseBackedReplicas(t *testing.T) {
	databaseURL := os.Getenv("REALTIME_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("REALTIME_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		HealthTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	suffix := fmt.Sprintf("realtime-integration-%d", time.Now().UnixNano())
	var organizationID string
	err = postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug, subscription_status)
		values ($1, $1, 'active')
		returning id::text
	`, suffix).Scan(&organizationID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(
			cleanupCtx,
			`delete from public.organizations where id = $1::uuid`,
			organizationID,
		)
	})

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := NewPostgresStore(postgres)
	if _, err := store.Append(ctx, NewEvent(
		"realtime.integration_baseline",
		organizationID,
		"",
		nil,
	)); err != nil {
		t.Fatal(err)
	}
	replicaA := NewDurableHub(store, logger)
	replicaB := NewDurableHub(store, logger)
	if err := replicaA.Start(ctx); err != nil {
		t.Fatal(err)
	}
	if err := replicaB.Start(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(replicaA.Close)
	t.Cleanup(replicaB.Close)

	userID := "e1000000-0000-4000-8000-000000000001"
	events, unsubscribe := replicaB.Subscribe(ctx, organizationID, userID)
	defer unsubscribe()

	replicaA.Publish(NewTargetedEvent(
		"access.permissions.changed",
		organizationID,
		userID,
		map[string]any{"reason": "integration_test"},
	))

	var received Event
	select {
	case received = <-events:
	case <-time.After(3 * time.Second):
		t.Fatal("second replica did not receive the durable event")
	}
	cursor, err := strconv.ParseUint(received.ID, 10, 64)
	if err != nil || cursor == 0 {
		t.Fatalf("event cursor = %q, error = %v", received.ID, err)
	}
	if received.Type != "access.permissions.changed" ||
		received.OrganizationID != organizationID {
		t.Fatalf("event = %#v", received)
	}

	replay, err := replicaB.Replay(ctx, organizationID, userID, cursor-1, 10)
	if err != nil {
		t.Fatal(err)
	}
	if replay.Reset != nil || len(replay.Events) != 1 || replay.Events[0].ID != received.ID {
		t.Fatalf("replay = %#v", replay)
	}

	otherReplay, err := replicaB.Replay(
		ctx,
		organizationID,
		"e1000000-0000-4000-8000-000000000002",
		cursor-1,
		10,
	)
	if err != nil {
		t.Fatal(err)
	}
	if otherReplay.Reset != nil || len(otherReplay.Events) != 0 {
		t.Fatalf("targeted event leaked through replay: %#v", otherReplay)
	}

	if stats := replicaA.Stats(); stats.Published != 1 ||
		stats.Persisted != 1 ||
		stats.PublishFailures != 0 {
		t.Fatalf("replica A stats = %#v", stats)
	}
}
