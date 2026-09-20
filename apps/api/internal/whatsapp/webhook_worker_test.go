package whatsapp

import (
	"context"
	"errors"
	"io"
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

func TestClaimEvolutionWebhooksQueryFairlyClaimsOneHeadPerSession(t *testing.T) {
	normalized := strings.Join(strings.Fields(strings.ToLower(claimEvolutionWebhooksQuery)), " ")

	for _, fragment := range []string{
		"from public.whatsapp_sessions ws",
		"nullif(btrim($3), '') is null or ws.id > nullif(btrim($3), '')::uuid",
		"coalesce(ws.is_active, true) = true",
		"coalesce(ws.status, '') <> 'deleted'",
		"limit $1 for no key update of ws skip locked",
		"cross join lateral",
		"head.id as event_id",
		"wi.session_id = ws.id",
		"wi.processing_lane = $4",
		"wi.payload #>> '{__vimob_ingress,routing_snapshot,version}'",
		") = '1'",
		"and ($4 <> 'live' or wi.next_attempt_at <= now())",
		"older.processing_lane = wi.processing_lane",
		"older.payload #>> '{__vimob_ingress,routing_snapshot,version}'",
		"(older.created_at, older.id) < (wi.created_at, wi.id)",
		"older.status in ('pending', 'retry')",
		"{__vimob_ingress,routing_key}",
		"{__vimob_ingress,routing_snapshot,messages}",
		"routing_message.snapshot->>'binding_eligible' = 'true'",
		"routing_message.snapshot->>'predecessor_inbox_event_key' <> wi.event_key",
		"same_inbox_route.snapshot->>'provider_message_id' = routing_message.snapshot->>'predecessor_provider_message_id'",
		"predecessor.status = 'processed'",
		"from public.whatsapp_webhook_routing_outcomes predecessor_outcome",
		"predecessor_outcome.provider_message_id = routing_message.snapshot->>'predecessor_provider_message_id'",
		"or head.routing_key = '__session__'",
		"and head.next_attempt_at <= now()",
		"join public.whatsapp_webhook_inbox wi on wi.id = selected.event_id",
		"for update of wi skip locked",
		"active.session_id = ws.id",
		"active.status = 'processing'",
		"$4 <> 'backlog' or not exists ( select 1",
		"live_due.processing_lane = 'live'",
		"live_due.payload #>> '{__vimob_ingress,routing_snapshot,version}'",
		"live_due.next_attempt_at <= now()",
		"order by claimed.session_id",
	} {
		if !strings.Contains(normalized, fragment) {
			t.Errorf("claim query is missing fair session guard %q", fragment)
		}
	}
	if strings.Contains(normalized, "limit 1 for update of wi skip locked") {
		t.Fatal("claim query may not skip a locked head and claim a newer row from the same session")
	}
	if strings.Contains(normalized, "routing_snapshot,messages,0") {
		t.Fatal("claim readiness may not inspect only the first message snapshot")
	}
	if got := strings.Count(normalized, "as routing_message(snapshot)"); got < 3 {
		t.Fatalf("routing predecessor gates = %d, want every candidate/race/live-priority pass", got)
	}
	if got := strings.Count(normalized, "as same_inbox_route(snapshot)"); got < 3 {
		t.Fatalf("same-envelope predecessor gates = %d, want every claim pass", got)
	}
	if got := strings.Count(normalized, "{__vimob_ingress,routing_snapshot,version}"); got < 5 {
		t.Fatalf("immutable routing snapshot claim gates = %d, want every candidate/race/claim pass", got)
	}
	if strings.Contains(normalized, "wi.processing_lane = 'backlog' or wi.next_attempt_at <= now()") {
		t.Fatal("backlog must retain strict FIFO and may not bypass a deferred head")
	}
	if strings.Contains(normalized, "media_jobs") {
		t.Fatal("inbox claiming must not depend on media job completion; queued media cannot block subsequent live text")
	}
	if got := strings.Count(normalized, "active.payload #>> '{__vimob_ingress,routing_key}'"); got < 3 {
		t.Fatalf("conversation-aware active guard count = %d, want every claim race check", got)
	}
	if strings.Contains(normalized, "older.next_attempt_at <= now()") {
		t.Fatal("a deferred retry must remain an ordering barrier for its own conversation")
	}
	if strings.Contains(normalized, "claim_bucket") || strings.Contains(normalized, "gen_random_uuid") || strings.Contains(normalized, "case when ws.id") {
		t.Fatal("claim query must use a monotonic PK cursor without a global CASE sort or random start")
	}
	if strings.Contains(normalized, "ws.status = 'connected'") || strings.Contains(normalized, "ws.status in ('connected'") {
		t.Fatal("claim query must keep active disconnected sessions eligible; only inactive or deleted sessions are terminally excluded")
	}
	if !shouldWrapEvolutionWebhookLaneClaim("ffffffff-ffff-4fff-8fff-ffffffffffff", 0) {
		t.Fatal("an exhausted non-empty cursor must wrap once")
	}
	if shouldWrapEvolutionWebhookLaneClaim("", 0) || shouldWrapEvolutionWebhookLaneClaim("cursor", 1) {
		t.Fatal("an initial or successful cursor segment must not wrap")
	}
}

func TestMarkEvolutionWebhookProcessedAtomicallyCompletesExactRoutingOutcomes(t *testing.T) {
	source := readWhatsAppSourceFunction(t, "webhook_worker.go", `func (repo Repository) markEvolutionWebhookProcessed`)
	normalized := strings.ToLower(strings.Join(strings.Fields(source), " "))
	for _, required := range []string{
		"with owned as materialized",
		"and inbox.status = 'processing'",
		"and inbox.locked_by = $2",
		"for update",
		"routing_message.snapshot->>'binding_eligible' = 'true'",
		"routing_snapshot.snapshot = payload_route.snapshot",
		"count(distinct payload_route.snapshot->>'provider_message_id')",
		"insert into public.whatsapp_webhook_routing_outcomes",
		"where whatsapp_webhook_routing_outcomes.ingress_sequence = excluded.ingress_sequence",
		"update public.whatsapp_webhook_inbox inbox set status = 'processed'",
		"integrity.payload_count = integrity.validated_count",
		"integrity.validated_count = (select count(*) from completed)",
		"if updated != 1",
	} {
		if !strings.Contains(normalized, required) {
			t.Fatalf("atomic webhook completion is missing %q\n%s", required, source)
		}
	}
	completed := strings.Index(normalized, "insert into public.whatsapp_webhook_routing_outcomes")
	processed := strings.Index(normalized, "update public.whatsapp_webhook_inbox inbox set status = 'processed'")
	if completed < 0 || processed < 0 || completed > processed {
		t.Fatalf("route outcomes must be proven before the inbox can become processed\n%s", source)
	}
	if strings.Contains(normalized, "on conflict (organization_id, session_id, provider_message_id) do update set ingress_sequence") {
		t.Fatal("a replay may not rewrite immutable provider ingress sequence")
	}
}

func TestClaimedEvolutionWebhookPublishesOutcomeOnlyAfterDispatchCompletes(t *testing.T) {
	source := readWhatsAppSourceFunction(t, "webhook_worker.go", `func (repo Repository) processClaimedEvolutionWebhook`)
	dispatch := strings.Index(source, "repo.dispatchEvolutionWebhook(ctx, item)")
	failed := strings.Index(source, "repo.markEvolutionWebhookFailed(ctx, item, err)")
	processed := strings.Index(source, "repo.markEvolutionWebhookProcessed(ctx, item)")
	if dispatch < 0 || failed < dispatch || processed < failed {
		t.Fatalf("dispatch, failure handling, and atomic completion are not ordered fail-closed\n%s", source)
	}
	if strings.Count(source, "repo.markEvolutionWebhookProcessed(ctx, item)") != 1 {
		t.Fatalf("routing outcome must be published through one completion path only\n%s", source)
	}
}

func TestWebhookWorkerLaneReservationAndContinuousDrain(t *testing.T) {
	tests := []struct {
		batch    int
		wantLive int
	}{
		{batch: 1, wantLive: 1},
		{batch: 2, wantLive: 1},
		{batch: 5, wantLive: 4},
		{batch: 10, wantLive: 8},
		{batch: 25, wantLive: 20},
	}
	for _, test := range tests {
		if got := reservedLiveWebhookBatch(test.batch); got != test.wantLive {
			t.Errorf("reservedLiveWebhookBatch(%d) = %d, want %d", test.batch, got, test.wantLive)
		}
	}
	if shouldContinueWebhookDrain(0) {
		t.Fatal("an empty claim must return to polling")
	}
	if !shouldContinueWebhookDrain(1) {
		t.Fatal("a partial claim must continue draining without a polling delay")
	}

	for _, test := range []struct {
		total       int
		wantLive    int
		wantBacklog int
	}{
		{total: 1, wantLive: 1, wantBacklog: 1},
		{total: 2, wantLive: 1, wantBacklog: 1},
		{total: 3, wantLive: 2, wantBacklog: 1},
		{total: 4, wantLive: 2, wantBacklog: 2},
		{total: 5, wantLive: 3, wantBacklog: 2},
		{total: 8, wantLive: 6, wantBacklog: 2},
		{total: 16, wantLive: 12, wantBacklog: 4},
	} {
		live, backlog := evolutionWebhookLaneConcurrency(test.total)
		if live != test.wantLive || backlog != test.wantBacklog {
			t.Errorf("evolutionWebhookLaneConcurrency(%d) = (%d, %d), want (%d, %d)", test.total, live, backlog, test.wantLive, test.wantBacklog)
		}
		if test.total > 1 && live+backlog != test.total {
			t.Errorf("lane concurrency (%d, %d) exceeds configured DB budget %d", live, backlog, test.total)
		}
	}
}

func TestDedicatedLiveLaneDoesNotWaitForBlockedBacklog(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	liveWake := newEvolutionWebhookWorkerSignal()
	backlogWake := newEvolutionWebhookWorkerSignal()
	backlogStarted := make(chan struct{}, 1)
	backlogRelease := make(chan struct{})
	backlogFinished := make(chan struct{})
	liveProcessed := make(chan struct{})
	liveDone := make(chan struct{})
	backlogDone := make(chan struct{})
	var liveReady atomic.Bool

	go func() {
		defer close(backlogDone)
		runEvolutionWebhookLaneWorker(ctx, time.Hour, backlogWake, func() (int, error) {
			select {
			case backlogStarted <- struct{}{}:
			default:
			}
			<-backlogRelease
			select {
			case <-backlogFinished:
			default:
				close(backlogFinished)
			}
			return 0, nil
		}, nil)
	}()
	go func() {
		defer close(liveDone)
		runEvolutionWebhookLaneWorker(ctx, time.Hour, liveWake, func() (int, error) {
			if liveReady.CompareAndSwap(true, false) {
				close(liveProcessed)
				return 1, nil
			}
			return 0, nil
		}, nil)
	}()

	select {
	case <-backlogStarted:
	case <-time.After(time.Second):
		t.Fatal("backlog runner did not start")
	}
	liveReady.Store(true)
	liveWake.Notify()
	select {
	case <-liveProcessed:
	case <-time.After(time.Second):
		t.Fatal("live runner waited for blocked backlog capacity")
	}
	select {
	case <-backlogFinished:
		t.Fatal("backlog unexpectedly finished before it was released")
	default:
	}
	close(backlogRelease)
	cancel()
	for name, done := range map[string]<-chan struct{}{"live": liveDone, "backlog": backlogDone} {
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatalf("%s runner did not stop", name)
		}
	}
}

func TestSummarizeEvolutionWebhookBatchSeparatesLaneAge(t *testing.T) {
	now := time.Date(2026, time.September, 9, 15, 0, 0, 0, time.UTC)
	cursors := evolutionWebhookLaneCursors{LiveSessionID: "live-cursor", BacklogSessionID: "backlog-cursor"}
	stats := summarizeEvolutionWebhookBatch([]pendingEvolutionWebhook{
		{ProcessingLane: evolutionWebhookLaneLive, CreatedAt: now.Add(-3 * time.Second)},
		{ProcessingLane: evolutionWebhookLaneLive, CreatedAt: now.Add(-12 * time.Second)},
		{ProcessingLane: evolutionWebhookLaneBacklog, CreatedAt: now.Add(-48 * time.Hour)},
	}, cursors, now)
	if stats.Cursors != cursors || stats.LiveClaimed != 2 || stats.BacklogClaimed != 1 || stats.Claimed() != 3 {
		t.Fatalf("batch stats = %#v", stats)
	}
	if stats.OldestLiveClaimAge != 12*time.Second || stats.OldestBacklogClaimAge != 48*time.Hour {
		t.Fatalf("batch ages = live:%s backlog:%s", stats.OldestLiveClaimAge, stats.OldestBacklogClaimAge)
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

func TestForwardEvolutionWebhookPreservesAuthenticatedRoutingSnapshot(t *testing.T) {
	var forwarded []byte
	target := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		forwarded, _ = io.ReadAll(request.Body)
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"ok":true}`))
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
		Payload: []byte(`{
			"event":"MESSAGES_UPSERT",
			"data":{"message":{"conversation":"oi"}},
			"__vimob_ingress":{"routing_key":"phone:5511999991111","routing_snapshot":{"version":1,"messages":[]}}
		}`),
	})
	if err != nil {
		t.Fatalf("forwardEvolutionWebhook() returned error: %v", err)
	}
	if !strings.Contains(string(forwarded), `"routing_snapshot"`) || !strings.Contains(string(forwarded), `"conversation":"oi"`) {
		t.Fatalf("forwarded provider payload = %s", forwarded)
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

func TestDrainEvolutionWebhookBatchContinuesOtherSessionsAfterError(t *testing.T) {
	wantErr := errors.New("database unavailable")
	processed := []string{}
	err := drainEvolutionWebhookBatch(context.Background(), []pendingEvolutionWebhook{
		{ID: "a-1", SessionID: "session-a"},
		{ID: "a-2", SessionID: "session-a"},
		{ID: "b-1", SessionID: "session-b"},
	}, 1, func(_ context.Context, item pendingEvolutionWebhook) error {
		processed = append(processed, item.ID)
		if item.SessionID == "session-a" {
			return wantErr
		}
		return nil
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("drainEvolutionWebhookBatch() error = %v, want %v", err, wantErr)
	}
	if got, want := processed, []string{"a-1", "b-1"}; !reflect.DeepEqual(got, want) {
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
	if got := (WorkerConfig{}).normalized().WebhookWorkerBatch; got != 10 {
		t.Fatalf("default batch = %d, want 10", got)
	}
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
