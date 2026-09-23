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
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const leadRecoveryMaxRequestBytes = int64(4 << 10)

type leadRecoveryExecutor interface {
	PreviewLeadRecovery(context.Context, LeadRecoveryRequest) (LeadRecoveryPreview, error)
	RecoverLead(context.Context, LeadRecoveryRequest) (LeadRecoveryResult, error)
}

type LeadRecoveryHTTPHandler struct {
	executor  leadRecoveryExecutor
	publisher realtime.Publisher
}

func NewLeadRecoveryHTTPHandler(repo Repository, publisher realtime.Publisher) LeadRecoveryHTTPHandler {
	if publisher == nil {
		publisher = realtime.NoopPublisher{}
	}
	return LeadRecoveryHTTPHandler{executor: repo, publisher: publisher}
}

func (handler LeadRecoveryHTTPHandler) Preview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	request, ok := parseLeadRecoveryRequest(w, r, false)
	if !ok {
		return
	}
	if handler.executor == nil {
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "meta_recovery_unavailable", "Meta lead recovery is unavailable.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 75*time.Second)
	defer cancel()
	preview, err := handler.executor.PreviewLeadRecovery(ctx, request)
	if err != nil {
		writeLeadRecoveryError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, preview)
}

func (handler LeadRecoveryHTTPHandler) Recover(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	request, ok := parseLeadRecoveryRequest(w, r, true)
	if !ok {
		return
	}
	if handler.executor == nil {
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "meta_recovery_unavailable", "Meta lead recovery is unavailable.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 75*time.Second)
	defer cancel()
	result, err := handler.executor.RecoverLead(ctx, request)
	if err != nil {
		writeLeadRecoveryError(w, r, err)
		return
	}
	if result.Status == "processed" {
		handler.publisher.Publish(realtime.NewEvent("lead.meta_webhook_received", request.OrganizationID, "", map[string]any{
			"leadId":    result.LeadID,
			"leadgenId": result.LeadgenID,
			"formId":    request.FormID,
			"pageId":    request.PageID,
			"reentry":   result.Reentry,
		}))
	}
	httpserver.WriteJSON(w, http.StatusOK, result)
}

func parseLeadRecoveryRequest(w http.ResponseWriter, r *http.Request, requireLeadID bool) (LeadRecoveryRequest, bool) {
	if r.Method != http.MethodPost {
		httpserver.WriteError(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "Method is not allowed.")
		return LeadRecoveryRequest{}, false
	}
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || !tenantContext.IsOrganizationMember() || !tenantContext.HasPermission(permissions.SettingsIntegrations) {
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to recover Meta leads.")
		return LeadRecoveryRequest{}, false
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Type"))), "application/json") {
		httpserver.WriteError(w, r, http.StatusUnsupportedMediaType, "content_type_must_be_json", "Content-Type must be application/json.")
		return LeadRecoveryRequest{}, false
	}
	defer r.Body.Close()
	var body struct {
		Date      string `json:"date"`
		LeadgenID string `json:"leadgenId"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, leadRecoveryMaxRequestBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json_body", "Request body is invalid.")
		return LeadRecoveryRequest{}, false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json_body", "Request body is invalid.")
		return LeadRecoveryRequest{}, false
	}
	if !requireLeadID && body.LeadgenID != "" {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json_body", "Request body is invalid.")
		return LeadRecoveryRequest{}, false
	}
	request := LeadRecoveryRequest{
		OrganizationID: tenantContext.OrganizationID,
		PageID:         r.PathValue("pageId"),
		FormID:         r.PathValue("formId"),
		Date:           body.Date,
		LeadgenID:      body.LeadgenID,
	}
	if _, _, err := validateRecoveryRequest(request, requireLeadID, time.Now()); err != nil {
		writeLeadRecoveryError(w, r, err)
		return LeadRecoveryRequest{}, false
	}
	return request, true
}

func writeLeadRecoveryError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errRecoveryInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "meta_recovery_invalid_input", "Select a valid Page, form and recent date.")
	case errors.Is(err, errRecoveryRouteUnavailable):
		httpserver.WriteError(w, r, http.StatusConflict, "meta_recovery_form_inactive", "This Meta form is not connected and active.")
	case errors.Is(err, errRecoveryWrongOrganization):
		httpserver.WriteError(w, r, http.StatusNotFound, "meta_recovery_form_not_found", "This Meta form is unavailable in the active organization.")
	case errors.Is(err, errRecoveryLeadMismatch):
		httpserver.WriteError(w, r, http.StatusUnprocessableEntity, "meta_recovery_lead_mismatch", "The Meta lead does not match the selected form or date.")
	case errors.Is(err, errRecoveryRateLimited):
		httpserver.WriteError(w, r, http.StatusTooManyRequests, "meta_recovery_rate_limited", "Meta limited lead retrieval. Try again later.")
	case errors.Is(err, errRecoveryCollectionTooLarge):
		httpserver.WriteError(w, r, http.StatusConflict, "meta_recovery_collection_too_large", "This form has too many leads for a safe recovery preview.")
	default:
		httpserver.WriteError(w, r, http.StatusBadGateway, "meta_recovery_failed", "Meta lead recovery could not be completed.")
	}
}
