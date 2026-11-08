package marketing

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	actionTimeout    = 15 * time.Second
	syncTimeout      = 140 * time.Second
	callbackTimeout  = 60 * time.Second
	maxRequestBodyKB = 64
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (handler *Handler) List(w http.ResponseWriter, r *http.Request) {
	organizationID, _, ok := handler.tenant(w, r)
	if !ok {
		return
	}
	enabled, metaConfigured := handler.service.Availability(organizationID)
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	connections, err := handler.service.List(ctx, organizationID)
	if err != nil {
		handler.writeError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]any{
		"enabled":         enabled,
		"meta_configured": metaConfigured,
		"connections":     connections,
	})
}

func (handler *Handler) StartMeta(w http.ResponseWriter, r *http.Request) {
	organizationID, userID, ok := handler.tenant(w, r)
	if !ok {
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && !handler.service.originAllowed(origin) {
		handler.writeError(w, r, newFailure("origin_not_allowed", http.StatusForbidden))
		return
	}
	var body struct {
		ReturnURL string `json:"return_url"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	authURL, err := handler.service.StartMeta(ctx, organizationID, userID, body.ReturnURL)
	if err != nil {
		handler.writeError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]any{"auth_url": authURL})
}

// CallbackMeta is the public OAuth redirect target. Purpose: finish a login the
// CRM started. Validation: a single-use state that expires in 10 minutes is
// checked before any provider call. Its work is bounded by callbackTimeout, and
// the response carries only a status and an error code, never a token.
func (handler *Handler) CallbackMeta(w http.ResponseWriter, r *http.Request) {
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(callbackTimeout + 10*time.Second))
	ctx, cancel := context.WithTimeout(r.Context(), callbackTimeout)
	defer cancel()
	query := r.URL.Query()
	returnURL, err := handler.service.CompleteMeta(ctx, query.Get("state"), query.Get("code"), query.Get("error"))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if returnURL == "" {
		handler.writeError(w, r, err)
		return
	}
	location, buildErr := callbackRedirect(returnURL, err)
	if buildErr != nil {
		handler.writeError(w, r, newFailure("invalid_return_url", http.StatusBadRequest))
		return
	}
	if err != nil {
		logFailure(r, err)
	}
	w.Header().Set("Location", location)
	w.WriteHeader(http.StatusFound)
}

func (handler *Handler) UpdateAssets(w http.ResponseWriter, r *http.Request) {
	organizationID, _, ok := handler.tenant(w, r)
	if !ok {
		return
	}
	var body struct {
		SelectedAssetIDs []string `json:"selected_asset_ids"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	if err := handler.service.UpdateSelection(ctx, organizationID, r.PathValue("id"), body.SelectedAssetIDs); err != nil {
		handler.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) Disconnect(w http.ResponseWriter, r *http.Request) {
	organizationID, _, ok := handler.tenant(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	if err := handler.service.Disconnect(ctx, organizationID, r.PathValue("id")); err != nil {
		handler.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Sync reads from the provider and writes only Marketing facts. Owners and
// admins only, as in the existing Marketing sync.
func (handler *Handler) Sync(w http.ResponseWriter, r *http.Request) {
	organizationID, userID, ok := handler.tenant(w, r)
	if !ok {
		return
	}
	if tenantContext, found := tenant.FromContext(r.Context()); !found || !tenantContext.HasRole("owner", "admin") {
		handler.writeError(w, r, newFailure("organization_admin_required", http.StatusForbidden))
		return
	}
	var body struct {
		DateStart string `json:"date_start"`
		DateStop  string `json:"date_stop"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(syncTimeout + 10*time.Second))
	ctx, cancel := context.WithTimeout(r.Context(), syncTimeout)
	defer cancel()
	result, err := handler.service.Sync(ctx, organizationID, userID, r.PathValue("id"), body.DateStart, body.DateStop)
	if err != nil {
		handler.writeError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, result)
}

func (handler *Handler) tenant(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	context, ok := tenant.FromContext(r.Context())
	if !ok || context.OrganizationID == "" {
		handler.writeError(w, r, newFailure("authentication_required", http.StatusUnauthorized))
		return "", "", false
	}
	return context.OrganizationID, context.UserID, true
}

func (handler *Handler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	logFailure(r, err)
	failure := failureOf(err)
	httpserver.WriteError(w, r, failure.Status, failure.Code, failure.Code)
}

// logFailure records only the code: causes can quote provider URLs or tokens.
func logFailure(r *http.Request, err error) {
	failure := failureOf(err)
	if failure.Status >= http.StatusInternalServerError {
		slog.ErrorContext(r.Context(), "marketing connection failed", "code", failure.Code)
	}
}

func decodeBody(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxRequestBodyKB<<10))
	decoder.DisallowUnknownFields()
	err := decoder.Decode(target)
	if err == nil {
		err = decoder.Decode(&struct{}{})
		if errors.Is(err, io.EOF) {
			return true
		}
	}
	httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_request_body", "invalid_request_body")
	return false
}

func callbackRedirect(returnURL string, err error) (string, error) {
	target, parseErr := url.Parse(returnURL)
	if parseErr != nil {
		return "", parseErr
	}
	query := target.Query()
	if err != nil {
		query.Set("marketing_connection", "error")
		query.Set("marketing_error", failureOf(err).Code)
	} else {
		query.Set("marketing_connection", "success")
	}
	target.RawQuery = query.Encode()
	return target.String(), nil
}
