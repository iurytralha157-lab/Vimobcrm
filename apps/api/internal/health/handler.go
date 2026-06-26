package health

import (
	"context"
	"net/http"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Handler struct {
	db *dbpkg.Postgres
}

func NewHandler(db *dbpkg.Postgres) Handler {
	return Handler{db: db}
}

func (handler Handler) Health(w http.ResponseWriter, _ *http.Request) {
	httpserver.WriteJSON(w, http.StatusOK, map[string]string{
		"status": "ok",
	})
}

func (handler Handler) Ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	if err := handler.db.Ping(ctx); err != nil {
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "database_unavailable", "Database is not ready.")
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]string{
		"status": "ready",
	})
}
