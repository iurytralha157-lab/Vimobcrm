package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicingress"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Handler struct {
	repo                   Repository
	publicClientIPResolver publicingress.ClientIPResolver
}

func NewHandler(repo Repository) Handler {
	return Handler{repo: repo}
}

func (handler Handler) WithPublicClientIPResolver(
	resolver publicingress.ClientIPResolver,
) Handler {
	handler.publicClientIPResolver = resolver
	return handler
}

func (handler Handler) ListOrganizations(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListOrganizations(
		r.Context(),
		tenantContext,
		r.URL.Query().Get("search"),
		r.URL.Query().Get("status"),
		r.URL.Query().Get("segment"),
	)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListUsers(r.Context(), tenantContext)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) ListActiveAnnouncements(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}
	items, err := handler.repo.ListActiveAnnouncements(r.Context(), tenantContext)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) ListMyFeatureRequests(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}
	items, err := handler.repo.ListMyFeatureRequests(r.Context(), tenantContext)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) CreateFeatureRequest(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}
	defer r.Body.Close()
	payload := map[string]any{}
	if err := decodeJSON(w, r, &payload); err != nil {
		return
	}
	item, err := handler.repo.CreateFeatureRequest(r.Context(), tenantContext, payload)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[map[string]any]{Data: item})
}

func (handler Handler) ListFeatureRequestsAdmin(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListFeatureRequestsAdmin(r.Context(), tenantContext)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) RespondFeatureRequestAdmin(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	payload := map[string]any{}
	if err := decodeJSON(w, r, &payload); err != nil {
		return
	}
	item, err := handler.repo.RespondFeatureRequestAdmin(r.Context(), tenantContext, r.PathValue("id"), payload)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) ListInvitations(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}
	items, err := handler.repo.ListInvitations(r.Context(), tenantContext, r.URL.Query().Get("organizationId"))
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) CreateInvitation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}
	defer r.Body.Close()
	var request InvitationRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	item, err := handler.repo.CreateInvitation(r.Context(), tenantContext, request)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[map[string]any]{Data: item})
}

func (handler Handler) ResendInvitation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}
	item, err := handler.repo.ResendInvitation(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) DeleteInvitation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}
	if err := handler.repo.DeleteInvitation(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) ShowInvitationByToken(w http.ResponseWriter, r *http.Request) {
	item, err := handler.repo.ShowInvitationByToken(r.Context(), r.PathValue("token"))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpserver.WriteJSON(w, http.StatusOK, Envelope[any]{Data: nil})
			return
		}
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) AcceptInvitationPublic(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var request AcceptInvitationRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	request = invitationAcceptanceRequestWithHTTPMetadata(
		request,
		r,
		handler.publicClientIPResolver,
	)

	result, err := handler.repo.AcceptInvitationPublic(r.Context(), r.PathValue("token"), request)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[AcceptInvitationResult]{Data: result})
}

func invitationAcceptanceRequestWithHTTPMetadata(
	request AcceptInvitationRequest,
	httpRequest *http.Request,
	resolver publicingress.ClientIPResolver,
) AcceptInvitationRequest {
	request.IPAddress = resolver.Resolve(httpRequest)
	request.UserAgent = httpRequest.UserAgent()
	return request
}

func (handler Handler) AcceptInvitationAuthenticated(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	user, ok := httpserver.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}
	var request AcceptInvitationRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	request = invitationAcceptanceRequestWithHTTPMetadata(
		request,
		r,
		handler.publicClientIPResolver,
	)

	result, err := handler.repo.AcceptInvitationAuthenticated(
		r.Context(),
		user.ID,
		r.PathValue("token"),
		request,
	)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[AcceptInvitationResult]{Data: result})
}

func (handler Handler) PublicOnboardingSignup(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var request OnboardingSignupRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	request.IPAddress = handler.publicClientIPResolver.Resolve(r)
	request.UserAgent = r.UserAgent()
	item, err := handler.repo.PublicOnboardingSignup(r.Context(), request)
	if err != nil {
		writeOnboardingError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, item)
}

func (handler Handler) PublicOnboardingValidateStep(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var request PublicOnboardingStepValidationRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	request.ipAddress = handler.publicClientIPResolver.Resolve(r)
	result, err := handler.repo.PublicOnboardingValidateStep(r.Context(), request)
	if err != nil {
		writeOnboardingError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, result)
}

func (handler Handler) PublicResendOnboardingEmailConfirmation(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var request ResendOnboardingEmailConfirmationRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	request.IPAddress = handler.publicClientIPResolver.Resolve(r)
	request.UserAgent = r.UserAgent()

	err := handler.repo.ResendPublicSignupEmailConfirmation(r.Context(), request)
	if errors.Is(err, ErrPublicSignupRateLimited) {
		httpserver.WriteJSON(w, http.StatusTooManyRequests, map[string]any{
			"ok":      false,
			"message": "Muitas tentativas. Aguarde antes de solicitar outro e-mail.",
		})
		return
	}
	if errors.Is(err, ErrInvalidInput) {
		httpserver.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok":      false,
			"message": "Informe um e-mail valido.",
		})
		return
	}
	if err != nil {
		// Account existence is intentionally never reflected in the public
		// response. Operators still receive an actionable error without putting
		// the requested address or a single-use credential in logs.
		slog.ErrorContext(r.Context(), "public signup confirmation resend failed", "error", err)
	}

	httpserver.WriteJSON(w, http.StatusAccepted, map[string]any{
		"ok":      true,
		"message": "Se existir um cadastro aguardando confirmacao, enviaremos um novo link para o e-mail informado.",
	})
}

func (handler Handler) PublicRecoverOnboardingSignup(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var request PublicSignupRecoveryRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	request.IPAddress = handler.publicClientIPResolver.Resolve(r)
	request.UserAgent = r.UserAgent()

	result, err := handler.repo.RecoverPublicSignup(r.Context(), request)
	if errors.Is(err, ErrPublicSignupRateLimited) {
		httpserver.WriteJSON(w, http.StatusTooManyRequests, map[string]any{
			"ok": false, "message": "Muitas tentativas. Aguarde antes de tentar novamente.",
		})
		return
	}
	if errors.Is(err, ErrInvalidInput) {
		httpserver.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "message": "Revise os dados informados para recuperar o cadastro.",
		})
		return
	}
	if errors.Is(err, ErrPublicSignupRecoveryUnavailable) {
		httpserver.WriteJSON(w, http.StatusConflict, map[string]any{
			"ok": false, "message": "Este cadastro não pode mais ser alterado por este link. Fale com o suporte se precisar de ajuda.",
		})
		return
	}
	if err != nil {
		// Capabilities and e-mail addresses are intentionally omitted from logs.
		slog.ErrorContext(r.Context(), "public signup recovery failed", "action", request.Action, "error", err)
		httpserver.WriteJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok": false, "message": "Não foi possível alterar o cadastro agora. Tente novamente.",
		})
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, result)
}

func (handler Handler) PublicCheckoutPlan(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var request CheckoutPlanRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	item, err := handler.repo.PublicCheckoutPlan(r.Context(), request)
	if err != nil {
		writeCheckoutPlanError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, item)
}

func (handler Handler) PublicSubscriptionPlans(w http.ResponseWriter, r *http.Request) {
	items, err := handler.repo.ListPublicSubscriptionPlans(r.Context())
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) ShowMyOnboardingRequest(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}
	item, err := handler.repo.ShowMyOnboardingRequest(r.Context(), tenantContext)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) CreateOnboardingRequest(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}
	defer r.Body.Close()
	payload := map[string]any{}
	if err := decodeJSON(w, r, &payload); err != nil {
		return
	}
	item, err := handler.repo.CreateOnboardingRequest(r.Context(), tenantContext, payload)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[map[string]any]{Data: item})
}

func (handler Handler) ListOnboardingRequestsAdmin(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListOnboardingRequestsAdmin(r.Context(), tenantContext)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) UpdateOnboardingRequestAdmin(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	payload := map[string]any{}
	if err := decodeJSON(w, r, &payload); err != nil {
		return
	}
	item, err := handler.repo.UpdateOnboardingRequestAdmin(r.Context(), tenantContext, r.PathValue("id"), payload)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) ListActiveSubscriptionPlans(w http.ResponseWriter, r *http.Request) {
	items, err := handler.repo.ListActiveSubscriptionPlans(r.Context())
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) ListTableRows(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	limit := parsePositiveInt(r.URL.Query().Get("limit"), 60)
	items, err := handler.repo.ListTableRows(r.Context(), tenantContext, r.PathValue("table"), limit)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) CountTableRows(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	count, err := handler.repo.CountTableRows(r.Context(), tenantContext, r.PathValue("table"))
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]int64{"count": count})
}

func (handler Handler) CreateTableRow(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	payload := map[string]any{}
	if err := decodeJSON(w, r, &payload); err != nil {
		return
	}
	item, err := handler.repo.CreateTableRow(r.Context(), tenantContext, r.PathValue("table"), payload)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[map[string]any]{Data: item})
}

func (handler Handler) UpdateTableRow(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	payload := map[string]any{}
	if err := decodeJSON(w, r, &payload); err != nil {
		return
	}
	item, err := handler.repo.UpdateTableRow(r.Context(), tenantContext, r.PathValue("table"), r.PathValue("id"), payload)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) DeleteTableRow(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	if err := handler.repo.DeleteTableRow(r.Context(), tenantContext, r.PathValue("table"), r.PathValue("id")); err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) ShowNotificationDispatchSettings(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.ShowNotificationDispatchSettings(r.Context(), tenantContext)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[NotificationDispatchSettings]{Data: item})
}

func (handler Handler) UpdateNotificationDispatchSettings(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request UpdateNotificationDispatchSettingsRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	item, err := handler.repo.UpdateNotificationDispatchSettings(r.Context(), tenantContext, request)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[NotificationDispatchSettings]{Data: item})
}

func (handler Handler) OrphanMemberStats(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.OrphanMemberStats(r.Context(), tenantContext)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) CleanupOrphanMembers(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.CleanupOrphanMembers(r.Context(), tenantContext)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) ListOrganizationModules(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListOrganizationModules(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) ListOrganizationPayments(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	items, err := handler.repo.ListOrganizationPayments(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) DashboardOverview(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	period := parsePositiveInt(r.URL.Query().Get("period"), 30)
	item, err := handler.repo.DashboardOverview(r.Context(), tenantContext, period)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) DashboardTimeseries(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	period := parsePositiveInt(r.URL.Query().Get("period"), 30)
	item, err := handler.repo.DashboardTimeseries(r.Context(), tenantContext, period)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) DashboardPending(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.DashboardPending(r.Context(), tenantContext)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func (handler Handler) DashboardFeed(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	limit := parsePositiveInt(r.URL.Query().Get("limit"), 30)
	items, err := handler.repo.DashboardFeed(r.Context(), tenantContext, limit)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]map[string]any]{Data: items})
}

func (handler Handler) CreateOrganization(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request CreateOrganizationRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	item, err := handler.repo.CreateOrganization(r.Context(), tenantContext, request)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, map[string]any{"organization": item})
}

func (handler Handler) UpdateOrganization(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request OrganizationUpdateRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	if err := handler.repo.UpdateOrganization(r.Context(), tenantContext, r.PathValue("id"), request); err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) UpdateOrganizationAccess(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request OrganizationAccessRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	if err := handler.repo.UpdateOrganizationAccess(r.Context(), tenantContext, r.PathValue("id"), request); err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) DeleteOrganization(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request OrganizationDeleteRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	result, err := handler.repo.DeleteOrganization(r.Context(), tenantContext, r.PathValue("id"), request)
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, result)
}

func (handler Handler) UpdateModuleAccess(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request ModuleAccessRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	if err := handler.repo.UpdateModuleAccess(r.Context(), tenantContext, request); err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request UserUpdateRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	if err := handler.repo.UpdateUser(r.Context(), tenantContext, r.PathValue("id"), request); err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	if err := handler.repo.DeleteUser(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (handler Handler) ResetUserPassword(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	item, err := handler.repo.ResetUserPassword(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]any]{Data: item})
}

func adminContext(w http.ResponseWriter, r *http.Request) (tenant.Context, bool) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || !tenantContext.IsSuperAdmin {
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
		return tenant.Context{}, false
	}
	return tenantContext, true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return err
	}
	return nil
}

func parsePositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed < 1 {
		return fallback
	}
	return parsed
}

func writeAdminError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvitationUserAlreadyMember):
		httpserver.WriteError(w, r, http.StatusConflict, "invitation_user_already_member", "Este usuario ja esta cadastrado na sua imobiliaria.")
	case errors.Is(err, ErrInvitationAlreadyPending):
		httpserver.WriteError(w, r, http.StatusConflict, "invitation_already_pending", "Ja existe um convite pendente para este usuario nesta imobiliaria.")
	case errors.Is(err, ErrInvitationEmailMissing):
		httpserver.WriteError(w, r, http.StatusUnprocessableEntity, "invitation_email_missing", "Este convite nao possui um e-mail para reenvio.")
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_admin_input", "Admin input is invalid.")
	case errors.Is(err, ErrNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "admin_resource_not_found", "Admin resource was not found.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	case errors.Is(err, ErrInvitationEmailFailed):
		httpserver.WriteError(w, r, http.StatusBadGateway, "invitation_email_failed", "Nao foi possivel enviar o convite por e-mail. Verifique a configuracao de envio.")
	case errors.Is(err, ErrPasswordRecoveryEmailFailed):
		httpserver.WriteError(w, r, http.StatusBadGateway, "password_recovery_email_failed", "Nao foi possivel enviar o e-mail de recuperacao. Verifique a configuracao de envio.")
	case errors.Is(err, ErrOrganizationDeleteConfirm):
		httpserver.WriteError(w, r, http.StatusConflict, "organization_delete_confirmation_mismatch", "O nome informado nao corresponde a organizacao.")
	case errors.Is(err, ErrOrganizationExternalCleanup):
		httpserver.WriteError(w, r, http.StatusBadGateway, "organization_external_cleanup_failed", "A organizacao foi inativada, mas uma integracao externa nao pôde ser desconectada. Tente novamente.")
	case errors.Is(err, ErrOrganizationPurgeUnsafe):
		httpserver.WriteError(w, r, http.StatusConflict, "organization_purge_unsafe", "A exclusao foi interrompida porque o banco nao encontrou uma ordem segura para remover os dados.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "admin_operation_failed", "Unable to complete admin operation.")
	}
}

func writeOnboardingError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrPublicSignupRateLimited):
		httpserver.WriteJSON(w, http.StatusTooManyRequests, map[string]any{"ok": false, "code": "signup_rate_limited", "message": "Muitas tentativas. Aguarde antes de tentar novamente."})
	case errors.Is(err, ErrSignupAttemptConflict):
		httpserver.WriteJSON(w, http.StatusConflict, map[string]any{"ok": false, "code": "signup_attempt_conflict", "message": "Esta tentativa ja foi usada com outro e-mail. Use o e-mail original ou inicie o cadastro em uma nova aba."})
	case errors.Is(err, ErrPublicSignupEmailExists):
		httpserver.WriteJSON(w, http.StatusConflict, map[string]any{"ok": false, "code": "signup_email_exists", "message": "Este e-mail ja esta cadastrado. Faca login ou use outro e-mail."})
	case errors.Is(err, ErrPublicSignupDocumentExists):
		httpserver.WriteJSON(w, http.StatusConflict, map[string]any{"ok": false, "code": "signup_document_exists", "message": "Ja existe uma organizacao cadastrada com este CPF ou CNPJ."})
	case errors.Is(err, ErrPublicSignupConfirmationFailed):
		httpserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "code": "signup_confirmation_failed", "message": "Nao foi possivel preparar a confirmacao do e-mail. Tente novamente em alguns instantes."})
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "code": "signup_invalid_input", "message": "Dados de cadastro invalidos."})
	case errors.Is(err, ErrNotFound):
		httpserver.WriteJSON(w, http.StatusNotFound, map[string]any{"ok": false, "code": "signup_plan_not_found", "message": "Plano de cadastro nao encontrado."})
	case strings.Contains(strings.ToLower(err.Error()), "already"):
		httpserver.WriteJSON(w, http.StatusConflict, map[string]any{"ok": false, "code": "signup_email_exists", "message": "Este e-mail ja esta cadastrado. Faca login ou use outro e-mail."})
	default:
		httpserver.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "code": "signup_failed", "message": "Nao foi possivel concluir o cadastro. Tente novamente em alguns instantes."})
	}
}

func writeCheckoutPlanError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrCheckoutPlanConflict):
		httpserver.WriteJSON(w, http.StatusConflict, map[string]any{"ok": false, "message": "Ja existe uma cobranca em andamento. Cancele ou aguarde a conciliacao antes de trocar o plano."})
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "Dados de plano invalidos."})
	case errors.Is(err, ErrNotFound):
		httpserver.WriteJSON(w, http.StatusNotFound, map[string]any{"ok": false, "message": "Checkout ou plano nao encontrado."})
	default:
		httpserver.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "Nao foi possivel atualizar o plano. Tente novamente em alguns instantes."})
	}
}
