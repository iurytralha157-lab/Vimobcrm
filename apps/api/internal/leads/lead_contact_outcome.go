package leads

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var ErrLeadContactOutcomeConflict = errors.New("contact outcome command has different input")
var ErrLeadContactOutcomeStorageUnavailable = errors.New("contact outcome receipt storage is unavailable")

type LeadContactOutcomeRequest struct {
	CommandID string `json:"commandId"`
	Channel   string `json:"channel"`
	Outcome   string `json:"outcome"`
	Notes     string `json:"notes"`
}

type leadContactOutcomeInput struct{ commandID, channel, outcome, notes string }

type LeadContactOutcomeReceipt struct {
	CommandID  string    `json:"commandId"`
	LeadID     string    `json:"leadId"`
	Channel    string    `json:"channel"`
	ActivityID string    `json:"activityId"`
	RecordedAt time.Time `json:"recordedAt"`
}

func (request LeadContactOutcomeRequest) Validate() (leadContactOutcomeInput, error) {
	commandID, valid := normalizeUUID(request.CommandID)
	notes := strings.TrimSpace(request.Notes)
	validOutcome := request.Channel == "call" && validEnum(request.Outcome, "answered", "not_answered", "invalid_number", "busy", "scheduled") ||
		request.Channel == "email" && validEnum(request.Outcome, "replied", "not_replied", "bounced")
	if !valid || !validOutcome || !utf8.ValidString(request.Notes) || strings.ContainsRune(notes, 0) || utf8.RuneCountInString(notes) > 2_000 {
		return leadContactOutcomeInput{}, fmt.Errorf("%w: contact outcome command, channel, outcome and notes are invalid", ErrInvalidInput)
	}
	return leadContactOutcomeInput{commandID, request.Channel, request.Outcome, notes}, nil
}

func contactOutcomeCommandDigest(leadID string, input leadContactOutcomeInput) string {
	// Keep personal notes only in the normal activity, never in the receipt.
	raw, _ := json.Marshal([]string{"lead-contact-outcome:v1", leadID, input.channel, input.outcome, input.notes})
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

func (handler Handler) RecordContactOutcome(w http.ResponseWriter, r *http.Request) {
	actor, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	request, ok := httpserver.DecodeJSONValue[LeadContactOutcomeRequest](w, r, 1<<16)
	if !ok {
		return
	}
	input, err := request.Validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	receipt, err := handler.repo.RecordContactOutcome(r.Context(), actor, r.PathValue("id"), input)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	// Replays may reconcile a lost ACK, but never repeat durable activity effects.
	handler.publishLeadEvent(actor, "lead.updated", receipt.LeadID, nil)
	httpserver.WriteJSON(w, http.StatusOK, map[string]LeadContactOutcomeReceipt{"data": receipt})
}

func (repo Repository) RecordContactOutcome(ctx context.Context, actor tenant.Context, leadID string, input leadContactOutcomeInput) (LeadContactOutcomeReceipt, error) {
	if repo.db == nil {
		return LeadContactOutcomeReceipt{}, ErrLeadContactOutcomeStorageUnavailable
	}
	return repo.recordContactOutcomeWithBegin(ctx, actor, leadID, input, repo.db.Pool().Begin)
}

func (repo Repository) recordContactOutcomeWithBegin(ctx context.Context, actor tenant.Context, leadID string, input leadContactOutcomeInput, begin func(context.Context) (pgx.Tx, error)) (LeadContactOutcomeReceipt, error) {
	leadID, valid := normalizeUUID(leadID)
	if !valid {
		return LeadContactOutcomeReceipt{}, ErrLeadNotFound
	}
	if !actor.IsOrganizationMember() {
		return LeadContactOutcomeReceipt{}, tenant.ErrOrganizationAccessDenied
	}
	input, err := (LeadContactOutcomeRequest{input.commandID, input.channel, input.outcome, input.notes}).Validate()
	if err != nil {
		return LeadContactOutcomeReceipt{}, err
	}
	tx, err := begin(ctx)
	if err != nil {
		return LeadContactOutcomeReceipt{}, err
	}
	defer tx.Rollback(ctx)
	// Lock lead -> receipt -> activity, including on replay. A receipt grants no
	// access after transfer, permission revocation, deletion or entry into a pool.
	if err := ensureLeadEditableForUpdate(ctx, tx, actor, leadID); err != nil {
		return LeadContactOutcomeReceipt{}, err
	}
	digest := contactOutcomeCommandDigest(leadID, input)
	receipt, replayed, err := claimLeadContactOutcomeReceipt(ctx, tx, actor, leadID, input, digest)
	if err != nil {
		return LeadContactOutcomeReceipt{}, err
	}
	if !replayed {
		content := "Tentativa de ligação"
		if input.channel == "email" {
			content = "Email enviado"
		}
		metadata := map[string]any{"outcome": input.outcome, "notes": input.notes, "channel": input.channel}
		if err := tx.QueryRow(ctx, `insert into public.activities
			(organization_id,lead_id,user_id,type,content,metadata)
			values($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::jsonb)
			returning id::text,created_at`, actor.OrganizationID, leadID, actor.UserID, input.channel, content, jsonb(metadata)).Scan(&receipt.ActivityID, &receipt.RecordedAt); err != nil {
			return LeadContactOutcomeReceipt{}, err
		}
		if _, valid := normalizeUUID(receipt.ActivityID); !valid || receipt.RecordedAt.IsZero() {
			return LeadContactOutcomeReceipt{}, ErrLeadContactOutcomeStorageUnavailable
		}
		if err := completeLeadContactOutcomeReceipt(ctx, tx, actor, receipt, digest); err != nil {
			return LeadContactOutcomeReceipt{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return LeadContactOutcomeReceipt{}, err // Retry the same command when COMMIT's ACK is uncertain.
	}
	return receipt, nil
}
