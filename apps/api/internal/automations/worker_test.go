package automations

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestProcessRuntimeOnceUsesOperationalBounds(t *testing.T) {
	var payload map[string]any
	var requestPath string
	var decodeErr error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPath = r.URL.Path
		decodeErr = json.NewDecoder(r.Body).Decode(&payload)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	repo := Repository{functions: newFunctionsClient(FunctionsConfig{
		ProjectURL: server.URL,
		APIKey:     "test-service-key",
	})}

	if err := repo.ProcessRuntimeOnce(context.Background()); err != nil {
		t.Fatalf("process runtime once: %v", err)
	}
	if requestPath != "/functions/v1/automation-runner" {
		t.Fatalf("unexpected function path: %s", requestPath)
	}
	if decodeErr != nil {
		t.Fatalf("decode request body: %v", decodeErr)
	}
	if payload["event_batch_size"] != float64(25) {
		t.Fatalf("unexpected event batch size: %v", payload["event_batch_size"])
	}
	if payload["execution_batch_size"] != float64(5) {
		t.Fatalf("unexpected execution batch size: %v", payload["execution_batch_size"])
	}
	if payload["delay_batch_size"] != float64(25) {
		t.Fatalf("unexpected delay batch size: %v", payload["delay_batch_size"])
	}
	if repo.functions.httpClient.Timeout != 60*time.Second {
		t.Fatalf("unexpected functions timeout: %s", repo.functions.httpClient.Timeout)
	}
}

func TestRuntimeWakeIsSharedAndCoalescedAcrossRepositoryCopies(t *testing.T) {
	repo := NewRepository(nil, FunctionsConfig{}, StorageConfig{})
	copyOfRepository := repo

	repo.signalRuntimeWake()
	copyOfRepository.signalRuntimeWake()

	if got := len(repo.runtimeWake); got != 1 {
		t.Fatalf("coalesced wake count = %d, want 1", got)
	}
	select {
	case <-copyOfRepository.runtimeWake:
	default:
		t.Fatal("repository copy does not share the runtime wake channel")
	}
	if got := len(repo.runtimeWake); got != 0 {
		t.Fatalf("wake count after shared receive = %d, want 0", got)
	}
}

func TestRuntimeManualWakeDebounceCoalescesBurst(t *testing.T) {
	debounce := newRuntimeWakeDebounce()
	t.Cleanup(debounce.Stop)

	const window = 60 * time.Millisecond
	debounce.Arm(window)
	time.Sleep(15 * time.Millisecond)
	lastWake := time.Now()
	debounce.Arm(window)

	fired := false
	select {
	case <-debounce.ch:
		fired = true
	case <-time.After(window / 2):
	}
	if fired {
		if elapsed := time.Since(lastWake); elapsed < window {
			t.Fatalf("manual runtime wake fired after %s, want >= %s", elapsed, window)
		}
	} else {
		select {
		case <-debounce.ch:
			if elapsed := time.Since(lastWake); elapsed < window {
				t.Fatalf("manual runtime wake fired after %s, want >= %s", elapsed, window)
			}
		case <-time.After(2 * window):
			t.Fatal("manual runtime wake did not fire after the debounce window")
		}
	}
	debounce.Consume()

	select {
	case <-debounce.ch:
		t.Fatal("burst produced more than one debounced runtime wake")
	case <-time.After(window):
	}
}

func TestDrainRuntimeBatchesRunsSeriallyUntilWorkIsEmpty(t *testing.T) {
	var remaining int32 = 40
	var active int32
	var maximum int32

	hasWork := func(context.Context) (bool, error) {
		return atomic.LoadInt32(&remaining) > 0, nil
	}
	runBatch := func(context.Context) error {
		current := atomic.AddInt32(&active, 1)
		for {
			observed := atomic.LoadInt32(&maximum)
			if current <= observed || atomic.CompareAndSwapInt32(&maximum, observed, current) {
				break
			}
		}
		atomic.AddInt32(&remaining, -1)
		atomic.AddInt32(&active, -1)
		return nil
	}

	hasMore, err := drainRuntimeBatches(context.Background(), 64, hasWork, runBatch)
	if err != nil {
		t.Fatalf("drain runtime batches: %v", err)
	}
	if hasMore {
		t.Fatal("drain reported work after the queue reached zero")
	}
	if got := atomic.LoadInt32(&remaining); got != 0 {
		t.Fatalf("remaining batches = %d, want 0", got)
	}
	if got := atomic.LoadInt32(&maximum); got != 1 {
		t.Fatalf("maximum batch concurrency = %d, want 1", got)
	}
}

func TestDrainRuntimeBatchesReturnsMoreWorkAtSafeLimit(t *testing.T) {
	var remaining int32 = 70
	hasWork := func(context.Context) (bool, error) {
		return atomic.LoadInt32(&remaining) > 0, nil
	}
	runBatch := func(context.Context) error {
		atomic.AddInt32(&remaining, -1)
		return nil
	}

	hasMore, err := drainRuntimeBatches(context.Background(), 64, hasWork, runBatch)
	if err != nil {
		t.Fatalf("drain runtime batches: %v", err)
	}
	if !hasMore {
		t.Fatal("drain must report work remaining after reaching its batch limit")
	}
	if got := atomic.LoadInt32(&remaining); got != 6 {
		t.Fatalf("remaining batches = %d, want 6", got)
	}
}

func TestWorkerConfigDefaultsCoverFortyExecutionBatches(t *testing.T) {
	config := (WorkerConfig{}).normalized()
	if config.RuntimeDrainLimit < 40 {
		t.Fatalf("runtime drain limit = %d, want at least 40", config.RuntimeDrainLimit)
	}
	if config.RunTimeout > 30*time.Second {
		t.Fatalf("runtime timeout = %s, want <= 30s", config.RunTimeout)
	}
}
