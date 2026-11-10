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

var ErrLeadFeedbackConflict = errors.New("feedback command has different input")
var ErrLeadFeedbackStorageUnavailable = errors.New("feedback command receipt storage is unavailable")

type LeadFeedbackRequest struct {
	CommandID string `json:"commandId"`
	Content   string `json:"content"`
}

type leadFeedbackInput struct{ commandID, content string }

type LeadFeedbackReceipt struct {
	CommandID  string    `json:"commandId"`
	LeadID     string    `json:"leadId"`
	ActivityID string    `json:"activityId"`
	RecordedAt time.Time `json:"recordedAt"`
}

type leadFeedbackResult struct {
	receipt                         LeadFeedbackReceipt
	pipelineID, stageID, assigneeID string
}

func (request LeadFeedbackRequest) Validate() (leadFeedbackInput, error) {
	commandID, valid := normalizeUUID(request.CommandID)
	content := strings.TrimSpace(request.Content)
	if !valid || content == "" || !utf8.ValidString(content) || utf8.RuneCountInString(content) > 2_000 {
		return leadFeedbackInput{}, fmt.Errorf("%w: feedback command and content are required", ErrInvalidInput)
	}
	return leadFeedbackInput{commandID: commandID, content: content}, nil
}

func feedbackCommandDigest(leadID, content string) string {
	// The actor and organization are part of the receipt's primary key. Persist
	// only this digest; personal text remains solely in its normal CRM records.
	raw, _ := json.Marshal([]string{"lead-feedback:v1", leadID, content})
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

func (handler Handler) RecordFeedback(w http.ResponseWriter, r *http.Request) {
	actor, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}
	request, ok := httpserver.DecodeJSONValue[LeadFeedbackRequest](w, r, 1<<16)
	if !ok {
		return
	}
	input, err := request.Validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	result, err := handler.repo.RecordFeedback(r.Context(), actor, r.PathValue("id"), input)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	// Every confirmed ACK can reconcile a lost response through the existing
	// invalidation event. Replays never append another activity or notification.
	handler.publishLeadEvent(actor, "lead.updated", result.receipt.LeadID, map[string]any{
		"pipelineId": result.pipelineID, "stageId": result.stageID, "assignedUserId": result.assigneeID,
	})
	httpserver.WriteJSON(w, http.StatusOK, map[string]LeadFeedbackReceipt{"data": result.receipt})
}

func (repo Repository) RecordFeedback(ctx context.Context, actor tenant.Context, leadID string, input leadFeedbackInput) (leadFeedbackResult, error) {
	if repo.db == nil {
		return leadFeedbackResult{}, ErrLeadFeedbackStorageUnavailable
	}
	return repo.recordFeedbackWithBegin(ctx, actor, leadID, input, repo.db.Pool().Begin)
}

func (repo Repository) recordFeedbackWithBegin(ctx context.Context, actor tenant.Context, leadID string, input leadFeedbackInput, begin func(context.Context) (pgx.Tx, error)) (leadFeedbackResult, error) {
	leadID, valid := normalizeUUID(leadID)
	if !valid {
		return leadFeedbackResult{}, ErrLeadNotFound
	}
	if !actor.IsOrganizationMember() {
		return leadFeedbackResult{}, tenant.ErrOrganizationAccessDenied
	}
	input, err := (LeadFeedbackRequest{CommandID: input.commandID, Content: input.content}).Validate()
	if err != nil {
		return leadFeedbackResult{}, err
	}
	tx, err := begin(ctx)
	if err != nil {
		return leadFeedbackResult{}, err
	}
	defer tx.Rollback(ctx)
	// Keep the established lead -> receipt -> activity lock order. Revalidate
	// current access even for an already committed command; a receipt grants none.
	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, actor.OrganizationID, leadID)
	if err != nil {
		return leadFeedbackResult{}, err
	}
	if isQueuePoolSnapshot(current) {
		return leadFeedbackResult{}, ErrQueuePoolConflict
	}
	if !canProgressLeadSnapshot(actor, current) {
		return leadFeedbackResult{}, tenant.ErrOrganizationAccessDenied
	}
	digest := feedbackCommandDigest(leadID, input.content)
	receipt, replayed, err := claimLeadFeedbackReceipt(ctx, tx, actor, leadID, input.commandID, digest)
	if err != nil {
		return leadFeedbackResult{}, err
	}
	if !replayed {
		updated, err := tx.Exec(ctx, `update public.leads set feedback=$3, updated_at=now()
			where organization_id=$1::uuid and id=$2::uuid`, actor.OrganizationID, leadID, input.content)
		if err != nil {
			return leadFeedbackResult{}, err
		}
		if updated.RowsAffected() != 1 {
			return leadFeedbackResult{}, ErrLeadNotFound
		}
		if current.Data["feedback"] != input.content {
			if _, err := tx.Exec(ctx, `insert into public.audit_logs
				(organization_id,user_id,action,entity_type,entity_id,old_data,new_data)
				values($1::uuid,$2::uuid,'update','lead',$3::uuid,$4::jsonb,$5::jsonb)`,
				actor.OrganizationID, actor.UserID, leadID,
				jsonb(map[string]any{"feedback": current.Data["feedback"]}), jsonb(map[string]any{"feedback": input.content})); err != nil {
				return leadFeedbackResult{}, err
			}
		}
		if err := tx.QueryRow(ctx, `insert into public.activities
			(organization_id,lead_id,user_id,type,content,metadata)
			values($1::uuid,$2::uuid,$3::uuid,'note',$4,'{"kind":"feedback","origin":"lead_update"}'::jsonb)
			returning id::text,created_at`, actor.OrganizationID, leadID, actor.UserID, input.content).Scan(&receipt.ActivityID, &receipt.RecordedAt); err != nil {
			return leadFeedbackResult{}, err
		}
		if _, valid := normalizeUUID(receipt.ActivityID); !valid || receipt.RecordedAt.IsZero() {
			return leadFeedbackResult{}, ErrLeadFeedbackStorageUnavailable
		}
		if err := completeLeadFeedbackReceipt(ctx, tx, actor, receipt, digest); err != nil {
			return leadFeedbackResult{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return leadFeedbackResult{}, err // Preserve the command identity on an uncertain outcome.
	}
	return leadFeedbackResult{receipt: receipt, pipelineID: current.PipelineID, stageID: current.StageID, assigneeID: current.AssignedUserID}, nil
}
