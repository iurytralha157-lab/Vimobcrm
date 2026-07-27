package leads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/authorization"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/searchtext"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type GamificationRecorder interface {
	RecordAction(ctx context.Context, tenantContext tenant.Context, actionType string, quantity int, referenceID string) error
}

type Repository struct {
	db                   *dbpkg.Postgres
	storage              storageClient
	evolutionGoAPIURL    string
	evolutionGoAPIKey    string
	notificationEmail    notificationEmailClient
	notificationPush     *notificationPushClient
	gamificationRecorder GamificationRecorder
}

type scanner interface {
	Scan(dest ...any) error
}

type leadTeamQueryer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type destination struct {
	PipelineID *string
	StageID    *string
	StageName  *string
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
	TeamID           string
	Phone            string
	AssignedUserID   string
	AssignedUserName string
}

type leadSnapshot struct {
	ID                 string
	TeamID             string
	Name               string
	Phone              string
	AssignedUserID     string
	PipelineID         string
	StageID            string
	StageName          string
	DealStatus         string
	LostReason         string
	InterestValue      string
	PropertyID         string
	InterestPropertyID string
	PropertyCode       string
	Data               map[string]any
}

func NewRepository(db *dbpkg.Postgres, gamificationRecorder GamificationRecorder, storageConfigs ...StorageConfig) Repository {
	repository := Repository{db: db, gamificationRecorder: gamificationRecorder}
	if len(storageConfigs) > 0 {
		repository.storage = newStorageClient(storageConfigs[0])
		repository.evolutionGoAPIURL = strings.TrimRight(strings.TrimSpace(storageConfigs[0].EvolutionGo.APIURL), "/")
		repository.evolutionGoAPIKey = strings.TrimSpace(storageConfigs[0].EvolutionGo.APIKey)
		repository.notificationEmail = newNotificationEmailClient(storageConfigs[0].Email)
		repository.notificationPush = newNotificationPushClient(storageConfigs[0].Push)
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
		leadVisibilitySQL("$2", "$3", "$4", tenantContext.HasPermission(permissions.LeadViewOwn)),
	}

	addFilter := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if strings.TrimSpace(filter.StageID) != "" {
		stageID, ok := normalizeUUID(filter.StageID)
		if !ok {
			return ListResponse{}, fmt.Errorf("%w: stageId is invalid", ErrInvalidInput)
		}
		addFilter("l.stage_id = $%d::uuid", stageID)
	}
	if filter.Unassigned {
		where = append(where, "l.assigned_user_id is null")
	} else if strings.TrimSpace(filter.AssignedUserID) != "" {
		assignedUserID, ok := normalizeUUID(filter.AssignedUserID)
		if !ok {
			return ListResponse{}, fmt.Errorf("%w: assignedUserId is invalid", ErrInvalidInput)
		}
		addFilter("l.assigned_user_id = $%d::uuid", assignedUserID)
	}
	if filter.DealStatus != "" {
		addFilter("l.deal_status = $%d", filter.DealStatus)
	}
	if filter.Search != "" {
		args = append(args, searchtext.Pattern(filter.Search))
		index := len(args)
		where = append(where, searchtext.AnySQL([]string{"l.name", "l.phone", "l.email"}, fmt.Sprintf("$%d", index)))
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
		  and ` + leadVisibilitySQL("$2", "$3", "$4", tenantContext.HasPermission(permissions.LeadViewOwn)) + `
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

func (repo Repository) GetSensitiveProfile(ctx context.Context, tenantContext tenant.Context, leadID string) (SensitiveLeadProfile, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return SensitiveLeadProfile{}, ErrLeadNotFound
	}

	lead, err := repo.Get(ctx, tenantContext, leadID)
	if err != nil {
		return SensitiveLeadProfile{}, err
	}
	if !authorization.CanOperateLead(tenantContext, authorization.LeadResource{
		AssignedUserID: lead.AssignedUserID,
		TeamID:         lead.TeamID,
	}) {
		return SensitiveLeadProfile{}, tenant.ErrOrganizationAccessDenied
	}

	var cpf, rg pgtype.Text
	err = repo.db.Pool().QueryRow(ctx, `
		select
			nullif(metadata #>> '{profile,cpf}', ''),
			nullif(metadata #>> '{profile,rg}', '')
		from public.leads
		where organization_id = $1::uuid
		  and id = $2::uuid
		limit 1
	`, tenantContext.OrganizationID, leadID).Scan(&cpf, &rg)
	if errors.Is(err, pgx.ErrNoRows) {
		return SensitiveLeadProfile{}, ErrLeadNotFound
	}
	if err != nil {
		return SensitiveLeadProfile{}, err
	}

	return SensitiveLeadProfile{CPF: textValue(cpf), RG: textValue(rg)}, nil
}

func (repo Repository) Create(ctx context.Context, tenantContext tenant.Context, input createInput) (CreateResult, error) {
	if !canCreateLeadInput(tenantContext, input) {
		return CreateResult{}, tenant.ErrOrganizationAccessDenied
	}
	if !canAssignLeads(tenantContext) {
		if input.AssignedUserID == nil || strings.TrimSpace(*input.AssignedUserID) == "" {
			assignedUserID := tenantContext.UserID
			input.AssignedUserID = &assignedUserID
		} else if strings.TrimSpace(*input.AssignedUserID) != tenantContext.UserID {
			return CreateResult{}, tenant.ErrOrganizationAccessDenied
		}
	}

	resolvedDestination, err := repo.resolveDestination(ctx, tenantContext.OrganizationID, input.PipelineID, input.StageID)
	if err != nil {
		return CreateResult{}, err
	}

	if err := repo.validateAssignedUser(ctx, tenantContext.OrganizationID, input.AssignedUserID); err != nil {
		return CreateResult{}, err
	}
	if err := repo.validateLeadTeam(ctx, tenantContext, input.TeamID); err != nil {
		return CreateResult{}, err
	}

	existingLead, err := repo.findExistingLeadByPhone(ctx, tenantContext.OrganizationID, input.Phone)
	if err != nil {
		return CreateResult{}, err
	}
	if existingLead != nil {
		return repo.registerReentry(ctx, tenantContext, input, resolvedDestination, *existingLead)
	}

	result, err := repo.createNewLead(ctx, tenantContext, input, resolvedDestination)
	if err == nil {
		return result, nil
	}

	if isLeadPhoneUniqueViolation(err) {
		existingLead, lookupErr := repo.findExistingLeadByPhone(ctx, tenantContext.OrganizationID, input.Phone)
		if lookupErr != nil {
			return CreateResult{}, lookupErr
		}
		if existingLead != nil {
			return repo.registerReentry(ctx, tenantContext, input, resolvedDestination, *existingLead)
		}
	}

	return CreateResult{}, err
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

	canEdit, err := repo.canEditLead(ctx, tx, tenantContext, current.AssignedUserID, current.TeamID)
	if err != nil {
		return Lead{}, err
	}

	canOperationalPatch := canUpdateAssignedLeadOperationalPatch(tenantContext, current, input)
	if !canEdit && !canOperationalPatch {
		return Lead{}, tenant.ErrOrganizationAccessDenied
	}

	if err := validateLostReasonContract(current, input); err != nil {
		return Lead{}, err
	}
	if err := repo.applySelectedPropertyCommercialValues(ctx, tx, tenantContext.OrganizationID, current, &input); err != nil {
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

	if input.TeamID.Set {
		if !canAssignLeads(tenantContext) {
			return Lead{}, tenant.ErrOrganizationAccessDenied
		}
		if err := repo.validateLeadTeam(ctx, tenantContext, input.TeamID.Value); err != nil {
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
	if err := repo.validateRoundRobinAssigneeTeam(ctx, tx, tenantContext.OrganizationID, nextTeamID, optionalString(nextAssignedUserID, 36)); err != nil {
		return Lead{}, err
	}

	if err := repo.applyDestinationAssignments(ctx, tenantContext.OrganizationID, current, input, addUUIDAssignment, addRawAssignment); err != nil {
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
	if input.InterestPropertyIDs.Set {
		for _, propertyID := range input.InterestPropertyIDs.Value {
			if err := repo.validateProperty(ctx, tx, tenantContext.OrganizationID, &propertyID); err != nil {
				return Lead{}, err
			}
		}
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
		if isLeadPhoneUniqueViolation(err) {
			return Lead{}, ErrLeadPhoneConflict
		}
		return Lead{}, err
	}

	oldAuditData, newAuditData := changedLeadAuditData(current.Data, input.auditData())
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

	if err := repo.reserveWonLeadProperty(ctx, tx, tenantContext, current, input); err != nil {
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

	updatedLead, err := repo.getLeadForMutation(ctx, tx, tenantContext.OrganizationID, updatedID)
	if err != nil {
		return Lead{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Lead{}, err
	}

	repo.dispatchDealStatusSideEffects(tenantContext, current, input)

	return updatedLead, nil
}

func (repo Repository) dispatchDealStatusSideEffects(tenantContext tenant.Context, current leadSnapshot, input updateInput) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		repo.dispatchDealWonNotification(ctx, tenantContext, current, input)
		repo.recordDealStatusGamification(ctx, tenantContext, current, input)
	}()
}

func (repo Repository) MoveStage(ctx context.Context, tenantContext tenant.Context, leadID string, input moveStageInput) (moveStageResult, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return moveStageResult{}, ErrLeadNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return moveStageResult{}, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, leadID)
	if err != nil {
		return moveStageResult{}, err
	}

	if !canOperateLeadSnapshot(tenantContext, current) {
		return moveStageResult{}, tenant.ErrOrganizationAccessDenied
	}

	resolvedDestination, err := repo.resolveDestination(ctx, tenantContext.OrganizationID, nil, &input.StageID)
	if err != nil {
		return moveStageResult{}, err
	}
	if resolvedDestination.PipelineID == nil || resolvedDestination.StageID == nil {
		return moveStageResult{}, ErrInvalidReference
	}

	stageChanged := current.StageID != *resolvedDestination.StageID
	boardOrderAt := input.BoardOrderAt
	if boardOrderAt == nil {
		// Compatibility with clients deployed before boardOrderAt existed: their
		// stageEnteredAt value represented card order, not the real stage clock.
		boardOrderAt = input.StageEnteredAt
	}

	var updatedID string
	var persistedStageEnteredAt *time.Time
	var persistedBoardOrderAt time.Time
	if stageChanged {
		var stageEnteredAt time.Time
		err = tx.QueryRow(ctx, `
			update public.leads
			set stage_id = $3::uuid,
			    pipeline_id = $4::uuid,
			    stage_entered_at = now(),
			    board_order_at = coalesce($5::timestamptz, now()),
			    is_own_resource = coalesce($6::boolean, is_own_resource),
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			returning id::text, stage_entered_at, board_order_at
		`, tenantContext.OrganizationID, leadID, *resolvedDestination.StageID, *resolvedDestination.PipelineID, nullableTime(boardOrderAt), nullableBool(input.IsOwnResource)).Scan(&updatedID, &stageEnteredAt, &persistedBoardOrderAt)
		persistedStageEnteredAt = &stageEnteredAt
	} else {
		err = tx.QueryRow(ctx, `
			update public.leads
			set board_order_at = coalesce($3::timestamptz, board_order_at, stage_entered_at, created_at)
			where organization_id = $1::uuid
			  and id = $2::uuid
			returning id::text, board_order_at
		`, tenantContext.OrganizationID, leadID, nullableTime(boardOrderAt)).Scan(&updatedID, &persistedBoardOrderAt)
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return moveStageResult{}, ErrLeadNotFound
		}
		return moveStageResult{}, err
	}

	auditAction := "reorder_lead"
	newData := map[string]any{
		"stage_id":       *resolvedDestination.StageID,
		"board_order_at": persistedBoardOrderAt,
		"origin":         "vimob_api",
	}
	if stageChanged {
		auditAction = "move_stage"
		newData["pipeline_id"] = *resolvedDestination.PipelineID
		newData["is_own_resource"] = nullableBool(input.IsOwnResource)
		newData["stage_entered_at"] = persistedStageEnteredAt
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
			$3::text,
			'lead',
			$4::uuid,
			$5::jsonb,
			$6::jsonb
		)
	`, tenantContext.OrganizationID, tenantContext.UserID, auditAction, updatedID, jsonb(map[string]any{
		"pipeline_id": nullableString(current.PipelineID),
		"stage_id":    nullableString(current.StageID),
	}), jsonb(newData)); err != nil {
		return moveStageResult{}, err
	}

	if stageChanged {
		if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, updatedID, tenantContext.UserID, "stage_change", fmt.Sprintf(`Lead "%s" movido de etapa`, current.Name), map[string]any{
			"from_stage_id": nullableString(current.StageID),
			"to_stage_id":   *resolvedDestination.StageID,
			"from_stage":    nullableString(current.StageName),
			"to_stage":      nullable(resolvedDestination.StageName),
			"from_pipeline": nullableString(current.PipelineID),
			"to_pipeline":   *resolvedDestination.PipelineID,
		}); err != nil {
			return moveStageResult{}, err
		}
	}

	updatedLead, err := repo.getLeadForMutation(ctx, tx, tenantContext.OrganizationID, updatedID)
	if err != nil {
		return moveStageResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return moveStageResult{}, err
	}

	return moveStageResult{Lead: updatedLead, StageChanged: stageChanged}, nil
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

	if !canOperateLeadSnapshot(tenantContext, current) {
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

	updatedLead, err := repo.getLeadForMutation(ctx, tx, tenantContext.OrganizationID, leadID)
	if err != nil {
		return Lead{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Lead{}, err
	}

	return updatedLead, nil
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

	if !canOperateLeadSnapshot(tenantContext, current) {
		return RoundRobinResult{}, tenant.ErrOrganizationAccessDenied
	}

	result := RoundRobinResult{
		Success:    true,
		LeadID:     current.ID,
		PipelineID: current.PipelineID,
		StageID:    current.StageID,
	}

	selection, reason, err := repo.selectRoundRobinMember(ctx, tx, tenantContext.OrganizationID, current.PipelineID, current.TeamID)
	if err != nil {
		return RoundRobinResult{}, err
	}
	if reason != "" {
		result.Error = reason
		return result, tx.Commit(ctx)
	}

	assignedUserID := selection.UserID
	if err := repo.validateRoundRobinAssigneeTeam(ctx, tx, tenantContext.OrganizationID, current.TeamID, &assignedUserID); err != nil {
		return RoundRobinResult{}, err
	}
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
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, leadID)
	if err != nil {
		return err
	}
	if !authorization.CanDeleteLead(tenantContext, authorization.LeadResource{AssignedUserID: current.AssignedUserID, TeamID: current.TeamID}) {
		return tenant.ErrOrganizationAccessDenied
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

	canEdit, err := repo.canEditLead(ctx, tx, tenantContext, current.AssignedUserID, current.TeamID)
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

	canEdit, err := repo.canEditLead(ctx, tx, tenantContext, current.AssignedUserID, current.TeamID)
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
	for _, propertyID := range input.InterestPropertyIDs {
		propertyID := propertyID
		if err := repo.validateProperty(ctx, tx, tenantContext.OrganizationID, &propertyID); err != nil {
			return CreateResult{}, err
		}
	}

	var leadID string
	err = tx.QueryRow(ctx, `
		with inserted as (
			insert into public.leads (
				organization_id,
				pipeline_id,
				stage_id,
				assigned_user_id,
				team_id,
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
				stage_entered_at,
				board_order_at,
				feedback,
				metadata
			)
			values (
				$1::uuid,
				$2::uuid,
				$3::uuid,
				$4::uuid,
				$5::uuid,
				case when $4::uuid is null then null else now() end,
				$6::uuid,
				$6::uuid,
				$7,
				$8,
				$9,
				$10,
				$11,
				$12,
				$13::numeric,
				$14,
				$15,
				case when $14 = 'lost' then now() else null end,
				case when $14 = 'won' then now() else null end,
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
				$27,
				$28::uuid,
				case when $3::uuid is null then null else now() end,
				case when $3::uuid is null then null else now() end,
				$29,
				$30::jsonb
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
				$28::uuid,
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
		nullable(input.TeamID),
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
		nullable(input.Feedback),
		jsonb(input.Metadata),
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

	initialFeedback := input.Feedback
	if initialFeedback == nil {
		initialFeedback = input.Message
	}
	if err := repo.insertInitialFeedbackActivity(ctx, tx, tenantContext.OrganizationID, leadID, tenantContext.UserID, initialFeedback, "lead_create"); err != nil {
		return CreateResult{}, err
	}

	if input.AssignedUserID != nil {
		if err := repo.insertNotification(ctx, tx, tenantContext.OrganizationID, *input.AssignedUserID, leadID, "Novo lead recebido", fmt.Sprintf("%s foi atribuido a voce", input.Name), "new_lead_received", map[string]any{
			"lead_name":  input.Name,
			"source":     input.Source,
			"dedupe_key": notificationDedupeKey("new_lead_received", leadID, *input.AssignedUserID),
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
	canViewExisting := authorization.CanViewLead(tenantContext, authorization.LeadResource{
		AssignedUserID: existingLead.AssignedUserID,
		TeamID:         existingLead.TeamID,
	})
	if !canViewExisting {
		return CreateResult{}, ErrLeadAlreadyExists
	}

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
		    source = coalesce(source, $6),
		    property_code = coalesce($7, property_code),
		    pipeline_id = coalesce($8::uuid, pipeline_id),
		    stage_entered_at = case
		      when $9::uuid is null or stage_id is not distinct from $9::uuid then stage_entered_at
		      else now()
		    end,
		    board_order_at = case
		      when $9::uuid is null or stage_id is not distinct from $9::uuid then coalesce(board_order_at, stage_entered_at, created_at)
		      else now()
		    end,
		    stage_id = coalesce($9::uuid, stage_id),
		    property_id = coalesce($10::uuid, property_id),
		    interest_property_id = coalesce($10::uuid, interest_property_id),
		    valor_interesse = coalesce($11::numeric, valor_interesse),
		    deal_status = $12,
		    lost_reason = case when $12 = 'lost' then $13 else null end,
		    lost_at = case when $12 = 'lost' then coalesce(lost_at, now()) else null end,
		    won_at = case when $12 = 'won' then coalesce(won_at, now()) else null end,
		    last_entry_at = now(),
		    reentry_count = coalesce(reentry_count, 0) + 1,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, existingLead.ID, input.Name, nullable(input.Email), nullable(input.Message), input.Source, nullable(input.PropertyCode), nullable(resolvedDestination.PipelineID), nullable(resolvedDestination.StageID), nullable(input.PropertyID), nullable(input.InterestValue), input.DealStatus, nullable(input.LostReason))
	if err != nil {
		return CreateResult{}, err
	}

	_, err = tx.Exec(ctx, `
		insert into public.lead_entry_events (
			organization_id,
			lead_id,
			source,
			provider,
			occurred_at,
			is_countable,
			source_detail,
			entry_type,
			property_id,
			valor_interesse,
			pipeline_id,
			stage_id,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3,
			'manual',
			now(),
			true,
			'vimob_api',
			'reentry',
			$4::uuid,
			$5::numeric,
			$6::uuid,
			$7::uuid,
			$8::jsonb
		)
	`, tenantContext.OrganizationID, existingLead.ID, input.Source, nullable(input.PropertyID), nullable(input.InterestValue), nullable(resolvedDestination.PipelineID), nullable(resolvedDestination.StageID), jsonb(map[string]any{
		"new_data": map[string]any{
			"name":          input.Name,
			"email":         nullable(input.Email),
			"message":       nullable(input.Message),
			"property_code": nullable(input.PropertyCode),
			"deal_status":   input.DealStatus,
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
		"deal_status":        input.DealStatus,
	}); err != nil {
		return CreateResult{}, err
	}

	if err := repo.insertInitialFeedbackActivity(ctx, tx, tenantContext.OrganizationID, existingLead.ID, tenantContext.UserID, input.Message, "lead_reentry"); err != nil {
		return CreateResult{}, err
	}

	if existingLead.AssignedUserID != "" {
		if err := repo.insertNotification(ctx, tx, tenantContext.OrganizationID, existingLead.AssignedUserID, existingLead.ID, "Lead retornou", fmt.Sprintf("%s teve uma nova entrada", input.Name), "lead_reentry", map[string]any{
			"lead_name": input.Name,
			"source":    input.Source,
			"entry_at":  time.Now().UTC().Format(time.RFC3339Nano),
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
		var resolvedStageName string

		err := repo.db.Pool().QueryRow(ctx, `
			select s.id::text, s.pipeline_id::text, s.name
			from public.stages s
			join public.pipelines p on p.id = s.pipeline_id
			where s.id = $1::uuid
			  and s.organization_id = $2::uuid
			  and p.organization_id = $2::uuid
			  and s.is_active = true
			  and p.is_active = true
			limit 1
		`, *stageID, organizationID).Scan(&resolvedStageID, &resolvedPipelineID, &resolvedStageName)
		if errors.Is(err, pgx.ErrNoRows) {
			return destination{}, ErrInvalidReference
		}
		if err != nil {
			return destination{}, err
		}

		if pipelineID != nil && *pipelineID != resolvedPipelineID {
			return destination{}, ErrInvalidReference
		}

		return destination{PipelineID: &resolvedPipelineID, StageID: &resolvedStageID, StageName: &resolvedStageName}, nil
	}

	if pipelineID != nil {
		var resolvedPipelineID string
		var resolvedStageID pgtype.Text
		var resolvedStageName pgtype.Text

		err := repo.db.Pool().QueryRow(ctx, `
			select p.id::text, (
				select s.id::text
				from public.stages s
				where s.pipeline_id = p.id
				  and s.organization_id = p.organization_id
				  and s.is_active = true
				order by s.position asc, s.created_at asc
				limit 1
			), (
				select s.name
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
		`, *pipelineID, organizationID).Scan(&resolvedPipelineID, &resolvedStageID, &resolvedStageName)
		if errors.Is(err, pgx.ErrNoRows) {
			return destination{}, ErrInvalidReference
		}
		if err != nil {
			return destination{}, err
		}

		if resolvedStageID.Valid {
			return destination{PipelineID: &resolvedPipelineID, StageID: &resolvedStageID.String, StageName: textPointer(resolvedStageName)}, nil
		}

		return destination{PipelineID: &resolvedPipelineID}, nil
	}

	var resolvedPipelineID pgtype.Text
	var resolvedStageID pgtype.Text
	var resolvedStageName pgtype.Text

	err := repo.db.Pool().QueryRow(ctx, `
		select p.id::text, (
			select s.id::text
			from public.stages s
			where s.pipeline_id = p.id
			  and s.organization_id = p.organization_id
			  and s.is_active = true
			order by s.position asc, s.created_at asc
			limit 1
		), (
			select s.name
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
	`, organizationID).Scan(&resolvedPipelineID, &resolvedStageID, &resolvedStageName)
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
	if resolvedStageName.Valid && strings.TrimSpace(resolvedStageName.String) != "" {
		out.StageName = &resolvedStageName.String
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

func (repo Repository) validateLeadTeam(ctx context.Context, tenantContext tenant.Context, teamID *string) error {
	if teamID == nil {
		return nil
	}
	if !canViewAllLeads(tenantContext) && !tenantContext.LeadsTeam(*teamID) {
		return tenant.ErrOrganizationAccessDenied
	}

	var teamExists bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.teams t
			where t.organization_id = $1::uuid
			  and t.id = $2::uuid
			  and coalesce(t.is_active, true) = true
		)
	`, tenantContext.OrganizationID, *teamID).Scan(&teamExists)
	if err != nil {
		return err
	}
	if !teamExists {
		return ErrInvalidReference
	}
	return nil
}

func (repo Repository) selectRoundRobinMember(ctx context.Context, tx pgx.Tx, organizationID string, pipelineID string, requiredTeamID string) (roundRobinSelection, string, error) {
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
		with entries as (
			select
				rrm.id,
				rrm.round_robin_id,
				rrm.organization_id,
				rrm.user_id,
				rrm.team_id,
				coalesce(rrm.position, 0) as position,
				rrm.created_at,
				coalesce(entry_logs.total, 0) as entry_total
			from public.round_robin_members rrm
			join public.round_robins rr
			  on rr.id = rrm.round_robin_id
			 and rr.organization_id = rrm.organization_id
			left join lateral (
			  select count(*)::bigint as total
			  from public.round_robin_logs rrl
			  where rrl.organization_id = rrm.organization_id
			    and rrl.round_robin_id = rrm.round_robin_id
			    and (
			      rrl.metadata->>'member_id' = rrm.id::text
			      or (rrm.user_id is not null and rrl.assigned_user_id = rrm.user_id)
			    )
			) entry_logs on true
			where rrm.organization_id = $1::uuid
			  and rrm.round_robin_id = $2::uuid
			  and coalesce(rrm.is_active, true) = true
		),
		candidates as (
			select
				entries.id,
				entries.round_robin_id,
				entries.organization_id,
				entries.user_id,
				entries.position,
				entries.created_at,
				entries.entry_total,
				tm.id as team_member_id,
				tm.created_at as team_member_created_at
			from entries
			left join public.team_members tm
			  on tm.organization_id = entries.organization_id
			 and tm.team_id = entries.team_id
			 and tm.user_id = entries.user_id
			 and coalesce(tm.is_active, true) = true
			where entries.user_id is not null

			union all

			select
				entries.id,
				entries.round_robin_id,
				entries.organization_id,
				tm.user_id,
				entries.position,
				entries.created_at,
				entries.entry_total,
				tm.id as team_member_id,
				tm.created_at as team_member_created_at
			from entries
			join public.teams t
			  on t.id = entries.team_id
			 and t.organization_id = entries.organization_id
			 and coalesce(t.is_active, true) = true
			join public.team_members tm
			  on tm.organization_id = entries.organization_id
			 and tm.team_id = entries.team_id
			 and coalesce(tm.is_active, true) = true
			where entries.user_id is null
			  and entries.team_id is not null
		)
		select candidates.id::text, candidates.user_id::text
		from candidates
		join public.organization_members om
		  on om.organization_id = candidates.organization_id
		 and om.user_id = candidates.user_id
		 and om.is_active = true
		join public.users u
		  on u.id = candidates.user_id
		 and u.is_active = true
		left join lateral (
		  select count(*)::bigint as total
		  from public.round_robin_logs rrl
		  where rrl.organization_id = candidates.organization_id
		    and rrl.round_robin_id = candidates.round_robin_id
		    and rrl.assigned_user_id = candidates.user_id
		) user_logs on true
		where (
		    nullif($3, '')::uuid is null
		    or exists (
		      select 1
		      from public.team_members required_member
		      where required_member.organization_id = candidates.organization_id
		        and required_member.team_id = nullif($3, '')::uuid
		        and required_member.user_id = candidates.user_id
		        and coalesce(required_member.is_active, true) = true
		    )
		  )
		  and (
		    candidates.team_member_id is null
		    or not exists (
		      select 1
		      from public.member_availability ma_any
		      where ma_any.organization_id = candidates.organization_id
		        and ma_any.team_member_id = candidates.team_member_id
		    )
		    or exists (
		      select 1
		      from public.member_availability ma
		      where ma.organization_id = candidates.organization_id
		        and ma.team_member_id = candidates.team_member_id
		        and ma.day_of_week = extract(dow from now() at time zone 'America/Sao_Paulo')::int
		        and coalesce(ma.is_active, true) = true
		        and (
		          coalesce(ma.is_all_day, false) = true
		          or (
		            ma.start_time is not null
		            and ma.end_time is not null
		            and (
		              (ma.start_time <= ma.end_time and (now() at time zone 'America/Sao_Paulo')::time >= ma.start_time and (now() at time zone 'America/Sao_Paulo')::time <= ma.end_time)
		              or (ma.start_time > ma.end_time and ((now() at time zone 'America/Sao_Paulo')::time >= ma.start_time or (now() at time zone 'America/Sao_Paulo')::time <= ma.end_time))
		            )
		          )
		        )
		    )
		  )
		order by candidates.entry_total asc, candidates.position asc, candidates.created_at asc, coalesce(user_logs.total, 0) asc, candidates.team_member_created_at asc nulls last, candidates.user_id asc
		limit 1
	`, organizationID, roundRobinID, requiredTeamID).Scan(&selection.MemberID, &selection.UserID)
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

	usesCanonicalLog, err := repo.assignmentLogUsesCanonicalSchema(ctx, tx)
	if err != nil {
		return err
	}
	if usesCanonicalLog {
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
		`, tenantContext.OrganizationID, current.ID, nullableString(current.AssignedUserID), nullable(assignedUserID), reason, nullableString(tenantContext.UserID))
		if err != nil {
			return err
		}
		return repo.insertTransferNotification(ctx, tx, tenantContext, current, assignedUserID, reason)
	}

	_, err = tx.Exec(ctx, `
		insert into public.assignments_log (
			organization_id,
			lead_id,
			assigned_user_id,
			user_id,
			reason,
			assigned_at
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			$5,
			now()
		)
	`, tenantContext.OrganizationID, current.ID, nullable(assignedUserID), nullableString(tenantContext.UserID), reason)
	if err != nil {
		return err
	}
	return repo.insertTransferNotification(ctx, tx, tenantContext, current, assignedUserID, reason)
}

func (repo Repository) validateRoundRobinAssigneeTeam(ctx context.Context, queryer leadTeamQueryer, organizationID string, teamID string, assignedUserID *string) error {
	if strings.TrimSpace(teamID) == "" || assignedUserID == nil {
		return nil
	}

	var isActiveMember bool
	err := queryer.QueryRow(ctx, `
		select exists (
			select 1
			from public.team_members tm
			where tm.organization_id = $1::uuid
			  and tm.team_id = $2::uuid
			  and tm.user_id = $3::uuid
			  and coalesce(tm.is_active, true) = true
		)
	`, organizationID, teamID, *assignedUserID).Scan(&isActiveMember)
	if err != nil {
		return err
	}
	if !isActiveMember {
		return ErrInvalidReference
	}

	return nil
}

func (repo Repository) insertTransferNotification(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, current leadSnapshot, assignedUserID *string, reason string) error {
	if assignedUserID == nil || strings.TrimSpace(*assignedUserID) == "" || current.AssignedUserID == *assignedUserID || !shouldInsertTransferNotification(reason) {
		return nil
	}

	oldUserName := ""
	if current.AssignedUserID != "" {
		oldUserName, _ = repo.getUserDisplayName(ctx, tx, current.AssignedUserID)
	}
	eventAt := time.Now().UTC()
	return repo.insertNotification(ctx, tx, tenantContext.OrganizationID, *assignedUserID, current.ID, "Lead transferido para voce", fmt.Sprintf("%s foi transferido para voce", current.Name), "lead_transferred", map[string]any{
		"lead_name":         current.Name,
		"from_user_id":      nullableString(current.AssignedUserID),
		"from_user_name":    oldUserName,
		"transfer_reason":   reason,
		"transferred_by":    nullableString(tenantContext.UserID),
		"transfer_event_at": eventAt.Format(time.RFC3339Nano),
		"pipeline_id":       nullableString(current.PipelineID),
		"stage_id":          nullableString(current.StageID),
		"dedupe_key":        notificationDedupeKey("lead_transferred", current.ID, *assignedUserID, current.AssignedUserID, reason, eventAt.Format(time.RFC3339Nano)),
	})
}

func shouldInsertTransferNotification(reason string) bool {
	// The redistribution worker emits richer received/away notifications after
	// the assignment succeeds. Emitting the generic transfer notice here would
	// duplicate WhatsApp and push deliveries for the new assignee.
	return !strings.EqualFold(strings.TrimSpace(reason), "auto_redistribution")
}

func (repo Repository) assignmentLogUsesCanonicalSchema(ctx context.Context, tx pgx.Tx) (bool, error) {
	var hasOldUser bool
	var hasNewUser bool
	var hasCreatedBy bool
	err := tx.QueryRow(ctx, `
		select
			exists (
				select 1
				from information_schema.columns
				where table_schema = 'public'
				  and table_name = 'assignments_log'
				  and column_name = 'old_user_id'
			),
			exists (
				select 1
				from information_schema.columns
				where table_schema = 'public'
				  and table_name = 'assignments_log'
				  and column_name = 'new_user_id'
			),
			exists (
				select 1
				from information_schema.columns
				where table_schema = 'public'
				  and table_name = 'assignments_log'
				  and column_name = 'created_by'
			)
	`).Scan(&hasOldUser, &hasNewUser, &hasCreatedBy)
	if err != nil {
		return false, err
	}
	return hasOldUser && hasNewUser && hasCreatedBy, nil
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
	var teamID, phone, assignedUserID, pipelineID, stageID, stageName, lostReason, interestValue, propertyID, interestPropertyID, propertyCode pgtype.Text
	var rawData []byte

	err := tx.QueryRow(ctx, `
		select
			l.id::text,
			nullif(to_jsonb(l)->>'team_id', ''),
			l.name,
			l.phone,
			l.assigned_user_id::text,
			l.pipeline_id::text,
			l.stage_id::text,
			s.name,
			l.deal_status,
			l.lost_reason,
			l.valor_interesse::text,
			l.property_id::text,
			l.interest_property_id::text,
			l.property_code,
			to_jsonb(l)
		from public.leads l
		left join public.stages s
		  on s.id = l.stage_id
		 and s.organization_id = l.organization_id
		where l.organization_id = $1::uuid
		  and l.id = $2::uuid
		limit 1
		for update of l
	`, organizationID, leadID).Scan(&snapshot.ID, &teamID, &snapshot.Name, &phone, &assignedUserID, &pipelineID, &stageID, &stageName, &snapshot.DealStatus, &lostReason, &interestValue, &propertyID, &interestPropertyID, &propertyCode, &rawData)
	if errors.Is(err, pgx.ErrNoRows) {
		return leadSnapshot{}, ErrLeadNotFound
	}
	if err != nil {
		return leadSnapshot{}, err
	}

	snapshot.TeamID = textValue(teamID)
	snapshot.Phone = textValue(phone)
	snapshot.AssignedUserID = textValue(assignedUserID)
	snapshot.PipelineID = textValue(pipelineID)
	snapshot.StageID = textValue(stageID)
	snapshot.StageName = textValue(stageName)
	snapshot.LostReason = textValue(lostReason)
	snapshot.InterestValue = textValue(interestValue)
	snapshot.PropertyID = textValue(propertyID)
	snapshot.InterestPropertyID = textValue(interestPropertyID)
	snapshot.PropertyCode = textValue(propertyCode)
	if err := json.Unmarshal(rawData, &snapshot.Data); err != nil {
		return leadSnapshot{}, err
	}

	return snapshot, nil
}

func changedLeadAuditData(current map[string]any, requested map[string]any) (map[string]any, map[string]any) {
	oldData := make(map[string]any)
	newData := make(map[string]any)
	for key, newValue := range requested {
		oldValue := currentLeadAuditValue(current, key)
		if leadAuditValuesEqual(key, oldValue, newValue) {
			continue
		}
		if key == "cpf" || key == "rg" {
			oldData[key] = protectedAuditValue(oldValue)
			newData[key] = protectedAuditValue(newValue)
			continue
		}
		oldData[key] = oldValue
		newData[key] = newValue
	}
	return oldData, newData
}

func currentLeadAuditValue(current map[string]any, key string) any {
	profileKey := ""
	switch key {
	case "person_type":
		profileKey = "personType"
	case "social_name":
		profileKey = "socialName"
	case "birth_date":
		profileKey = "birthDate"
	case "corporate_name":
		profileKey = "corporateName"
	case "trade_name":
		profileKey = "tradeName"
	case "state_registration":
		profileKey = "stateRegistration"
	case "gender", "cpf", "rg", "cnpj":
		profileKey = key
	}
	if profileKey == "" {
		return current[key]
	}
	metadata, ok := current["metadata"].(map[string]any)
	if !ok {
		return nil
	}
	profile, ok := metadata["profile"].(map[string]any)
	if !ok {
		return nil
	}
	return profile[profileKey]
}

func protectedAuditValue(value any) any {
	if strings.TrimSpace(fmt.Sprint(value)) == "" || value == nil {
		return nil
	}
	return "Protegido"
}

func leadAuditValuesEqual(key string, left any, right any) bool {
	if key == "trabalha" || key == "procura_financiamento" || key == "is_own_resource" {
		return leadAuditBoolValue(left) == leadAuditBoolValue(right)
	}
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	if key == "valor_interesse" || key == "commission_percentage" {
		leftNumber, leftErr := strconv.ParseFloat(fmt.Sprint(left), 64)
		rightNumber, rightErr := strconv.ParseFloat(fmt.Sprint(right), 64)
		return leftErr == nil && rightErr == nil && leftNumber == rightNumber
	}
	return fmt.Sprint(left) == fmt.Sprint(right)
}

func leadAuditBoolValue(value any) bool {
	if value == nil {
		return false
	}
	parsed, err := strconv.ParseBool(fmt.Sprint(value))
	return err == nil && parsed
}

func (repo Repository) getLeadForMutation(ctx context.Context, tx pgx.Tx, organizationID string, leadID string) (Lead, error) {
	lead, err := scanLead(tx.QueryRow(ctx, `
		select `+leadSelectFields()+`
		from public.leads l
		left join public.stages s
		  on s.id = l.stage_id
		 and s.organization_id = l.organization_id
		left join public.users u on u.id = l.assigned_user_id
		where l.organization_id = $1::uuid
		  and l.id = $2::uuid
		limit 1
	`, organizationID, leadID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Lead{}, ErrLeadNotFound
	}
	return lead, err
}

func (repo Repository) canEditLead(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, assignedUserID string, teamID string) (bool, error) {
	_ = ctx
	_ = tx
	return authorization.CanOperateLead(tenantContext, authorization.LeadResource{AssignedUserID: assignedUserID, TeamID: teamID}), nil
}

func (repo Repository) applyDestinationAssignments(ctx context.Context, organizationID string, current leadSnapshot, input updateInput, addUUIDAssignment func(string, patchString), addRawAssignment func(string)) error {
	if !input.PipelineID.Set && !input.StageID.Set {
		return nil
	}

	if input.StageID.Set {
		if input.StageID.Value == nil {
			addUUIDAssignment("stage_id", input.StageID)
			if current.StageID != "" {
				addRawAssignment("stage_entered_at = null")
				addRawAssignment("board_order_at = null")
			}
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
		if resolvedDestination.StageID != nil && current.StageID != *resolvedDestination.StageID {
			addRawAssignment("stage_entered_at = now()")
			addRawAssignment("board_order_at = now()")
		}
		return nil
	}

	if input.PipelineID.Value == nil {
		addUUIDAssignment("pipeline_id", input.PipelineID)
		addUUIDAssignment("stage_id", patchString{Set: true})
		if current.StageID != "" {
			addRawAssignment("stage_entered_at = null")
			addRawAssignment("board_order_at = null")
		}
		return nil
	}

	resolvedDestination, err := repo.resolveDestination(ctx, organizationID, input.PipelineID.Value, nil)
	if err != nil {
		return err
	}

	addUUIDAssignment("pipeline_id", patchString{Set: true, Value: resolvedDestination.PipelineID})
	addUUIDAssignment("stage_id", patchString{Set: true, Value: resolvedDestination.StageID})
	if resolvedDestination.StageID != nil && current.StageID != *resolvedDestination.StageID {
		addRawAssignment("stage_entered_at = now()")
		addRawAssignment("board_order_at = now()")
	}

	return nil
}

func (repo Repository) findExistingLeadByPhone(ctx context.Context, organizationID string, phone *string) (*existingLeadMatch, error) {
	if phone == nil {
		return nil, nil
	}

	if normalizePhone(*phone) == "" {
		return nil, nil
	}

	var match existingLeadMatch
	var teamID, phoneValue, assignedUserID, assignedUserName pgtype.Text
	err := repo.db.Pool().QueryRow(ctx, `
		select
			l.id::text,
			nullif(to_jsonb(l)->>'team_id', ''),
			l.phone,
			l.assigned_user_id::text,
			u.name
		from public.leads l
		left join public.users u on u.id = l.assigned_user_id
		where l.organization_id = $1::uuid
		  and l.phone is not null
		  and normalize_phone(l.phone) = normalize_phone($2)
		order by l.created_at asc
		limit 1
	`, organizationID, *phone).Scan(&match.ID, &teamID, &phoneValue, &assignedUserID, &assignedUserName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	match.TeamID = textValue(teamID)
	match.Phone = textValue(phoneValue)
	match.AssignedUserID = textValue(assignedUserID)
	match.AssignedUserName = textValue(assignedUserName)

	return &match, nil
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

func (repo Repository) applySelectedPropertyCommercialValues(ctx context.Context, tx pgx.Tx, organizationID string, current leadSnapshot, input *updateInput) error {
	if input == nil || (!input.PropertyID.Set && !input.InterestPropertyID.Set) {
		return nil
	}

	currentPropertyID := current.InterestPropertyID
	if currentPropertyID == "" {
		currentPropertyID = current.PropertyID
	}

	propertyID := currentPropertyID
	if input.PropertyID.Set {
		propertyID = ""
		if input.PropertyID.Value != nil {
			propertyID = *input.PropertyID.Value
		}
	}
	if input.InterestPropertyID.Set {
		propertyID = ""
		if input.InterestPropertyID.Value != nil {
			propertyID = *input.InterestPropertyID.Value
		}
	}
	if propertyID == currentPropertyID {
		return nil
	}

	if propertyID == "" {
		input.InterestValue = patchString{Set: true}
		input.CommissionPercentage = patchString{Set: true}
		return nil
	}

	var price, commission pgtype.Text
	if err := tx.QueryRow(ctx, `
		select coalesce(nullif(preco, 0), nullif(valor_venda_avaliado, 0))::text,
		       commission_percentage::text
		from public.properties
		where organization_id = $1::uuid
		  and id = $2::uuid
		limit 1
	`, organizationID, propertyID).Scan(&price, &commission); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalidReference
		}
		return err
	}

	input.InterestValue = patchString{Set: true}
	if price.Valid {
		value := price.String
		input.InterestValue.Value = &value
	}
	input.CommissionPercentage = patchString{Set: true}
	if commission.Valid {
		value := commission.String
		input.CommissionPercentage.Value = &value
	}

	return nil
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
		"from_status":     current.DealStatus,
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

	return nil
}

func (repo Repository) insertLeadUpdateActivities(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, current leadSnapshot, input updateInput) error {
	if input.Feedback.Set && input.Feedback.Value != nil {
		feedback := strings.TrimSpace(*input.Feedback.Value)
		if feedback != "" {
			if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, current.ID, tenantContext.UserID, "note", feedback, map[string]any{
				"kind":   "feedback",
				"origin": "lead_update",
			}); err != nil {
				return err
			}
		}
	}

	if input.StageID.Set && input.StageID.Value != nil && *input.StageID.Value != current.StageID {
		var stageName, pipelineID string
		if err := tx.QueryRow(ctx, `
			select s.name, s.pipeline_id::text
			from public.stages s
			where s.organization_id = $1::uuid
			  and s.id = $2::uuid
			limit 1
		`, tenantContext.OrganizationID, *input.StageID.Value).Scan(&stageName, &pipelineID); err != nil {
			return err
		}
		if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, current.ID, tenantContext.UserID, "stage_change", fmt.Sprintf(`Lead "%s" movido de etapa`, current.Name), map[string]any{
			"from_stage_id": nullableString(current.StageID),
			"to_stage_id":   *input.StageID.Value,
			"from_stage":    nullableString(current.StageName),
			"to_stage":      stageName,
			"from_pipeline": nullableString(current.PipelineID),
			"to_pipeline":   pipelineID,
		}); err != nil {
			return err
		}
	}

	propertyID := current.InterestPropertyID
	if propertyID == "" {
		propertyID = current.PropertyID
	}
	if input.PropertyID.Set {
		propertyID = ""
		if input.PropertyID.Value != nil {
			propertyID = *input.PropertyID.Value
		}
	}
	if input.InterestPropertyID.Set {
		propertyID = ""
		if input.InterestPropertyID.Value != nil {
			propertyID = *input.InterestPropertyID.Value
		}
	}

	currentPropertyID := current.InterestPropertyID
	if currentPropertyID == "" {
		currentPropertyID = current.PropertyID
	}
	if propertyID == "" || propertyID == currentPropertyID {
		return nil
	}

	var title, code, price, commission pgtype.Text
	if err := tx.QueryRow(ctx, `
		select title, code, preco::text, commission_percentage::text
		from public.properties
		where organization_id = $1::uuid
		  and id = $2::uuid
		limit 1
	`, tenantContext.OrganizationID, propertyID).Scan(&title, &code, &price, &commission); err != nil {
		return err
	}

	propertyTitle := textValue(title)
	propertyCode := textValue(code)
	content := strings.TrimSpace(strings.Join([]string{propertyCode, propertyTitle}, " - "))
	content = strings.Trim(content, "- ")
	if content == "" {
		content = "Imovel selecionado"
	}

	return repo.insertActivity(ctx, tx, tenantContext.OrganizationID, current.ID, tenantContext.UserID, "property_selected", content, map[string]any{
		"property_id":           propertyID,
		"property_title":        nullableString(propertyTitle),
		"property_code":         nullableString(propertyCode),
		"property_price":        nullableString(textValue(price)),
		"commission_percentage": nullableString(textValue(commission)),
		"origin":                "lead_update",
	})
}

type propertyReservationSnapshot struct {
	LeadID             string
	OldStatus          string
	OldPublishedOnSite *bool
	OldAnnounce        *bool
}

func (repo Repository) latestPropertyReservation(ctx context.Context, tx pgx.Tx, organizationID string, propertyID string) (propertyReservationSnapshot, bool, error) {
	var hasEventsTable bool
	if err := tx.QueryRow(ctx, `select to_regclass('public.events') is not null`).Scan(&hasEventsTable); err != nil {
		return propertyReservationSnapshot{}, false, err
	}
	if !hasEventsTable {
		return propertyReservationSnapshot{}, false, nil
	}

	var snapshot propertyReservationSnapshot
	var oldPublishedOnSite, oldAnnounce pgtype.Bool
	err := tx.QueryRow(ctx, `
		select coalesce(payload->>'reserved_by_lead_id', payload->>'lead_id', ''),
		       coalesce(payload->>'old_status', 'active'),
		       case
		         when lower(payload->>'old_published_on_site') in ('true', 'false')
		         then (payload->>'old_published_on_site')::boolean
		       end,
		       case
		         when lower(payload->>'old_anunciar') in ('true', 'false')
		         then (payload->>'old_anunciar')::boolean
		       end
		from public.events
		where organization_id = $1::uuid
		  and entity_type = 'property'
		  and entity_id = $2::uuid
		  and event_type = 'property_reserved_by_won_lead'
		order by created_at desc
		limit 1
	`, organizationID, propertyID).Scan(
		&snapshot.LeadID,
		&snapshot.OldStatus,
		&oldPublishedOnSite,
		&oldAnnounce,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return propertyReservationSnapshot{}, false, nil
	}
	if err != nil {
		return propertyReservationSnapshot{}, false, err
	}
	if oldPublishedOnSite.Valid {
		value := oldPublishedOnSite.Bool
		snapshot.OldPublishedOnSite = &value
	}
	if oldAnnounce.Valid {
		value := oldAnnounce.Bool
		snapshot.OldAnnounce = &value
	}

	return snapshot, true, nil
}

func (repo Repository) reserveWonLeadProperty(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, current leadSnapshot, input updateInput) error {
	if !input.DealStatus.Set || input.DealStatus.Value == nil || *input.DealStatus.Value != "won" || current.DealStatus == "won" {
		return nil
	}

	propertyID := current.InterestPropertyID
	if propertyID == "" {
		propertyID = current.PropertyID
	}
	if input.PropertyID.Set && input.PropertyID.Value != nil {
		propertyID = *input.PropertyID.Value
	}
	if input.InterestPropertyID.Set && input.InterestPropertyID.Value != nil {
		propertyID = *input.InterestPropertyID.Value
	}
	if propertyID == "" {
		return nil
	}

	var title, code, oldStatus string
	var oldPublishedOnSite, oldAnnounce bool
	err := tx.QueryRow(ctx, `
		select coalesce(title, 'Imovel') as title,
		       coalesce(code, '') as code,
		       coalesce(status, 'active') as old_status,
		       coalesce(published_on_site, false),
		       coalesce(anunciar, false)
		from public.properties
		where organization_id = $1::uuid
		  and id = $2::uuid
		for update
	`, tenantContext.OrganizationID, propertyID).Scan(&title, &code, &oldStatus, &oldPublishedOnSite, &oldAnnounce)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("%w: propertyId is invalid", ErrInvalidReference)
	}
	if err != nil {
		return err
	}

	if isReservedLeadPropertyStatus(oldStatus) {
		reservation, found, reservationErr := repo.latestPropertyReservation(ctx, tx, tenantContext.OrganizationID, propertyID)
		if reservationErr != nil {
			return reservationErr
		}
		if found && reservation.LeadID == current.ID {
			return nil
		}
	}

	if message := wonPropertyUnavailableMessage(oldStatus); message != "" {
		return fmt.Errorf("%w: %s", ErrLeadPropertyUnavailable, message)
	}

	tag, err := tx.Exec(ctx, `
		update public.properties
		set status = 'reserved',
		    published_on_site = false,
		    anunciar = false,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, propertyID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: propertyId is invalid", ErrInvalidReference)
	}

	actorName := tenantContext.UserID
	if value, err := repo.getUserDisplayName(ctx, tx, tenantContext.UserID); err == nil && strings.TrimSpace(value) != "" {
		actorName = value
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	if err := repo.notifyInterestedLeadsForReservedProperty(ctx, tx, tenantContext, current, propertyID, title, code, oldStatus); err != nil {
		return err
	}

	var hasEventsTable bool
	if err := tx.QueryRow(ctx, `select to_regclass('public.events') is not null`).Scan(&hasEventsTable); err != nil {
		return err
	}
	if !hasEventsTable {
		return nil
	}

	_, err = tx.Exec(ctx, `
		insert into public.events (
			organization_id,
			event_type,
			entity_type,
			entity_id,
			payload,
			status
		)
		values (
			$1::uuid,
			'property_reserved_by_won_lead',
			'property',
			$2::uuid,
			$3::jsonb,
			'processed'
		)
	`, tenantContext.OrganizationID, propertyID, jsonb(map[string]any{
		"user_id":               tenantContext.UserID,
		"user_name":             actorName,
		"reserved_by_user_id":   tenantContext.UserID,
		"reserved_by_user_name": actorName,
		"reserved_by_lead_id":   current.ID,
		"reserved_by_lead_name": current.Name,
		"lead_id":               current.ID,
		"lead_name":             current.Name,
		"property_id":           propertyID,
		"property_code":         code,
		"title":                 title,
		"old_status":            oldStatus,
		"old_published_on_site": oldPublishedOnSite,
		"old_anunciar":          oldAnnounce,
		"new_status":            "reserved",
		"organization_id":       tenantContext.OrganizationID,
		"message":               fmt.Sprintf(`Imovel "%s" reservado por "%s" ao marcar o lead "%s" como ganho`, title, actorName, current.Name),
	}))
	return err
}

func (repo Repository) releaseReopenedLeadProperty(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, current leadSnapshot, input updateInput) error {
	if !input.DealStatus.Set || input.DealStatus.Value == nil || *input.DealStatus.Value != "open" || current.DealStatus == "open" {
		return nil
	}

	propertyID := current.InterestPropertyID
	if propertyID == "" {
		propertyID = current.PropertyID
	}
	if input.PropertyID.Set && input.PropertyID.Value != nil {
		propertyID = *input.PropertyID.Value
	}
	if input.InterestPropertyID.Set && input.InterestPropertyID.Value != nil {
		propertyID = *input.InterestPropertyID.Value
	}
	if propertyID == "" {
		return nil
	}

	var title, code, currentStatus string
	err := tx.QueryRow(ctx, `
		select coalesce(title, 'Imovel'),
		       coalesce(code, ''),
		       coalesce(status, 'active')
		from public.properties
		where organization_id = $1::uuid
		  and id = $2::uuid
		for update
	`, tenantContext.OrganizationID, propertyID).Scan(&title, &code, &currentStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if !isReservedLeadPropertyStatus(currentStatus) {
		return nil
	}

	restoreStatus := "active"
	restorePublishedOnSite := true
	restoreAnnounce := true
	reservation, found, err := repo.latestPropertyReservation(ctx, tx, tenantContext.OrganizationID, propertyID)
	if err != nil {
		return err
	}
	if found {
		if reservation.LeadID != "" && reservation.LeadID != current.ID {
			return nil
		}
		restoreStatus = reopenedPropertyRestoreStatus(reservation.OldStatus)
		if reservation.OldPublishedOnSite != nil {
			restorePublishedOnSite = *reservation.OldPublishedOnSite
		}
		if reservation.OldAnnounce != nil {
			restoreAnnounce = *reservation.OldAnnounce
		}
	} else if current.DealStatus != "won" {
		// Sem trilha de reserva, somente uma reabertura direta de ganho oferece
		// evidencia suficiente para liberar o imovel com seguranca.
		return nil
	}

	if _, err := tx.Exec(ctx, `
		update public.properties
		set status = $3,
		    published_on_site = $4,
		    anunciar = $5,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, propertyID, restoreStatus, restorePublishedOnSite, restoreAnnounce); err != nil {
		return err
	}

	var hasEventsTable bool
	if err := tx.QueryRow(ctx, `select to_regclass('public.events') is not null`).Scan(&hasEventsTable); err != nil {
		return err
	}
	if !hasEventsTable {
		return nil
	}

	_, err = tx.Exec(ctx, `
		insert into public.events (
			organization_id,
			event_type,
			entity_type,
			entity_id,
			payload,
			status
		)
		values (
			$1::uuid,
			'property_republished_by_reopened_lead',
			'property',
			$2::uuid,
			$3::jsonb,
			'processed'
		)
	`, tenantContext.OrganizationID, propertyID, jsonb(map[string]any{
		"user_id":            tenantContext.UserID,
		"reopened_lead_id":   current.ID,
		"reopened_lead_name": current.Name,
		"property_id":        propertyID,
		"property_code":      code,
		"title":              title,
		"old_status":         currentStatus,
		"new_status":         restoreStatus,
		"published_on_site":  restorePublishedOnSite,
		"anunciar":           restoreAnnounce,
		"organization_id":    tenantContext.OrganizationID,
		"message":            fmt.Sprintf(`Imovel "%s" republicado ao reabrir o lead "%s"`, title, current.Name),
	}))
	return err
}

func wonPropertyUnavailableMessage(status string) string {
	switch normalizeLeadPropertyStatus(status) {
	case "reserved", "reservado":
		return "Este imovel ja esta reservado. Consulte o administrador antes de marcar o lead como ganho."
	case "sold", "vendido":
		return "Este imovel ja esta vendido e nao pode ser marcado como ganho."
	case "rented", "alugado", "locado":
		return "Este imovel ja esta alugado e nao pode ser marcado como ganho."
	case "draft", "rascunho", "inactive", "inativo", "archived", "arquivado":
		return "Este imovel nao esta disponivel para ser marcado como ganho."
	default:
		return ""
	}
}

func reopenedPropertyRestoreStatus(status string) string {
	status = strings.TrimSpace(status)
	switch normalizeLeadPropertyStatus(status) {
	case "", "reserved", "reservado", "sold", "vendido", "rented", "alugado", "locado", "draft", "rascunho", "inactive", "inativo", "archived", "arquivado":
		return "active"
	default:
		return status
	}
}

func isReservedLeadPropertyStatus(status string) bool {
	normalized := normalizeLeadPropertyStatus(status)
	return normalized == "reserved" || normalized == "reservado"
}

func normalizeLeadPropertyStatus(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer(
		"\u00e1", "a", "\u00e0", "a", "\u00e2", "a", "\u00e3", "a",
		"\u00e9", "e", "\u00ea", "e",
		"\u00ed", "i",
		"\u00f3", "o", "\u00f4", "o", "\u00f5", "o",
		"\u00fa", "u",
		"\u00e7", "c",
	)
	return replacer.Replace(value)
}

func (repo Repository) notifyInterestedLeadsForReservedProperty(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, current leadSnapshot, propertyID string, propertyTitle string, propertyCode string, oldStatus string) error {
	rows, err := tx.Query(ctx, `
		select distinct on (l.id)
			l.id::text,
			l.name,
			l.assigned_user_id::text
		from public.leads l
		where l.organization_id = $1::uuid
		  and l.id <> $2::uuid
		  and l.assigned_user_id is not null
		  and coalesce(l.deal_status, 'open') not in ('won', 'lost')
		  and (
		    l.interest_property_id = $3::uuid
		    or l.property_id = $3::uuid
		  )
		order by l.id, l.created_at desc
	`, tenantContext.OrganizationID, current.ID, propertyID)
	if err != nil {
		return err
	}
	defer rows.Close()

	propertyLabel := propertyTitle
	if strings.TrimSpace(propertyLabel) == "" {
		propertyLabel = "Imovel"
	}
	if strings.TrimSpace(propertyCode) != "" {
		propertyLabel = fmt.Sprintf("%s (%s)", propertyLabel, propertyCode)
	}

	for rows.Next() {
		var leadID, leadName, assignedUserID string
		if err := rows.Scan(&leadID, &leadName, &assignedUserID); err != nil {
			return err
		}

		content := fmt.Sprintf(`O imovel de interesse "%s" foi reservado pelo lead "%s". Revise este atendimento.`, propertyLabel, current.Name)
		metadata := map[string]any{
			"property_id":           propertyID,
			"property_title":        propertyTitle,
			"property_code":         propertyCode,
			"old_status":            oldStatus,
			"new_status":            "reserved",
			"reserved_by_lead_id":   current.ID,
			"reserved_by_lead_name": current.Name,
			"affected_lead_id":      leadID,
			"affected_lead_name":    leadName,
			"event_key":             "interest_property_reserved",
			"notification_reason":   "same_interest_property_reserved",
			"source":                "deal_won_property_reservation",
			"dedupe_key":            notificationDedupeKey("interest_property_reserved", current.ID, leadID, assignedUserID),
		}

		if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, leadID, tenantContext.UserID, "property_interest_reserved", content, metadata); err != nil {
			return err
		}
		if err := repo.insertNotificationWithType(ctx, tx, tenantContext.OrganizationID, assignedUserID, leadID, "Imovel de interesse reservado", content, "interest_property_reserved", "warning", metadata); err != nil {
			return err
		}
	}

	return rows.Err()
}

func (repo Repository) dispatchDealWonNotification(ctx context.Context, tenantContext tenant.Context, current leadSnapshot, input updateInput) {
	if !input.DealStatus.Set || input.DealStatus.Value == nil || *input.DealStatus.Value != "won" || current.DealStatus == "won" {
		return
	}

	assignedUserID := current.AssignedUserID
	if input.AssignedUserID.Set {
		assignedUserID = ""
		if input.AssignedUserID.Value != nil {
			assignedUserID = *input.AssignedUserID.Value
		}
	}

	interestValue := current.InterestValue
	if input.InterestValue.Set {
		interestValue = ""
		if input.InterestValue.Value != nil {
			interestValue = *input.InterestValue.Value
		}
	}

	recipients, err := repo.listDealWonNotificationRecipients(ctx, tenantContext.OrganizationID, assignedUserID)
	if err != nil || len(recipients) == 0 {
		if assignedUserID != "" {
			recipients = []string{assignedUserID}
		}
	}
	actorName := "Equipe Vimob"
	if name, err := repo.getNotificationUserName(ctx, tenantContext.OrganizationID, tenantContext.UserID); err == nil && name != "" {
		actorName = name
	}
	organizationName := ""
	_ = repo.db.Pool().QueryRow(ctx, `
		select coalesce(name, '')
		from public.organizations
		where id = $1::uuid
		limit 1
	`, tenantContext.OrganizationID).Scan(&organizationName)

	for _, recipientID := range recipients {
		_, _ = repo.enqueueDispatchNotification(ctx, tenantContext.OrganizationID, recipientID, DispatchNotificationRequest{
			EventKey:  "deal_won",
			UserID:    recipientID,
			LeadID:    &current.ID,
			DedupeKey: "deal_won:" + current.ID + ":" + recipientID,
			Variables: map[string]any{
				"lead_name":         current.Name,
				"valor_interesse":   nullableString(interestValue),
				"actor_name":        actorName,
				"organization_name": organizationName,
			},
		})
	}
}

func (repo Repository) listDealWonNotificationRecipients(ctx context.Context, organizationID string, assignedUserID string) ([]string, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		with base as (
			select nullif($2, '')::uuid as assigned_user_id
		),
		responsible as (
			select assigned_user_id as user_id
			from base
			where assigned_user_id is not null
		),
		admins as (
			select distinct om.user_id
			from public.organization_members om
			join public.users u on u.id = om.user_id
			where om.organization_id = $1::uuid
			  and coalesce(om.is_active, false) = true
			  and coalesce(u.is_active, false) = true
			  and om.role in ('owner', 'admin', 'manager')
		),
		leaders as (
			select distinct leader.user_id
			from base
			join public.team_members member
			  on member.user_id = base.assigned_user_id
			 and member.organization_id = $1::uuid
			 and coalesce(member.is_active, true) = true
			join public.team_members leader
			  on leader.team_id = member.team_id
			 and leader.organization_id = member.organization_id
			 and coalesce(leader.is_active, true) = true
			 and coalesce(leader.is_leader, false) = true
		)
		select distinct user_id::text
		from (
			select user_id from responsible
			union all
			select user_id from admins
			union all
			select user_id from leaders
		) recipients
		where user_id is not null
	`, organizationID, assignedUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	recipients := []string{}
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		if strings.TrimSpace(userID) != "" {
			recipients = append(recipients, userID)
		}
	}
	return recipients, rows.Err()
}

func (repo Repository) getNotificationUserName(ctx context.Context, organizationID string, userID string) (string, error) {
	var name pgtype.Text
	err := repo.db.Pool().QueryRow(ctx, `
		select u.name
		from public.users u
		join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		where u.id = $2::uuid
		  and coalesce(u.is_active, false) = true
		  and coalesce(om.is_active, false) = true
		limit 1
	`, organizationID, userID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return textValue(name), nil
}

func (repo Repository) recordDealStatusGamification(ctx context.Context, tenantContext tenant.Context, current leadSnapshot, input updateInput) {
	if repo.gamificationRecorder == nil || !input.DealStatus.Set || input.DealStatus.Value == nil || *input.DealStatus.Value == current.DealStatus {
		return
	}

	newStatus := *input.DealStatus.Value
	switch newStatus {
	case "won":
		_ = repo.gamificationRecorder.RecordAction(ctx, tenantContext, "sale_closed", 1, current.ID)
	case "open":
		if current.DealStatus == "lost" {
			_ = repo.gamificationRecorder.RecordAction(ctx, tenantContext, "lost_lead_recovered", 1, current.ID)
		}
	}
}

func (repo Repository) linkWhatsAppConversations(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, phone *string, conversationID *string) error {
	if conversationID != nil {
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_conversations
			set lead_id = null,
			    updated_at = now()
			where organization_id = $1::uuid
			  and lead_id = $3::uuid
			  and id <> $2::uuid
			  and deleted_at is null
			  and is_group is not true
		`, organizationID, *conversationID, leadID); err != nil {
			return err
		}

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

	if normalizePhone(*phone) == "" {
		return nil
	}

	_, err := tx.Exec(ctx, `
		with target as (
			select id
			from public.whatsapp_conversations
			where organization_id = $1::uuid
			  and lead_id is null
			  and contact_phone is not null
			  and normalize_phone(contact_phone) = normalize_phone($2)
			  and deleted_at is null
			  and is_group is not true
			order by last_message_at desc nulls last, updated_at desc, created_at desc
			limit 1
		)
		update public.whatsapp_conversations
		set lead_id = $3::uuid,
		    updated_at = now()
		from target
		where whatsapp_conversations.id = target.id
		  and not exists (
		    select 1
		    from public.whatsapp_conversations existing
		    where existing.organization_id = $1::uuid
		      and existing.lead_id = $3::uuid
		      and existing.deleted_at is null
		      and existing.is_group is not true
		  )
	`, organizationID, *phone, leadID)
	return err
}

func isLeadPhoneUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}

	return pgErr.Code == "23505" && pgErr.ConstraintName == "leads_org_phone_unique"
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
	`, organizationID, leadID, nullableString(userID), activityType, content, jsonb(metadata))
	return err
}

func (repo Repository) insertInitialFeedbackActivity(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, userID string, message *string, origin string) error {
	if message == nil {
		return nil
	}

	feedback := strings.TrimSpace(*message)
	if feedback == "" {
		return nil
	}

	return repo.insertActivity(ctx, tx, organizationID, leadID, userID, "note", feedback, map[string]any{
		"kind":   "feedback",
		"origin": origin,
	})
}

func (repo Repository) insertNotification(ctx context.Context, tx pgx.Tx, organizationID string, userID string, leadID string, title string, content string, eventKey string, metadata map[string]any) error {
	return repo.insertNotificationWithType(ctx, tx, organizationID, userID, leadID, title, content, eventKey, "lead", metadata)
}

func (repo Repository) insertNotificationWithType(ctx context.Context, tx pgx.Tx, organizationID string, userID string, leadID string, title string, content string, eventKey string, notificationType string, metadata map[string]any) error {
	if userID == "" {
		return nil
	}

	notificationType = strings.TrimSpace(notificationType)
	if notificationType == "" {
		notificationType = "lead"
	}

	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata = applyNotificationDispatchMetadata(metadata, eventKey, nil)
	dedupeKey := stringFromMap(metadata, "dedupe_key")

	_, err := tx.Exec(ctx, `
		with input as (
			select nullif($8, '') as dedupe_key
		)
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
		select
			$1::uuid,
			$2::uuid,
			$3,
			$4,
			$4,
			$6,
			'in_app',
			$5::uuid,
			'/crm/pipelines?lead=' || $5::text,
			$7::jsonb
		from input
		where input.dedupe_key is null
		   or not exists (
		     select 1
		     from public.notifications n
		     where n.organization_id = $1::uuid
		       and n.user_id = $2::uuid
		       and n.metadata->>'dedupe_key' = input.dedupe_key
		   )
	`, organizationID, userID, title, content, leadID, notificationType, jsonb(metadata), dedupeKey)
	if isNotificationDedupeConflict(err) {
		return nil
	}
	return err
}

func notificationDedupeKey(parts ...string) string {
	cleaned := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			cleaned = append(cleaned, part)
		}
	}
	return strings.Join(cleaned, ":")
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
		l.team_id::text,
		l.valor_interesse::text,
		l.commission_percentage::text,
		l.lost_reason,
		l.feedback,
		l.finalidade_compra,
		l.trabalha,
		l.procura_financiamento,
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
		l.metadata,
		l.created_at,
		l.updated_at,
		l.stage_entered_at,
		l.board_order_at,
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

func leadVisibilitySQL(canViewAllPlaceholder string, userIDPlaceholder string, canViewTeamPlaceholder string, canViewOwn bool) string {
	canViewOwnSQL := "false"
	if canViewOwn {
		canViewOwnSQL = "true"
	}
	return `(
		` + canViewAllPlaceholder + `::boolean
		or (` + canViewOwnSQL + ` and l.assigned_user_id = ` + userIDPlaceholder + `::uuid)
		or (
			` + canViewTeamPlaceholder + `::boolean
			and (
				(
					nullif(to_jsonb(l)->>'team_id', '') is not null
					and exists (
						select 1 from public.team_members leader
						where leader.organization_id = l.organization_id
						  and leader.user_id = ` + userIDPlaceholder + `::uuid
						  and leader.team_id::text = to_jsonb(l)->>'team_id'
						  and leader.is_active = true
						  and leader.is_leader = true
					)
				)
				or (
					nullif(to_jsonb(l)->>'team_id', '') is null
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
	var pipelineID, stageID, assignedUserID, teamID, interestValue, commissionPercentage pgtype.Text
	var lostReason, feedback, finalidadeCompra pgtype.Text
	var isOwnResource pgtype.Bool
	var trabalha, procuraFinanciamento pgtype.Bool
	var cargo, empresa, profissao, endereco, bairro, numero, cep, cidade, uf, rendaFamiliar, faixaValorImovel pgtype.Text
	var rawMetadata []byte
	var stageEnteredAt, boardOrderAt, lastContactAt, nextFollowUpAt pgtype.Timestamptz
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
		&teamID,
		&interestValue,
		&commissionPercentage,
		&lostReason,
		&feedback,
		&finalidadeCompra,
		&trabalha,
		&procuraFinanciamento,
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
		&rawMetadata,
		&lead.CreatedAt,
		&lead.UpdatedAt,
		&stageEnteredAt,
		&boardOrderAt,
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
	lead.TeamID = textValue(teamID)
	lead.InterestValue = textValue(interestValue)
	lead.CommissionPercentage = textValue(commissionPercentage)
	lead.LostReason = textValue(lostReason)
	lead.Feedback = textValue(feedback)
	lead.FinalidadeCompra = textValue(finalidadeCompra)
	lead.Trabalha = boolPtr(trabalha)
	lead.ProcuraFinanciamento = boolPtr(procuraFinanciamento)
	lead.IsOwnResource = boolPtr(isOwnResource)
	lead.StageEnteredAt = timePtr(stageEnteredAt)
	lead.BoardOrderAt = timePtr(boardOrderAt)
	lead.LastContactAt = timePtr(lastContactAt)
	lead.NextFollowUpAt = timePtr(nextFollowUpAt)
	lead.AdditionalFields = additionalFields(cargo, empresa, profissao, endereco, bairro, numero, cep, cidade, uf, rendaFamiliar, faixaValorImovel)
	mergeLeadProfileMetadata(lead.AdditionalFields, rawMetadata)

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

	return fields
}

func mergeLeadProfileMetadata(fields LeadMetadata, rawMetadata []byte) {
	if fields == nil || len(rawMetadata) == 0 {
		return
	}
	var metadata LeadMetadata
	if err := json.Unmarshal(rawMetadata, &metadata); err != nil {
		return
	}
	if profile, ok := metadata["profile"].(map[string]any); ok {
		for key, value := range profile {
			if key == "cpf" || key == "rg" {
				flagKey := "hasCPF"
				if key == "rg" {
					flagKey = "hasRG"
				}
				fields[flagKey] = strings.TrimSpace(fmt.Sprint(value)) != ""
				continue
			}
			fields[key] = value
		}
	}
	if propertyIDs, ok := metadata["interestPropertyIds"]; ok {
		fields["interestPropertyIds"] = propertyIDs
	}
}

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}

	return value.String
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}

	return &value.String
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

func validateLostReasonContract(current leadSnapshot, input updateInput) error {
	nextStatus := current.DealStatus
	if input.DealStatus.Set {
		if input.DealStatus.Value == nil {
			return fmt.Errorf("%w: dealStatus is required", ErrInvalidInput)
		}
		nextStatus = *input.DealStatus.Value
	}

	nextLostReason := current.LostReason
	if input.LostReason.Set {
		nextLostReason = ""
		if input.LostReason.Value != nil {
			nextLostReason = strings.TrimSpace(*input.LostReason.Value)
		}
	}

	lostReasonIsBlank := strings.TrimSpace(nextLostReason) == ""
	isMovingToLost := nextStatus == "lost" && current.DealStatus != "lost"
	isClearingLostReason := nextStatus == "lost" && strings.TrimSpace(current.LostReason) != "" && input.LostReason.Set && lostReasonIsBlank
	if (isMovingToLost || isClearingLostReason) && lostReasonIsBlank {
		return fmt.Errorf("%w: lostReason is required when dealStatus is lost", ErrInvalidInput)
	}

	return nil
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

func canViewAllLeads(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.HasPermission(permissions.LeadViewAll)
}

func canManageLeads(tenantContext tenant.Context) bool {
	return canViewAllLeads(tenantContext) && tenantContext.HasPermission(permissions.LeadOperate)
}

func canCreateLeads(tenantContext tenant.Context) bool {
	return authorization.CanCreateLead(tenantContext)
}

func canCreateLeadInput(tenantContext tenant.Context, input createInput) bool {
	if input.ImportMode {
		return tenantContext.IsOrganizationMember() && tenantContext.HasPermission(permissions.LeadImport)
	}
	return canCreateLeads(tenantContext)
}

func canEditAllLeads(tenantContext tenant.Context) bool {
	return canManageLeads(tenantContext)
}

func canAssignLeads(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission(permissions.LeadOperate)
}

func canMoveLead(tenantContext tenant.Context, assignedUserID string) bool {
	return authorization.CanOperateLead(tenantContext, authorization.LeadResource{AssignedUserID: assignedUserID})
}

func canOperateLeadSnapshot(tenantContext tenant.Context, current leadSnapshot) bool {
	return authorization.CanOperateLead(tenantContext, authorization.LeadResource{
		AssignedUserID: current.AssignedUserID,
		TeamID:         current.TeamID,
	})
}

func canUpdateAssignedLeadOperationalPatch(tenantContext tenant.Context, current leadSnapshot, input updateInput) bool {
	if canOperateLeadSnapshot(tenantContext, current) {
		return isLeadStatusPatch(current, input) || isLeadFeedbackPatch(input) || isLeadPropertyInterestPatch(input)
	}

	return canUpdateLedLeadStatus(tenantContext, current, input)
}

func canUpdateVisibleLeadPropertyInterest(canViewLead bool, input updateInput) bool {
	return canViewLead && isLeadPropertyInterestPatch(input)
}

func canUpdateVisibleLeadStatus(canViewLead bool, current leadSnapshot, input updateInput) bool {
	return canViewLead &&
		isLeadStatusPatch(current, input) &&
		!input.PropertyID.Set &&
		!input.InterestPropertyID.Set &&
		!input.IsOwnResource.Set
}

func canUpdateAssignedLeadStatus(tenantContext tenant.Context, current leadSnapshot, input updateInput) bool {
	return canMoveLead(tenantContext, current.AssignedUserID) && isLeadStatusPatch(current, input) ||
		canUpdateLedLeadStatus(tenantContext, current, input)
}

func canUpdateLedLeadStatus(tenantContext tenant.Context, current leadSnapshot, input updateInput) bool {
	return canOperateLeadSnapshot(tenantContext, current) &&
		isLeadStatusPatch(current, input) &&
		!input.PropertyID.Set &&
		!input.InterestPropertyID.Set &&
		!input.IsOwnResource.Set
}

func isLeadStatusPatch(current leadSnapshot, input updateInput) bool {
	for _, field := range []patchString{
		input.Name,
		input.Email,
		input.Phone,
		input.Source,
		input.Message,
		input.PropertyCode,
		input.PipelineID,
		input.StageID,
		input.AssignedUserID,
		input.InterestValue,
		input.CommissionPercentage,
		input.Feedback,
		input.Cargo,
		input.Empresa,
		input.Profissao,
		input.Endereco,
		input.Numero,
		input.Complemento,
		input.Bairro,
		input.CEP,
		input.Cidade,
		input.UF,
		input.RendaFamiliar,
		input.FaixaValorImovel,
		input.FinalidadeCompra,
	} {
		if field.Set {
			return false
		}
	}

	if input.Trabalha.Set || input.ProcuraFinanciamento.Set {
		return false
	}

	if input.DealStatus.Set {
		return true
	}

	return current.DealStatus == "lost" &&
		input.LostReason.Set &&
		!input.PropertyID.Set &&
		!input.InterestPropertyID.Set &&
		!input.IsOwnResource.Set
}

func isLeadFeedbackPatch(input updateInput) bool {
	if !input.Feedback.Set {
		return false
	}

	for _, field := range []patchString{
		input.Name,
		input.Email,
		input.Phone,
		input.Source,
		input.Message,
		input.PropertyCode,
		input.PropertyID,
		input.InterestPropertyID,
		input.PipelineID,
		input.StageID,
		input.AssignedUserID,
		input.InterestValue,
		input.CommissionPercentage,
		input.DealStatus,
		input.LostReason,
		input.Cargo,
		input.Empresa,
		input.Profissao,
		input.Endereco,
		input.Numero,
		input.Complemento,
		input.Bairro,
		input.CEP,
		input.Cidade,
		input.UF,
		input.RendaFamiliar,
		input.FaixaValorImovel,
		input.FinalidadeCompra,
	} {
		if field.Set {
			return false
		}
	}

	return !input.Trabalha.Set &&
		!input.ProcuraFinanciamento.Set &&
		!input.IsOwnResource.Set
}

func isLeadPropertyInterestPatch(input updateInput) bool {
	if !input.PropertyID.Set && !input.InterestPropertyID.Set {
		return false
	}
	if (!input.PropertyID.Set || input.PropertyID.Value == nil) &&
		(!input.InterestPropertyID.Set || input.InterestPropertyID.Value == nil) {
		return false
	}

	for _, field := range []patchString{
		input.Name,
		input.Email,
		input.Phone,
		input.Source,
		input.Message,
		input.PipelineID,
		input.StageID,
		input.AssignedUserID,
		input.DealStatus,
		input.LostReason,
		input.Feedback,
		input.Cargo,
		input.Empresa,
		input.Profissao,
		input.Endereco,
		input.Numero,
		input.Complemento,
		input.Bairro,
		input.CEP,
		input.Cidade,
		input.UF,
		input.RendaFamiliar,
		input.FaixaValorImovel,
		input.FinalidadeCompra,
	} {
		if field.Set {
			return false
		}
	}

	return !input.Trabalha.Set &&
		!input.ProcuraFinanciamento.Set &&
		!input.IsOwnResource.Set
}

func canTransferLead(tenantContext tenant.Context, assignedUserID string) bool {
	return authorization.CanOperateLead(tenantContext, authorization.LeadResource{AssignedUserID: assignedUserID})
}

func canDeleteLeads(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission(permissions.LeadDelete)
}
