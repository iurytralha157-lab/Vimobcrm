package whatsapp

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Handler struct {
	repo           Repository
	aiRunner       aiRunner
	autoReplyToken string
	workerConfig   WorkerConfig
}

func NewHandler(repo Repository) Handler {
	return Handler{repo: repo, workerConfig: DefaultWorkerConfig()}
}

func (handler Handler) WithWorkerConfig(config WorkerConfig) Handler {
	handler.workerConfig = config.normalized()
	return handler
}

func (handler Handler) EvolutionGoWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		httpserver.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"service": "evolution-go-webhook-proxy",
		})
		return
	}
	if r.Method != http.MethodPost {
		httpserver.WriteError(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "Method is not allowed.")
		return
	}
	if err := handler.repo.AuthorizeEvolutionWebhookRoute(r.Context(), r.URL.Query(), r.Header); err != nil {
		if errors.Is(err, errWebhookSessionMismatch) {
			httpserver.WriteError(w, r, http.StatusForbidden, "whatsapp_webhook_session_mismatch", "WhatsApp webhook instance does not match the configured session.")
		} else {
			httpserver.WriteError(w, r, http.StatusForbidden, "invalid_whatsapp_webhook_token", "WhatsApp webhook authentication failed.")
		}
		return
	}

	defer r.Body.Close()
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 32<<20))
	if err != nil {
		httpserver.WriteError(w, r, http.StatusRequestEntityTooLarge, "whatsapp_webhook_body_too_large", "Webhook body is too large.")
		return
	}
	envelope, err := parseEvolutionWebhookEnvelope(r.URL.Query(), r.Header, body)
	if err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_whatsapp_webhook", "WhatsApp webhook payload is invalid.")
		return
	}
	receipt, err := handler.repo.AcceptEvolutionWebhook(r.Context(), envelope)
	if err != nil {
		switch {
		case errors.Is(err, errWebhookUnauthorized):
			httpserver.WriteError(w, r, http.StatusForbidden, "invalid_whatsapp_webhook_token", "WhatsApp webhook token is invalid.")
		case errors.Is(err, errWebhookSessionMismatch):
			httpserver.WriteError(w, r, http.StatusForbidden, "whatsapp_webhook_session_mismatch", "WhatsApp webhook instance does not match the configured session.")
		case errors.Is(err, ErrSessionNotFound):
			httpserver.WriteError(w, r, http.StatusNotFound, "whatsapp_webhook_session_not_found", "WhatsApp webhook session was not found.")
		default:
			httpserver.WriteError(w, r, http.StatusInternalServerError, "whatsapp_webhook_enqueue_failed", "Unable to persist WhatsApp webhook.")
		}
		return
	}
	wakeWhatsAppWebhookWorker()
	httpserver.WriteJSON(w, http.StatusAccepted, map[string]any{"ok": true, "receipt": receipt})
}

func (handler Handler) ListSessions(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	sessions, err := handler.repo.ListSessions(r.Context(), tenantContext)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	quota, err := handler.repo.GetSessionQuota(r.Context(), tenantContext.OrganizationID)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]Session]{Data: sessions, Meta: quota})
}

func (handler Handler) CreateSession(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	var request CreateSessionRequest
	if !decodeWhatsAppJSON(w, r, &request, 1<<16) {
		return
	}
	input, err := request.Validate()
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	response, err := handler.repo.CreateSession(r.Context(), tenantContext, input)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, response)
}

func (handler Handler) ShowSession(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	session, err := handler.repo.GetSession(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[Session]{Data: session})
}

func (handler Handler) DeleteSession(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	if err := handler.repo.DeleteSession(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) GetQRCode(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	response, err := handler.repo.GetQRCode(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) GetConnectionStatus(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	response, err := handler.repo.GetConnectionStatus(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) RecreateSession(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	response, err := handler.repo.RecreateSession(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) LogoutSession(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	data, err := handler.repo.LogoutSession(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "data": data})
}

func (handler Handler) ToggleNotificationSession(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	var request ToggleNotificationRequest
	if !decodeWhatsAppJSON(w, r, &request, 1<<16) {
		return
	}

	if err := handler.repo.ToggleNotificationSession(r.Context(), tenantContext, r.PathValue("id"), request.Enabled); err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) ToggleAutoReplySession(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	var request ToggleAutoReplyRequest
	if !decodeWhatsAppJSON(w, r, &request, 1<<16) {
		return
	}

	if err := handler.repo.ToggleAutoReplySession(r.Context(), tenantContext, r.PathValue("id"), request); err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) ListSessionAccess(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	access, err := handler.repo.ListSessionAccess(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]SessionAccess]{Data: access})
}

func (handler Handler) GrantSessionAccess(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	defer r.Body.Close()
	var request GrantAccessRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	input, err := request.Validate()
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	if err := handler.repo.GrantSessionAccess(r.Context(), tenantContext, r.PathValue("id"), input); err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

func (handler Handler) RevokeSessionAccess(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	if err := handler.repo.RevokeSessionAccess(r.Context(), tenantContext, r.PathValue("id"), r.PathValue("userId")); err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) ListConversations(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	filter, err := ParseConversationListFilter(r.URL.Query())
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	conversations, err := handler.repo.ListConversations(r.Context(), tenantContext, filter)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]Conversation]{Data: conversations})
}

func (handler Handler) StartConversation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	var request StartConversationRequest
	if !decodeWhatsAppJSON(w, r, &request, 1<<16) {
		return
	}

	conversation, err := handler.repo.StartConversation(r.Context(), tenantContext, request)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, Envelope[Conversation]{Data: conversation})
}

func (handler Handler) FindConversation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	filter, err := ParseFindConversationFilter(r.URL.Query())
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	conversation, err := handler.repo.FindConversation(r.Context(), tenantContext, filter)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[*Conversation]{Data: conversation})
}

func (handler Handler) HistoryAccess(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	filter, err := ParseHistoryAccessFilter(r.URL.Query())
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	response, err := handler.repo.GetHistoryAccess(r.Context(), tenantContext, filter)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[HistoryAccessResponse]{Data: response})
}

func (handler Handler) ShowConversation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	conversation, err := handler.repo.GetConversation(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[Conversation]{Data: conversation})
}

func (handler Handler) ListMessages(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	filter, err := ParseMessageFilter(r.URL.Query())
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	page, err := handler.repo.ListMessages(r.Context(), tenantContext, r.PathValue("id"), filter)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[MessagePage]{Data: page})
}

func (handler Handler) SendMessage(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	var request SendMessageRequest
	if !decodeWhatsAppJSON(w, r, &request, 8<<20) {
		return
	}
	input, err := request.Validate()
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	response, err := handler.repo.SendMessage(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	wakeWhatsAppOutboxWorker()
	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) ReactToMessage(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	var request ReactToMessageRequest
	if !decodeWhatsAppJSON(w, r, &request, 1<<16) {
		return
	}
	input, err := request.Validate()
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	response, err := handler.repo.ReactToMessage(
		r.Context(),
		tenantContext,
		r.PathValue("id"),
		r.PathValue("messageId"),
		input,
	)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	wakeWhatsAppOutboxWorker()
	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) MarkConversationAsRead(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	if err := handler.repo.MarkConversationAsRead(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) MarkAsSeenOnWhatsApp(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	if err := handler.repo.MarkAsSeenOnWhatsApp(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) ArchiveConversation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	defer r.Body.Close()
	var request ArchiveRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	if err := handler.repo.ArchiveConversation(r.Context(), tenantContext, r.PathValue("id"), request.Archive); err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) DeleteConversation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	if err := handler.repo.DeleteConversation(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) LinkConversationToLead(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	defer r.Body.Close()
	var request LinkLeadRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}

	leadID, err := request.Validate()
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	if err := handler.repo.LinkConversationToLead(r.Context(), tenantContext, r.PathValue("id"), leadID); err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) RetryMediaDownload(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	data, err := handler.repo.RetryMediaDownload(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "data": data})
}

func (handler Handler) ListLabels(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	labels, err := handler.repo.ListLabels(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]WhatsAppLabel]{Data: labels})
}

func (handler Handler) ListChatLabels(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	labels, err := handler.repo.ListChatLabels(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]WhatsAppLabel]{Data: labels})
}

func (handler Handler) SyncLabels(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	response, err := handler.repo.SyncLabels(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) AssignLabel(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	var request AssignLabelRequest
	if !decodeWhatsAppJSON(w, r, &request, 1<<16) {
		return
	}
	data, err := handler.repo.AssignLabel(r.Context(), tenantContext, r.PathValue("id"), request)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "data": data})
}

func (handler Handler) ListGroups(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	groups, err := handler.repo.ListGroups(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]WhatsAppGroup]{Data: groups})
}

func (handler Handler) SyncGroups(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	data, err := handler.repo.SyncGroups(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "data": data})
}

func (handler Handler) GroupInfo(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	var request GroupJIDRequest
	if !decodeWhatsAppJSON(w, r, &request, 1<<16) {
		return
	}
	data, err := handler.repo.GroupInfo(r.Context(), tenantContext, r.PathValue("id"), request.JID)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "data": data})
}

func (handler Handler) GroupInviteLink(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	var request GroupJIDRequest
	if !decodeWhatsAppJSON(w, r, &request, 1<<16) {
		return
	}
	data, err := handler.repo.GroupInviteLink(r.Context(), tenantContext, r.PathValue("id"), request.JID)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "data": data})
}

func (handler Handler) UpdateGroup(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	var request UpdateGroupRequest
	if !decodeWhatsAppJSON(w, r, &request, 1<<16) {
		return
	}
	data, err := handler.repo.UpdateGroup(r.Context(), tenantContext, r.PathValue("id"), request)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "data": data})
}

func (handler Handler) CheckNumbers(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	var request CheckNumbersRequest
	if !decodeWhatsAppJSON(w, r, &request, 1<<16) {
		return
	}
	data, err := handler.repo.CheckNumbers(r.Context(), tenantContext, r.PathValue("id"), request.Numbers)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "data": data})
}

func (handler Handler) FetchAvatar(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	var request AvatarRequest
	if !decodeWhatsAppJSON(w, r, &request, 1<<16) {
		return
	}
	data, err := handler.repo.FetchAvatar(r.Context(), tenantContext, r.PathValue("id"), request.JID)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "data": data})
}

func (handler Handler) SyncContactsAvatars(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	data, err := handler.repo.SyncContactsAvatars(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "data": data})
}

func (handler Handler) HistorySync(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	var request HistorySyncRequest
	if !decodeWhatsAppJSON(w, r, &request, 1<<16) {
		return
	}
	data, err := handler.repo.HistorySync(r.Context(), tenantContext, r.PathValue("id"), request.JID)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "data": data})
}

func (handler Handler) ProviderAction(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}

	var request ProviderActionRequest
	if !decodeWhatsAppJSON(w, r, &request, 1<<20) {
		return
	}
	response, err := handler.repo.RunProviderAction(r.Context(), tenantContext, request)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, response)
}

func requireTenant(w http.ResponseWriter, r *http.Request) (tenant.Context, bool) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return tenant.Context{}, false
	}

	return tenantContext, true
}

func decodeWhatsAppJSON(w http.ResponseWriter, r *http.Request, target any, maxBytes int64) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return false
	}

	return true
}

func writeWhatsAppError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_whatsapp_input", err.Error())
	case errors.Is(err, ErrInvalidReference):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_whatsapp_reference", "One or more WhatsApp references do not belong to this organization.")
	case errors.Is(err, ErrSessionNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "whatsapp_session_not_found", "WhatsApp session was not found.")
	case errors.Is(err, ErrConversationNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "whatsapp_conversation_not_found", "WhatsApp conversation was not found.")
	case errors.Is(err, ErrMessageNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "whatsapp_message_not_found", "WhatsApp message was not found.")
	case errors.Is(err, ErrProviderFailed):
		httpserver.WriteError(w, r, http.StatusBadGateway, "whatsapp_provider_failed", "WhatsApp provider request failed. Please try again.")
	case errors.Is(err, ErrFeatureUnavailable):
		httpserver.WriteError(w, r, http.StatusForbidden, "whatsapp_feature_unavailable", err.Error())
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		slog.Error("whatsapp operation failed",
			"error", err,
			"request_id", httpserver.RequestIDFromContext(r.Context()),
			"path", r.URL.Path,
		)
		httpserver.WriteError(w, r, http.StatusInternalServerError, "whatsapp_operation_failed", "Unable to complete WhatsApp operation.")
	}
}
