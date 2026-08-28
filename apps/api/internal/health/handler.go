package health

import (
	"context"
	"net/http"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Handler struct {
	db           databasePinger
	timeout      time.Duration
	runtimeStats func() map[string]any
}

type databasePinger interface {
	Ping(context.Context) error
}

func NewHandler(db *dbpkg.Postgres, timeout time.Duration) Handler {
	if timeout <= 0 {
		timeout = 3 * time.Second
	}

	return Handler{
		db:      db,
		timeout: timeout,
	}
}

func (handler Handler) WithRuntimeStats(provider func() map[string]any) Handler {
	handler.runtimeStats = provider
	return handler
}

func (handler Handler) Health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set(releaseHeader, currentRelease())
	payload := map[string]any{
		"status":  "ok",
		"release": currentRelease(),
	}
	if handler.runtimeStats != nil {
		payload["runtime"] = handler.runtimeStats()
	}
	httpserver.WriteJSON(w, http.StatusOK, payload)
}

func (handler Handler) Ready(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set(releaseHeader, currentRelease())
	ctx, cancel := context.WithTimeout(r.Context(), handler.timeout)
	defer cancel()

	if err := handler.db.Ping(ctx); err != nil {
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "database_unavailable", "Database is not ready.")
		return
	}

	payload := map[string]any{
		"status":  "ready",
		"release": currentRelease(),
	}
	if handler.runtimeStats != nil {
		payload["runtime"] = handler.runtimeStats()
	}
	httpserver.WriteJSON(w, http.StatusOK, payload)
}
