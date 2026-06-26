package realtime

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const heartbeatInterval = 25 * time.Second

type Handler struct {
	hub *Hub
}

func NewHandler(hub *Hub) Handler {
	return Handler{hub: hub}
}

func (handler Handler) Events(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		httpserver.WriteError(w, r, http.StatusInternalServerError, "streaming_not_supported", "Realtime streaming is not supported.")
		return
	}

	if controller := http.NewResponseController(w); controller != nil {
		_ = controller.SetWriteDeadline(time.Time{})
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	events, unsubscribe := handler.hub.Subscribe(r.Context(), tenantContext.OrganizationID, tenantContext.UserID)
	defer unsubscribe()

	if err := writeSSE(w, flusher, Event{
		ID:             "0",
		Type:           EventConnected,
		OrganizationID: tenantContext.OrganizationID,
		UserID:         tenantContext.UserID,
		CreatedAt:      time.Now().UTC(),
		Data: map[string]any{
			"memberRole": tenantContext.MemberRole,
		},
	}); err != nil {
		return
	}

	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case event, ok := <-events:
			if !ok {
				return
			}
			if err := writeSSE(w, flusher, event); err != nil {
				return
			}
		case <-ticker.C:
			if err := writeSSE(w, flusher, Event{
				ID:             fmt.Sprintf("ping-%d", time.Now().Unix()),
				Type:           EventPing,
				OrganizationID: tenantContext.OrganizationID,
				UserID:         tenantContext.UserID,
				CreatedAt:      time.Now().UTC(),
			}); err != nil {
				return
			}
		case <-r.Context().Done():
			return
		}
	}
}

func writeSSE(w http.ResponseWriter, flusher http.Flusher, event Event) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}

	if event.ID != "" {
		if _, err := fmt.Fprintf(w, "id: %s\n", sanitizeSSELine(event.ID)); err != nil {
			return err
		}
	}
	if event.Type != "" {
		if _, err := fmt.Fprintf(w, "event: %s\n", sanitizeSSELine(event.Type)); err != nil {
			return err
		}
	}
	for _, line := range strings.Split(string(payload), "\n") {
		if _, err := fmt.Fprintf(w, "data: %s\n", line); err != nil {
			return err
		}
	}
	if _, err := fmt.Fprint(w, "\n"); err != nil {
		return err
	}

	flusher.Flush()
	return nil
}

func sanitizeSSELine(value string) string {
	value = strings.ReplaceAll(value, "\r", "")
	value = strings.ReplaceAll(value, "\n", "")
	return value
}
