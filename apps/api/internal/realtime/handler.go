package realtime

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	heartbeatInterval       = 25 * time.Second
	minimumStreamDuration   = 4 * time.Minute
	streamDurationJitterSec = 120
)

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

	lastSentID := uint64(0)
	replayedEvents := 0
	resyncRequired := false
	if replayCursor, ok := lastEventCursor(r.Header.Get("Last-Event-ID")); ok {
		replay, err := handler.hub.Replay(
			r.Context(),
			tenantContext.OrganizationID,
			tenantContext.UserID,
			replayCursor,
			defaultReplayLimit,
		)
		if err != nil {
			reset := newResetEvent(
				tenantContext.OrganizationID,
				replayCursor,
				"replay_unavailable",
				0,
			)
			if err := writeSSE(w, flusher, *reset); err != nil {
				return
			}
			lastSentID = replayCursor
			resyncRequired = true
		} else if replay.Reset != nil {
			if err := writeSSE(w, flusher, *replay.Reset); err != nil {
				return
			}
			lastSentID = replay.Cursor
			resyncRequired = true
		} else {
			for _, event := range replay.Events {
				if err := writeSSE(w, flusher, event); err != nil {
					return
				}
				if eventID := parseCursor(event.ID); eventID > lastSentID {
					lastSentID = eventID
				}
				replayedEvents++
			}
			if replay.Cursor > lastSentID {
				lastSentID = replay.Cursor
			}
		}
	}

	connectedID := "connected"
	if lastSentID > 0 {
		connectedID = strconv.FormatUint(lastSentID, 10)
	}
	if err := writeSSE(w, flusher, Event{
		ID:             connectedID,
		Type:           EventConnected,
		OrganizationID: tenantContext.OrganizationID,
		UserID:         tenantContext.UserID,
		CreatedAt:      time.Now().UTC(),
		Data: map[string]any{
			"memberRole":     tenantContext.MemberRole,
			"replayedEvents": replayedEvents,
			"resyncRequired": resyncRequired,
		},
	}); err != nil {
		return
	}

	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()
	streamTimer := time.NewTimer(
		minimumStreamDuration +
			time.Duration(rand.IntN(streamDurationJitterSec))*time.Second,
	)
	defer streamTimer.Stop()

	for {
		select {
		case event, ok := <-events:
			if !ok {
				return
			}
			if eventID := parseCursor(event.ID); eventID > 0 {
				if eventID <= lastSentID {
					continue
				}
				lastSentID = eventID
			}
			if err := writeSSE(w, flusher, event); err != nil {
				return
			}
		case <-ticker.C:
			if err := writeSSEComment(w, flusher, "ping"); err != nil {
				return
			}
		case <-streamTimer.C:
			// Force a fresh JWT/tenant resolution periodically. The jitter avoids
			// reconnecting every browser at once after a deploy.
			return
		case <-r.Context().Done():
			return
		}
	}
}

func writeSSEComment(w http.ResponseWriter, flusher http.Flusher, value string) error {
	if _, err := fmt.Fprintf(w, ": %s\n\n", sanitizeSSELine(value)); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}

func lastEventCursor(value string) (uint64, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	cursor, err := strconv.ParseUint(value, 10, 64)
	return cursor, err == nil && cursor > 0
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
