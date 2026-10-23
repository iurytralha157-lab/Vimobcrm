package whatsapp

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestClaimTransitiveBacklogDependencyWalkIsBounded(t *testing.T) {
	ctx, postgres := webhookDependencyDatabase(t)
	for _, length := range []int{32, 33} {
		t.Run(fmt.Sprintf("links_%d", length), func(t *testing.T) {
			fixture := newWebhookDependencyFixture(t, ctx, postgres, "bounded-dependency")
			var predecessorKey, predecessorProvider, rootID string
			for index := 0; index <= length; index++ {
				lane := evolutionWebhookLaneBacklog
				if index == length {
					lane = evolutionWebhookLaneLive
				}
				event := webhookDependencyEvent{
					key: fixture.suffix + fmt.Sprintf("-event-%d", index), providerID: fmt.Sprintf("provider-%d", index),
					route: "jid:dependent", lane: lane, epoch: 1, age: time.Duration(length+2-index) * time.Minute,
					predecessorKey: predecessorKey, predecessorProvider: predecessorProvider,
				}
				id := insertWebhookDependencyEvent(t, ctx, postgres, fixture, event)
				if index == 0 {
					rootID = id
				}
				predecessorKey, predecessorProvider = event.key, event.providerID
			}
			insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
				key: fixture.suffix + "-other-live", providerID: "other-live", route: "jid:other",
				lane: evolutionWebhookLaneLive, epoch: 1, age: time.Minute,
			})
			repo := NewRepository(postgres, nil, StorageConfig{})
			claimed, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
			if err != nil {
				t.Fatal(err)
			}
			if length == 32 && (len(claimed) != 1 || claimed[0].ID != rootID) {
				t.Fatalf("bounded root claim = %#v, want %s", claimed, rootID)
			}
			if length == 33 && len(claimed) != 0 {
				t.Fatal("dependency beyond 32 links granted a priority exception")
			}
		})
	}
}

func TestClaimTransitiveBacklogDependencyKeepsOrderingBarriers(t *testing.T) {
	ctx, postgres := webhookDependencyDatabase(t)
	for _, barrier := range []struct{ name, lane, route string }{
		{"older_backlog_retry", evolutionWebhookLaneBacklog, "jid:dependent"},
		{"older_live_retry", evolutionWebhookLaneLive, "jid:dependent"},
		{"due_live_session_control", evolutionWebhookLaneLive, "__session__"},
	} {
		t.Run(barrier.name, func(t *testing.T) {
			fixture := newWebhookDependencyFixture(t, ctx, postgres, barrier.name)
			rootKey, middleKey := fixture.suffix+"-root", fixture.suffix+"-middle"
			insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
				key: rootKey, providerID: "root", route: "jid:dependent", lane: evolutionWebhookLaneBacklog,
				epoch: 1, age: 4 * time.Minute,
			})
			insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
				key: middleKey, providerID: "middle", route: "jid:dependent", lane: evolutionWebhookLaneBacklog,
				predecessorKey: rootKey, predecessorProvider: "root", epoch: 1, age: 3 * time.Minute,
			})
			insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
				key: fixture.suffix + "-live", providerID: "live", route: "jid:dependent", lane: evolutionWebhookLaneLive,
				predecessorKey: middleKey, predecessorProvider: "middle", epoch: 1, age: 2 * time.Minute,
			})
			due := time.Hour
			if barrier.route == "__session__" {
				due = -time.Minute
			}
			insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
				key: fixture.suffix + "-barrier", providerID: "barrier", route: barrier.route,
				lane: barrier.lane, epoch: 1, age: 5 * time.Minute, due: due, status: "retry",
			})
			insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
				key: fixture.suffix + "-other-live", providerID: "other-live", route: "jid:other",
				lane: evolutionWebhookLaneLive, epoch: 1, age: time.Minute,
			})
			repo := NewRepository(postgres, nil, StorageConfig{})
			claimed, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
			if err != nil || len(claimed) != 0 {
				t.Fatalf("ordering barrier claim = %#v, error = %v", claimed, err)
			}
		})
	}
}

func TestClaimTransitiveBacklogDependencyKeepsExactHeadLock(t *testing.T) {
	ctx, postgres := webhookDependencyDatabase(t)
	fixture := newWebhookDependencyFixture(t, ctx, postgres, "locked-dependency-head")
	rootKey, middleKey := fixture.suffix+"-root", fixture.suffix+"-middle"
	rootID := insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: rootKey, providerID: "root", route: "jid:dependent", lane: evolutionWebhookLaneBacklog, epoch: 1, age: 4 * time.Minute,
	})
	insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: middleKey, providerID: "middle", route: "jid:dependent", lane: evolutionWebhookLaneBacklog,
		predecessorKey: rootKey, predecessorProvider: "root", epoch: 1, age: 3 * time.Minute,
	})
	insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: fixture.suffix + "-live", providerID: "live", route: "jid:dependent", lane: evolutionWebhookLaneLive,
		predecessorKey: middleKey, predecessorProvider: "middle", epoch: 1, age: 2 * time.Minute,
	})
	insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: fixture.suffix + "-other-live", providerID: "other-live", route: "jid:other",
		lane: evolutionWebhookLaneLive, epoch: 1, age: time.Minute,
	})
	tx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select id from public.whatsapp_webhook_inbox where id = $1::uuid for update`, rootID); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(postgres, nil, StorageConfig{})
	claimed, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
	if err != nil || len(claimed) != 0 {
		t.Fatalf("locked exact head claim = %#v, error = %v", claimed, err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	// Two replicas compete only after the exact head lock has been released.
	var wg sync.WaitGroup
	results := make(chan []pendingEvolutionWebhook, 2)
	errors := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
			results <- items
			errors <- err
		}()
	}
	wg.Wait()
	close(results)
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	count := 0
	for items := range results {
		for _, item := range items {
			if item.ID != rootID {
				t.Fatalf("concurrent claim skipped the dependency head: %s", item.ID)
			}
			count++
		}
	}
	if count != 1 {
		t.Fatalf("concurrent dependency leases = %d, want 1", count)
	}
}

func TestClaimTransitiveBacklogDependencyKeepsSessionFairness(t *testing.T) {
	ctx, postgres := webhookDependencyDatabase(t)
	roots := map[string]string{}
	for index := range 4 {
		fixture := newWebhookDependencyFixture(t, ctx, postgres, fmt.Sprintf("fair-dependency-%d", index))
		rootKey := fixture.suffix + "-root"
		roots[fixture.sessionID] = insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
			key: rootKey, providerID: "root", route: "jid:dependent", lane: evolutionWebhookLaneBacklog,
			epoch: 1, age: 3 * time.Minute,
		})
		insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
			key: fixture.suffix + "-live", providerID: "live", route: "jid:dependent", lane: evolutionWebhookLaneLive,
			predecessorKey: rootKey, predecessorProvider: "root", epoch: 1, age: 2 * time.Minute,
		})
		insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
			key: fixture.suffix + "-other-live", providerID: "other-live", route: "jid:other", lane: evolutionWebhookLaneLive,
			epoch: 1, age: time.Minute,
		})
	}
	rootsSeen := map[string]bool{}
	repo := NewRepository(postgres, nil, StorageConfig{})
	cursor := ""
	for range 2 {
		claimed, nextCursor, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 2, cursor)
		if err != nil || len(claimed) != 2 {
			t.Fatalf("fair dependency batch size = %d, error = %v, want 2", len(claimed), err)
		}
		for _, item := range claimed {
			if item.ID != roots[item.SessionID] || rootsSeen[item.SessionID] || item.SessionID <= cursor {
				t.Fatalf("dependency claim lost one-per-session monotonic fairness: %#v", item)
			}
			rootsSeen[item.SessionID] = true
		}
		if nextCursor != claimed[len(claimed)-1].SessionID {
			t.Fatal("dependency batch did not advance the session cursor")
		}
		cursor = nextCursor
	}
	if len(rootsSeen) != len(roots) {
		t.Fatal("an eligible dependency session was starved by the previous batch")
	}
}
