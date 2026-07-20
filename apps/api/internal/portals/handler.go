package portals

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const maxPortalWebhookBody = 2 << 20

type Handler struct {
	repo Repository
}

func NewHandler(repo Repository) Handler {
	return Handler{repo: repo}
}

func (handler Handler) GetGrupoOLX(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.GetGrupoOLX(r.Context(), tenantContext)
	if errors.Is(err, ErrNotFound) {
		httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: nil})
		return
	}
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) SaveGrupoOLX(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request GrupoOLXSettingsRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	item, err := handler.repo.SaveGrupoOLX(r.Context(), tenantContext, request)
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) ActivateGrupoOLX(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.ActivateGrupoOLX(r.Context(), tenantContext)
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) RegenerateGrupoOLXFeedToken(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.RegenerateFeedToken(r.Context(), tenantContext)
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) RegenerateGrupoOLXWebhookToken(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.RegenerateWebhookToken(r.Context(), tenantContext)
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) ListGrupoOLXPublications(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListPublications(r.Context(), tenantContext)
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) UpsertGrupoOLXPublications(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := organizationContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request UpsertPublicationsRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	items, err := handler.repo.UpsertPublications(r.Context(), tenantContext, request)
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) GrupoOLXFeed(w http.ResponseWriter, r *http.Request) {
	token := cleanPathToken(r.PathValue("token"))
	body, err := handler.repo.BuildGrupoOLXFeed(r.Context(), token)
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

func (handler Handler) GrupoOLXLeadWebhook(w http.ResponseWriter, r *http.Request) {
	token := cleanPathToken(r.PathValue("token"))
	body, ok := readLimitedBody(w, r)
	if !ok {
		return
	}
	result, err := handler.repo.ProcessGrupoOLXLead(r.Context(), token, r.Header.Get("Authorization"), body)
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "data": result})
}

func (handler Handler) GrupoOLXImportReportWebhook(w http.ResponseWriter, r *http.Request) {
	token := cleanPathToken(r.PathValue("token"))
	body, ok := readLimitedBody(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.ReceiveGrupoOLXImportReport(r.Context(), token, r.Header.Get("Authorization"), body)
	if err != nil {
		writePortalError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func organizationContext(w http.ResponseWriter, r *http.Request) (tenant.Context, bool) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return tenant.Context{}, false
	}
	return tenantContext, true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, maxPortalWebhookBody))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return err
	}
	if err := ensureJSONEOF(decoder); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return err
	}
	return nil
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body must contain a single JSON value")
		}
		return err
	}
	return nil
}

func readLimitedBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, maxPortalWebhookBody+1))
	if err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_body", "Request body is invalid.")
		return nil, false
	}
	if len(body) > maxPortalWebhookBody {
		httpserver.WriteError(w, r, http.StatusRequestEntityTooLarge, "body_too_large", "Webhook body is too large.")
		return nil, false
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		httpserver.WriteError(w, r, http.StatusBadRequest, "empty_body", "Webhook body is required.")
		return nil, false
	}
	return body, true
}

func cleanPathToken(token string) string {
	return strings.TrimSuffix(strings.TrimSpace(token), ".xml")
}

func writePortalError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_portal_input", "Dados da integracao de portais invalidos.")
	case errors.Is(err, ErrUnauthorized):
		httpserver.WriteError(w, r, http.StatusUnauthorized, "portal_webhook_unauthorized", "Webhook nao autorizado.")
	case errors.Is(err, ErrNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "portal_integration_not_found", "Integracao de portal nao encontrada.")
	case errors.Is(err, ErrModuleUnavailable):
		httpserver.WriteError(w, r, http.StatusForbidden, "portal_module_unavailable", "Modulo de portais indisponivel para a organizacao.")
	case errors.Is(err, ErrListingNotFound):
		httpserver.WriteError(w, r, http.StatusBadRequest, "portal_listing_not_found", "Anuncio do portal nao encontrado no Vimob.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "portal_error", "Nao foi possivel processar a integracao de portais.")
	}
}
