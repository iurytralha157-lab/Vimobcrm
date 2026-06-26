package leads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db      *dbpkg.Postgres
	storage storageClient
}

type scanner interface {
	Scan(dest ...any) error
}

type destination struct {
	PipelineID *string
	StageID    *string
}

type CreateResult struct {
	Lead             Lead
	Reentry          bool
	AssignedUserName string
}

type roundRobinSelection struct {
	RoundRobinID string
	MemberID     string
	UserID       string
}

type existingLeadMatch struct {
	ID               string
	Phone            string
	AssignedUserID   string
	AssignedUserName string
}

type leadSnapshot struct {
	ID             string
	Name           string
	Phone          string
	AssignedUserID string
	PipelineID     string
	StageID        string
	DealStatus     string
	LostReason     string
	InterestValue  string
}

func NewRepository(db *dbpkg.Postgres, storageConfigs ...StorageConfig) Repository {
	repository := Repository{db: db}
	if len(storageConfigs) > 0 {
		repository.storage = newStorageClient(storageConfigs[0])
	}
	return repository
}

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context, filter ListFilter) (ListResponse, error) {
	args := []any{
		tenantContext.OrganizationID,
		canViewAllLeads(tenantContext),
		tenantContext.UserID,
		tenantContext.HasPermission("lead_view_team"),
	}

	where := []string{
		"l.organization_id = $1::uuid",
		leadVisibilitySQL("$2", "$3", "$4"),
	}

	addFilter := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if filter.StageID != "" {
		addFilter("l.stage_id = $%d::uuid", filter.StageID)
	}
	if filter.Unassigned {
		where = append(where, "l.assigned_user_id is null")
	} else if filter.AssignedUserID != "" {
		addFilter("l.assigned_user_id = $%d::uuid", filter.AssignedUserID)
	}
	if filter.DealStatus != "" {
		addFilter("l.deal_status = $%d", filter.DealStatus)
	}
	if filter.Search != "" {
		args = append(args, "%"+filter.Search+"%")
		index := len(args)
		where = append(where, fmt.Sprintf("(l.name ilike $%d or l.phone ilike $%d or l.email ilike $%d)", index, index, index))
	}

	args = append(args, filter.Limit, filter.Offset)
	limitIndex := len(args) - 1
	offsetIndex := len(args)

	query := `
		select
			count(*) over() as total_count,
			` + leadSelectFields() + `
		from public.leads l
		left join public.stages s on s.id = l.stage_id
		left join public.users u on u.id = l.assigned_user_id
		where ` + strings.Join(where, " and ") + `
		order by l.created_at desc, l.id desc
		limit $` + fmt.Sprint(limitIndex) + `
		offset $` + fmt.Sprint(offsetIndex)

	rows, err := repo.db.Pool().Query(ctx, query, args...)
	if err != nil {
		return ListResponse{}, err
	}
	defer rows.Close()

	leads := make([]Lead, 0, filter.Limit)
	var total int64

	for rows.Next() {
		lead, rowTotal, err := scanLeadWithTotal(rows)
		if err != nil {
			return ListResponse{}, err
		}
		total = rowTotal
		leads = append(leads, lead)
	}

	if err := rows.Err(); err != nil {
		return ListResponse{}, err
	}

	return ListResponse{
		Data:   leads,
		Total:  total,
		Limit:  filter.Limit,
		Offset: filter.Offset,
	}, nil
}

func (repo Repository) Get(ctx context.Context, tenantContext tenant.Context, leadID string) (Lead, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return Lead{}, ErrLeadNotFound
	}

	query := `
		select ` + leadSelectFields() + `
		from public.leads l
		left join public.stages s on s.id = l.stage_id
		left join public.users u on u.id = l.assigned_user_id
		where l.organization_id = $1::uuid
		  and ` + leadVisibilitySQL("$2", "$3", "$4") + `
		  and l.id = $5::uuid
		limit 1`

	lead, err := scanLead(repo.db.Pool().QueryRow(
		ctx,
		query,
		tenantContext.OrganizationID,
		canViewAllLeads(tenantContext),
		tenantContext.UserID,
		tenantContext.HasPermission("lead_view_team"),
		leadID,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return Lead{}, ErrLeadNotFound
	}
	if err != nil {
		return Lead{}, err
	}

	return lead, nil
}

func (repo Repository) Create(ctx context.Context, tenantContext tenant.Context, input createInput) (CreateResult, error) {
	if !canManageLeads(tenantContext) {
		return CreateResult{}, tenant.ErrOrganizationAccessDenied
	}

	resolvedDestination, err := repo.resolveDestination(ctx, tenantContext.OrganizationID, input.PipelineID, input.StageID)
	if err != nil {
		return CreateResult{}, err
	}

	if err := repo.validateAssignedUser(ctx, tenantContext.OrganizationID, input.AssignedUserID); err != nil {
		return CreateResult{}, err
	}

	existingLead, err := repo.findExistingLeadByPhone(ctx, tenantContext.OrganizationID, input.Phone)
	if err != nil {
		return CreateResult{}, err
	}
	if existingLead != nil {
		return repo.registerReentry(ctx, tenantContext, input, resolvedDestination, *existingLead)
	}

	return repo.createNewLead(ctx, tenantContext, input, resolvedDestination)
}

func (repo Repository) Update(ctx context.Context, tenantContext tenant.Context, leadID string, input updateInput) (Lead, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return Lead{}, ErrLeadNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Lead{}, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, leadID)
	if err != nil {
		return Lead{}, err
	}

	canEdit, err := repo.canEditLead(ctx, tx, tenantContext, current.AssignedUserID)
	if err != nil {
		return Lead{}, err
	}
	if !canEdit {
		return Lead{}, tenant.ErrOrganizationAccessDenied
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
		if input.AssignedUserID.Value != nil {
			if err := repo.validateAssignedUser(ctx, tenantContext.OrganizationID, input.AssignedUserID.Value); err != nil {
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

	if err := repo.applyDestinationAssignments(ctx, tenantContext.OrganizationID, input, addUUIDAssignment, addRawAssignment); err != nil {
		return Lead{}, err
	}

	if input.PropertyID.Set {
		if err := repo.validateProperty(ctx, tx, tenantContext.OrganizationID, input.PropertyID.Value); err != nil {
			return Lead{}, err
		}
		addUUIDAssignment("property_id", input.PropertyID)
	}
	if input.InterestPropertyID.Set {
		if err := repo.validateProperty(ctx, tx, tenantContext.OrganizationID, input.InterestPropertyID.Value); err != nil {
			return Lead{}, err
		}
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

	addRawAssignment("updated_at = now()")

	query := `
		update public.leads
		set ` + strings.Join(assignments, ",\n		    ") + `
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning id::text
	`

	var updatedID string
	if err := tx.QueryRow(ctx, query, args...).Scan(&updatedID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Lead{}, ErrLeadNotFound
		}
		return Lead{}, err
	}

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
	`, tenantContext.OrganizationID, tenantContext.UserID, updatedID, jsonb(map[string]any{
		"name":             current.Name,
		"stage_id":         nullableString(current.StageID),
		"assigned_user_id": nullableString(current.AssignedUserID),
	}), jsonb(input.auditData()))
	if err != nil {
		return Lead{}, err
	}

	if err := repo.insertDealStatusActivities(ctx, tx, tenantContext, current, input); err != nil {
		return Lead{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Lead{}, err
	}

	return repo.Get(ctx, tenantContext, updatedID)
}

func (repo Repository) MoveStage(ctx context.Context, tenantContext tenant.Context, leadID string, input moveStageInput) (Lead, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return Lead{}, ErrLeadNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Lead{}, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, leadID)
	if err != nil {
		return Lead{}, err
	}

	if !canMoveLead(tenantContext, current.AssignedUserID) {
		return Lead{}, tenant.ErrOrganizationAccessDenied
	}

	resolvedDestination, err := repo.resolveDestination(ctx, tenantContext.OrganizationID, nil, &input.StageID)
	if err != nil {
		return Lead{}, err
	}
	if resolvedDestination.PipelineID == nil || resolvedDestination.StageID == nil {
		return Lead{}, ErrInvalidReference
	}

	var updatedID string
	if err := tx.QueryRow(ctx, `
		update public.leads
		set stage_id = $3::uuid,
		    pipeline_id = $4::uuid,
		    stage_entered_at = coalesce($5::timestamptz, now()),
		    is_own_resource = coalesce($6::boolean, is_own_resource),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning id::text
	`, tenantContext.OrganizationID, leadID, *resolvedDestination.StageID, *resolvedDestination.PipelineID, nullableTime(input.StageEnteredAt), nullableBool(input.IsOwnResource)).Scan(&updatedID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Lead{}, ErrLeadNotFound
		}
		return Lead{}, err
	}

	if _, err := tx.Exec(ctx, `
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
			'move_stage',
			'lead',
			$3::uuid,
			$4::jsonb,
			$5::jsonb
		)
	`, tenantContext.OrganizationID, tenantContext.UserID, updatedID, jsonb(map[string]any{
		"pipeline_id": nullableString(current.PipelineID),
		"stage_id":    nullableString(current.StageID),
	}), jsonb(map[string]any{
		"pipeline_id":      *resolvedDestination.PipelineID,
		"stage_id":         *resolvedDestination.StageID,
		"is_own_resource":  nullableBool(input.IsOwnResource),
		"stage_entered_at": nullableTime(input.StageEnteredAt),
		"origin":           "vimob_api",
	})); err != nil {
		return Lead{}, err
	}

	if current.StageID != *resolvedDestination.StageID {
		if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, updatedID, tenantContext.UserID, "stage_change", fmt.Sprintf(`Lead "%s" movido de etapa`, current.Name), map[string]any{
			"from_stage_id": nullableString(current.StageID),
			"to_stage_id":   *resolvedDestination.StageID,
			"from_pipeline": nullableString(current.PipelineID),
			"to_pipeline":   *resolvedDestination.PipelineID,
		}); err != nil {
			return Lead{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Lead{}, err
	}

	return repo.Get(ctx, tenantContext, updatedID)
}

func (repo Repository) Assign(ctx context.Context, tenantContext tenant.Context, leadID string, input assignInput) (Lead, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return Lead{}, ErrLeadNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Lead{}, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, leadID)
	if err != nil {
		return Lead{}, err
	}

	if !canTransferLead(tenantContext, current.AssignedUserID) {
		return Lead{}, tenant.ErrOrganizationAccessDenied
	}

	if input.AssignedUserID != nil {
		if err := repo.validateAssignedUser(ctx, tenantContext.OrganizationID, input.AssignedUserID); err != nil {
			return Lead{}, err
		}
	}

	if err := repo.transferLeadAssignee(ctx, tx, tenantContext, current, input.AssignedUserID, "manual_transfer"); err != nil {
		return Lead{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Lead{}, err
	}

	return repo.Get(ctx, tenantContext, leadID)
}

func (repo Repository) RedistributeRoundRobin(ctx context.Context, tenantContext tenant.Context, leadID string) (RoundRobinResult, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return RoundRobinResult{}, ErrLeadNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return RoundRobinResult{}, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, leadID)
	if err != nil {
		return RoundRobinResult{}, err
	}

	if !canAssignLeads(tenantContext) {
		return RoundRobinResult{}, tenant.ErrOrganizationAccessDenied
	}

	result := RoundRobinResult{
		Success:    true,
		LeadID:     current.ID,
		PipelineID: current.PipelineID,
		StageID:    current.StageID,
	}

	selection, reason, err := repo.selectRoundRobinMember(ctx, tx, tenantContext.OrganizationID, current.PipelineID)
	if err != nil {
		return RoundRobinResult{}, err
	}
	if reason != "" {
		result.Error = reason
		return result, tx.Commit(ctx)
	}

	assignedUserID := selection.UserID
	if err := repo.transferLeadAssignee(ctx, tx, tenantContext, current, &assignedUserID, "round_robin"); err != nil {
		return RoundRobinResult{}, err
	}

	if _, err := tx.Exec(ctx, `
		insert into public.round_robin_logs (
			organization_id,
			round_robin_id,
			lead_id,
			assigned_user_id,
			reason,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			'round_robin',
			$5::jsonb
		)
	`, tenantContext.OrganizationID, selection.RoundRobinID, current.ID, selection.UserID, jsonb(map[string]any{
		"member_id": selection.MemberID,
		"source":    "vimob_api",
	})); err != nil {
		return RoundRobinResult{}, err
	}

	if _, err := tx.Exec(ctx, `
		update public.round_robins
		set current_position = coalesce((
		      select rrm.position
		      from public.round_robin_members rrm
		      where rrm.id = $2::uuid
		      limit 1
		    ), current_position),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $3::uuid
	`, tenantContext.OrganizationID, selection.MemberID, selection.RoundRobinID); err != nil {
		return RoundRobinResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return RoundRobinResult{}, err
	}

	result.AssignedUserID = selection.UserID
	result.RoundRobinID = selection.RoundRobinID
	result.RoundRobinUsed = true
	return result, nil
}

func (repo Repository) Delete(ctx context.Context, tenantContext tenant.Context, leadID string) error {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return ErrLeadNotFound
	}
	if !canDeleteLeads(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, leadID)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		delete from public.notifications
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
	`, tenantContext.OrganizationID, leadID); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		update public.whatsapp_conversations
		set lead_id = null,
		    updated_at = now()
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
	`, tenantContext.OrganizationID, leadID); err != nil {
		return err
	}

	tag, err := tx.Exec(ctx, `
		delete from public.leads
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, leadID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrLeadNotFound
	}

	if _, err := tx.Exec(ctx, `
		insert into public.audit_logs (
			organization_id,
			user_id,
			action,
			entity_type,
			entity_id,
			old_data
		)
		values (
			$1::uuid,
			$2::uuid,
			'delete',
			'lead',
			$3::uuid,
			$4::jsonb
		)
	`, tenantContext.OrganizationID, tenantContext.UserID, leadID, jsonb(map[string]any{
		"name":             current.Name,
		"phone":            nullableString(current.Phone),
		"assigned_user_id": nullableString(current.AssignedUserID),
		"deal_status":      current.DealStatus,
	})); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (repo Repository) AddTag(ctx context.Context, tenantContext tenant.Context, leadID string, input tagInput) error {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return ErrLeadNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, leadID)
	if err != nil {
		return err
	}

	canEdit, err := repo.canEditLead(ctx, tx, tenantContext, current.AssignedUserID)
	if err != nil {
		return err
	}
	if !canEdit {
		return tenant.ErrOrganizationAccessDenied
	}

	tagName, err := repo.getTagName(ctx, tx, tenantContext.OrganizationID, input.TagID)
	if err != nil {
		return err
	}

	var alreadyExists bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.lead_tags
			where organization_id = $1::uuid
			  and lead_id = $2::uuid
			  and tag_id = $3::uuid
		)
	`, tenantContext.OrganizationID, leadID, input.TagID).Scan(&alreadyExists); err != nil {
		return err
	}
	if alreadyExists {
		return ErrTagAlreadyExists
	}

	if _, err := tx.Exec(ctx, `
		insert into public.lead_tags (
			organization_id,
			lead_id,
			tag_id
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid
		)
	`, tenantContext.OrganizationID, leadID, input.TagID); err != nil {
		return err
	}

	if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, leadID, tenantContext.UserID, "tag_added", fmt.Sprintf(`Tag "%s" adicionada`, tagName), map[string]any{
		"tag_id":   input.TagID,
		"tag_name": tagName,
	}); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (repo Repository) RemoveTag(ctx context.Context, tenantContext tenant.Context, leadID string, input tagInput) error {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return ErrLeadNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, leadID)
	if err != nil {
		return err
	}

	canEdit, err := repo.canEditLead(ctx, tx, tenantContext, current.AssignedUserID)
	if err != nil {
		return err
	}
	if !canEdit {
		return tenant.ErrOrganizationAccessDenied
	}

	tagName, err := repo.getTagName(ctx, tx, tenantContext.OrganizationID, input.TagID)
	if err != nil {
		return err
	}

	tag, err := tx.Exec(ctx, `
		delete from public.lead_tags
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
		  and tag_id = $3::uuid
	`, tenantContext.OrganizationID, leadID, input.TagID)
	if err != nil {
		return err
	}

	if tag.RowsAffected() > 0 {
		if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, leadID, tenantContext.UserID, "tag_removed", fmt.Sprintf(`Tag "%s" removida`, tagName), map[string]any{
			"tag_id":   input.TagID,
			"tag_name": tagName,
		}); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (repo Repository) createNewLead(ctx context.Context, tenantContext tenant.Context, input createInput, resolvedDestination destination) (CreateResult, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return CreateResult{}, err
	}
	defer tx.Rollback(ctx)

	if err := repo.validateProperty(ctx, tx, tenantContext.OrganizationID, input.PropertyID); err != nil {
		return CreateResult{}, err
	}

	var leadID string
	err = tx.QueryRow(ctx, `
		with inserted as (
			insert into public.leads (
				organization_id,
				pipeline_id,
				stage_id,
				assigned_user_id,
				assigned_at,
				property_id,
				interest_property_id,
				name,
				email,
				phone,
				source,
				message,
				property_code,
				valor_interesse,
				deal_status,
				lost_reason,
				lost_at,
				won_at,
				is_own_resource,
				cargo,
				empresa,
				profissao,
				endereco,
				bairro,
				numero,
				cep,
				cidade,
				uf,
				renda_familiar,
				faixa_valor_imovel,
				created_by,
				stage_entered_at
			)
			values (
				$1::uuid,
				$2::uuid,
				$3::uuid,
				$4::uuid,
				case when $4::uuid is null then null else now() end,
				$5::uuid,
				$5::uuid,
				$6,
				$7,
				$8,
				$9,
				$10,
				$11,
				$12::numeric,
				$13,
				$14,
				case when $13 = 'lost' then now() else null end,
				case when $13 = 'won' then now() else null end,
				$15,
				$16,
				$17,
				$18,
				$19,
				$20,
				$21,
				$22,
				$23,
				$24,
				$25,
				$26,
				$27::uuid,
				case when $3::uuid is null then null else now() end
			)
			returning id::text, name, phone, source
		),
		audit as (
			insert into public.audit_logs (
				organization_id,
				user_id,
				action,
				entity_type,
				entity_id,
				new_data
			)
			select
				$1::uuid,
				$27::uuid,
				'create',
				'lead',
				inserted.id,
				jsonb_build_object(
					'name', inserted.name,
					'phone', inserted.phone,
					'source', inserted.source
				)
			from inserted
		)
		select id from inserted
	`,
		tenantContext.OrganizationID,
		nullable(resolvedDestination.PipelineID),
		nullable(resolvedDestination.StageID),
		nullable(input.AssignedUserID),
		nullable(input.PropertyID),
		input.Name,
		nullable(input.Email),
		nullable(input.Phone),
		input.Source,
		nullable(input.Message),
		nullable(input.PropertyCode),
		nullable(input.InterestValue),
		input.DealStatus,
		nullable(input.LostReason),
		nullableBool(input.IsOwnResource),
		nullable(input.Cargo),
		nullable(input.Empresa),
		nullable(input.Profissao),
		nullable(input.Endereco),
		nullable(input.Bairro),
		nullable(input.Numero),
		nullable(input.CEP),
		nullable(input.Cidade),
		nullable(input.UF),
		nullable(input.RendaFamiliar),
		nullable(input.FaixaValorImovel),
		tenantContext.UserID,
	).Scan(&leadID)
	if err != nil {
		return CreateResult{}, err
	}

	if err := repo.insertLeadTags(ctx, tx, tenantContext.OrganizationID, leadID, input.TagIDs); err != nil {
		return CreateResult{}, err
	}

	if err := repo.linkWhatsAppConversations(ctx, tx, tenantContext.OrganizationID, leadID, input.Phone, input.ConversationID); err != nil {
		return CreateResult{}, err
	}

	if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, leadID, tenantContext.UserID, "lead_created", fmt.Sprintf(`Lead "%s" foi criado`, input.Name), map[string]any{
		"source": input.Source,
		"origin": "vimob_api",
	}); err != nil {
		return CreateResult{}, err
	}

	if input.AssignedUserID != nil {
		if err := repo.insertNotification(ctx, tx, tenantContext.OrganizationID, *input.AssignedUserID, leadID, "Novo lead recebido", fmt.Sprintf("%s foi atribuido a voce", input.Name), "new_lead_received", map[string]any{
			"lead_name": input.Name,
			"source":    input.Source,
		}); err != nil {
			return CreateResult{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return CreateResult{}, err
	}

	lead, err := repo.Get(ctx, tenantContext, leadID)
	if err != nil {
		return CreateResult{}, err
	}

	return CreateResult{Lead: lead}, nil
}

func (repo Repository) registerReentry(ctx context.Context, tenantContext tenant.Context, input createInput, resolvedDestination destination, existingLead existingLeadMatch) (CreateResult, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return CreateResult{}, err
	}
	defer tx.Rollback(ctx)

	if err := repo.validateProperty(ctx, tx, tenantContext.OrganizationID, input.PropertyID); err != nil {
		return CreateResult{}, err
	}

	actorName, err := repo.getUserDisplayName(ctx, tx, tenantContext.UserID)
	if err != nil {
		return CreateResult{}, err
	}

	_, err = tx.Exec(ctx, `
		update public.leads
		set name = $3,
		    email = $4,
		    message = $5,
		    source = coalesce($6, source),
		    property_code = coalesce($7, property_code),
		    pipeline_id = coalesce($8::uuid, pipeline_id),
		    stage_entered_at = case
		      when $9::uuid is null or stage_id is not distinct from $9::uuid then stage_entered_at
		      else now()
		    end,
		    stage_id = coalesce($9::uuid, stage_id),
		    property_id = coalesce($10::uuid, property_id),
		    interest_property_id = coalesce($10::uuid, interest_property_id),
		    valor_interesse = coalesce($11::numeric, valor_interesse),
		    last_entry_at = now(),
		    reentry_count = coalesce(reentry_count, 0) + 1,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, existingLead.ID, input.Name, nullable(input.Email), nullable(input.Message), input.Source, nullable(input.PropertyCode), nullable(resolvedDestination.PipelineID), nullable(resolvedDestination.StageID), nullable(input.PropertyID), nullable(input.InterestValue))
	if err != nil {
		return CreateResult{}, err
	}

	_, err = tx.Exec(ctx, `
		insert into public.lead_entry_events (
			organization_id,
			lead_id,
			source,
			entry_type,
			property_id,
			valor_interesse,
			payload
		)
		values (
			$1::uuid,
			$2::uuid,
			$3,
			'manual_reentry',
			$4::uuid,
			$5::numeric,
			$6::jsonb
		)
	`, tenantContext.OrganizationID, existingLead.ID, input.Source, nullable(input.PropertyID), nullable(input.InterestValue), jsonb(map[string]any{
		"new_data": map[string]any{
			"name":          input.Name,
			"email":         nullable(input.Email),
			"message":       nullable(input.Message),
			"property_code": nullable(input.PropertyCode),
		},
		"origin": "vimob_api",
	}))
	if err != nil {
		return CreateResult{}, err
	}

	assignedUserName := existingLead.AssignedUserName
	if assignedUserName == "" {
		assignedUserName = "sem responsavel"
	}

	if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, existingLead.ID, tenantContext.UserID, "lead_reentry", fmt.Sprintf("Nova entrada manual registrada por %s. Lead mantido com %s.", actorName, assignedUserName), map[string]any{
		"entry_type":         "manual_reentry",
		"source":             input.Source,
		"actor_id":           tenantContext.UserID,
		"actor_name":         actorName,
		"assigned_user_id":   nullableString(existingLead.AssignedUserID),
		"assigned_user_name": assignedUserName,
		"kept_assignee":      true,
		"pipeline_id":        nullable(resolvedDestination.PipelineID),
		"stage_id":           nullable(resolvedDestination.StageID),
		"property_id":        nullable(input.PropertyID),
		"property_code":      nullable(input.PropertyCode),
	}); err != nil {
		return CreateResult{}, err
	}

	if existingLead.AssignedUserID != "" {
		if err := repo.insertNotification(ctx, tx, tenantContext.OrganizationID, existingLead.AssignedUserID, existingLead.ID, "Lead retornou", fmt.Sprintf("%s teve uma nova entrada", input.Name), "lead_reentry", map[string]any{
			"lead_name": input.Name,
			"source":    input.Source,
		}); err != nil {
			return CreateResult{}, err
		}
	}

	if err := repo.insertNotification(ctx, tx, tenantContext.OrganizationID, tenantContext.UserID, existingLead.ID, "Lead ja existia", fmt.Sprintf("Lead mantido com %s", assignedUserName), "lead_duplicate_existing", map[string]any{
		"lead_name":     input.Name,
		"assignee_name": assignedUserName,
		"source":        input.Source,
	}); err != nil {
		return CreateResult{}, err
	}

	if err := repo.linkWhatsAppConversations(ctx, tx, tenantContext.OrganizationID, existingLead.ID, input.Phone, input.ConversationID); err != nil {
		return CreateResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return CreateResult{}, err
	}

	lead, err := repo.Get(ctx, tenantContext, existingLead.ID)
	if err != nil {
		return CreateResult{}, err
	}

	return CreateResult{Lead: lead, Reentry: true, AssignedUserName: assignedUserName}, nil
}

func (repo Repository) resolveDestination(ctx context.Context, organizationID string, pipelineID *string, stageID *string) (destination, error) {
	if stageID != nil {
		var resolvedStageID string
		var resolvedPipelineID string

		err := repo.db.Pool().QueryRow(ctx, `
			select s.id::text, s.pipeline_id::text
			from public.stages s
			join public.pipelines p on p.id = s.pipeline_id
			where s.id = $1::uuid
			  and s.organization_id = $2::uuid
			  and p.organization_id = $2::uuid
			  and s.is_active = true
			  and p.is_active = true
			limit 1
		`, *stageID, organizationID).Scan(&resolvedStageID, &resolvedPipelineID)
		if errors.Is(err, pgx.ErrNoRows) {
			return destination{}, ErrInvalidReference
		}
		if err != nil {
			return destination{}, err
		}

		if pipelineID != nil && *pipelineID != resolvedPipelineID {
			return destination{}, ErrInvalidReference
		}

		return destination{PipelineID: &resolvedPipelineID, StageID: &resolvedStageID}, nil
	}

	if pipelineID != nil {
		var resolvedPipelineID string
		var resolvedStageID pgtype.Text

		err := repo.db.Pool().QueryRow(ctx, `
			select p.id::text, (
				select s.id::text
				from public.stages s
				where s.pipeline_id = p.id
				  and s.organization_id = p.organization_id
				  and s.is_active = true
				order by s.position asc, s.created_at asc
				limit 1
			)
			from public.pipelines p
			where p.id = $1::uuid
			  and p.organization_id = $2::uuid
			  and p.is_active = true
			limit 1
		`, *pipelineID, organizationID).Scan(&resolvedPipelineID, &resolvedStageID)
		if errors.Is(err, pgx.ErrNoRows) {
			return destination{}, ErrInvalidReference
		}
		if err != nil {
			return destination{}, err
		}

		if resolvedStageID.Valid {
			return destination{PipelineID: &resolvedPipelineID, StageID: &resolvedStageID.String}, nil
		}

		return destination{PipelineID: &resolvedPipelineID}, nil
	}

	var resolvedPipelineID pgtype.Text
	var resolvedStageID pgtype.Text

	err := repo.db.Pool().QueryRow(ctx, `
		select p.id::text, (
			select s.id::text
			from public.stages s
			where s.pipeline_id = p.id
			  and s.organization_id = p.organization_id
			  and s.is_active = true
			order by s.position asc, s.created_at asc
			limit 1
		)
		from public.pipelines p
		where p.organization_id = $1::uuid
		  and p.is_active = true
		order by p.is_default desc, p.position asc, p.created_at asc
		limit 1
	`, organizationID).Scan(&resolvedPipelineID, &resolvedStageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return destination{}, nil
	}
	if err != nil {
		return destination{}, err
	}

	out := destination{}
	if resolvedPipelineID.Valid {
		out.PipelineID = &resolvedPipelineID.String
	}
	if resolvedStageID.Valid {
		out.StageID = &resolvedStageID.String
	}

	return out, nil
}

func (repo Repository) validateAssignedUser(ctx context.Context, organizationID string, assignedUserID *string) error {
	if assignedUserID == nil {
		return nil
	}

	var exists bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.organization_members om
			join public.users u on u.id = om.user_id
			where om.organization_id = $1::uuid
			  and om.user_id = $2::uuid
			  and om.is_active = true
			  and u.is_active = true
		)
	`, organizationID, *assignedUserID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}

	return nil
}

func (repo Repository) selectRoundRobinMember(ctx context.Context, tx pgx.Tx, organizationID string, pipelineID string) (roundRobinSelection, string, error) {
	var roundRobinID string
	err := tx.QueryRow(ctx, `
		select id::text
		from public.round_robins
		where organization_id = $1::uuid
		  and is_active = true
		  and (pipeline_id is null or pipeline_id = $2::uuid)
		order by pipeline_id is null, created_at asc
		limit 1
	`, organizationID, nullableString(pipelineID)).Scan(&roundRobinID)
	if errors.Is(err, pgx.ErrNoRows) {
		return roundRobinSelection{}, "no_queue", nil
	}
	if err != nil {
		return roundRobinSelection{}, "", err
	}

	var selection roundRobinSelection
	selection.RoundRobinID = roundRobinID

	err = tx.QueryRow(ctx, `
		select rrm.id::text, rrm.user_id::text
		from public.round_robin_members rrm
		join public.organization_members om
		  on om.organization_id = rrm.organization_id
		 and om.user_id = rrm.user_id
		 and om.is_active = true
		join public.users u
		  on u.id = rrm.user_id
		 and u.is_active = true
		where rrm.organization_id = $1::uuid
		  and rrm.round_robin_id = $2::uuid
		  and rrm.is_active = true
		order by rrm.position asc, rrm.created_at asc
		limit 1
	`, organizationID, roundRobinID).Scan(&selection.MemberID, &selection.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return roundRobinSelection{}, "no_member", nil
	}
	if err != nil {
		return roundRobinSelection{}, "", err
	}

	return selection, "", nil
}

func (repo Repository) transferLeadAssignee(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, current leadSnapshot, assignedUserID *string, reason string) error {
	_, err := tx.Exec(ctx, `
		update public.leads
		set assigned_user_id = $3::uuid,
		    assigned_at = case when $3::uuid is null then null else now() end,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, current.ID, nullable(assignedUserID))
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
		insert into public.assignments_log (
			organization_id,
			lead_id,
			old_user_id,
			new_user_id,
			reason,
			created_by
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			$5,
			$6::uuid
		)
	`, tenantContext.OrganizationID, current.ID, nullableString(current.AssignedUserID), nullable(assignedUserID), reason, tenantContext.UserID)
	return err
}

func (repo Repository) validateProperty(ctx context.Context, tx pgx.Tx, organizationID string, propertyID *string) error {
	if propertyID == nil {
		return nil
	}

	var exists bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.properties
			where organization_id = $1::uuid
			  and id = $2::uuid
		)
	`, organizationID, *propertyID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}

	return nil
}

func (repo Repository) getLeadSnapshotForUpdate(ctx context.Context, tx pgx.Tx, organizationID string, leadID string) (leadSnapshot, error) {
	var snapshot leadSnapshot
	var phone, assignedUserID, pipelineID, stageID, lostReason, interestValue pgtype.Text

	err := tx.QueryRow(ctx, `
		select
			id::text,
			name,
			phone,
			assigned_user_id::text,
			pipeline_id::text,
			stage_id::text,
			deal_status,
			lost_reason,
			valor_interesse::text
		from public.leads
		where organization_id = $1::uuid
		  and id = $2::uuid
		limit 1
	`, organizationID, leadID).Scan(&snapshot.ID, &snapshot.Name, &phone, &assignedUserID, &pipelineID, &stageID, &snapshot.DealStatus, &lostReason, &interestValue)
	if errors.Is(err, pgx.ErrNoRows) {
		return leadSnapshot{}, ErrLeadNotFound
	}
	if err != nil {
		return leadSnapshot{}, err
	}

	snapshot.Phone = textValue(phone)
	snapshot.AssignedUserID = textValue(assignedUserID)
	snapshot.PipelineID = textValue(pipelineID)
	snapshot.StageID = textValue(stageID)
	snapshot.LostReason = textValue(lostReason)
	snapshot.InterestValue = textValue(interestValue)

	return snapshot, nil
}

func (repo Repository) canEditLead(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, assignedUserID string) (bool, error) {
	if canEditAllLeads(tenantContext) {
		return true, nil
	}

	if !tenantContext.HasPermission("lead_edit") {
		return false, nil
	}

	if assignedUserID != "" && assignedUserID == tenantContext.UserID {
		return true, nil
	}

	if assignedUserID == "" || !tenantContext.HasPermission("lead_view_team") {
		return false, nil
	}

	var canEditTeamLead bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.team_members leader
			join public.team_members member
			  on member.organization_id = leader.organization_id
			 and member.team_id = leader.team_id
			 and member.is_active = true
			where leader.organization_id = $1::uuid
			  and leader.user_id = $2::uuid
			  and leader.is_active = true
			  and leader.is_leader = true
			  and member.user_id = $3::uuid
		)
	`, tenantContext.OrganizationID, tenantContext.UserID, assignedUserID).Scan(&canEditTeamLead)
	if err != nil {
		return false, err
	}

	return canEditTeamLead, nil
}

func (repo Repository) applyDestinationAssignments(ctx context.Context, organizationID string, input updateInput, addUUIDAssignment func(string, patchString), addRawAssignment func(string)) error {
	if !input.PipelineID.Set && !input.StageID.Set {
		return nil
	}

	if input.StageID.Set {
		if input.StageID.Value == nil {
			addUUIDAssignment("stage_id", input.StageID)
			addRawAssignment("stage_entered_at = null")
			if input.PipelineID.Set {
				addUUIDAssignment("pipeline_id", input.PipelineID)
			}
			return nil
		}

		var pipelineID *string
		if input.PipelineID.Set {
			pipelineID = input.PipelineID.Value
		}

		resolvedDestination, err := repo.resolveDestination(ctx, organizationID, pipelineID, input.StageID.Value)
		if err != nil {
			return err
		}

		addUUIDAssignment("pipeline_id", patchString{Set: true, Value: resolvedDestination.PipelineID})
		addUUIDAssignment("stage_id", patchString{Set: true, Value: resolvedDestination.StageID})
		addRawAssignment("stage_entered_at = now()")
		return nil
	}

	if input.PipelineID.Value == nil {
		addUUIDAssignment("pipeline_id", input.PipelineID)
		addUUIDAssignment("stage_id", patchString{Set: true})
		addRawAssignment("stage_entered_at = null")
		return nil
	}

	resolvedDestination, err := repo.resolveDestination(ctx, organizationID, input.PipelineID.Value, nil)
	if err != nil {
		return err
	}

	addUUIDAssignment("pipeline_id", patchString{Set: true, Value: resolvedDestination.PipelineID})
	addUUIDAssignment("stage_id", patchString{Set: true, Value: resolvedDestination.StageID})
	if resolvedDestination.StageID != nil {
		addRawAssignment("stage_entered_at = now()")
	}

	return nil
}

func (repo Repository) findExistingLeadByPhone(ctx context.Context, organizationID string, phone *string) (*existingLeadMatch, error) {
	if phone == nil {
		return nil, nil
	}

	normalizedPhone := normalizePhone(*phone)
	if normalizedPhone == "" {
		return nil, nil
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			l.id::text,
			l.phone,
			l.assigned_user_id::text,
			u.name
		from public.leads l
		left join public.users u on u.id = l.assigned_user_id
		where l.organization_id = $1::uuid
		  and l.phone is not null
		  and l.phone ilike $2
		order by l.created_at asc
		limit 200
	`, organizationID, "%"+phoneTail(normalizedPhone)+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var match existingLeadMatch
		var phoneValue, assignedUserID, assignedUserName pgtype.Text
		if err := rows.Scan(&match.ID, &phoneValue, &assignedUserID, &assignedUserName); err != nil {
			return nil, err
		}

		match.Phone = textValue(phoneValue)
		match.AssignedUserID = textValue(assignedUserID)
		match.AssignedUserName = textValue(assignedUserName)

		if normalizePhone(match.Phone) == normalizedPhone {
			return &match, nil
		}
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return nil, nil
}

func (repo Repository) insertLeadTags(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, tagIDs []string) error {
	for _, tagID := range tagIDs {
		if _, err := repo.getTagName(ctx, tx, organizationID, tagID); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, `
			insert into public.lead_tags (
				organization_id,
				lead_id,
				tag_id
			)
			values (
				$1::uuid,
				$2::uuid,
				$3::uuid
			)
			on conflict (lead_id, tag_id) do nothing
		`, organizationID, leadID, tagID); err != nil {
			return err
		}
	}

	return nil
}

func (repo Repository) getTagName(ctx context.Context, tx pgx.Tx, organizationID string, tagID string) (string, error) {
	var name string
	err := tx.QueryRow(ctx, `
		select name
		from public.tags
		where organization_id = $1::uuid
		  and id = $2::uuid
		limit 1
	`, organizationID, tagID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrInvalidReference
	}
	if err != nil {
		return "", err
	}

	return name, nil
}

func (repo Repository) insertDealStatusActivities(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, current leadSnapshot, input updateInput) error {
	if !input.DealStatus.Set || input.DealStatus.Value == nil || *input.DealStatus.Value == current.DealStatus {
		return nil
	}

	newStatus := *input.DealStatus.Value
	lostReason := current.LostReason
	if input.LostReason.Set {
		lostReason = ""
		if input.LostReason.Value != nil {
			lostReason = *input.LostReason.Value
		}
	}

	interestValue := current.InterestValue
	if input.InterestValue.Set {
		interestValue = ""
		if input.InterestValue.Value != nil {
			interestValue = *input.InterestValue.Value
		}
	}

	content := fmt.Sprintf(`Lead "%s" reaberto`, current.Name)
	if newStatus == "won" {
		content = fmt.Sprintf(`Lead "%s" marcado como GANHO`, current.Name)
	}
	if newStatus == "lost" {
		content = fmt.Sprintf(`Lead "%s" marcado como PERDIDO`, current.Name)
		if lostReason != "" {
			content = content + " - Motivo: " + lostReason
		}
	}

	metadata := map[string]any{
		"new_status":      newStatus,
		"to_status":       newStatus,
		"previous_status": current.DealStatus,
		"valor_interesse": nullableString(interestValue),
	}
	if newStatus == "lost" && lostReason != "" {
		metadata["lost_reason"] = lostReason
	}

	if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, current.ID, tenantContext.UserID, "status_change", content, metadata); err != nil {
		return err
	}

	if newStatus != "won" {
		return nil
	}

	return repo.insertActivity(ctx, tx, tenantContext.OrganizationID, current.ID, tenantContext.UserID, "sale_closed", fmt.Sprintf(`Venda concluida para o lead "%s"`, current.Name), map[string]any{
		"new_status":      "won",
		"to_status":       "won",
		"valor_interesse": nullableString(interestValue),
	})
}

func (repo Repository) linkWhatsAppConversations(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, phone *string, conversationID *string) error {
	if conversationID != nil {
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_conversations
			set lead_id = $3::uuid,
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, organizationID, *conversationID, leadID); err != nil {
			return err
		}
	}

	if phone == nil {
		return nil
	}

	normalizedPhone := normalizePhone(*phone)
	if normalizedPhone == "" {
		return nil
	}

	rows, err := tx.Query(ctx, `
		select id::text, contact_phone
		from public.whatsapp_conversations
		where organization_id = $1::uuid
		  and lead_id is null
		  and contact_phone is not null
		  and contact_phone ilike $2
		limit 200
	`, organizationID, "%"+phoneTail(normalizedPhone)+"%")
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		var contactPhone pgtype.Text
		if err := rows.Scan(&id, &contactPhone); err != nil {
			return err
		}

		if normalizePhone(textValue(contactPhone)) != normalizedPhone {
			continue
		}

		if _, err := tx.Exec(ctx, `
			update public.whatsapp_conversations
			set lead_id = $3::uuid,
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and lead_id is null
		`, organizationID, id, leadID); err != nil {
			return err
		}
	}

	return rows.Err()
}

func (repo Repository) insertActivity(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, userID string, activityType string, content string, metadata map[string]any) error {
	_, err := tx.Exec(ctx, `
		insert into public.activities (
			organization_id,
			lead_id,
			user_id,
			type,
			content,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4,
			$5,
			$6::jsonb
		)
	`, organizationID, leadID, userID, activityType, content, jsonb(metadata))
	return err
}

func (repo Repository) insertNotification(ctx context.Context, tx pgx.Tx, organizationID string, userID string, leadID string, title string, content string, eventKey string, metadata map[string]any) error {
	if userID == "" {
		return nil
	}

	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["event_key"] = eventKey

	_, err := tx.Exec(ctx, `
		insert into public.notifications (
			organization_id,
			user_id,
			title,
			content,
			body,
			type,
			channel,
			lead_id,
			target_url,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3,
			$4,
			$4,
			'lead',
			'in_app',
			$5::uuid,
			$6,
			$7::jsonb
		)
	`, organizationID, userID, title, content, leadID, "/leads", jsonb(metadata))
	return err
}

func (repo Repository) getUserDisplayName(ctx context.Context, tx pgx.Tx, userID string) (string, error) {
	var name, email pgtype.Text
	err := tx.QueryRow(ctx, `
		select name, email
		from public.users
		where id = $1::uuid
	`, userID).Scan(&name, &email)
	if err != nil {
		return "", err
	}

	if value := textValue(name); value != "" {
		return value, nil
	}
	if value := textValue(email); value != "" {
		return value, nil
	}

	return userID, nil
}

func leadSelectFields() string {
	return `
		l.id::text,
		l.organization_id::text,
		l.name,
		l.email,
		l.phone,
		l.source,
		l.status,
		l.deal_status,
		l.priority,
		l.message,
		l.property_code,
		l.property_id::text,
		l.interest_property_id::text,
		l.pipeline_id::text,
		l.stage_id::text,
		l.assigned_user_id::text,
		l.valor_interesse::text,
		l.lost_reason,
		l.is_own_resource,
		l.reentry_count,
		l.cargo,
		l.empresa,
		l.profissao,
		l.endereco,
		l.bairro,
		l.numero,
		l.cep,
		l.cidade,
		l.uf,
		l.renda_familiar,
		l.faixa_valor_imovel,
		l.created_at,
		l.updated_at,
		l.stage_entered_at,
		l.last_contact_at,
		l.next_follow_up_at,
		s.id::text,
		s.name,
		s.color,
		s.stage_key,
		u.id::text,
		u.name,
		u.avatar_url`
}

func leadVisibilitySQL(canViewAllPlaceholder string, userIDPlaceholder string, canViewTeamPlaceholder string) string {
	return `(
		` + canViewAllPlaceholder + `::boolean
		or l.assigned_user_id = ` + userIDPlaceholder + `::uuid
		or (
			` + canViewTeamPlaceholder + `::boolean
			and l.assigned_user_id is not null
			and exists (
				select 1
				from public.team_members leader
				join public.team_members member
				  on member.organization_id = leader.organization_id
				 and member.team_id = leader.team_id
				 and member.is_active = true
				where leader.organization_id = l.organization_id
				  and leader.user_id = ` + userIDPlaceholder + `::uuid
				  and leader.is_active = true
				  and leader.is_leader = true
				  and member.user_id = l.assigned_user_id
			)
		)
	)`
}

func scanLeadWithTotal(row scanner) (Lead, int64, error) {
	var total int64
	lead, err := scanLeadFields(row, &total)
	return lead, total, err
}

func scanLead(row scanner) (Lead, error) {
	lead, err := scanLeadFields(row, nil)
	return lead, err
}

func scanLeadFields(row scanner, total *int64) (Lead, error) {
	var lead Lead
	var email, phone, priority, message, propertyCode, propertyID, interestPropertyID pgtype.Text
	var pipelineID, stageID, assignedUserID, interestValue pgtype.Text
	var lostReason pgtype.Text
	var isOwnResource pgtype.Bool
	var cargo, empresa, profissao, endereco, bairro, numero, cep, cidade, uf, rendaFamiliar, faixaValorImovel pgtype.Text
	var stageEnteredAt, lastContactAt, nextFollowUpAt pgtype.Timestamptz
	var stageIDValue, stageName, stageColor, stageKey pgtype.Text
	var assigneeID, assigneeName, assigneeAvatarURL pgtype.Text

	dest := []any{
		&lead.ID,
		&lead.OrganizationID,
		&lead.Name,
		&email,
		&phone,
		&lead.Source,
		&lead.Status,
		&lead.DealStatus,
		&priority,
		&message,
		&propertyCode,
		&propertyID,
		&interestPropertyID,
		&pipelineID,
		&stageID,
		&assignedUserID,
		&interestValue,
		&lostReason,
		&isOwnResource,
		&lead.ReentryCount,
		&cargo,
		&empresa,
		&profissao,
		&endereco,
		&bairro,
		&numero,
		&cep,
		&cidade,
		&uf,
		&rendaFamiliar,
		&faixaValorImovel,
		&lead.CreatedAt,
		&lead.UpdatedAt,
		&stageEnteredAt,
		&lastContactAt,
		&nextFollowUpAt,
		&stageIDValue,
		&stageName,
		&stageColor,
		&stageKey,
		&assigneeID,
		&assigneeName,
		&assigneeAvatarURL,
	}

	if total != nil {
		dest = append([]any{total}, dest...)
	}

	if err := row.Scan(dest...); err != nil {
		return Lead{}, err
	}

	lead.Email = textValue(email)
	lead.Phone = textValue(phone)
	lead.Priority = textValueWithDefault(priority, "normal")
	lead.Message = textValue(message)
	lead.PropertyCode = textValue(propertyCode)
	lead.PropertyID = textValue(propertyID)
	lead.InterestPropertyID = textValue(interestPropertyID)
	lead.PipelineID = textValue(pipelineID)
	lead.StageID = textValue(stageID)
	lead.AssignedUserID = textValue(assignedUserID)
	lead.InterestValue = textValue(interestValue)
	lead.LostReason = textValue(lostReason)
	lead.IsOwnResource = boolPtr(isOwnResource)
	lead.StageEnteredAt = timePtr(stageEnteredAt)
	lead.LastContactAt = timePtr(lastContactAt)
	lead.NextFollowUpAt = timePtr(nextFollowUpAt)
	lead.AdditionalFields = additionalFields(cargo, empresa, profissao, endereco, bairro, numero, cep, cidade, uf, rendaFamiliar, faixaValorImovel)

	if stageIDValue.Valid {
		lead.Stage = &Stage{
			ID:       stageIDValue.String,
			Name:     textValue(stageName),
			Color:    textValue(stageColor),
			StageKey: textValue(stageKey),
		}
	}

	if assigneeID.Valid {
		lead.Assignee = &Assignee{
			ID:        assigneeID.String,
			Name:      textValue(assigneeName),
			AvatarURL: textValue(assigneeAvatarURL),
		}
	}

	return lead, nil
}

func additionalFields(values ...pgtype.Text) LeadMetadata {
	keys := []string{"cargo", "empresa", "profissao", "endereco", "bairro", "numero", "cep", "cidade", "uf", "rendaFamiliar", "faixaValorImovel"}
	fields := LeadMetadata{}

	for index, value := range values {
		if value.Valid && value.String != "" {
			fields[keys[index]] = value.String
		}
	}

	if len(fields) == 0 {
		return nil
	}

	return fields
}

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}

	return value.String
}

func textValueWithDefault(value pgtype.Text, fallback string) string {
	if !value.Valid || value.String == "" {
		return fallback
	}

	return value.String
}

func timePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}

	return &value.Time
}

func boolPtr(value pgtype.Bool) *bool {
	if !value.Valid {
		return nil
	}

	return &value.Bool
}

func nullable(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}

	return *value
}

func nullableBool(value *bool) any {
	if value == nil {
		return nil
	}

	return *value
}

func nullableTime(value *time.Time) any {
	if value == nil {
		return nil
	}

	return *value
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}

	return value
}

func nullablePatchString(value patchString) any {
	if !value.Set || value.Value == nil || strings.TrimSpace(*value.Value) == "" {
		return nil
	}

	return *value.Value
}

func nullablePatchBool(value patchBool) any {
	if !value.Set || value.Value == nil {
		return nil
	}

	return *value.Value
}

func jsonb(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}

	return string(payload)
}

func normalizePhone(value string) string {
	var builder strings.Builder
	for _, char := range value {
		if unicode.IsDigit(char) {
			builder.WriteRune(char)
		}
	}

	digits := builder.String()
	if len(digits) >= 12 && strings.HasPrefix(digits, "55") {
		return digits[2:]
	}

	return digits
}

func phoneTail(normalizedPhone string) string {
	if len(normalizedPhone) < 4 {
		return normalizedPhone
	}

	return normalizedPhone[len(normalizedPhone)-4:]
}

func canViewAllLeads(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin", "manager") ||
		tenantContext.HasPermission("lead_view_all")
}

func canManageLeads(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin", "manager") ||
		tenantContext.HasPermission("lead_manage")
}

func canEditAllLeads(tenantContext tenant.Context) bool {
	return canManageLeads(tenantContext) ||
		tenantContext.HasPermission("lead_edit_all")
}

func canAssignLeads(tenantContext tenant.Context) bool {
	return canManageLeads(tenantContext) ||
		tenantContext.HasPermission("lead_assign") ||
		tenantContext.HasPermission("lead_transfer")
}

func canMoveLead(tenantContext tenant.Context, assignedUserID string) bool {
	return canManageLeads(tenantContext) ||
		(assignedUserID != "" && assignedUserID == tenantContext.UserID)
}

func canTransferLead(tenantContext tenant.Context, assignedUserID string) bool {
	return canAssignLeads(tenantContext) ||
		(assignedUserID != "" && assignedUserID == tenantContext.UserID)
}

func canDeleteLeads(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.HasPermission("lead_delete")
}
