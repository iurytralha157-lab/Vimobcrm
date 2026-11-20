package leads

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	"log/slog"
)

func (repo Repository) Update(ctx context.Context, tenantContext tenant.Context, leadID string, input updateInput) (Lead, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return Lead{}, ErrLeadNotFound
	}
	if err := normalizeLeadUpdateFinancialInput(&input, leadFinancialWireMaxLength); err != nil {
		return Lead{}, err
	}

	pool := repo.db.Pool()
	updateStartedAt := time.Now()
	poolBefore := pool.Stat()
	var (
		beginDuration       time.Duration
		snapshotDuration    time.Duration
		updateDuration      time.Duration
		sideEffectsDuration time.Duration
		finalReadDuration   time.Duration
		commitDuration      time.Duration
	)
	defer func() {
		totalDuration := time.Since(updateStartedAt)
		if totalDuration < 250*time.Millisecond {
			return
		}

		poolAfter := pool.Stat()
		slog.Warn(
			"slow lead update",
			"duration_ms", totalDuration.Milliseconds(),
			"db_begin_ms", beginDuration.Milliseconds(),
			"lead_snapshot_ms", snapshotDuration.Milliseconds(),
			"lead_update_ms", updateDuration.Milliseconds(),
			"side_effects_ms", sideEffectsDuration.Milliseconds(),
			"final_read_ms", finalReadDuration.Milliseconds(),
			"commit_ms", commitDuration.Milliseconds(),
			"pool_total_conns", poolAfter.TotalConns(),
			"pool_acquired_conns", poolAfter.AcquiredConns(),
			"pool_idle_conns", poolAfter.IdleConns(),
			"pool_empty_acquire_delta", poolAfter.EmptyAcquireCount()-poolBefore.EmptyAcquireCount(),
			"pool_acquire_wait_ms_delta", (poolAfter.AcquireDuration() - poolBefore.AcquireDuration()).Milliseconds(),
		)
	}()

	beginStartedAt := time.Now()
	tx, err := pool.Begin(ctx)
	beginDuration = time.Since(beginStartedAt)
	if err != nil {
		return Lead{}, err
	}
	defer tx.Rollback(ctx)

	snapshotStartedAt := time.Now()
	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, leadID)
	snapshotDuration = time.Since(snapshotStartedAt)
	if err != nil {
		return Lead{}, err
	}
	if isQueuePoolSnapshot(current) {
		return Lead{}, ErrQueuePoolConflict
	}

	canEdit, err := repo.canEditLead(ctx, tx, tenantContext, current.AssignedUserID, current.TeamID)
	if err != nil {
		return Lead{}, err
	}

	canOperationalPatch := canUpdateAssignedLeadOperationalPatch(tenantContext, current, input)
	if !canEdit && !canOperationalPatch {
		return Lead{}, tenant.ErrOrganizationAccessDenied
	}
	if err := validateLeadUpdateRevision(current, input); err != nil {
		return Lead{}, err
	}
	if err := validateLeadUpdateDestination(current, input); err != nil {
		return Lead{}, err
	}

	if err := repo.applyDestinationDealStatus(ctx, tx, tenantContext.OrganizationID, current, &input); err != nil {
		return Lead{}, err
	}
	if err := validateLostReasonContract(current, input); err != nil {
		return Lead{}, err
	}
	propertyInterestsChange, err := normalizeLeadPropertyInterests(current, &input)
	if err != nil {
		return Lead{}, err
	}
	if current.DealStatus == "won" && leadPropertyLinkChanged(current, input) {
		return Lead{}, ErrLeadPropertyRelinkWhileWon
	}
	if err := repo.validateUpdatePropertyReferences(ctx, tx, tenantContext, current, input); err != nil {
		return Lead{}, err
	}
	if err := repo.applySelectedPropertyCommercialValues(ctx, tx, tenantContext, current, &input); err != nil {
		return Lead{}, err
	}
	financialReviewRequired, err := leadTransitionRequiresFinancialReview(ctx, tx, tenantContext.OrganizationID, current, input)
	if err != nil {
		return Lead{}, err
	}

	assignments := []string{}
	args := []any{tenantContext.OrganizationID, leadID}

	addAssignment := func(column string, value any) {
		args = append(args, value)
		assignments = append(assignments, fmt.Sprintf("%s = $%d", column, len(args)))
	}
	addUUIDAssignment := func(column string, field patchString) {
		if field.Set {
			addAssignment(column, nullablePatchString(field))
			assignments[len(assignments)-1] += "::uuid"
		}
	}
	addNumericAssignment := func(column string, field patchString) {
		if field.Set {
			addAssignment(column, nullablePatchString(field))
			assignments[len(assignments)-1] += "::numeric"
		}
	}
	addTextAssignment := func(column string, field patchString) {
		if field.Set {
			addAssignment(column, nullablePatchString(field))
		}
	}
	addBoolAssignment := func(column string, field patchBool) {
		if field.Set {
			addAssignment(column, nullablePatchBool(field))
		}
	}
	addRawAssignment := func(expression string) {
		assignments = append(assignments, expression)
	}

	if input.AssignedUserID.Set {
		if !canAssignLeads(tenantContext) {
			return Lead{}, tenant.ErrOrganizationAccessDenied
		}
		if err := prepareManualQueueTransfer(ctx, tx, tenantContext, current.ID, input.AssignedUserID.Value); err != nil {
			return Lead{}, err
		}
		if input.AssignedUserID.Value != nil {
			if err := repo.validateAssignedUser(ctx, tx, tenantContext.OrganizationID, input.AssignedUserID.Value); err != nil {
				return Lead{}, err
			}
			addUUIDAssignment("assigned_user_id", input.AssignedUserID)
			addRawAssignment("assigned_at = now()")
		} else {
			addAssignment("assigned_user_id", nil)
			assignments[len(assignments)-1] += "::uuid"
			addRawAssignment("assigned_at = null")
		}
	}

	if input.TeamID.Set {
		if !canAssignLeads(tenantContext) {
			return Lead{}, tenant.ErrOrganizationAccessDenied
		}
		if err := repo.validateLeadTeam(ctx, tx, tenantContext, input.TeamID.Value); err != nil {
			return Lead{}, err
		}
		addUUIDAssignment("team_id", input.TeamID)
	}

	nextTeamID := current.TeamID
	if input.TeamID.Set {
		nextTeamID = ""
		if input.TeamID.Value != nil {
			nextTeamID = *input.TeamID.Value
		}
	}
	nextAssignedUserID := current.AssignedUserID
	if input.AssignedUserID.Set {
		nextAssignedUserID = ""
		if input.AssignedUserID.Value != nil {
			nextAssignedUserID = *input.AssignedUserID.Value
		}
	}
	if updateChangesLeadTeamAssignment(input) {
		if err := repo.validateRoundRobinAssigneeTeam(ctx, tx, tenantContext.OrganizationID, nextTeamID, optionalString(nextAssignedUserID, 36)); err != nil {
			return Lead{}, err
		}
	}

	if err := repo.applyDestinationAssignments(ctx, tx, tenantContext.OrganizationID, current, input, addUUIDAssignment, addRawAssignment); err != nil {
		return Lead{}, err
	}

	if input.PropertyID.Set {
		addUUIDAssignment("property_id", input.PropertyID)
	}
	if input.InterestPropertyID.Set {
		addUUIDAssignment("interest_property_id", input.InterestPropertyID)
	}

	addTextAssignment("name", input.Name)
	addTextAssignment("email", input.Email)
	addTextAssignment("phone", input.Phone)
	addTextAssignment("source", input.Source)
	addTextAssignment("message", input.Message)
	addTextAssignment("property_code", input.PropertyCode)
	addNumericAssignment("valor_interesse", input.InterestValue)
	addNumericAssignment("commission_percentage", input.CommissionPercentage)
	addTextAssignment("lost_reason", input.LostReason)
	addTextAssignment("feedback", input.Feedback)
	addTextAssignment("cargo", input.Cargo)
	addTextAssignment("empresa", input.Empresa)
	addTextAssignment("profissao", input.Profissao)
	addTextAssignment("endereco", input.Endereco)
	addTextAssignment("numero", input.Numero)
	addTextAssignment("complemento", input.Complemento)
	addTextAssignment("bairro", input.Bairro)
	addTextAssignment("cep", input.CEP)
	addTextAssignment("cidade", input.Cidade)
	addTextAssignment("uf", input.UF)
	addTextAssignment("renda_familiar", input.RendaFamiliar)
	addTextAssignment("faixa_valor_imovel", input.FaixaValorImovel)
	addTextAssignment("finalidade_compra", input.FinalidadeCompra)
	addBoolAssignment("trabalha", input.Trabalha)
	addBoolAssignment("procura_financiamento", input.ProcuraFinanciamento)
	addBoolAssignment("is_own_resource", input.IsOwnResource)
	if input.MetadataSet {
		args = append(args, jsonb(input.Metadata))
		assignments = append(assignments, fmt.Sprintf("metadata = coalesce(metadata, '{}'::jsonb) || $%d::jsonb", len(args)))
	}

	if input.DealStatus.Set {
		addTextAssignment("deal_status", input.DealStatus)
		if input.DealStatus.Value != nil {
			switch *input.DealStatus.Value {
			case "won":
				addRawAssignment("won_at = coalesce(won_at, now())")
				addRawAssignment("lost_at = null")
			case "lost":
				addRawAssignment("lost_at = coalesce(lost_at, now())")
				addRawAssignment("won_at = null")
			case "open":
				addRawAssignment("won_at = null")
				addRawAssignment("lost_at = null")
			}
		}
	}

	if len(assignments) == 0 {
		return Lead{}, ErrNoLeadChanges
	}
	if !hasLeadColumnAssignment(assignments, "board_order_at") {
		// board_order_at is the index-backed operational clock for the Kanban.
		// Advancing it on a real lead patch keeps recently worked leads at the
		// top without sorting the all-time board by an unindexed expression.
		addRawAssignment("board_order_at = now()")
	}

	wonPropertyReservation, err := repo.lockWonLeadPropertyForUpdate(
		ctx,
		tx,
		tenantContext,
		current,
		input,
	)
	if err != nil {
		return Lead{}, err
	}

	if input.InterestPropertyIDs.Set {
		primary := optionalString(selectedLeadPropertyID(current, input), 36)
		if err := lockNewLeadSecondaryPropertyInterests(ctx, tx, tenantContext.OrganizationID, primary, leadInterestPropertyIDs(current), input.InterestPropertyIDs.Value); err != nil {
			return Lead{}, err
		}
	}
	addRawAssignment("updated_at = now()")

	query := `
		update public.leads
		set ` + strings.Join(assignments, ",\n		    ") + `
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning id::text
	`

	var updatedID string
	updateQueryStartedAt := time.Now()
	if err := tx.QueryRow(ctx, query, args...).Scan(&updatedID); err != nil {
		updateDuration = time.Since(updateQueryStartedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return Lead{}, ErrLeadNotFound
		}
		if isLeadPhoneUniqueViolation(err) {
			return Lead{}, ErrLeadPhoneConflict
		}
		return Lead{}, err
	}
	updateDuration = time.Since(updateQueryStartedAt)

	sideEffectsStartedAt := time.Now()
	oldAuditData, newAuditData := changedLeadAuditData(current.Data, input.auditData())
	if propertyInterestsChange != nil {
		// Preserve exact IDs privately, with the same operation identity as the
		// public count-only activity. History redaction must not expose this list.
		oldAuditData["interest_property_ids"] = propertyInterestsChange.Before
		newAuditData["interest_property_ids"] = propertyInterestsChange.After
		newAuditData["operation_id"] = propertyInterestsChange.OperationID
	}
	if len(newAuditData) > 0 {
		_, err = tx.Exec(ctx, `
			insert into public.audit_logs (
				organization_id,
				user_id,
				action,
				entity_type,
				entity_id,
				old_data,
				new_data
			)
			values (
				$1::uuid,
				$2::uuid,
				'update',
				'lead',
				$3::uuid,
				$4::jsonb,
				$5::jsonb
			)
		`, tenantContext.OrganizationID, tenantContext.UserID, updatedID, jsonb(oldAuditData), jsonb(newAuditData))
		if err != nil {
			return Lead{}, err
		}
	}

	if _, err := repo.reserveWonLeadProperty(
		ctx,
		tx,
		tenantContext,
		current,
		input,
		wonPropertyReservation,
	); err != nil {
		return Lead{}, err
	}
	if err := repo.releaseReopenedLeadProperty(ctx, tx, tenantContext, current, input); err != nil {
		return Lead{}, err
	}

	if err := repo.insertDealStatusActivities(ctx, tx, tenantContext, current, input); err != nil {
		return Lead{}, err
	}

	if err := repo.insertLeadUpdateActivities(ctx, tx, tenantContext, current, input); err != nil {
		return Lead{}, err
	}
	if err := repo.insertLeadPropertyInterestsActivity(ctx, tx, tenantContext, current.ID, propertyInterestsChange); err != nil {
		return Lead{}, err
	}
	if err := repo.enqueueDealWonNotifications(ctx, tx, tenantContext, current, input); err != nil {
		return Lead{}, err
	}
	sideEffectsDuration = time.Since(sideEffectsStartedAt)

	if err := validatePersistedLeadUpdateDestination(ctx, tx, tenantContext.OrganizationID, updatedID, input); err != nil {
		return Lead{}, err
	}

	finalReadStartedAt := time.Now()
	updatedLead, err := repo.getLeadForMutation(ctx, tx, tenantContext, updatedID)
	finalReadDuration = time.Since(finalReadStartedAt)
	if err != nil {
		return Lead{}, err
	}
	updatedLead.FinancialReviewRequired = financialReviewRequired

	commitStartedAt := time.Now()
	if err := tx.Commit(ctx); err != nil {
		commitDuration = time.Since(commitStartedAt)
		return Lead{}, err
	}
	commitDuration = time.Since(commitStartedAt)

	repo.dispatchDealStatusSideEffects(tenantContext, current, input)
	repo.hydrateMutationLeadAvatar(tenantContext.OrganizationID, &updatedLead)

	return updatedLead, nil
}

func hasLeadColumnAssignment(assignments []string, column string) bool {
	prefix := column + " ="
	for _, assignment := range assignments {
		if strings.HasPrefix(strings.TrimSpace(assignment), prefix) {
			return true
		}
	}
	return false
}
