package leads

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var ErrLeadCreationWorkflowUnavailable = errors.New("lead creation commercial workflow is unavailable")

type leadCreationOutcome struct {
	LeadID        string
	InitialStatus string
	Deferred      bool
}

func prepareLeadCreationOutcome(ctx context.Context, tx pgx.Tx, actor tenant.Context, input createInput) (leadCreationOutcome, error) {
	if input.DealStatus == "won" && !actor.HasPermission(permissions.LeadOperate) {
		return leadCreationOutcome{}, tenant.ErrOrganizationAccessDenied
	}
	var ready bool
	if err := tx.QueryRow(ctx, `select
		to_regprocedure('private.set_lead_creation_status_phase(uuid,uuid,text)') is not null
		and current_setting('session_replication_role') = 'origin'
		and exists (select 1 from pg_catalog.pg_trigger financial_trigger
			where financial_trigger.tgrelid=to_regclass('public.leads')
			and financial_trigger.tgname='trigger_create_commission_on_won'
			and financial_trigger.tgfoid=to_regprocedure('public.create_commission_on_won()')
			and financial_trigger.tgenabled in ('O','A') and not financial_trigger.tgisinternal
			and (financial_trigger.tgtype & 16) <> 0 and (financial_trigger.tgtype & 2) = 0)`).Scan(&ready); err != nil {
		return leadCreationOutcome{}, err
	}
	if input.DealStatus == "won" && !ready {
		return leadCreationOutcome{}, ErrLeadCreationWorkflowUnavailable
	}
	out := leadCreationOutcome{InitialStatus: input.DealStatus, Deferred: ready}
	if out.InitialStatus == "won" {
		out.InitialStatus = "open"
	}
	if err := tx.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&out.LeadID); err != nil {
		return leadCreationOutcome{}, err
	}
	if _, valid := normalizeUUID(out.LeadID); !valid {
		return leadCreationOutcome{}, ErrInvalidReference
	}
	if ready {
		if err := setLeadCreationStatusPhase(ctx, tx, actor.OrganizationID, out.LeadID, "defer"); err != nil {
			return leadCreationOutcome{}, err
		}
	}
	return out, nil
}

func setLeadCreationStatusPhase(ctx context.Context, tx pgx.Tx, organizationID, leadID, phase string) error {
	_, err := tx.Exec(ctx, `select private.set_lead_creation_status_phase($1::uuid,$2::uuid,$3)`, organizationID, leadID, phase)
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) && validEnum(pgError.Code, "42883", "3F000", "42501") {
		return ErrLeadCreationWorkflowUnavailable
	}
	return err
}

// Lock before INSERT creates its property FK KEY SHARE. Two new contenders
// must not each retain that shared lock while waiting to upgrade for a win.
// This does not reserve/unpublish anything: the final outcome does that later.
func lockLeadCreationProperty(ctx context.Context, tx pgx.Tx, actor tenant.Context, input createInput, _ leadCreationOutcome) error {
	if input.PropertyID == nil {
		return nil
	}
	if !propertyscope.CanRead(actor) {
		return ErrInvalidReference
	}
	args, visibility := appendCanonicalPropertyVisibility([]any{actor.OrganizationID, *input.PropertyID}, actor, "creation_property")
	var id string
	err := tx.QueryRow(ctx, `select creation_property.id::text from public.properties creation_property
		where creation_property.organization_id=$1::uuid and creation_property.id=$2::uuid
		and `+visibility+` for update of creation_property`, args...).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidReference
	}
	if err != nil {
		return err
	}
	if id != *input.PropertyID {
		return ErrInvalidReference
	}
	return nil
}

type leadCreationOutcomeOperations struct {
	snapshot func() (leadSnapshot, error)
	status   func(leadSnapshot) (string, error)
	reserve  func(leadSnapshot, updateInput) (*wonLeadPropertyReservation, error)
	effects  func(leadSnapshot, updateInput, *wonLeadPropertyReservation) error
}

type leadCreationOutcomeTransition struct {
	Before leadSnapshot
	Input  updateInput
}

func (repo Repository) finishLeadCreationOutcome(ctx context.Context, tx pgx.Tx, actor tenant.Context, requested createInput, creation leadCreationOutcome) (leadCreationOutcomeTransition, error) {
	operations := leadCreationOutcomeOperations{
		snapshot: func() (leadSnapshot, error) {
			current, err := repo.getLeadSnapshotForUpdate(ctx, tx, actor.OrganizationID, creation.LeadID)
			if err != nil {
				return leadSnapshot{}, err
			}
			if err := distribution.LockIntakePipelineDestination(ctx, tx, actor.OrganizationID, optionalString(current.PipelineID, 36), optionalString(current.StageID, 36)); err != nil {
				return leadSnapshot{}, err
			}
			// Assignment automation and the distributor can change the original
			// request. Validate their effective team relation before any outcome.
			if err := repo.validateRoundRobinAssigneeTeam(ctx, tx, actor.OrganizationID, current.TeamID, optionalString(current.AssignedUserID, 36)); err != nil {
				return leadSnapshot{}, err
			}
			return current, nil
		},
		status: func(current leadSnapshot) (string, error) {
			if current.StageID == "" {
				return requested.DealStatus, nil
			}
			stage, err := repo.resolveMoveStageDestination(ctx, tx, actor.OrganizationID, current.StageID)
			if err != nil {
				return "", err
			}
			status, err := repo.resolveMoveStageDealStatus(ctx, tx, actor.OrganizationID, current.StageID, stage.IsWon, stage.IsLost)
			if err != nil {
				return "", err
			}
			if status == "" {
				status = requested.DealStatus
			}
			return status, nil
		},
		reserve: func(before leadSnapshot, patch updateInput) (*wonLeadPropertyReservation, error) {
			return repo.lockWonLeadPropertyForUpdate(ctx, tx, actor, before, patch)
		},
		effects: func(before leadSnapshot, patch updateInput, reservation *wonLeadPropertyReservation) error {
			if _, err := repo.reserveWonLeadProperty(ctx, tx, actor, before, patch, reservation); err != nil {
				return err
			}
			if err := repo.insertDealStatusActivities(ctx, tx, actor, before, patch); err != nil {
				return err
			}
			return repo.enqueueDealWonNotifications(ctx, tx, actor, before, patch)
		},
	}
	return runLeadCreationOutcome(ctx, tx, actor, requested, creation, operations)
}

// The caller owns the transaction, including the import receipt. This kernel
// never commits: any unavailable property, trigger drift or scope failure also
// rolls back the new contact, its financial trigger and reservation effects.
func runLeadCreationOutcome(ctx context.Context, tx pgx.Tx, actor tenant.Context, requested createInput, creation leadCreationOutcome, operations leadCreationOutcomeOperations) (leadCreationOutcomeTransition, error) {
	before, err := operations.snapshot()
	if err != nil {
		return leadCreationOutcomeTransition{}, err
	}
	if before.ID != creation.LeadID || before.Data["organization_id"] != actor.OrganizationID {
		return leadCreationOutcomeTransition{}, ErrInvalidReference
	}
	if !creation.Deferred {
		if before.DealStatus == "won" {
			return leadCreationOutcomeTransition{}, ErrLeadCreationWorkflowUnavailable
		}
		return leadCreationOutcomeTransition{}, nil
	}
	if before.DealStatus == "won" {
		return leadCreationOutcomeTransition{}, ErrLeadCreationWorkflowUnavailable
	}
	status, err := operations.status(before)
	if err != nil {
		return leadCreationOutcomeTransition{}, err
	}
	if !validEnum(status, "open", "won", "lost") {
		return leadCreationOutcomeTransition{}, ErrInvalidReference
	}
	if status == "won" && !canOperateLeadSnapshot(actor, before) {
		return leadCreationOutcomeTransition{}, tenant.ErrOrganizationAccessDenied
	}
	if status == before.DealStatus {
		// Common open creation keeps its original write/effect behavior. Only a
		// real transition needs the UPDATE-based commercial/status workflow.
		return leadCreationOutcomeTransition{}, setLeadCreationStatusPhase(ctx, tx, actor.OrganizationID, creation.LeadID, "done")
	}
	patch := updateInput{DealStatus: patchString{Set: true, Value: &status}}
	if status == "lost" {
		patch.LostReason = patchString{Set: true, Value: requested.LostReason}
	}
	// Explicit lost inputs were validated before creation. Keep the existing
	// configured on-enter lost behavior; this change gates only commercial wins.
	reservation, err := operations.reserve(before, patch)
	if err != nil {
		return leadCreationOutcomeTransition{}, err
	}
	if err := setLeadCreationStatusPhase(ctx, tx, actor.OrganizationID, creation.LeadID, "apply"); err != nil {
		return leadCreationOutcomeTransition{}, err
	}
	// UPDATE is intentional: the canonical commission/receivable trigger is an
	// AFTER UPDATE transition trigger, never an INSERT trigger.
	tag, err := tx.Exec(ctx, `update public.leads set deal_status=$3,
		lost_reason=case when $3='lost' then $4::text else null end,
		won_at=case when $3='won' then coalesce(won_at,now()) else null end,
		lost_at=case when $3='lost' then coalesce(lost_at,now()) else null end,
		updated_at=now() where organization_id=$1::uuid and id=$2::uuid`, actor.OrganizationID, creation.LeadID, status, nullable(requested.LostReason))
	if err != nil {
		return leadCreationOutcomeTransition{}, err
	}
	if tag.RowsAffected() != 1 {
		return leadCreationOutcomeTransition{}, ErrLeadNotFound
	}
	after, err := operations.snapshot()
	if err != nil {
		return leadCreationOutcomeTransition{}, err
	}
	if after.ID != before.ID || after.Data["organization_id"] != actor.OrganizationID || after.DealStatus != status || after.PipelineID != before.PipelineID || after.StageID != before.StageID || after.PropertyID != before.PropertyID || after.InterestPropertyID != before.InterestPropertyID || after.AssignedUserID != before.AssignedUserID || after.TeamID != before.TeamID {
		return leadCreationOutcomeTransition{}, fmt.Errorf("%w: creation outcome changed during finalization", ErrLeadChanged)
	}
	if status == "won" && !canOperateLeadSnapshot(actor, after) {
		return leadCreationOutcomeTransition{}, tenant.ErrOrganizationAccessDenied
	}
	if err := operations.effects(before, patch, reservation); err != nil {
		return leadCreationOutcomeTransition{}, err
	}
	if err := setLeadCreationStatusPhase(ctx, tx, actor.OrganizationID, creation.LeadID, "done"); err != nil {
		return leadCreationOutcomeTransition{}, err
	}
	return leadCreationOutcomeTransition{Before: before, Input: patch}, nil
}
