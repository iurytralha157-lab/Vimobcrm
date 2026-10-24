package whatsapp

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// Hold a real reservation open to prove the nonblocking contract independently
// of the planner/scheduler interleaving exercised by the concurrent rounds.
func testWebhookRouteClaimShortMutexContention(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "route-short-mutex")
	rootKey := f.suffix + "-root"
	root := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
		key: rootKey, providerID: "root", route: "jid:dependent", lane: evolutionWebhookLaneBacklog, epoch: 1, age: 2 * time.Minute})
	child := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
		key: f.suffix + "-child", providerID: "child", route: "jid:dependent", lane: evolutionWebhookLaneLive,
		predecessorKey: rootKey, predecessorProvider: "root", epoch: 1, age: time.Minute})
	holder, err := db.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWebhookTx(holder)
	reserved, err := reserveEvolutionWebhookClaimSessions(ctx, holder, 1, "", evolutionWebhookLaneBacklog)
	if err != nil || len(reserved) != 1 || reserved[0] != f.sessionID {
		t.Fatalf("held reservation=%#v/%v", reserved, err)
	}
	repo := NewRepository(db, nil, StorageConfig{})
	if items := concurrentWebhookRouteClaims(t, ctx, repo); len(items) != 0 {
		t.Fatalf("replicas bypassed a held claim reservation: %#v", items)
	}
	assertRouteClaimState(t, ctx, db.Pool(), root, "pending", 0)
	assertRouteClaimState(t, ctx, db.Pool(), child, "pending", 0)
	if err := holder.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
	if err != nil || len(items) != 1 || items[0].ID != root {
		t.Fatalf("released reservation did not yield the exact root: %#v/%v", items, err)
	}
	for _, lane := range []string{evolutionWebhookLaneLive, evolutionWebhookLaneBacklog} {
		items, _, err := repo.claimEvolutionWebhooksForLane(ctx, lane, 1, "")
		if err != nil || len(items) != 0 {
			t.Fatalf("%s bypassed the processing dependency root or duplicated its lease: %#v/%v", lane, items, err)
		}
	}
	assertRouteClaimState(t, ctx, db.Pool(), root, "processing", 1)
	assertRouteClaimState(t, ctx, db.Pool(), child, "pending", 0)
}

func concurrentWebhookRouteClaims(t *testing.T, ctx context.Context, repo Repository) []pendingEvolutionWebhook {
	t.Helper()
	var wg sync.WaitGroup
	start := make(chan struct{})
	results := make(chan []pendingEvolutionWebhook, 4)
	errors := make(chan error, 4)
	for _, lane := range []string{evolutionWebhookLaneLive, evolutionWebhookLaneBacklog, evolutionWebhookLaneLive, evolutionWebhookLaneBacklog} {
		wg.Add(1)
		go func(lane string) {
			defer wg.Done()
			<-start
			items, _, err := repo.claimEvolutionWebhooksForLane(ctx, lane, 1, "")
			results <- items
			errors <- err
		}(lane)
	}
	close(start)
	wg.Wait()
	close(results)
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	var claimed []pendingEvolutionWebhook
	for items := range results {
		claimed = append(claimed, items...)
	}
	return claimed
}
