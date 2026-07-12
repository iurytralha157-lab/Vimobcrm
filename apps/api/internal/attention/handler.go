package attention

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Handler struct {
	repo Repository
}

func NewHandler(repo Repository) Handler {
	return Handler{repo: repo}
}

func (handler Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	context, ok := attentionContext(w, r)
	if !ok {
		return
	}
	settings, err := handler.repo.GetSettings(r.Context(), context)
	if err != nil {
		writeAttentionError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Settings]{Data: settings})
}

func (handler Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	context, ok := attentionContext(w, r)
	if !ok {
		return
	}
	var request SettingsRequest
	if !decodeAttentionJSON(w, r, &request, false) {
		return
	}
	settings, err := handler.repo.UpdateSettings(r.Context(), context, request)
	if err != nil {
		writeAttentionError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Settings]{Data: settings})
}

func (handler Handler) ListPolicies(w http.ResponseWriter, r *http.Request) {
	context, ok := attentionContext(w, r)
	if !ok {
		return
	}
	includeArchived, _ := strconv.ParseBool(r.URL.Query().Get("includeArchived"))
	policies, err := handler.repo.ListPolicies(r.Context(), context, includeArchived)
	if err != nil {
		writeAttentionError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]Policy]{Data: policies})
}

func (handler Handler) CreatePolicy(w http.ResponseWriter, r *http.Request) {
	context, ok := attentionContext(w, r)
	if !ok {
		return
	}
	var request PolicyRequest
	if !decodeAttentionJSON(w, r, &request, false) {
		return
	}
	policy, err := handler.repo.CreatePolicy(r.Context(), context, request)
	if err != nil {
		writeAttentionError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[Policy]{Data: policy})
}

func (handler Handler) UpdatePolicy(w http.ResponseWriter, r *http.Request) {
	context, ok := attentionContext(w, r)
	if !ok {
		return
	}
	var request PolicyRequest
	if !decodeAttentionJSON(w, r, &request, false) {
		return
	}
	policy, err := handler.repo.UpdatePolicy(r.Context(), context, r.PathValue("id"), request)
	if err != nil {
		writeAttentionError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Policy]{Data: policy})
}

func (handler Handler) ListItems(w http.ResponseWriter, r *http.Request) {
	context, ok := attentionContext(w, r)
	if !ok {
		return
	}
	filter := ListFilter{
		Scope:  r.URL.Query().Get("scope"),
		Status: splitStatuses(r.URL.Query().Get("status")),
		Limit:  parseLimit(r.URL.Query().Get("limit")),
		Cursor: r.URL.Query().Get("cursor"),
	}
	items, err := handler.repo.ListItems(r.Context(), context, filter)
	if err != nil {
		writeAttentionError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[ItemPage]{Data: items})
}

func (handler Handler) Summary(w http.ResponseWriter, r *http.Request) {
	context, ok := attentionContext(w, r)
	if !ok {
		return
	}
	summary, err := handler.repo.Summary(r.Context(), context, r.URL.Query().Get("scope"))
	if err != nil {
		writeAttentionError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Summary]{Data: summary})
}

func (handler Handler) AcknowledgeItem(w http.ResponseWriter, r *http.Request) {
	context, ok := attentionContext(w, r)
	if !ok {
		return
	}
	var request AcknowledgeRequest
	if !decodeAttentionJSON(w, r, &request, true) {
		return
	}
	item, err := handler.repo.AcknowledgeItem(r.Context(), context, r.PathValue("id"), request)
	if err != nil {
		writeAttentionError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Item]{Data: item})
}

func (handler Handler) SnoozeItem(w http.ResponseWriter, r *http.Request) {
	context, ok := attentionContext(w, r)
	if !ok {
		return
	}
	var request SnoozeRequest
	if !decodeAttentionJSON(w, r, &request, false) {
		return
	}
	item, err := handler.repo.SnoozeItem(r.Context(), context, r.PathValue("id"), request)
	if err != nil {
		writeAttentionError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Item]{Data: item})
}

func (handler Handler) ResolveItem(w http.ResponseWriter, r *http.Request) {
	context, ok := attentionContext(w, r)
	if !ok {
		return
	}
	var request ResolveRequest
	if !decodeAttentionJSON(w, r, &request, false) {
		return
	}
	item, err := handler.repo.ResolveItem(r.Context(), context, r.PathValue("id"), request)
	if err != nil {
		writeAttentionError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Item]{Data: item})
}

func attentionContext(w http.ResponseWriter, r *http.Request) (tenant.Context, bool) {
	context, ok := tenant.FromContext(r.Context())
	if !ok || strings.TrimSpace(context.OrganizationID) == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return tenant.Context{}, false
	}
	return context, true
}

func decodeAttentionJSON(w http.ResponseWriter, r *http.Request, target any, allowEmpty bool) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		if allowEmpty && errors.Is(err, io.EOF) {
			return true
		}
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body must contain one JSON object.")
		return false
	}
	return true
}

func splitStatuses(value string) []string {
	result := []string{}
	for _, candidate := range strings.Split(value, ",") {
		candidate = strings.ToLower(strings.TrimSpace(candidate))
		if candidate != "" {
			result = append(result, candidate)
		}
	}
	return result
}

func writeAttentionError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_attention_input", err.Error())
	case errors.Is(err, ErrNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "attention_not_found", "Attention resource was not found.")
	case errors.Is(err, ErrForbidden), errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "attention_operation_failed", "Unable to complete attention operation.")
	}
}
