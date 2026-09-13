package meta

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const marketingSyncMaxRequestBytes = int64(16 << 10)

type marketingSyncExecutor interface {
	Sync(context.Context, MarketingSyncRequest) (MarketingSyncResult, error)
}

// MarketingSyncHTTPHandler is the native Go endpoint for
// POST /v1/integrations/meta/marketing/sync. app.go only needs to register its
// Sync method behind the existing auth and tenant middleware.
type MarketingSyncHTTPHandler struct {
	syncer marketingSyncExecutor
}

func NewMarketingSyncHTTPHandler(service *MarketingSyncService) MarketingSyncHTTPHandler {
	return MarketingSyncHTTPHandler{syncer: service}
}

func (handler MarketingSyncHTTPHandler) Sync(w http.ResponseWriter, request *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if request.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		httpserver.WriteError(w, request, http.StatusMethodNotAllowed, "method_not_allowed", "Method is not allowed.")
		return
	}
	tenantContext, ok := tenant.FromContext(request.Context())
	if !ok || strings.TrimSpace(tenantContext.OrganizationID) == "" || strings.TrimSpace(tenantContext.UserID) == "" {
		httpserver.WriteError(w, request, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}
	if !tenantContext.HasRole("owner", "admin") {
		httpserver.WriteError(w, request, http.StatusForbidden, "organization_admin_required", "Organization owner or administrator access is required.")
		return
	}
	if handler.syncer == nil {
		httpserver.WriteError(w, request, http.StatusServiceUnavailable, "marketing_sync_unavailable", "Marketing synchronization is unavailable.")
		return
	}
	contentType := strings.ToLower(strings.TrimSpace(request.Header.Get("Content-Type")))
	if !strings.HasPrefix(contentType, "application/json") {
		httpserver.WriteError(w, request, http.StatusUnsupportedMediaType, "content_type_must_be_json", "Content-Type must be application/json.")
		return
	}
	defer request.Body.Close()
	var body struct {
		DateStart string `json:"date_start"`
		DateStop  string `json:"date_stop"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, request.Body, marketingSyncMaxRequestBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		httpserver.WriteError(w, request, http.StatusBadRequest, "invalid_json_body", "Request body is invalid.")
		return
	}
	if err := ensureMarketingSyncJSONEOF(decoder); err != nil {
		httpserver.WriteError(w, request, http.StatusBadRequest, "invalid_json_body", "Request body is invalid.")
		return
	}

	// The global API write timeout is intentionally short for normal requests.
	// This one owner-triggered import has a bounded 135s provider deadline, so
	// extend only this connection instead of weakening every API endpoint.
	controller := http.NewResponseController(w)
	_ = controller.SetWriteDeadline(time.Now().Add(marketingSyncRuntimeLimit + 15*time.Second))

	result, err := handler.syncer.Sync(request.Context(), MarketingSyncRequest{
		OrganizationID: tenantContext.OrganizationID,
		UserID:         tenantContext.UserID,
		DateFrom:       body.DateStart,
		DateTo:         body.DateStop,
	})
	if err != nil {
		status := http.StatusInternalServerError
		var failure *MarketingSyncFailure
		if errors.As(err, &failure) {
			status = failure.HTTPStatus
		}
		httpserver.WriteError(w, request, status, marketingSyncErrorCode(err), "Meta Marketing synchronization failed.")
		return
	}
	writeMarketingSyncResult(w, http.StatusOK, result)
}

func writeMarketingSyncResult(w http.ResponseWriter, status int, result MarketingSyncResult) {
	if result.Errors == nil {
		result.Errors = []string{}
	}
	httpserver.WriteJSON(w, status, result)
}

func ensureMarketingSyncJSONEOF(decoder *json.Decoder) error {
	var extra any
	err := decoder.Decode(&extra)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err == nil {
		return errors.New("request body must contain one JSON object")
	}
	return err
}
