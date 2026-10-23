package leads

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Handler struct {
	repo                  Repository
	publisher             realtime.Publisher
	moveStageLimiter      *moveStageRateLimiter
	creativeMediaResolver dashboardCreativeMediaResolver
}

func NewHandler(repo Repository, publishers ...realtime.Publisher) Handler {
	publisher := realtime.Publisher(realtime.NoopPublisher{})
	if len(publishers) > 0 && publishers[0] != nil {
		publisher = publishers[0]
	}
	return Handler{repo: repo, publisher: publisher, moveStageLimiter: newMoveStageRateLimiter()}
}

func (handler Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	filter, err := ParseListFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	response, err := handler.repo.List(r.Context(), tenantContext, filter)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) Show(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	lead, err := handler.repo.Get(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]Lead{
		"data": lead,
	})
}

func (handler Handler) ShowSensitiveProfile(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	profile, err := handler.repo.GetSensitiveProfile(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]SensitiveLeadProfile{
		"data": profile,
	})
}

func (handler Handler) ShowConversationDetail(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	lead, err := handler.repo.GetConversationDetail(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]ConversationLeadDetail{
		"data": lead,
	})
}

func (handler Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()

	var request CreateRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	result, err := handler.repo.Create(r.Context(), tenantContext, input)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	if !result.Replayed {
		handler.publishLeadCreationEvent(tenantContext, result.Lead.ID)
	}
	httpserver.WriteJSON(w, http.StatusCreated, createLeadResponse(tenantContext, result))
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
		writeLeadError(w, r, err)
		return
	}

	lead, err := handler.repo.Update(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	handler.publishLeadEvent(tenantContext, "lead.updated", lead.ID, map[string]any{
		"leadId":         lead.ID,
		"pipelineId":     lead.PipelineID,
		"stageId":        lead.StageID,
		"assignedUserId": lead.AssignedUserID,
	})
	httpserver.WriteJSON(w, http.StatusOK, map[string]Lead{
		"data": lead,
	})
}

func (handler Handler) MoveStage(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()

	allowed, err := handler.allowMoveStageRequest(r.Context(), tenantContext)
	if err != nil {
		slog.Error("move-stage shared rate limiter failed", "error", err, "organization_id", tenantContext.OrganizationID)
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "lead_move_rate_limit_unavailable", "Unable to validate the movement rate limit.")
		return
	}
	if !allowed {
		httpserver.WriteError(w, r, http.StatusTooManyRequests, "lead_move_rate_limited", "Muitas movimentacoes em sequencia. Aguarde um instante e tente novamente.")
		return
	}

	var request MoveStageRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	result, err := handler.repo.MoveStage(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	eventName := "lead.reordered"
	if result.StageChanged {
		eventName = "lead.stage_moved"
	}
	handler.publishLeadEvent(tenantContext, eventName, result.Lead.ID, map[string]any{
		"leadId":     result.Lead.ID,
		"pipelineId": result.Lead.PipelineID,
		"stageId":    result.Lead.StageID,
	})
	httpserver.WriteJSON(w, http.StatusOK, map[string]Lead{
		"data": result.Lead,
	})
}

func (handler Handler) Assign(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()

	var request AssignRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	lead, err := handler.repo.Assign(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	handler.publishLeadEvent(tenantContext, "lead.assigned", lead.ID, map[string]any{
		"leadId":         lead.ID,
		"assignedUserId": lead.AssignedUserID,
	})
	httpserver.WriteJSON(w, http.StatusOK, map[string]Lead{
		"data": lead,
	})
}

func (handler Handler) RedistributeRoundRobin(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()
	var request RedistributeRoundRobinRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil && !errors.Is(err, io.EOF) {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	result, err := handler.repo.RedistributeRoundRobin(r.Context(), tenantContext, r.PathValue("id"), request.ExpectedUnassigned)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	if result.Success && result.AssignedUserID != "" {
		handler.publishLeadEvent(tenantContext, "lead.redistributed", result.LeadID, map[string]any{
			"leadId":         result.LeadID,
			"pipelineId":     result.PipelineID,
			"stageId":        result.StageID,
			"assignedUserId": result.AssignedUserID,
			"roundRobinId":   result.RoundRobinID,
			"roundRobinUsed": result.RoundRobinUsed,
		})
	}
	httpserver.WriteJSON(w, http.StatusOK, result)
}

func (handler Handler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	if err := handler.repo.Delete(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeLeadError(w, r, err)
		return
	}

	handler.publishLeadEvent(tenantContext, "lead.deleted", r.PathValue("id"), map[string]any{
		"leadId": r.PathValue("id"),
	})
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) AddTag(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	defer r.Body.Close()

	var request TagRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	if err := handler.repo.AddTag(r.Context(), tenantContext, r.PathValue("id"), input); err != nil {
		writeLeadError(w, r, err)
		return
	}

	handler.publishLeadEvent(tenantContext, "lead.tagged", r.PathValue("id"), map[string]any{
		"leadId": r.PathValue("id"),
		"tagId":  input.TagID,
	})
	httpserver.WriteJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

func (handler Handler) RemoveTag(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}

	input, err := (TagRequest{TagID: r.PathValue("tagId")}).Validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}

	if err := handler.repo.RemoveTag(r.Context(), tenantContext, r.PathValue("id"), input); err != nil {
		writeLeadError(w, r, err)
		return
	}

	handler.publishLeadEvent(tenantContext, "lead.untagged", r.PathValue("id"), map[string]any{
		"leadId": r.PathValue("id"),
		"tagId":  input.TagID,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) publishLeadEvent(tenantContext tenant.Context, eventType string, leadID string, data map[string]any) {
	if data == nil {
		data = map[string]any{}
	}
	data["leadId"] = leadID
	handler.publisher.Publish(realtime.NewEvent(eventType, tenantContext.OrganizationID, tenantContext.UserID, data))
}

func writeLeadError(w http.ResponseWriter, r *http.Request, err error) {
	if writeQueueRuntimeError(w, r, err) {
		return
	}
	if writeLeadFinancialError(w, r, err) {
		return
	}
	switch {
	case errors.Is(err, ErrLeadContactOutcomeConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "lead_contact_outcome_command_conflict", "Esta tentativa já foi registrada com outros dados. Preserve suas anotações e revise o resultado.")
	case errors.Is(err, ErrLeadContactOutcomeStorageUnavailable):
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "lead_contact_outcome_storage_unavailable", "Não foi possível confirmar o registro. Preserve suas anotações e tente novamente com a mesma tentativa.")
	case errors.Is(err, ErrLeadFeedbackConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "lead_feedback_command_conflict", "This feedback command already has different content. Keep the draft and start a new command.")
	case errors.Is(err, ErrLeadFeedbackStorageUnavailable):
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "lead_feedback_storage_unavailable", "Feedback receipt storage is unavailable. Keep the draft and retry the same command later.")
	case errors.Is(err, ErrCadenceCompletionConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "lead_cadence_completion_conflict", "This cadence task was completed with another result. Refresh and review your notes.")
	case errors.Is(err, ErrQueueManagedReleaseRequired):
		httpserver.WriteError(w, r, http.StatusConflict, "queue_managed_release_required", "Escolha outro responsável para transferir este lead. Esta ação não pode deixá-lo sem responsável.")
	case errors.Is(err, ErrQueuePoolConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "queue_pool_changed", "O lead mudou no bolsão. Atualize e tente novamente.")
	case errors.Is(err, ErrLostReasonRequired):
		httpserver.WriteError(w, r, http.StatusBadRequest, "lead_lost_reason_required", "lostReason is required when dealStatus is lost")
	case errors.Is(err, ErrInvalidTagInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_tag_input", "Revise o nome, a cor e a versão da tag antes de tentar novamente.")
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_lead_input", err.Error())
	case errors.Is(err, ErrNoLeadChanges):
		httpserver.WriteError(w, r, http.StatusBadRequest, "no_lead_changes", "No lead changes were provided.")
	case errors.Is(err, ErrLeadStageChanged):
		httpserver.WriteError(w, r, http.StatusConflict, "lead_stage_changed", "O lead mudou de etapa em outra sessão. Atualize e tente novamente.")
	case errors.Is(err, ErrTagAlreadyExists):
		httpserver.WriteError(w, r, http.StatusConflict, "tag_already_exists", "Tag is already attached to this lead.")
	case errors.Is(err, ErrTagNameAlreadyExists):
		httpserver.WriteError(w, r, http.StatusConflict, "tag_already_exists", "Já existe uma tag com este nome.")
	case errors.Is(err, ErrTagChanged):
		httpserver.WriteError(w, r, http.StatusConflict, "tag_changed", "Esta tag foi alterada em outra sessão. Atualize a lista e abra a edição novamente.")
	case errors.Is(err, ErrTagInUse):
		httpserver.WriteError(w, r, http.StatusConflict, "tag_in_use", "Esta tag está sendo usada em configurações. Remova ou substitua esses vínculos antes de excluir.")
	case errors.Is(err, ErrLeadSourceAlreadyExists):
		httpserver.WriteError(w, r, http.StatusConflict, "lead_source_already_exists", "This lead source already exists.")
	case errors.Is(err, ErrLeadAlreadyExists):
		httpserver.WriteError(w, r, http.StatusConflict, "lead_already_exists", "Atencao: lead nao criado, pois ja esta cadastrado e atribuido a outro responsavel. Entre em contato com o administrador.")
	case errors.Is(err, ErrLeadPhoneConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "lead_phone_conflict", "Este telefone ja esta cadastrado em outro lead.")
	case errors.Is(err, ErrLeadChanged):
		httpserver.WriteError(w, r, http.StatusConflict, "lead_changed", "Este contato foi alterado em outra sessão. Reabra a edição para conferir os dados atuais; suas alterações não foram gravadas.")
	case errors.Is(err, ErrLeadImportRequestConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "lead_import_request_conflict", "Esta linha já foi enviada com outras informações. Confira o resultado anterior antes de iniciar uma nova importação.")
	case errors.Is(err, ErrLeadImportIdempotencyUnavailable):
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "lead_import_idempotency_unavailable", "A proteção contra importações repetidas ainda não está disponível. Esta tentativa não gravou contatos; contate o administrador.")
	case errors.Is(err, ErrLeadCreationWorkflowUnavailable):
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "lead_creation_workflow_unavailable", "A criação de contatos ganhos ainda precisa da atualização do fluxo comercial. Nenhum contato foi gravado; preserve os dados e contate o administrador.")
	case errors.Is(err, ErrContactsExportChanged):
		httpserver.WriteError(w, r, http.StatusConflict, "contacts_export_changed", "Os contatos ou suas informações mudaram durante a exportação. Gere o arquivo novamente para incluir um conjunto consistente.")
	case errors.Is(err, ErrLeadPropertyUnavailable):
		httpserver.WriteError(w, r, http.StatusConflict, "lead_property_unavailable", leadErrorMessage(err, ErrLeadPropertyUnavailable))
	case errors.Is(err, ErrLeadPropertyRelinkWhileWon):
		httpserver.WriteError(w, r, http.StatusConflict, "lead_property_relink_while_won", "Reabra o lead antes de trocar o imóvel vinculado.")
	case errors.Is(err, ErrLeadReservationUnverified):
		httpserver.WriteError(w, r, http.StatusConflict, "lead_reservation_unverified", "Não foi possível confirmar a reserva deste imóvel. Peça uma conferência ao administrador antes de alterar o resultado do lead.")
	case errors.Is(err, ErrConversationBindingChanged):
		httpserver.WriteError(w, r, http.StatusConflict, "whatsapp_conversation_binding_changed", "The WhatsApp conversation was linked to another lead. Refresh and try again.")
	case errors.Is(err, ErrWhatsAppSendInFlight):
		httpserver.WriteError(w, r, http.StatusConflict, "lead_whatsapp_send_in_flight", ErrWhatsAppSendInFlight.Error())
	case errors.Is(err, ErrLeadAssigneeTeamMismatch):
		httpserver.WriteError(w, r, http.StatusBadRequest, "lead_assignee_team_mismatch", "O responsável precisa ser um membro ativo da equipe vinculada ao lead. Revise a equipe antes de transferir.")
	case errors.Is(err, distribution.ErrIntakeDestinationUnavailable):
		httpserver.WriteError(w, r, http.StatusBadRequest, "lead_destination_unavailable", "O funil selecionado precisa ter uma coluna ativa. Revise o destino do lead e tente novamente.")
	case errors.Is(err, ErrLeadDestinationBusy):
		httpserver.WriteError(w, r, http.StatusConflict, "lead_destination_busy", "O destino do lead está sendo alterado em outra sessão. Aguarde e revise a coluna antes de tentar novamente.")
	case errors.Is(err, ErrMoveStageDestinationUnavailable):
		httpserver.WriteError(w, r, http.StatusBadRequest, "lead_move_destination_unavailable", "The destination stage or pipeline is no longer available. Refresh and select an active stage.")
	case errors.Is(err, ErrMoveStageConfigurationConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "lead_move_configuration_conflict", "The destination stage has conflicting commercial rules. Ask a manager to review its configuration.")
	case errors.Is(err, ErrLeadLinkedPropertyInvalid):
		httpserver.WriteError(w, r, http.StatusBadRequest, "lead_linked_property_invalid", "The linked property is unavailable in this organization. Review the link before changing the commercial status.")
	case errors.Is(err, ErrInvalidReference):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_lead_reference", "One or more lead references do not belong to this organization.")
	case errors.Is(err, ErrLeadNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "lead_not_found", "Lead was not found.")
	case errors.Is(err, ErrStorageNotConfigured):
		httpserver.WriteError(w, r, http.StatusInternalServerError, "lead_storage_not_configured", "Lead storage is not configured.")
	case errors.Is(err, ErrAttachmentUploadConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "lead_attachment_upload_conflict", "Este documento já foi enviado com outras informações. Confira o envio anterior antes de escolher o arquivo novamente.")
	case errors.Is(err, ErrAttachmentUploadUnavailable):
		httpserver.WriteError(w, r, http.StatusServiceUnavailable, "lead_attachment_upload_unavailable", "Não foi possível confirmar a proteção do envio. Preserve o arquivo e tente novamente com a mesma seleção; contate o administrador se persistir.")
	case errors.Is(err, ErrStorageOperation):
		httpserver.WriteError(w, r, http.StatusBadGateway, "lead_storage_failed", "Lead storage operation failed.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		slog.Error("lead operation failed",
			"error", err,
			"request_id", httpserver.RequestIDFromContext(r.Context()),
			"path", r.URL.Path,
			"method", r.Method,
		)
		httpserver.WriteError(w, r, http.StatusInternalServerError, "lead_operation_failed", "Unable to complete lead operation.")
	}
}

func leadErrorMessage(err error, sentinel error) string {
	message := strings.TrimSpace(err.Error())
	prefix := sentinel.Error() + ":"
	return strings.TrimSpace(strings.TrimPrefix(message, prefix))
}
