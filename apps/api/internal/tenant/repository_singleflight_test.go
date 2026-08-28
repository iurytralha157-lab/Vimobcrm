package tenant

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestResolveCacheSingleflightCollapsesConcurrentFullResolution(t *testing.T) {
	cache := &resolveCache{}
	const callers = 32

	start := make(chan struct{})
	loaderStarted := make(chan struct{})
	releaseLoader := make(chan struct{})
	var ready sync.WaitGroup
	ready.Add(callers)
	var loaderOnce sync.Once
	var calls atomic.Int32
	results := make(chan Context, callers)
	errorsFound := make(chan error, callers)
	trialEndsAt := time.Date(2026, time.July, 30, 12, 0, 0, 0, time.UTC)

	resolve := func(ctx context.Context) (Context, error) {
		calls.Add(1)
		loaderOnce.Do(func() { close(loaderStarted) })
		select {
		case <-ctx.Done():
			return Context{}, ctx.Err()
		case <-releaseLoader:
			return Context{
				UserID:         "11111111-1111-4111-8111-111111111111",
				OrganizationID: "22222222-2222-4222-8222-222222222222",
				Permissions:    []string{"lead_view"},
				EnabledModules: []string{"properties"},
				TrialEndsAt:    &trialEndsAt,
			}, nil
		}
	}

	for range callers {
		go func() {
			ready.Done()
			<-start
			resolved, err := cache.doResolve(context.Background(), "user|organization", resolve)
			if err != nil {
				errorsFound <- err
				return
			}
			results <- resolved
		}()
	}

	ready.Wait()
	close(start)
	select {
	case <-loaderStarted:
	case <-time.After(time.Second):
		t.Fatal("shared resolver did not start")
	}
	// Keep the loader blocked long enough for every released caller to join the
	// same in-flight key instead of measuring sequential cache behavior.
	time.Sleep(20 * time.Millisecond)
	close(releaseLoader)

	resolvedContexts := make([]Context, 0, callers)
	for range callers {
		select {
		case err := <-errorsFound:
			t.Fatalf("resolve: %v", err)
		case resolved := <-results:
			resolvedContexts = append(resolvedContexts, resolved)
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for shared resolution")
		}
	}

	if got := calls.Load(); got != 1 {
		t.Fatalf("full resolver calls = %d, want 1", got)
	}
	resolvedContexts[0].Permissions[0] = "mutated"
	resolvedContexts[0].EnabledModules[0] = "mutated"
	*resolvedContexts[0].TrialEndsAt = trialEndsAt.Add(time.Hour)
	if resolvedContexts[1].Permissions[0] != "lead_view" ||
		resolvedContexts[1].EnabledModules[0] != "properties" ||
		!resolvedContexts[1].TrialEndsAt.Equal(trialEndsAt) {
		t.Fatal("singleflight waiters received shared mutable tenant context state")
	}
}

func TestResolveCacheSingleflightCallerCancellationDoesNotPoisonWaiters(t *testing.T) {
	cache := &resolveCache{}
	loaderStarted := make(chan struct{})
	releaseLoader := make(chan struct{})
	loaderContextErr := make(chan error, 1)
	var loaderStartedOnce sync.Once
	var calls atomic.Int32

	resolve := func(ctx context.Context) (Context, error) {
		calls.Add(1)
		loaderStartedOnce.Do(func() { close(loaderStarted) })
		<-releaseLoader
		loaderContextErr <- ctx.Err()
		return Context{
			UserID:         "11111111-1111-4111-8111-111111111111",
			OrganizationID: "22222222-2222-4222-8222-222222222222",
			Permissions:    []string{},
			EnabledModules: []string{},
		}, nil
	}

	leaderCtx, cancelLeader := context.WithCancel(context.Background())
	leaderResult := make(chan error, 1)
	go func() {
		_, err := cache.doResolve(leaderCtx, "user|organization", resolve)
		leaderResult <- err
	}()

	select {
	case <-loaderStarted:
	case <-time.After(time.Second):
		t.Fatal("shared resolver did not start")
	}

	waiterAttempted := make(chan struct{})
	waiterResult := make(chan error, 1)
	go func() {
		close(waiterAttempted)
		_, err := cache.doResolve(context.Background(), "user|organization", resolve)
		waiterResult <- err
	}()
	<-waiterAttempted
	time.Sleep(20 * time.Millisecond)

	cancelLeader()
	select {
	case err := <-leaderResult:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("leader error = %v, want context canceled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancelled leader remained blocked on shared resolution")
	}

	close(releaseLoader)
	select {
	case err := <-waiterResult:
		if err != nil {
			t.Fatalf("waiter inherited leader cancellation: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("waiter did not receive shared result")
	}

	if got := calls.Load(); got != 1 {
		t.Fatalf("full resolver calls = %d, want 1", got)
	}
	if err := <-loaderContextErr; err != nil {
		t.Fatalf("shared resolver context was cancelled with leader: %v", err)
	}
}

func TestResolveCacheSingleflightKeepsTenantKeysIndependent(t *testing.T) {
	cache := &resolveCache{}
	started := make(chan string, 2)
	release := make(chan struct{})
	type resolution struct {
		context Context
		err     error
	}
	results := make(chan resolution, 2)

	for _, organizationID := range []string{
		"22222222-2222-4222-8222-222222222222",
		"33333333-3333-4333-8333-333333333333",
	} {
		organizationID := organizationID
		go func() {
			resolved, err := cache.doResolve(
				context.Background(),
				"user|"+organizationID,
				func(ctx context.Context) (Context, error) {
					started <- organizationID
					select {
					case <-ctx.Done():
						return Context{}, ctx.Err()
					case <-release:
						return Context{
							OrganizationID: organizationID,
							Permissions:    []string{},
							EnabledModules: []string{},
						}, nil
					}
				},
			)
			results <- resolution{context: resolved, err: err}
		}()
	}

	seen := map[string]bool{}
	for range 2 {
		select {
		case organizationID := <-started:
			seen[organizationID] = true
		case <-time.After(time.Second):
			t.Fatal("different tenant keys blocked behind one flight")
		}
	}
	close(release)

	for range 2 {
		select {
		case result := <-results:
			if result.err != nil {
				t.Fatalf("resolve independent key: %v", result.err)
			}
			if !seen[result.context.OrganizationID] {
				t.Fatalf("unexpected resolved organization %q", result.context.OrganizationID)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for independent tenant resolution")
		}
	}
}

func TestResolveCacheSingleflightDoesNotRetainFailures(t *testing.T) {
	cache := &resolveCache{}
	transient := errors.New("transient")
	var calls atomic.Int32

	resolve := func(context.Context) (Context, error) {
		if calls.Add(1) == 1 {
			return Context{}, transient
		}
		return Context{Permissions: []string{}, EnabledModules: []string{}}, nil
	}

	if _, err := cache.doResolve(context.Background(), "user|organization", resolve); !errors.Is(err, transient) {
		t.Fatalf("first resolve error = %v, want transient", err)
	}
	if _, err := cache.doResolve(context.Background(), "user|organization", resolve); err != nil {
		t.Fatalf("second resolve retained transient failure: %v", err)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("resolver calls = %d, want 2", got)
	}
}
