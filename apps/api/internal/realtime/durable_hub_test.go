package realtime

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"strconv"
	"sync"
	"testing"
	"time"
)

type sharedMemoryStore struct {
	mu          sync.Mutex
	events      []Event
	appendError error
}

func (store *sharedMemoryStore) Append(_ context.Context, event Event) (Event, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	if store.appendError != nil {
		return Event{}, store.appendError
	}

	event = normalizeEvent(event)
	event.ID = strconv.Itoa(len(store.events) + 1)
	store.events = append(store.events, event)
	return event, nil
}

func (store *sharedMemoryStore) LatestID(context.Context) (uint64, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	return uint64(len(store.events)), nil
}

func (store *sharedMemoryStore) OldestID(context.Context) (uint64, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if len(store.events) == 0 {
		return 0, nil
	}
	cursor, _ := strconv.ParseUint(store.events[0].ID, 10, 64)
	return cursor, nil
}

func (store *sharedMemoryStore) ListAfter(
	_ context.Context,
	afterID uint64,
	throughID uint64,
	limit int,
) ([]Event, error) {
	return store.list("", "", afterID, throughID, limit), nil
}

func (store *sharedMemoryStore) ListSubscriberAfter(
	_ context.Context,
	organizationID string,
	userID string,
	afterID uint64,
	throughID uint64,
	limit int,
) ([]Event, error) {
	return store.list(organizationID, userID, afterID, throughID, limit), nil
}

func (store *sharedMemoryStore) list(
	organizationID string,
	userID string,
	afterID uint64,
	throughID uint64,
	limit int,
) []Event {
	store.mu.Lock()
	defer store.mu.Unlock()

	result := make([]Event, 0, limit)
	for _, event := range store.events {
		cursor, _ := strconv.ParseUint(event.ID, 10, 64)
		if cursor <= afterID || (throughID > 0 && cursor > throughID) {
			continue
		}
		if organizationID != "" && event.OrganizationID != organizationID {
			continue
		}
		if event.AudienceUserID != "" && event.AudienceUserID != userID {
			continue
		}
		result = append(result, event)
		if len(result) == limit {
			break
		}
	}
	return slices.Clone(result)
}

func (store *sharedMemoryStore) PruneBefore(_ context.Context, before time.Time) (int64, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	kept := store.events[:0]
	var deleted int64
	for _, event := range store.events {
		if event.CreatedAt.Before(before) {
			deleted++
			continue
		}
		kept = append(kept, event)
	}
	store.events = kept
	return deleted, nil
}

func TestDurableHubFansOutAcrossTwoReplicas(t *testing.T) {
	store := &sharedMemoryStore{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	replicaA := NewDurableHub(store, slog.Default())
	replicaB := NewDurableHub(store, slog.Default())
	if err := replicaA.Start(ctx); err != nil {
		t.Fatalf("start replica A: %v", err)
	}
	if err := replicaB.Start(ctx); err != nil {
		t.Fatalf("start replica B: %v", err)
	}
	defer replicaA.Close()
	defer replicaB.Close()

	eventsA, unsubscribeA := replicaA.Subscribe(ctx, "org-1", "user-1")
	defer unsubscribeA()
	eventsB, unsubscribeB := replicaB.Subscribe(ctx, "org-1", "user-2")
	defer unsubscribeB()

	replicaA.Publish(NewEvent("lead.updated", "org-1", "user-1", map[string]any{"leadId": "lead-1"}))

	assertEventType(t, eventsA, "lead.updated")
	assertEventType(t, eventsB, "lead.updated")
}

func TestDurableReplayRespectsOrganizationAndTargetAudience(t *testing.T) {
	store := &sharedMemoryStore{}
	_, _ = store.Append(context.Background(), NewEvent("lead.updated", "org-1", "", nil))
	_, _ = store.Append(context.Background(), NewEvent("lead.updated", "org-2", "", nil))
	_, _ = store.Append(context.Background(), NewTargetedEvent("access.permissions.changed", "org-1", "user-1", nil))
	_, _ = store.Append(context.Background(), NewTargetedEvent("access.permissions.changed", "org-1", "user-2", nil))

	hub := NewDurableHub(store, slog.Default())
	replay, err := hub.Replay(context.Background(), "org-1", "user-1", 1, 20)
	if err != nil {
		t.Fatalf("replay events: %v", err)
	}
	if replay.Reset != nil {
		t.Fatalf("unexpected replay reset: %#v", replay.Reset)
	}
	if len(replay.Events) != 1 || replay.Events[0].AudienceUserID != "user-1" {
		t.Fatalf("expected only the target user's event, got %#v", replay.Events)
	}
}

func TestDurablePublishFailureRequestsResyncWithoutAdvancingCursor(t *testing.T) {
	store := &sharedMemoryStore{appendError: errors.New("database unavailable")}
	hub := NewDurableHub(store, slog.Default())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	events, unsubscribe := hub.Subscribe(ctx, "org-1", "user-1")
	defer unsubscribe()

	hub.Publish(NewEvent("lead.updated", "org-1", "user-1", map[string]any{"leadId": "lead-1"}))

	select {
	case event := <-events:
		if event.Type != EventReset {
			t.Fatalf("expected a reset after durable append failure, got %q", event.Type)
		}
		if event.Data["reason"] != "publish_not_persisted" {
			t.Fatalf("expected publish_not_persisted reason, got %#v", event.Data["reason"])
		}
		if parseCursor(event.ID) != 0 {
			t.Fatalf("transient reset must not advance the durable cursor, got %q", event.ID)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for publish failure reset")
	}

	stats := hub.Stats()
	if stats.PublishFailures != 1 || stats.Persisted != 0 {
		t.Fatalf("unexpected durable failure metrics: %#v", stats)
	}
}

func assertEventType(t *testing.T, events <-chan Event, expected string) {
	t.Helper()
	select {
	case event := <-events:
		if event.Type != expected {
			t.Fatalf("expected %q, got %q", expected, event.Type)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for %q", expected)
	}
}

var _ EventStore = (*sharedMemoryStore)(nil)
