package attention

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db *dbpkg.Postgres
}

type scanner interface {
	Scan(dest ...any) error
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

func (repo Repository) ListPolicies(ctx context.Context, tenantContext tenant.Context, includeArchived bool) ([]Policy, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := repo.ensureOrganizationSettings(ctx, tx, tenantContext); err != nil {
		return nil, err
	}
	where := "p.organization_id = $1::uuid"
	if !includeArchived {
		where += " and p.status <> 'archived'"
	}
	rows, err := tx.Query(ctx, policySelectSQL()+`
		where `+where+`
		order by p.policy_type, p.name, p.version desc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	policies := []Policy{}
	for rows.Next() {
		policy, err := scanPolicy(rows)
		if err != nil {
			return nil, err
		}
		policies = append(policies, policy)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return policies, nil
}

func (repo Repository) CreatePolicy(ctx context.Context, tenantContext tenant.Context, request PolicyRequest) (Policy, error) {
	if !canManagePolicies(tenantContext) {
		return Policy{}, ErrForbidden
	}
	input, err := normalizeCreatePolicy(request)
	if err != nil {
		return Policy{}, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Policy{}, err
	}
	defer tx.Rollback(ctx)
	if err := repo.ensurePolicyScope(ctx, tx, tenantContext.OrganizationID, input.PipelineID, input.StageID); err != nil {
		return Policy{}, err
	}

	var policyID string
	err = tx.QueryRow(ctx, `
		insert into public.lead_attention_policies (
			organization_id, version, name, policy_type, status,
			pipeline_id, stage_id, threshold_minutes, warning_minutes,
			repeat_minutes, escalation_minutes, redistribution_minutes,
			business_hours_only, redistribute_before_contact_only,
			notify_assignee, notify_leaders, notify_admins, config, created_by
		) values (
			$1::uuid, 1, $2, $3, $4,
			$5::uuid, $6::uuid, $7, $8,
			$9, $10, $11,
			$12, $13,
			$14, $15, $16, $17::jsonb, $18::uuid
		)
		returning id::text
	`, tenantContext.OrganizationID, input.Name, input.PolicyType, input.Status,
		nullableText(input.PipelineID), nullableText(input.StageID), input.ThresholdMinutes, input.WarningMinutes,
		nullableInt(input.RepeatMinutes), nullableInt(input.EscalationMinutes), nullableInt(input.RedistributionMinutes),
		input.BusinessHoursOnly, input.RedistributeBeforeContactOnly,
		input.NotifyAssignee, input.NotifyLeaders, input.NotifyAdmins, jsonValue(input.Config), tenantContext.UserID,
	).Scan(&policyID)
	if err != nil {
		return Policy{}, translatePolicyWriteError(err)
	}
	policy, err := repo.showPolicyTx(ctx, tx, tenantContext.OrganizationID, policyID, false)
	if err != nil {
		return Policy{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Policy{}, err
	}
	return policy, nil
}

func (repo Repository) UpdatePolicy(ctx context.Context, tenantContext tenant.Context, policyID string, request PolicyRequest) (Policy, error) {
	if !canManagePolicies(tenantContext) {
		return Policy{}, ErrForbidden
	}
	if !validUUID(policyID) {
		return Policy{}, ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Policy{}, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.showPolicyTx(ctx, tx, tenantContext.OrganizationID, policyID, true)
	if err != nil {
		return Policy{}, err
	}
	if current.Status == "archived" {
		return Policy{}, ErrNotFound
	}
	input, err := normalizeUpdatePolicy(current, request)
	if err != nil {
		return Policy{}, err
	}
	if err := repo.ensurePolicyScope(ctx, tx, tenantContext.OrganizationID, input.PipelineID, input.StageID); err != nil {
		return Policy{}, err
	}

	if _, err := tx.Exec(ctx, `
		update public.lead_attention_policies
		set status = 'archived', updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, tenantContext.OrganizationID, current.ID); err != nil {
		return Policy{}, err
	}

	var nextID string
	err = tx.QueryRow(ctx, `
		insert into public.lead_attention_policies (
			organization_id, policy_key, version, name, policy_type, status,
			pipeline_id, stage_id, threshold_minutes, warning_minutes,
			repeat_minutes, escalation_minutes, redistribution_minutes,
			business_hours_only, redistribute_before_contact_only,
			notify_assignee, notify_leaders, notify_admins, config, created_by
		) values (
			$1::uuid, $2::uuid, $3, $4, $5, $6,
			$7::uuid, $8::uuid, $9, $10,
			$11, $12, $13,
			$14, $15,
			$16, $17, $18, $19::jsonb, $20::uuid
		)
		returning id::text
	`, tenantContext.OrganizationID, current.PolicyKey, current.Version+1, input.Name, input.PolicyType, input.Status,
		nullableText(input.PipelineID), nullableText(input.StageID), input.ThresholdMinutes, input.WarningMinutes,
		nullableInt(input.RepeatMinutes), nullableInt(input.EscalationMinutes), nullableInt(input.RedistributionMinutes),
		input.BusinessHoursOnly, input.RedistributeBeforeContactOnly,
		input.NotifyAssignee, input.NotifyLeaders, input.NotifyAdmins, jsonValue(input.Config), tenantContext.UserID,
	).Scan(&nextID)
	if err != nil {
		return Policy{}, translatePolicyWriteError(err)
	}
	next, err := repo.showPolicyTx(ctx, tx, tenantContext.OrganizationID, nextID, false)
	if err != nil {
		return Policy{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Policy{}, err
	}
	return next, nil
}

func (repo Repository) showPolicyTx(ctx context.Context, tx pgx.Tx, organizationID, policyID string, lock bool) (Policy, error) {
	lockClause := ""
	if lock {
		lockClause = " for update of p"
	}
	policy, err := scanPolicy(tx.QueryRow(ctx, policySelectSQL()+`
		where p.organization_id = $1::uuid and p.id = $2::uuid`+lockClause,
		organizationID, policyID,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return Policy{}, ErrNotFound
	}
	return policy, err
}

func (repo Repository) ensurePolicyScope(ctx context.Context, tx pgx.Tx, organizationID string, pipelineID, stageID *string) error {
	if pipelineID != nil && !validUUID(*pipelineID) {
		return fmt.Errorf("%w: pipelineId is invalid", ErrInvalidInput)
	}
	if stageID != nil && !validUUID(*stageID) {
		return fmt.Errorf("%w: stageId is invalid", ErrInvalidInput)
	}
	if pipelineID != nil {
		var exists bool
		if err := tx.QueryRow(ctx, `
			select exists (
				select 1 from public.pipelines
				where organization_id = $1::uuid and id = $2::uuid
			)
		`, organizationID, *pipelineID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("%w: pipelineId does not belong to the organization", ErrInvalidInput)
		}
	}
	if stageID != nil {
		var exists bool
		if err := tx.QueryRow(ctx, `
			select exists (
				select 1 from public.stages
				where organization_id = $1::uuid
				  and id = $2::uuid
				  and ($3::uuid is null or pipeline_id = $3::uuid)
			)
		`, organizationID, *stageID, nullableText(pipelineID)).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("%w: stageId does not belong to the selected pipeline", ErrInvalidInput)
		}
	}
	return nil
}

func policySelectSQL() string {
	return `
		select
			p.id::text, p.organization_id::text, p.policy_key::text, p.version,
			p.name, p.policy_type, p.status,
			p.pipeline_id::text, pi.name,
			p.stage_id::text, s.name,
			p.threshold_minutes, p.warning_minutes, p.repeat_minutes,
			p.escalation_minutes, p.redistribution_minutes,
			p.business_hours_only, p.redistribute_before_contact_only,
			p.notify_assignee, p.notify_leaders, p.notify_admins,
			p.config, p.created_by::text, p.created_at, p.updated_at
		from public.lead_attention_policies p
		left join public.pipelines pi
		  on pi.organization_id = p.organization_id and pi.id = p.pipeline_id
		left join public.stages s
		  on s.organization_id = p.organization_id and s.id = p.stage_id
	`
}

func scanPolicy(row scanner) (Policy, error) {
	var policy Policy
	var pipelineID, pipelineName, stageID, stageName, createdBy pgtype.Text
	var repeatMinutes, escalationMinutes, redistributionMinutes pgtype.Int4
	var config []byte
	err := row.Scan(
		&policy.ID, &policy.OrganizationID, &policy.PolicyKey, &policy.Version,
		&policy.Name, &policy.PolicyType, &policy.Status,
		&pipelineID, &pipelineName, &stageID, &stageName,
		&policy.ThresholdMinutes, &policy.WarningMinutes, &repeatMinutes,
		&escalationMinutes, &redistributionMinutes,
		&policy.BusinessHoursOnly, &policy.RedistributeBeforeOnly,
		&policy.NotifyAssignee, &policy.NotifyLeaders, &policy.NotifyAdmins,
		&config, &createdBy, &policy.CreatedAt, &policy.UpdatedAt,
	)
	if err != nil {
		return Policy{}, err
	}
	policy.PipelineID = textPointer(pipelineID)
	policy.PipelineName = textPointer(pipelineName)
	policy.StageID = textPointer(stageID)
	policy.StageName = textPointer(stageName)
	policy.CreatedBy = textPointer(createdBy)
	policy.RepeatMinutes = intPointer(repeatMinutes)
	policy.EscalationMinutes = intPointer(escalationMinutes)
	policy.RedistributionMinutes = intPointer(redistributionMinutes)
	policy.Config = decodeMap(config)
	return policy, nil
}

func translatePolicyWriteError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return fmt.Errorf("%w: an active policy already exists for this scope", ErrInvalidInput)
		case "23503", "23514", "22P02":
			return fmt.Errorf("%w: policy violates the database contract", ErrInvalidInput)
		}
	}
	return err
}

func validUUID(value string) bool {
	var uuid pgtype.UUID
	return uuid.Scan(strings.TrimSpace(value)) == nil && uuid.Valid
}

func nullableText(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}

func nullableInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	copy := value.String
	return &copy
}

func intPointer(value pgtype.Int4) *int {
	if !value.Valid {
		return nil
	}
	copy := int(value.Int32)
	return &copy
}

func timePointer(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	copy := value.Time
	return &copy
}

func jsonValue(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func decodeMap(value []byte) map[string]any {
	result := map[string]any{}
	if len(value) > 0 {
		_ = json.Unmarshal(value, &result)
	}
	return result
}

type pageCursor struct {
	UpdatedAt time.Time `json:"updatedAt"`
	ID        string    `json:"id"`
}

func encodeCursor(updatedAt time.Time, id string) string {
	payload, _ := json.Marshal(pageCursor{UpdatedAt: updatedAt.UTC(), ID: id})
	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeCursor(value string) (pageCursor, error) {
	if strings.TrimSpace(value) == "" {
		return pageCursor{}, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return pageCursor{}, ErrInvalidInput
	}
	var cursor pageCursor
	if err := json.Unmarshal(payload, &cursor); err != nil || cursor.UpdatedAt.IsZero() || !validUUID(cursor.ID) {
		return pageCursor{}, ErrInvalidInput
	}
	return cursor, nil
}

func parseLimit(value string) int {
	limit, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || limit <= 0 {
		return 50
	}
	if limit > 200 {
		return 200
	}
	return limit
}
