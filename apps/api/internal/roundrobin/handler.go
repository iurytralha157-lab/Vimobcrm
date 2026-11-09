package roundrobin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/managementintent"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Handler struct {
	repo      Repository
	publisher realtime.Publisher
}

func NewHandler(repo Repository, publishers ...realtime.Publisher) Handler {
	handler := Handler{repo: repo, publisher: realtime.NoopPublisher{}}
	if len(publishers) > 0 && publishers[0] != nil {
		handler.publisher = publishers[0]
	}
	return handler
}

func (handler Handler) ListWhatsAppSessionOptions(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	items, err := handler.repo.ListWhatsAppSessionOptions(r.Context(), tenantContext)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]WhatsAppSessionOption{"data": items})
}

func (handler Handler) ListMetaFormOptions(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	items, err := handler.repo.ListMetaFormOptions(r.Context(), tenantContext)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]MetaFormOption{"data": items})
}

func (handler Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	items, err := handler.repo.List(r.Context(), tenantContext)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]RoundRobin{"data": items})
}

func (handler Handler) Capabilities(w http.ResponseWriter, r *http.Request) {
	if _, ok := tenant.RequireOrganizationContext(w, r); !ok {
		return
	}
	available, err := managedQueueSchedulesAvailable(r.Context(), handler.repo.db.Pool())
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpserver.WriteJSON(w, http.StatusOK, map[string]map[string]bool{"data": {"managedSchedules": available}})
}

func (handler Handler) Get(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}

	item, err := handler.repo.Get(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]RoundRobin{"data": item})
}

func (handler Handler) ListHistory(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}

	limit, err := parseHistoryLimit(r.URL.Query().Get("limit"))
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	offset, err := parseHistoryOffset(r.URL.Query().Get("offset"))
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}
	items, err := handler.repo.ListHistory(r.Context(), tenantContext, r.PathValue("id"), limit, offset)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]HistoryEvent{"data": items})
}

func (handler Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request CreateRequest
	request.IdempotencyKey = r.Header.Get("Idempotency-Key")
	if !managementintent.ValidKey(request.IdempotencyKey) {
		httpserver.WriteError(w, r, http.StatusPreconditionRequired, "management_create_key_required", "Reabra o formulário antes de criar a fila.")
		return
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	item, err := handler.repo.Create(r.Context(), tenantContext, input)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	handler.publishQueueChanged(tenantContext)
	httpserver.WriteJSON(w, http.StatusCreated, map[string]RoundRobin{"data": item})
}

func (handler Handler) Update(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request UpdateRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	item, err := handler.repo.Update(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	handler.publishQueueChanged(tenantContext)
	httpserver.WriteJSON(w, http.StatusOK, map[string]RoundRobin{"data": item})
}

func (handler Handler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	expected, err := parseRevisionHeader(r.Header.Get("If-Match"))
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}
	if err := handler.repo.Delete(r.Context(), tenantContext, r.PathValue("id"), expected); err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	handler.publishQueueChanged(tenantContext)
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) ListRules(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	var roundRobinID *string
	if value := r.PathValue("id"); value != "" {
		roundRobinID = &value
	} else if value := r.URL.Query().Get("roundRobinId"); value != "" {
		roundRobinID = &value
	}

	rules, err := handler.repo.ListRules(r.Context(), tenantContext, roundRobinID)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string][]Rule{"data": rules})
}

func (handler Handler) CreateRule(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request RuleRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate(r.PathValue("id"))
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	rule, err := handler.repo.CreateRule(r.Context(), tenantContext, input)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	handler.publishQueueChanged(tenantContext)
	httpserver.WriteJSON(w, http.StatusCreated, map[string]Rule{"data": rule})
}

func (handler Handler) UpdateRule(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request UpdateRuleRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	rule, err := handler.repo.UpdateRule(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	handler.publishQueueChanged(tenantContext)
	httpserver.WriteJSON(w, http.StatusOK, map[string]Rule{"data": rule})
}

func (handler Handler) DeleteRule(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	expected, err := parseRevisionHeader(r.Header.Get("If-Match"))
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}
	if err := handler.repo.DeleteRule(r.Context(), tenantContext, r.PathValue("id"), expected); err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	handler.publishQueueChanged(tenantContext)
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) AddMember(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request MemberRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	members, err := handler.repo.AddMember(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	handler.publishQueueChanged(tenantContext)
	httpserver.WriteJSON(w, http.StatusCreated, map[string][]Member{"data": members})
}

func (handler Handler) UpdateMember(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request UpdateMemberRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	member, err := handler.repo.UpdateMember(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	handler.publishQueueChanged(tenantContext)
	httpserver.WriteJSON(w, http.StatusOK, map[string]Member{"data": member})
}

func (handler Handler) DeleteMember(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	expected, err := parseRevisionHeader(r.Header.Get("If-Match"))
	if err != nil {
		writeRoundRobinError(w, r, err)
		return
	}
	if err := handler.repo.DeleteMember(r.Context(), tenantContext, r.PathValue("id"), expected); err != nil {
		writeRoundRobinError(w, r, err)
		return
	}

	handler.publishQueueChanged(tenantContext)
	w.WriteHeader(http.StatusNoContent)
}

func writeRoundRobinError(w http.ResponseWriter, r *http.Request, err error) {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == "23514" && postgresError.Message == "queue_managed_admission_on_hold" {
		httpserver.WriteError(w, r, http.StatusConflict, "queue_managed_admission_on_hold", "A escala semanal ainda não está disponível. Salve a fila sem escala ou tente novamente mais tarde.")
		return
	}
	if errors.As(err, &postgresError) && postgresError.Code == "23514" && postgresError.Message == "queue_distribution_pending" {
		err = ErrQueueDistributionPending
	}
	if errors.As(err, &postgresError) && postgresError.Code == "23503" && postgresError.ConstraintName == "tags_management_reference_guard" {
		err = ErrInvalidReference
	}
	if errors.Is(err, managementintent.ErrConflict) || errors.Is(err, managementintent.ErrResultUnavailable) {
		httpserver.WriteError(w, r, http.StatusConflict, "management_create_conflict", "Este pedido de criação já foi utilizado. Recarregue a lista de filas.")
		return
	}
	if errors.Is(err, managementintent.ErrInvalidKey) {
		httpserver.WriteError(w, r, http.StatusPreconditionRequired, "management_create_key_required", "Reabra o formulário antes de criar a fila.")
		return
	}
	if errors.Is(err, ErrRevisionRequired) {
		httpserver.WriteError(w, r, http.StatusPreconditionRequired, "round_robin_revision_required", "Recarregue a fila antes de alterar sua configuração.")
		return
	}
	if errors.Is(err, ErrRevisionConflict) {
		httpserver.WriteError(w, r, http.StatusConflict, "round_robin_revision_conflict", "A fila foi alterada por outra pessoa. Recarregue os dados e revise seu rascunho antes de salvar.")
		return
	}
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_round_robin_input", err.Error())
	case errors.Is(err, ErrNoChanges):
		httpserver.WriteError(w, r, http.StatusBadRequest, "no_round_robin_changes", "No round-robin changes were provided.")
	case errors.Is(err, ErrInvalidReference):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_round_robin_reference", "One or more round-robin references do not belong to this organization.")
	case errors.Is(err, ErrConditionConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "round_robin_condition_conflict", err.Error())
	case errors.Is(err, ErrPendingWhatsAppIntake):
		httpserver.WriteError(w, r, http.StatusConflict, "round_robin_pending_whatsapp_intake", "This queue still has accepted WhatsApp events waiting for processing or review. Retry deletion after they finish.")
	case errors.Is(err, ErrQueueDistributionPending):
		httpserver.WriteError(w, r, http.StatusConflict, "round_robin_distribution_pending", "Esta fila tem leads em rotação ou no bolsão. Resolva essas pendências antes de excluí-la; os leads e participantes foram preservados.")
	case errors.Is(err, ErrRoundRobinNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "round_robin_not_found", "Round-robin was not found.")
	case errors.Is(err, ErrRuleNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "round_robin_rule_not_found", "Round-robin rule was not found.")
	case errors.Is(err, ErrMemberNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "round_robin_member_not_found", "Round-robin member was not found.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		slog.ErrorContext(r.Context(), "round robin operation failed", "error", err)
		httpserver.WriteError(w, r, http.StatusInternalServerError, "round_robin_operation_failed", "Unable to complete round-robin operation.")
	}
}
