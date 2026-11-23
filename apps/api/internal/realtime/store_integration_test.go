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

	organizationID := createRealtimeTestOrganization(t, ctx, postgres, "replicas")

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
	if err := replicaA.Start(ctx, false); err != nil {
		t.Fatal(err)
	}
	if err := replicaB.Start(ctx, false); err != nil {
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

func TestPostgresRealtimeCursorWaitsForEarlierTransaction(t *testing.T) {
	databaseURL := os.Getenv("REALTIME_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("REALTIME_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	firstDB, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 2})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(firstDB.Close)
	secondDB, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 1})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(secondDB.Close)
	firstOrg := createRealtimeTestOrganization(t, ctx, firstDB, "writer-a")
	secondOrg := createRealtimeTestOrganization(t, ctx, firstDB, "writer-b")
	store := NewPostgresStore(firstDB)
	peer := NewPostgresStore(secondDB)

	const insert = `insert into private.realtime_events (organization_id, event_type)
		values ($1::uuid, $2) returning id`
	first, err := firstDB.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = first.Rollback(ctx) }()
	var firstID, secondID, thirdID uint64
	if err := first.QueryRow(ctx, insert, firstOrg, "realtime.writer_a_first").Scan(&firstID); err != nil {
		t.Fatal(err)
	}

	var peerPID int32
	if err := secondDB.Pool().QueryRow(ctx, `select pg_backend_pid()`).Scan(&peerPID); err != nil {
		t.Fatal(err)
	}
	type appendResult struct {
		event Event
		err   error
	}
	appended := make(chan appendResult, 1)
	go func() {
		event, err := peer.Append(ctx, NewEvent("realtime.writer_b", secondOrg, "", nil))
		appended <- appendResult{event, err}
	}()

	waitCtx, stopWaiting := context.WithTimeout(ctx, 3*time.Second)
	defer stopWaiting()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var blocked bool
		if err := firstDB.Pool().QueryRow(waitCtx, `select exists (
			select 1 from pg_catalog.pg_locks
			where pid = $1 and locktype = 'advisory' and not granted
		)`, peerPID).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		select {
		case result := <-appended:
			t.Fatalf("peer append did not wait for writer A: id=%q err=%v", result.event.ID, result.err)
		case <-waitCtx.Done():
			t.Fatal("peer append did not wait on the cursor lock")
		case <-ticker.C:
		}
	}

	// If B reserved an ID before waiting, A's later inserts would get higher
	// IDs, and a tailer could skip B when it observes A's commit first.
	if err := first.QueryRow(ctx, insert, firstOrg, "realtime.writer_a_second").Scan(&secondID); err != nil {
		t.Fatal(err)
	}
	if err := first.QueryRow(ctx, insert, firstOrg, "realtime.writer_a_third").Scan(&thirdID); err != nil {
		t.Fatal(err)
	}
	if err := first.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var peerID uint64
	select {
	case result := <-appended:
		if result.err != nil {
			t.Fatal(result.err)
		}
		peerID = parseCursor(result.event.ID)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if !(firstID < secondID && secondID < thirdID && thirdID < peerID) {
		t.Fatalf("write order A1, A2, A3, B = %d, %d, %d, %d", firstID, secondID, thirdID, peerID)
	}
	events, err := store.ListAfter(ctx, firstID-1, peerID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 4 || parseCursor(events[0].ID) != firstID || parseCursor(events[1].ID) != secondID || parseCursor(events[2].ID) != thirdID || parseCursor(events[3].ID) != peerID {
		t.Fatalf("durable catch-up order = %#v", events)
	}
	replay, err := store.ListSubscriberAfter(ctx, firstOrg, "e1000000-0000-4000-8000-000000000001", firstID-1, peerID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(replay) != 3 || parseCursor(replay[0].ID) != firstID || parseCursor(replay[1].ID) != secondID || parseCursor(replay[2].ID) != thirdID {
		t.Fatalf("subscriber replay order = %#v", replay)
	}

	rollback, err := firstDB.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rollback.Rollback(ctx) }()
	var rolledBackID uint64
	if err := rollback.QueryRow(ctx, insert, firstOrg, "realtime.rolled_back").Scan(&rolledBackID); err != nil {
		t.Fatal(err)
	}
	if err := rollback.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	committed, err := peer.Append(ctx, NewEvent("realtime.after_rollback", secondOrg, "", nil))
	if err != nil {
		t.Fatal(err)
	}
	if parseCursor(committed.ID) <= rolledBackID {
		t.Fatalf("committed id = %q, rolled-back id = %d", committed.ID, rolledBackID)
	}
	events, err = store.ListAfter(ctx, peerID, parseCursor(committed.ID), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].ID != committed.ID {
		t.Fatalf("durable catch-up across a rollback gap = %#v", events)
	}
}

func createRealtimeTestOrganization(t *testing.T, ctx context.Context, postgres *dbpkg.Postgres, label string) string {
	t.Helper()
	suffix := fmt.Sprintf("realtime-integration-%s-%d", label, time.Now().UnixNano())
	var organizationID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug, subscription_status)
		values ($1, $1, 'active')
		returning id::text
	`, suffix).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.organizations where id = $1::uuid`, organizationID)
	})
	return organizationID
}
