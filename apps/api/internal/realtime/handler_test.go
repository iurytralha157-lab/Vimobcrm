package realtime

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestEventsWritesConnectedEvent(t *testing.T) {
	handler := NewHandler(NewHub())
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := tenant.ContextWithTenant(r.Context(), tenant.Context{
			UserID:         "user-1",
			OrganizationID: "org-1",
			MemberRole:     "admin",
		})
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
