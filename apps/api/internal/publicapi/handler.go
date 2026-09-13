package publicapi

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicingress"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/webhooks"
)

const publicAPIRequestBodyLimit int64 = 1 << 20

type requestAuthorizer interface {
	AllowIP(context.Context, string) error
	Authenticate(context.Context, string) (Principal, error)
	AllowPrincipal(context.Context, Principal) error
	MarkUsed(context.Context, Principal) error
}

type leadIntake interface {
	ReceiveAPILead(context.Context, string, string, string, map[string]any) (webhooks.IncomingLeadResult, error)
}

type Handler struct {
	authorizer             requestAuthorizer
	intake                 leadIntake
	publicClientIPResolver publicingress.ClientIPResolver
}

func NewHandler(repo Repository, intake webhooks.Repository) Handler {
	return Handler{authorizer: repo, intake: intake}
}

func (handler Handler) WithPublicClientIPResolver(resolver publicingress.ClientIPResolver) Handler {
	handler.publicClientIPResolver = resolver
	return handler
}

func (handler Handler) CreateLead(w http.ResponseWriter, r *http.Request) {
	if err := handler.authorizer.AllowIP(
		r.Context(),
		handler.publicClientIPResolver.Resolve(r),
	); err != nil {
		writePublicAPIError(w, r, err)
		return
	}

	rawKey, ok := apiCredential(r)
	if !ok {
		writePublicAPIError(w, r, ErrInvalidCredentials)
		return
	}
	principal, err := handler.authorizer.Authenticate(r.Context(), rawKey)
	if err != nil {
		writePublicAPIError(w, r, err)
		return
	}
	if err := handler.authorizer.AllowPrincipal(r.Context(), principal); err != nil {
		writePublicAPIError(w, r, err)
		return
	}

	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if !validIdempotencyKey(idempotencyKey) {
		writePublicAPIError(w, r, ErrInvalidInput)
		return
	}
	var input LeadRequest
	if err := httpserver.DecodeJSON(w, r, &input, publicAPIRequestBodyLimit); err != nil {
		return
	}
	payload, err := input.Payload()
	if err != nil {
		writePublicAPIError(w, r, err)
		return
	}

	result, err := handler.intake.ReceiveAPILead(
		r.Context(),
		principal.OrganizationID,
		principal.KeyID,
		idempotencyKey,
		payload,
	)
	if err != nil {
		writePublicAPIError(w, r, err)
		return
	}
	_ = handler.authorizer.MarkUsed(r.Context(), principal)

	status := http.StatusCreated
	if result.Idempotent {
		status = http.StatusOK
	}
	httpserver.WriteJSON(w, status, Envelope[LeadResult]{Data: LeadResult{
		ID:         result.LeadID,
		Reentry:    result.Reentry,
		Idempotent: result.Idempotent,
	}})
}

func apiCredential(request *http.Request) (string, bool) {
	if request == nil {
		return "", false
	}
	authorization := strings.TrimSpace(request.Header.Get("Authorization"))
	bearer := bearerCredential(authorization)
	headerKey := strings.TrimSpace(request.Header.Get("X-API-Key"))
	if authorization != "" && bearer == "" {
		return "", false
	}
	if bearer != "" && headerKey != "" && subtle.ConstantTimeCompare([]byte(bearer), []byte(headerKey)) != 1 {
		return "", false
	}
	if bearer != "" {
		return bearer, true
	}
	if headerKey != "" {
		return headerKey, true
	}
	return "", false
}

func bearerCredential(header string) string {
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return parts[1]
}

func validIdempotencyKey(value string) bool {
	if len(value) < 8 || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if character < 0x21 || character > 0x7e {
			return false
		}
	}
	return true
}

func writePublicAPIError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidCredentials):
		httpserver.WriteError(w, r, http.StatusUnauthorized, "invalid_api_key", "API key is invalid, expired, or inactive.")
	case errors.Is(err, ErrBillingRequired):
		httpserver.WriteError(w, r, http.StatusPaymentRequired, "billing_access_required", "Billing access is required to use the public API.")
	case errors.Is(err, ErrAPIUnavailable):
		httpserver.WriteError(w, r, http.StatusForbidden, "api_module_unavailable", "The API module is not enabled for this organization.")
	case errors.Is(err, ErrRateLimited), errors.Is(err, webhooks.ErrRateLimited):
		w.Header().Set("Retry-After", "60")
		httpserver.WriteError(w, r, http.StatusTooManyRequests, "api_rate_limited", "Public API request rate limit exceeded.")
	case errors.Is(err, ErrInvalidInput), errors.Is(err, webhooks.ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_api_input", "Public API input is invalid.")
	case errors.Is(err, webhooks.ErrIdempotencyConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "idempotency_conflict", "Idempotency-Key was already used with a different payload.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "public_api_failed", "Unable to complete the public API request.")
	}
}
