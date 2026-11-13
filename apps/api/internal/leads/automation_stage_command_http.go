package leads

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type automationStageCommand struct {
	OrganizationID string `json:"organizationId"`
	ExecutionID    string `json:"executionId"`
	NodeKey        string `json:"nodeKey"`
	LeaseToken     string `json:"leaseToken"`
	EffectKey      string `json:"effectKey"`
}

func (input *automationStageCommand) validate() bool {
	return input.validateFor("move_lead")
}

func (input *automationStageCommand) validateFor(action string) bool {
	var ok bool
	input.OrganizationID, ok = normalizeUUID(input.OrganizationID)
	if !ok {
		return false
	}
	input.ExecutionID, ok = normalizeUUID(input.ExecutionID)
	if !ok {
		return false
	}
	return input.NodeKey != "" && strings.TrimSpace(input.NodeKey) == input.NodeKey && len(input.NodeKey) <= 200 &&
		strings.TrimSpace(input.LeaseToken) != "" && len(input.LeaseToken) <= 512 &&
		input.EffectKey == "automation:"+input.ExecutionID+":"+input.NodeKey+":"+action && len(input.EffectKey) <= 512
}

type automationCommandError struct {
	Code   string
	Status int
}

func (err *automationCommandError) Error() string { return err.Code }
func commandError(code string, status int) error  { return &automationCommandError{code, status} }

type automationStageResponse struct {
	OK       bool            `json:"ok"`
	Status   string          `json:"status"`
	EffectID string          `json:"effect_id"`
	Response json.RawMessage `json:"response"`
}

type transactionalTenantResolver interface {
	ResolveInTx(context.Context, pgx.Tx, string, string) (tenant.Context, error)
}

type AutomationStageCommandHandler struct {
	token   string
	execute func(context.Context, automationStageCommand) (automationStageResponse, error)
}

type AutomationDistributionCommandHandler struct {
	AutomationStageCommandHandler
}

func NewAutomationStageCommandHandler(repo Repository, resolver transactionalTenantResolver, token string) AutomationStageCommandHandler {
	return AutomationStageCommandHandler{token: strings.TrimSpace(token), execute: func(ctx context.Context, input automationStageCommand) (automationStageResponse, error) {
		return repo.executeAutomationStageCommand(ctx, resolver, input)
	}}
}

func (handler AutomationStageCommandHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	handler.serveCommand(w, r, "move_lead")
}

func NewAutomationDistributionCommandHandler(repo Repository, resolver transactionalTenantResolver, token string) AutomationDistributionCommandHandler {
	return AutomationDistributionCommandHandler{AutomationStageCommandHandler{token: strings.TrimSpace(token), execute: func(ctx context.Context, input automationStageCommand) (automationStageResponse, error) {
		return repo.executeAutomationDistributionCommand(ctx, resolver, input)
	}}}
}

func (handler AutomationDistributionCommandHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	handler.serveCommand(w, r, automationDistributionAction)
}

func (handler AutomationStageCommandHandler) serveCommand(w http.ResponseWriter, r *http.Request, action string) {
	if handler.token == "" || handler.execute == nil {
		httpserver.WriteError(w, r, 503, "automation_command_unavailable", "Automation command service is unavailable.")
		return
	}
	expected, provided := sha256.Sum256([]byte(handler.token)), sha256.Sum256([]byte(r.Header.Get("X-Internal-Token")))
	if subtle.ConstantTimeCompare(expected[:], provided[:]) != 1 {
		httpserver.WriteError(w, r, 401, "unauthorized", "Internal authentication is required.")
		return
	}
	defer r.Body.Close()
	var input automationStageCommand
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(&struct{}{}) != io.EOF || !input.validateFor(action) {
		httpserver.WriteError(w, r, 400, "automation_command_invalid", "Invalid automation command.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	result, err := handler.execute(ctx, input)
	if err != nil {
		writeAutomationCommandError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, result)
}

func automationCommandRetryable(err error) bool {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "40001", "40P01", "55P03", "57014", "08000", "08003", "08006", "57P01":
			return true
		}
	}
	return false
}

func writeAutomationCommandError(w http.ResponseWriter, r *http.Request, err error) {
	var classified *automationCommandError
	if errors.As(err, &classified) {
		httpserver.WriteError(w, r, classified.Status, classified.Code, "Automation command was rejected.")
		return
	}
	if automationCommandRetryable(err) {
		httpserver.WriteError(w, r, 503, "automation_command_retryable", "Retry the same automation effect.")
		return
	}
	if errors.Is(err, tenant.ErrOrganizationAccessDenied) || errors.Is(err, tenant.ErrUserInactive) || errors.Is(err, tenant.ErrUserProfileNotFound) {
		httpserver.WriteError(w, r, 403, "automation_actor_forbidden", "The flow author no longer has access.")
		return
	}
	// Existing canonical errors keep their stable business status/code. Unknown DB
	// failures are retryable, without exposing SQL, lease tokens or personal data.
	if isCanonicalStageBusinessError(err) {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteError(w, r, 503, "automation_command_retryable", "Retry the same automation effect.")
}

func isCanonicalStageBusinessError(err error) bool {
	for _, target := range []error{ErrLeadNotFound, ErrInvalidReference, ErrInvalidInput, ErrLeadChanged, ErrLeadStageChanged, ErrLostReasonRequired, ErrLeadPropertyUnavailable, ErrLeadPropertyRelinkWhileWon, ErrLeadReservationUnverified} {
		if errors.Is(err, target) {
			return true
		}
	}
	return false
}
