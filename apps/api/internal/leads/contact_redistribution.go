package leads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/roundrobin"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const manualQueueRedistribution = "manual_queue_redistribution"
const maxContactRedistributionTargets = 300

type contactRedistributionTarget struct {
	LeadID            string    `json:"leadId"`
	ExpectedUpdatedAt time.Time `json:"expectedUpdatedAt"`
}

type contactRedistributionRequest struct {
	Targets      []contactRedistributionTarget `json:"targets"`
	RoundRobinID string                        `json:"roundRobinId"`
	OperationID  string                        `json:"operationId"`
}

type contactRedistributionItem struct {
	LeadID         string `json:"leadId"`
	Success        bool   `json:"success"`
	Reason         string `json:"reason"`
	AssignedUserID string `json:"assignedUserId,omitempty"`
}

type contactRedistributionResult struct {
	Items []contactRedistributionItem `json:"items"`
}

type contactRedistributionReceipt struct {
	Item               contactRedistributionItem `json:"item"`
	RequestHash        string                    `json:"requestHash"`
	MemberID           string                    `json:"memberId"`
	CandidateCreatedAt time.Time                 `json:"candidateCreatedAt"`
}

func (request *contactRedistributionRequest) validate() (string, error) {
	var valid bool
	request.RoundRobinID, valid = normalizeUUID(request.RoundRobinID)
	if !valid {
		return "", fmt.Errorf("%w: Selecione uma fila de distribuição válida.", ErrInvalidInput)
	}
	request.OperationID, valid = normalizeUUID(request.OperationID)
	if !valid || len(request.Targets) == 0 || len(request.Targets) > maxContactRedistributionTargets {
		return "", fmt.Errorf("%w: Selecione entre 1 e 300 leads com uma operação válida.", ErrInvalidInput)
	}
	seen := make(map[string]struct{}, len(request.Targets))
	binding := make([]string, 0, 1+2*len(request.Targets))
	binding = append(binding, request.RoundRobinID)
	for index := range request.Targets {
		target := &request.Targets[index]
		target.LeadID, valid = normalizeUUID(target.LeadID)
		if !valid || target.ExpectedUpdatedAt.IsZero() {
			return "", fmt.Errorf("%w: Atualize os contatos e selecione os leads novamente.", ErrInvalidInput)
		}
		if _, duplicate := seen[target.LeadID]; duplicate {
			return "", fmt.Errorf("%w: Remova os leads repetidos da seleção.", ErrInvalidInput)
		}
		seen[target.LeadID] = struct{}{}
		binding = append(binding, target.LeadID, target.ExpectedUpdatedAt.UTC().Format(time.RFC3339Nano))
	}
	return distribution.StableKey(manualQueueRedistribution, binding...), nil
}

func (handler Handler) RedistributeContacts(w http.ResponseWriter, r *http.Request) {
	actor, ok := tenant.FromContext(r.Context())
	if !ok || actor.OrganizationID == "" || actor.UserID == "" ||
		!actor.HasPermission(permissions.LeadOperate) || !actor.HasPermission(permissions.DistributionManage) {
		writeLeadError(w, r, tenant.ErrOrganizationAccessDenied)
		return
	}
	request, ok := httpserver.DecodeJSONValue[contactRedistributionRequest](w, r, 64<<10)
	if !ok {
		return
	}
	requestHash, err := request.validate()
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	result, err := handler.repo.redistributeContacts(r.Context(), actor, request, requestHash)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]contactRedistributionResult{"data": result})
}

func (repo Repository) redistributeContacts(ctx context.Context, actor tenant.Context, request contactRedistributionRequest, requestHash string) (contactRedistributionResult, error) {
	if repo.db == nil || repo.db.Pool() == nil {
		return contactRedistributionResult{}, errors.New("contact redistribution storage is unavailable")
	}
	ctx, cancel := context.WithTimeout(ctx, 55*time.Second)
	defer cancel()
	resolver := tenant.NewRepository(repo.db)
	items := make([]contactRedistributionItem, 0, len(request.Targets))
	loggedFailure := false
	for _, target := range request.Targets {
		item := contactRedistributionItem{LeadID: target.LeadID, Reason: "retry_required"}
		if ctx.Err() == nil {
			err := retryRedistributionTransaction(ctx, func() error {
				updated, err := repo.redistributeContact(ctx, resolver, actor, request, requestHash, target)
				if err == nil {
					item = updated
				}
				return err
			})
			if err != nil && !loggedFailure && !isContactRedistributionContention(err) {
				slog.Default().WarnContext(ctx, "contact redistribution could not be confirmed")
				loggedFailure = true
			}
		}
		items = append(items, item)
		if item.Reason == "operation_conflict" || item.Reason == "retry_required" {
			for _, remaining := range request.Targets[len(items):] {
				items = append(items, contactRedistributionItem{LeadID: remaining.LeadID, Reason: item.Reason})
			}
			break
		}
	}
	return contactRedistributionResult{Items: items}, nil
}

func (repo Repository) redistributeContact(ctx context.Context, resolver tenant.Repository, actor tenant.Context, request contactRedistributionRequest, requestHash string, target contactRedistributionTarget) (contactRedistributionItem, error) {
	item := contactRedistributionItem{LeadID: target.LeadID}
	failure := func(reason string) (contactRedistributionItem, error) {
		item.Reason = reason
		return item, nil
	}
	key := distribution.StableKey(manualQueueRedistribution, actor.UserID, request.OperationID, target.LeadID)
	operationKey := distribution.StableKey(manualQueueRedistribution+"_batch", actor.UserID, request.OperationID)

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return item, err
	}
	defer rollbackRedistributionTransaction(ctx, tx)
	if _, err := tx.Exec(ctx, `set local lock_timeout = '2s'; set local statement_timeout = '6s'`); err != nil {
		return item, err
	}

	// A long batch must not continue on the initial authorization snapshot
	// after a role or team grant has changed.
	currentActor, err := resolver.ResolveInTx(ctx, tx, actor.UserID, actor.OrganizationID)
	if errors.Is(err, tenant.ErrOrganizationAccessDenied) || errors.Is(err, tenant.ErrUserInactive) ||
		errors.Is(err, tenant.ErrUserProfileNotFound) || errors.Is(err, tenant.ErrOrganizationNotFound) {
		return failure("lead_unavailable")
	}
	if err != nil {
		return item, err
	}
	if currentActor.OrganizationID != actor.OrganizationID || currentActor.UserID != actor.UserID ||
		!currentActor.HasPermission(permissions.LeadOperate) || !currentActor.HasPermission(permissions.DistributionManage) {
		return failure("lead_unavailable")
	}
	actor = currentActor

	// The first successful target doubles as the actor-scoped operation binding.
	// Take this lock before the queue/lead so disjoint requests cannot race to bind it.
	var locked bool
	if err := tx.QueryRow(ctx, `select pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))`,
		distribution.StableKey(manualQueueRedistribution+"_lock", actor.OrganizationID, operationKey)).Scan(&locked); err != nil {
		return item, err
	}
	if !locked {
		return failure("retry_required")
	}
	operation, err := findContactRedistributionReceipt(ctx, tx, actor.OrganizationID, operationKey)
	if err != nil {
		return item, err
	}
	if operation != nil {
		if operation.RequestHash != requestHash {
			return failure("operation_conflict")
		}
		if operation.Item.LeadID == target.LeadID {
			return operation.Item, nil
		}
	}

	// A previously committed transfer can have removed the actor's lead visibility.
	// Its original receipt is scoped to that actor and returned without another write.
	receipt, err := findContactRedistributionReceipt(ctx, tx, actor.OrganizationID, key)
	if err != nil {
		return item, err
	}
	if receipt != nil {
		if receipt.RequestHash != requestHash || receipt.Item.LeadID != target.LeadID {
			return failure("operation_conflict")
		}
		return receipt.Item, nil
	}
	if operation == nil {
		key = operationKey
	}

	// Lock in queue-before-lead order. Some older intake paths still lock a lead
	// first, so skip a contended lead and keep the batch moving.
	if err := roundrobin.LockActiveQueueForDistribution(ctx, tx, actor, request.RoundRobinID); err != nil {
		if errors.Is(err, roundrobin.ErrRoundRobinNotFound) || errors.Is(err, tenant.ErrOrganizationAccessDenied) {
			return failure("queue_unavailable")
		}
		return item, err
	}
	current, err := repo.getRedistributionLeadSnapshotForUpdate(ctx, tx, actor.OrganizationID, target.LeadID)
	if errors.Is(err, ErrLeadNotFound) {
		return failure("lead_unavailable")
	}
	if err != nil {
		return item, err
	}
	if !canOperateLeadSnapshot(actor, current) {
		return failure("lead_unavailable")
	}
	if err := validateLeadAssignmentRevision(current, assignInput{ExpectedUpdatedAt: &target.ExpectedUpdatedAt}); err != nil {
		return failure("lead_changed")
	}
	if isQueuePoolSnapshot(current) || isManagedWhatsAppMessageDistributionLead(current.Data) ||
		current.Data["operational_effects_suppressed"] == true {
		return failure("lead_ineligible")
	}
	recipient, err := selectContactRedistributionRecipient(ctx, tx, actor.OrganizationID, request.RoundRobinID, current.TeamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return failure("queue_unavailable")
	}
	if err != nil {
		return item, err
	}

	item.Reason = "redistributed"
	if current.AssignedUserID == recipient.UserID {
		item.Reason = "same_assignee"
	} else {
		err = repo.transferLeadAssignee(ctx, tx, actor, current, &recipient.UserID, manualQueueRedistribution)
		if errors.Is(err, tenant.ErrOrganizationAccessDenied) || errors.Is(err, ErrQueuePoolConflict) {
			return failure("lead_ineligible")
		}
		if err != nil {
			return contactRedistributionItem{}, err
		}
	}
	item.AssignedUserID, item.Success = recipient.UserID, true
	if err := recordContactRedistributionReceipt(ctx, tx, actor, request.RoundRobinID, key, requestHash, item, recipient); err != nil {
		return contactRedistributionItem{}, err
	}
	if item.Reason == "redistributed" {
		if _, err := tx.Exec(ctx, `insert into private.realtime_events (organization_id, user_id, event_type, data)
			values ($1::uuid, $2::uuid, 'lead.redistributed', $3::jsonb)`, actor.OrganizationID, actor.UserID, jsonb(map[string]any{
			"leadId": current.ID, "pipelineId": current.PipelineID, "stageId": current.StageID,
			"assignedUserId": recipient.UserID, "roundRobinId": request.RoundRobinID, "roundRobinUsed": true,
		})); err != nil {
			return contactRedistributionItem{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return contactRedistributionItem{}, err
	}
	return item, nil
}

func findContactRedistributionReceipt(ctx context.Context, tx pgx.Tx, organizationID, key string) (*contactRedistributionReceipt, error) {
	var data []byte
	err := tx.QueryRow(ctx, `select result from private.lead_distribution_events
		where organization_id=$1::uuid and idempotency_key=$2 and source=$3`, organizationID, key, manualQueueRedistribution).Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var receipt contactRedistributionReceipt
	if err := json.Unmarshal(data, &receipt); err != nil {
		return nil, err
	}
	if !receipt.Item.Success {
		return nil, errors.New("invalid contact redistribution receipt")
	}
	return &receipt, nil
}

func recordContactRedistributionReceipt(ctx context.Context, tx pgx.Tx, actor tenant.Context, queueID, key, requestHash string, item contactRedistributionItem, recipient contactRedistributionRecipient) error {
	outcome := "assigned"
	if item.Reason == "same_assignee" {
		outcome = "already_assigned"
	}
	_, err := tx.Exec(ctx, `insert into private.lead_distribution_events
		(organization_id, lead_id, idempotency_key, requested_round_robin_id, round_robin_id, assigned_user_id,
		 candidate_position, source, outcome, result, created_at, completed_at)
		values ($1::uuid, $2::uuid, $3, $4::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9::jsonb,
		 greatest(clock_timestamp(), $10::timestamptz + interval '1 microsecond'), clock_timestamp())`,
		actor.OrganizationID, item.LeadID, key, queueID, recipient.UserID, recipient.Position,
		manualQueueRedistribution, outcome,
		jsonb(contactRedistributionReceipt{item, requestHash, recipient.MemberID, recipient.CreatedAt}),
		recipient.PreviousCursorAt)
	return err
}
