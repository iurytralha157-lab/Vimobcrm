package app

import (
	"context"
	"crypto/subtle"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/leads"
)

const operationsTokenHeader = "X-Vimob-Operations-Token"
const operationsRunTimeout = 55 * time.Second

type operationsChecksHandler struct {
	token   string
	timeout time.Duration
	runSLA  func(context.Context) (leads.SLACheckResult, error)
	runPool func(context.Context) (leads.PoolCheckResult, error)
}

func newOperationsChecksHandler(repo leads.Repository, token string, workersEnabled bool, writeTimeout time.Duration) operationsChecksHandler {
	if !workersEnabled || token == "" || writeTimeout <= time.Second {
		return operationsChecksHandler{}
	}
	return operationsChecksHandler{
		token: token, timeout: min(operationsRunTimeout, writeTimeout-time.Second),
		runSLA: repo.RunSLACheck, runPool: repo.RunPoolCheck,
	}
}

func (h operationsChecksHandler) sla(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := h.authorize(w, r)
	if cancel == nil {
		return
	}
	defer cancel()

	result, err := h.runSLA(ctx)
	switch {
	case err != nil:
		operationsWriteFailure(w, r, ctx)
	case result.Busy:
		httpserver.WriteJSON(w, http.StatusConflict, result)
	default:
		httpserver.WriteJSON(w, http.StatusOK, result)
	}
}

func (h operationsChecksHandler) pool(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := h.authorize(w, r)
	if cancel == nil {
		return
	}
	defer cancel()

	result, err := h.runPool(ctx)
	if err != nil {
		operationsWriteFailure(w, r, ctx)
		return
	}
	// Scheduler responses retain counts only. Per-lead identifiers and error
	// details are unnecessary in the scheduled HTTP execution history.
	status := http.StatusOK
	if !result.Success {
		status = http.StatusInternalServerError
	}
	httpserver.WriteJSON(w, status, struct {
		Success       bool `json:"success"`
		Redistributed int  `json:"redistributed"`
		Skipped       int  `json:"skipped"`
		Failed        int  `json:"failed"`
		Warnings      int  `json:"warnings"`
	}{
		Success: result.Success, Redistributed: result.Redistributed, Skipped: result.Skipped,
		Failed: result.Failed, Warnings: len(result.Warnings),
	})
}

func (h operationsChecksHandler) authorize(w http.ResponseWriter, r *http.Request) (context.Context, context.CancelFunc) {
	w.Header().Set("Cache-Control", "no-store")
	if h.token == "" {
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "operations_checks_disabled", "Operations checks are disabled.")
		return nil, nil
	}
	tokens := r.Header.Values(operationsTokenHeader)
	if len(tokens) != 1 || subtle.ConstantTimeCompare([]byte(h.token), []byte(tokens[0])) != 1 {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "operations_checks_unauthorized", "Invalid operations credentials.")
		return nil, nil
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 32))
	if payload := strings.TrimSpace(string(body)); err != nil || (payload != "" && payload != "{}") {
		httpserver.WriteError(w, r, http.StatusBadRequest, "operations_checks_invalid_body", "The command accepts an empty object.")
		return nil, nil
	}
	return context.WithTimeout(r.Context(), h.timeout)
}

func operationsWriteFailure(w http.ResponseWriter, r *http.Request, ctx context.Context) {
	if ctx.Err() == context.DeadlineExceeded {
		httpserver.WriteError(w, r, http.StatusGatewayTimeout, "operations_check_timeout", "The operation exceeded its time limit.")
		return
	}
	httpserver.WriteError(w, r, http.StatusInternalServerError, "operations_check_failed", "The operation failed.")
}
