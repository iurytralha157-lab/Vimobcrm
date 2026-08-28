package whatsapp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestEvolutionWebhookProcessedRetention(t *testing.T) {
	tests := map[string]time.Duration{
		"messages.upsert": 24 * time.Hour,
		"message":         24 * time.Hour,
		"receipt":         6 * time.Hour,
		"messages.status": 6 * time.Hour,
		"message_ack":     6 * time.Hour,
		"qrcode.updated":  time.Hour,
		"connection":      time.Hour,
	}
	for eventType, want := range tests {
		if got := evolutionWebhookProcessedRetention(eventType); got != want {
			t.Errorf("evolutionWebhookProcessedRetention(%q) = %s, want %s", eventType, got, want)
		}
	}
}

func TestClaimEvolutionWebhooksQuerySerializesSessionsAcrossReplicas(t *testing.T) {
	normalized := strings.Join(strings.Fields(strings.ToLower(claimEvolutionWebhooksQuery)), " ")

	for _, fragment := range []string{
		"and not exists ( select 1 from public.whatsapp_webhook_inbox blocker",
		"blocker.session_id = wi.session_id",
		"blocker.status = 'processing'",
		"blocker.status in ('pending', 'retry')",
		"(blocker.next_attempt_at, blocker.created_at, blocker.id) < (wi.next_attempt_at, wi.created_at, wi.id)",
		"order by wi.next_attempt_at, wi.created_at, wi.id",
		"for update skip locked",
	} {
		if !strings.Contains(normalized, fragment) {
			t.Errorf("claim query is missing cross-replica session guard %q", fragment)
		}
	}
}

func TestValidateEvolutionWebhookTargetResponse(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		body       string
		wantError  bool
	}{
		{name: "canonical acknowledgement", statusCode: 200, body: `{"ok":true}`, wantError: false},
		{name: "legacy acknowledgement", statusCode: 200, body: `{"success":true,"result":{"accepted":1,"failed":0,"inProgress":0}}`, wantError: false},
		{name: "semantic ok failure", statusCode: 200, body: `{"ok":false}`, wantError: true},
		{name: "semantic success failure", statusCode: 200, body: `{"success":false}`, wantError: true},
		{name: "ignored callback", statusCode: 200, body: `{"ok":true,"ignored":true}`, wantError: true},
		{name: "partial failure", statusCode: 200, body: `{"success":true,"result":{"accepted":1,"failed":1}}`, wantError: true},
		{name: "unfinished batch", statusCode: 200, body: `{"success":true,"result":{"inProgress":1}}`, wantError: true},
		{name: "ignored batch item", statusCode: 200, body: `{"success":true,"result":{"ignored":1}}`, wantError: true},
		{name: "missing success marker", statusCode: 200, body: `{"result":{"accepted":1}}`, wantError: true},
		{name: "invalid json", statusCode: 200, body: `not-json`, wantError: true},
		{name: "empty response", statusCode: 204, body: ``, wantError: true},
		{name: "http failure", statusCode: 503, body: `{"ok":true}`, wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateEvolutionWebhookTargetResponse(test.statusCode, []byte(test.body))
			if (err != nil) != test.wantError {
				t.Fatalf("validateEvolutionWebhookTargetResponse() error = %v, wantError %v", err, test.wantError)
			}
		})
	}
}

func TestForwardEvolutionWebhookBoundsTargetResponseBody(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"ok":true,"padding":"` + strings.Repeat("x", int(maxEvolutionWebhookTargetResponseBytes)) + `"}`))
	}))
	defer target.Close()

	repo := Repository{functions: functionsClient{
		apiKey:              "sb_secret_webhook_worker_test_0123456789",
		evolutionWebhookURL: target.URL,
		httpClient:          target.Client(),
	}}
	err := repo.forwardEvolutionWebhook(context.Background(), pendingEvolutionWebhook{
		SessionID:    "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9",
		InstanceID:   "instance-1",
		WebhookToken: "session-secret",
		Payload:      []byte(`{"event":"MESSAGES_UPSERT"}`),
	})
	if err == nil || !strings.Contains(err.Error(), "exceeded the allowed size") {
		t.Fatalf("forwardEvolutionWebhook() error = %v, want bounded response failure", err)
	}
}

func TestDrainEvolutionWebhookBatchPreservesClaimOrderPerSession(t *testing.T) {
	items := []pendingEvolutionWebhook{
		{ID: "a-1", SessionID: "session-a"},
		{ID: "b-1", SessionID: "session-b"},
		{ID: "a-2", SessionID: "session-a"},
		{ID: "b-2", SessionID: "session-b"},
		{ID: "a-3", SessionID: "session-a"},
	}
	var mu sync.Mutex
	active := map[string]bool{}
	processed := map[string][]string{}
	var overlap bool
	err := drainEvolutionWebhookBatch(context.Background(), items, 2, func(_ context.Context, item pendingEvolutionWebhook) error {
		mu.Lock()
		if active[item.SessionID] {
			overlap = true
		}
		active[item.SessionID] = true
		processed[item.SessionID] = append(processed[item.SessionID], item.ID)
		mu.Unlock()
		time.Sleep(time.Millisecond)
		mu.Lock()
		active[item.SessionID] = false
		mu.Unlock()
		return nil
	})
	if err != nil {
		t.Fatalf("drainEvolutionWebhookBatch() error = %v", err)
	}
	if overlap {
		t.Fatal("events from the same session overlapped")
	}
	if got, want := processed["session-a"], []string{"a-1", "a-2", "a-3"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("session-a order = %#v, want %#v", got, want)
	}
	if got, want := processed["session-b"], []string{"b-1", "b-2"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("session-b order = %#v, want %#v", got, want)
	}
}

func TestDrainEvolutionWebhookBatchProcessesDifferentSessionsInParallel(t *testing.T) {
	started := make(chan string, 2)
	release := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- drainEvolutionWebhookBatch(context.Background(), []pendingEvolutionWebhook{
			{ID: "a-1", SessionID: "session-a"},
			{ID: "b-1", SessionID: "session-b"},
		}, 2, func(ctx context.Context, item pendingEvolutionWebhook) error {
			started <- item.SessionID
			select {
			case <-release:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		})
	}()

	first := receiveWebhookTestSignal(t, started)
	second := receiveWebhookTestSignal(t, started)
	if first == second {
		t.Fatalf("parallel workers started the same session twice: %q", first)
	}
	close(release)
	if err := receiveWebhookTestSignal(t, done); err != nil {
		t.Fatalf("drainEvolutionWebhookBatch() error = %v", err)
	}
}

func TestDrainEvolutionWebhookBatchHonorsConcurrencyLimit(t *testing.T) {
	items := make([]pendingEvolutionWebhook, 0, 5)
	for index := 0; index < 5; index++ {
		items = append(items, pendingEvolutionWebhook{ID: string(rune('a' + index)), SessionID: string(rune('A' + index))})
	}
	started := make(chan struct{}, len(items))
	release := make(chan struct{})
	done := make(chan error, 1)
	var active atomic.Int32
	var maximum atomic.Int32
	go func() {
		done <- drainEvolutionWebhookBatch(context.Background(), items, 2, func(ctx context.Context, _ pendingEvolutionWebhook) error {
			current := active.Add(1)
			for {
				observed := maximum.Load()
				if current <= observed || maximum.CompareAndSwap(observed, current) {
					break
				}
			}
			started <- struct{}{}
			select {
			case <-release:
				active.Add(-1)
				return nil
			case <-ctx.Done():
				active.Add(-1)
				return ctx.Err()
			}
		})
	}()
	receiveWebhookTestSignal(t, started)
	receiveWebhookTestSignal(t, started)
	if got := maximum.Load(); got != 2 {
		t.Fatalf("maximum concurrency before release = %d, want 2", got)
	}
	close(release)
	if err := receiveWebhookTestSignal(t, done); err != nil {
		t.Fatalf("drainEvolutionWebhookBatch() error = %v", err)
	}
	if got := maximum.Load(); got != 2 {
		t.Fatalf("maximum concurrency = %d, want 2", got)
	}
}

func TestDrainEvolutionWebhookBatchCancelsRemainingWorkAfterError(t *testing.T) {
	wantErr := errors.New("database unavailable")
	processed := []string{}
	err := drainEvolutionWebhookBatch(context.Background(), []pendingEvolutionWebhook{
		{ID: "a-1", SessionID: "session-a"},
		{ID: "a-2", SessionID: "session-a"},
		{ID: "b-1", SessionID: "session-b"},
	}, 1, func(_ context.Context, item pendingEvolutionWebhook) error {
		processed = append(processed, item.ID)
		return wantErr
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("drainEvolutionWebhookBatch() error = %v, want %v", err, wantErr)
	}
	if got, want := processed, []string{"a-1"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("processed after error = %#v, want %#v", got, want)
	}
}

func TestDrainEvolutionWebhookBatchPropagatesCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- drainEvolutionWebhookBatch(ctx, []pendingEvolutionWebhook{{ID: "a-1", SessionID: "session-a"}}, 1, func(ctx context.Context, _ pendingEvolutionWebhook) error {
			close(started)
			<-ctx.Done()
			return ctx.Err()
		})
	}()
	receiveWebhookTestSignal(t, started)
	cancel()
	if err := receiveWebhookTestSignal(t, done); !errors.Is(err, context.Canceled) {
		t.Fatalf("drainEvolutionWebhookBatch() error = %v, want context canceled", err)
	}
}

func TestWebhookWorkerConcurrencyNormalization(t *testing.T) {
	if got := (WorkerConfig{}).normalized().WebhookWorkerConcurrency; got != 4 {
		t.Fatalf("default concurrency = %d, want 4", got)
	}
	if got := (WorkerConfig{WebhookWorkerConcurrency: 16}).normalized().WebhookWorkerConcurrency; got != 16 {
		t.Fatalf("maximum concurrency = %d, want 16", got)
	}
	if got := (WorkerConfig{WebhookWorkerConcurrency: 17}).normalized().WebhookWorkerConcurrency; got != 4 {
		t.Fatalf("out-of-range concurrency = %d, want safe default 4", got)
	}
}

func receiveWebhookTestSignal[T any](t *testing.T, channel <-chan T) T {
	t.Helper()
	select {
	case value := <-channel:
		return value
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for webhook worker signal")
		var zero T
		return zero
	}
}
