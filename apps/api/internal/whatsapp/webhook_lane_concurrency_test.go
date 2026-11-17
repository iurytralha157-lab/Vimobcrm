package whatsapp

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestWebhookBacklogOverridePreservesAutoAndTotalBudget(t *testing.T) {
	for total := 1; total <= maxWhatsAppWebhookWorkerConcurrency; total++ {
		wantLive, wantBacklog := evolutionWebhookLaneConcurrency(total)
		live, backlog := evolutionWebhookLaneConcurrencyWithBacklog(total, 0)
		if live != wantLive || backlog != wantBacklog {
			t.Fatalf("auto changed at total %d: got %d/%d want %d/%d", total, live, backlog, wantLive, wantBacklog)
		}
		for override := 1; override < total; override++ {
			live, backlog := evolutionWebhookLaneConcurrencyWithBacklog(total, override)
			if live < 1 || backlog != override || live+backlog != total {
				t.Fatalf("override exceeded reserved budget: total=%d backlog=%d got=%d/%d", total, override, live, backlog)
			}
		}
		for _, invalid := range []int{-1, total, total + 1} {
			live, backlog := evolutionWebhookLaneConcurrencyWithBacklog(total, invalid)
			if live != wantLive || backlog != wantBacklog {
				t.Fatal("invalid programmatic setting changed the automatic budget")
			}
		}
	}
	repo := NewRepository(nil, nil, StorageConfig{WebhookWorkerBacklogConcurrency: 8})
	if live, backlog := evolutionWebhookLaneConcurrencyWithBacklog(16, repo.webhookWorkerBacklogConcurrency); live != 8 || backlog != 8 {
		t.Fatalf("storage configuration lost override: %d/%d", live, backlog)
	}
}

func TestWebhookBacklogOverrideKeepsLiveCapacityAcrossTwoTenantsAndShutdown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	live, backlog := evolutionWebhookLaneConcurrencyWithBacklog(16, 8)
	backlogRelease, liveRelease := make(chan struct{}), make(chan struct{})
	var releaseBacklog, releaseLive sync.Once
	var workers sync.WaitGroup
	var active, maximum, admissions atomic.Int32
	defer func() {
		cancel()
		releaseBacklog.Do(func() { close(backlogRelease) })
		releaseLive.Do(func() { close(liveRelease) })
		stopped := make(chan struct{})
		go func() { workers.Wait(); close(stopped) }()
		select {
		case <-stopped:
		case <-time.After(3 * time.Second):
			t.Error("lane runner cleanup exceeded its deadline")
		}
	}()
	// Fake jobs carry two distinct tenant scopes. No DB or provider is used;
	// the production lane runners own admission and cancellation behavior.
	type job struct{ tenant string }
	newQueue := func() chan job {
		queue := make(chan job, 16)
		for n := range 16 {
			queue <- job{tenant: []string{"synthetic-org-a", "synthetic-org-b"}[n%2]}
		}
		return queue
	}
	backlogQueue, liveQueue := newQueue(), newQueue()
	start := func(count int, queue <-chan job, release <-chan struct{}) <-chan string {
		started := make(chan string, count)
		wake := newEvolutionWebhookWorkerSignal()
		for range count {
			workers.Go(func() {
				runEvolutionWebhookLaneWorker(ctx, time.Hour, wake, func() (int, error) {
					select {
					case current := <-queue:
						now := active.Add(1)
						for previous := maximum.Load(); now > previous && !maximum.CompareAndSwap(previous, now); previous = maximum.Load() {
						}
						admissions.Add(1)
						started <- current.tenant
						<-release // Already admitted work drains before the runner exits.
						active.Add(-1)
						return 1, nil
					default:
						return 0, nil
					}
				}, nil)
			})
		}
		return started
	}
	waitStarted := func(started <-chan string, count int) {
		t.Helper()
		seen := map[string]int{}
		timer := time.NewTimer(3 * time.Second)
		defer timer.Stop()
		for range count {
			select {
			case tenant := <-started:
				seen[tenant]++
			case <-timer.C:
				t.Fatal("reserved lane waited for the blocked other lane")
			}
		}
		if seen["synthetic-org-a"] == 0 || seen["synthetic-org-b"] == 0 {
			t.Fatal("one synthetic tenant did not progress")
		}
	}
	backlogStarted := start(backlog, backlogQueue, backlogRelease)
	waitStarted(backlogStarted, backlog)
	liveStarted := start(live, liveQueue, liveRelease)
	waitStarted(liveStarted, live)
	if active.Load() != 16 || maximum.Load() != 16 || admissions.Load() != 16 {
		t.Fatalf("wrong fixed concurrency budget: active=%d max=%d admitted=%d", active.Load(), maximum.Load(), admissions.Load())
	}
	cancel()
	releaseBacklog.Do(func() { close(backlogRelease) })
	releaseLive.Do(func() { close(liveRelease) })
	done := make(chan struct{})
	go func() { workers.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("lane runners did not drain after cancellation")
	}
	if active.Load() != 0 || admissions.Load() != 16 || len(backlogQueue) != 8 || len(liveQueue) != 8 {
		t.Fatalf("shutdown admitted successors: active=%d admissions=%d queues=%d/%d", active.Load(), admissions.Load(), len(backlogQueue), len(liveQueue))
	}
}
