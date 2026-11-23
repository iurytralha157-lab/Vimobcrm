package realtime

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
)

type streamSessionChecker struct {
	active atomic.Bool
	calls  atomic.Int32
}

func (checker *streamSessionChecker) IsActive(_ context.Context, userID, sessionID string) (bool, error) {
	checker.calls.Add(1)
	return checker.active.Load() && userID == "user-1" && sessionID == "session-1", nil
}

func newTestStreamHandler(hub *Hub) (Handler, *streamSessionChecker) {
	checker := &streamSessionChecker{}
	checker.active.Store(true)
	return NewHandler(hub).WithActiveSessionChecker(checker), checker
}

func streamTestContext(ctx context.Context, memberRole string) context.Context {
	ctx = httpserver.ContextWithUser(ctx, authpkg.User{ID: "user-1", SessionID: "session-1"})
	return tenant.ContextWithTenant(ctx, tenant.Context{
		UserID:         "user-1",
		OrganizationID: "org-1",
		MemberRole:     memberRole,
	})
}

func TestEventsWritesConnectedEvent(t *testing.T) {
	handler, _ := newTestStreamHandler(NewHub())
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := streamTestContext(r.Context(), "admin")
		handler.Events(w, r.WithContext(ctx))
	}))
	defer server.Close()

	response, err := server.Client().Get(server.URL)
	if err != nil {
		t.Fatalf("failed to open sse stream: %v", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.StatusCode)
	}
	if contentType := response.Header.Get("Content-Type"); !strings.Contains(contentType, "text/event-stream") {
		t.Fatalf("expected event-stream content type, got %q", contentType)
	}

	scanner := bufio.NewScanner(response.Body)
	lines := []string{}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			break
		}
		lines = append(lines, line)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("failed reading connected event: %v", err)
	}

	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, "event: realtime.connected") {
		t.Fatalf("expected connected event, got:\n%s", joined)
	}
	if !strings.Contains(joined, `"organizationId":"org-1"`) {
		t.Fatalf("expected organization id in connected event, got:\n%s", joined)
	}
}

func TestEventsClosesStreamAfterTargetedMembershipRevocation(t *testing.T) {
	hub := NewHub()
	handler, _ := newTestStreamHandler(hub)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := streamTestContext(r.Context(), "user")
		handler.Events(w, r.WithContext(ctx))
	}))
	defer server.Close()

	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("open sse stream: %v", err)
	}
	defer response.Body.Close()

	scanner := bufio.NewScanner(response.Body)
	connected := readSSEFrame(t, scanner)
	if !strings.Contains(connected, "event: realtime.connected") {
		t.Fatalf("expected connected frame, got:\n%s", connected)
	}

	hub.Publish(NewTargetedEvent(
		EventAccessMembershipChanged,
		"org-1",
		"user-1",
		map[string]any{
			"targetUserId": "user-1",
			"isActive":     false,
			"deleted":      false,
			"revoked":      true,
		},
	))

	revocation := readSSEFrame(t, scanner)
	if !strings.Contains(revocation, "event: "+EventAccessMembershipChanged) ||
		!strings.Contains(revocation, `"revoked":true`) {
		t.Fatalf("expected membership revocation frame, got:\n%s", revocation)
	}

	streamClosed := make(chan bool, 1)
	go func() {
		streamClosed <- !scanner.Scan()
	}()

	select {
	case closed := <-streamClosed:
		if !closed {
			t.Fatal("stream emitted data after membership revocation")
		}
	case <-time.After(time.Second):
		t.Fatal("sse stream stayed open after membership revocation")
	}
}

func TestEventsDoNotDeliverAfterSessionRevocation(t *testing.T) {
	hub := NewHub()
	handler, checker := newTestStreamHandler(hub)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handler.Events(w, r.WithContext(streamTestContext(r.Context(), "user")))
	}))
	defer server.Close()

	response, err := server.Client().Get(server.URL)
	if err != nil {
		t.Fatalf("open sse stream: %v", err)
	}
	defer response.Body.Close()
	scanner := bufio.NewScanner(response.Body)
	if connected := readSSEFrame(t, scanner); !strings.Contains(connected, "event: realtime.connected") {
		t.Fatalf("expected connected frame, got:\n%s", connected)
	}

	checker.active.Store(false)
	hub.Publish(NewEvent("lead.updated", "org-1", "user-2", map[string]any{"private": "must-not-arrive"}))
	streamClosed := make(chan bool, 1)
	go func() { streamClosed <- !scanner.Scan() }()
	select {
	case closed := <-streamClosed:
		if !closed {
			t.Fatalf("revoked session received frame: %q", scanner.Text())
		}
	case <-time.After(time.Second):
		t.Fatal("sse stream stayed open after event for revoked session")
	}
}

func TestEventsCloseIdleStreamAfterSessionRevocation(t *testing.T) {
	handler, checker := newTestStreamHandler(NewHub())
	handler.sessionRecheckInterval = 10 * time.Millisecond
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handler.Events(w, r.WithContext(streamTestContext(r.Context(), "user")))
	}))
	defer server.Close()

	response, err := server.Client().Get(server.URL)
	if err != nil {
		t.Fatalf("open sse stream: %v", err)
	}
	defer response.Body.Close()
	scanner := bufio.NewScanner(response.Body)
	if connected := readSSEFrame(t, scanner); !strings.Contains(connected, "event: realtime.connected") {
		t.Fatalf("expected connected frame, got:\n%s", connected)
	}
	checker.active.Store(false)
	streamClosed := make(chan bool, 1)
	go func() { streamClosed <- !scanner.Scan() }()
	select {
	case closed := <-streamClosed:
		if !closed {
			t.Fatalf("revoked session received frame: %q", scanner.Text())
		}
	case <-time.After(time.Second):
		t.Fatal("idle sse stream stayed open after session revocation")
	}
}

func TestLatestTargetedMembershipEventSuppressesStaleReplayState(t *testing.T) {
	events := []Event{
		NewTargetedEvent(EventAccessMembershipChanged, "org-1", "user-1", map[string]any{"revoked": true}),
		NewEvent("lead.updated", "org-1", "user-2", nil),
		NewTargetedEvent(EventAccessMembershipChanged, "org-1", "user-1", map[string]any{"revoked": false}),
	}

	if got := latestTargetedMembershipEventIndex(events, "user-1"); got != 2 {
		t.Fatalf("latest membership event index = %d, want 2", got)
	}
	if membershipEventRevokesAccess(events[0], "user-2") {
		t.Fatal("revocation must not close another user's stream")
	}
	if membershipEventRevokesAccess(events[2], "user-1") {
		t.Fatal("reactivation must keep the stream open")
	}
}

func TestDurableStreamReplaysFirstEventAfterDisconnect(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	store := &sharedMemoryStore{}
	replicaA := NewDurableHub(store, nil)
	replicaB := NewDurableHub(store, nil)
	for _, hub := range []*Hub{replicaA, replicaB} {
		if err := hub.Start(ctx, false); err != nil {
			t.Fatal(err)
		}
		defer hub.Close()
	}
	serverA := newDurableStreamServer(replicaA)
	defer serverA.Close()
	serverB := newDurableStreamServer(replicaB)
	defer serverB.Close()

	initial := openDurableStream(t, ctx, serverA, "")
	connected := readSSEFrame(t, bufio.NewScanner(initial.Body))
	initial.Body.Close()
	if !strings.Contains(connected, "id: 0\nevent: realtime.connected") {
		t.Fatalf("initial connection did not advertise an empty durable cursor: %s", connected)
	}

	replicaA.Publish(NewEvent("schedule.changed", "org-1", "", nil))
	replicaA.Publish(NewEvent("schedule.changed", "other-organization", "", nil))
	resumed := openDurableStream(t, ctx, serverB, "0")
	defer resumed.Body.Close()
	scanner := bufio.NewScanner(resumed.Body)
	first := readSSEFrame(t, scanner)
	if strings.Contains(first, "event: realtime.connected") {
		// This replica may still be tailing the missed write when it accepts the stream.
		first = readSSEFrame(t, scanner)
	}
	if !strings.Contains(first, "id: 1\nevent: schedule.changed") || !strings.Contains(first, `"organizationId":"org-1"`) {
		t.Fatalf("first event was missing or outside the tenant: %s", first)
	}
}

func TestDurableStreamResetsAheadCursorToEmptyLog(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	hub := NewDurableHub(&sharedMemoryStore{}, nil)
	if err := hub.Start(ctx, false); err != nil {
		t.Fatal(err)
	}
	defer hub.Close()
	server := newDurableStreamServer(hub)
	defer server.Close()
	response := openDurableStream(t, ctx, server, "999")
	defer response.Body.Close()
	scanner := bufio.NewScanner(response.Body)
	reset := readSSEFrame(t, scanner)
	if !strings.Contains(reset, "id: 0\nevent: realtime.reset") || !strings.Contains(reset, "cursor_ahead_of_log") {
		t.Fatalf("expected authoritative reset to 0: %s", reset)
	}
	if connected := readSSEFrame(t, scanner); !strings.Contains(connected, "id: 0\nevent: realtime.connected") {
		t.Fatalf("expected new checkpoint after reset: %s", connected)
	}
	hub.Publish(NewEvent("schedule.changed", "org-1", "", nil))
	if live := readSSEFrame(t, scanner); !strings.Contains(live, "id: 1\nevent: schedule.changed") {
		t.Fatalf("event after reset was blocked by the old cursor: %s", live)
	}
}

func newDurableStreamServer(hub *Hub) *httptest.Server {
	handler, _ := newTestStreamHandler(hub)
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handler.Events(w, r.WithContext(streamTestContext(r.Context(), "user")))
	}))
}

func openDurableStream(t *testing.T, ctx context.Context, server *httptest.Server, cursor string) *http.Response {
	t.Helper()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	if cursor != "" {
		request.Header.Set("Last-Event-ID", cursor)
	}
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		t.Fatalf("unexpected SSE status %d", response.StatusCode)
	}
	return response
}

func readSSEFrame(t *testing.T, scanner *bufio.Scanner) string {
	t.Helper()
	lines := []string{}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			return strings.Join(lines, "\n")
		}
		lines = append(lines, line)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("read sse frame: %v", err)
	}
	t.Fatal("sse stream closed before the complete frame")
	return ""
}
