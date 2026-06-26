package pipelines

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
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

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context) ([]Pipeline, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			p.id::text,
			p.organization_id::text,
			p.name,
			coalesce(p.is_default, false),
			coalesce(p.is_active, true),
			coalesce(p.position, 0),
			(
				select rr.id::text
				from public.round_robins rr
				where rr.organization_id = p.organization_id
				  and rr.pipeline_id = p.id
				  and rr.is_active = true
				order by rr.created_at asc
				limit 1
			),
			p.created_at,
			p.updated_at
		from public.pipelines p
		where p.organization_id = $1::uuid
		order by coalesce(p.position, 0), p.created_at
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Pipeline{}
	for rows.Next() {
		pipeline, err := scanPipeline(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, pipeline)
	}

	return out, rows.Err()
}

func (repo Repository) Create(ctx context.Context, tenantContext tenant.Context, input createPipelineInput) (Pipeline, error) {
	if !canManagePipelines(tenantContext) {
		return Pipeline{}, tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Pipeline{}, err
	}
	defer tx.Rollback(ctx)

	if input.IsDefault {
		if _, err := tx.Exec(ctx, `
			update public.pipelines
			set is_default = false,
			    updated_at = now()
			where organization_id = $1::uuid
		`, tenantContext.OrganizationID); err != nil {
			return Pipeline{}, err
		}
	}

	var pipelineID string
	err = tx.QueryRow(ctx, `
		insert into public.pipelines (
			organization_id,
			name,
			is_default,
			is_active,
			position
		)
		values (
			$1::uuid,
			$2,
			$3,
			true,
			coalesce((
				select max(position) + 1
				from public.pipelines
				where organization_id = $1::uuid
			), 0)
		)
		returning id::text
	`, tenantContext.OrganizationID, input.Name, input.IsDefault).Scan(&pipelineID)
	if err != nil {
		return Pipeline{}, err
	}

	if err := repo.createDefaultStages(ctx, tx, tenantContext.OrganizationID, pipelineID); err != nil {
		return Pipeline{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Pipeline{}, err
	}

	return repo.Get(ctx, tenantContext, pipelineID)
}

func (repo Repository) Get(ctx context.Context, tenantContext tenant.Context, pipelineID string) (Pipeline, error) {
	pipelineID, ok := normalizeUUID(pipelineID)
	if !ok {
		return Pipeline{}, ErrPipelineNotFound
	}

	pipeline, err := scanPipeline(repo.db.Pool().QueryRow(ctx, `
		select
			p.id::text,
			p.organization_id::text,
			p.name,
			coalesce(p.is_default, false),
			coalesce(p.is_active, true),
			coalesce(p.position, 0),
			(
				select rr.id::text
				from public.round_robins rr
				where rr.organization_id = p.organization_id
				  and rr.pipeline_id = p.id
				  and rr.is_active = true
				order by rr.created_at asc
				limit 1
			),
			p.created_at,
			p.updated_at
		from public.pipelines p
		where p.organization_id = $1::uuid
		  and p.id = $2::uuid
		limit 1
	`, tenantContext.OrganizationID, pipelineID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Pipeline{}, ErrPipelineNotFound
	}
	return pipeline, err
}

func (repo Repository) Update(ctx context.Context, tenantContext tenant.Context, pipelineID string, input updatePipelineInput) (Pipeline, error) {
	pipelineID, ok := normalizeUUID(pipelineID)
	if !ok {
		return Pipeline{}, ErrPipelineNotFound
	}
	if !canManagePipelines(tenantContext) {
		return Pipeline{}, tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Pipeline{}, err
	}
	defer tx.Rollback(ctx)

	if err := repo.ensurePipeline(ctx, tx, tenantContext.OrganizationID, pipelineID); err != nil {
		return Pipeline{}, err
	}

	if input.IsDefault.Set && input.IsDefault.Value != nil && *input.IsDefault.Value {
		if _, err := tx.Exec(ctx, `
			update public.pipelines
			set is_default = false,
			    updated_at = now()
			where organization_id = $1::uuid
			  and id <> $2::uuid
		`, tenantContext.OrganizationID, pipelineID); err != nil {
			return Pipeline{}, err
		}
	}

	assignments := []string{}
	args := []any{tenantContext.OrganizationID, pipelineID}
	if input.Name.Set {
		args = append(args, nullablePatchString(input.Name))
		assignments = append(assignments, fmt.Sprintf("name = $%d", len(args)))
	}
	if input.IsDefault.Set {
		args = append(args, nullablePatchBool(input.IsDefault))
		assignments = append(assignments, fmt.Sprintf("is_default = coalesce($%d::boolean, false)", len(args)))
	}
	assignments = append(assignments, "updated_at = now()")

	if _, err := tx.Exec(ctx, `
		update public.pipelines
		set `+strings.Join(assignments, ", ")+`
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, args...); err != nil {
		return Pipeline{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Pipeline{}, err
	}

	return repo.Get(ctx, tenantContext, pipelineID)
}

func (repo Repository) Delete(ctx context.Context, tenantContext tenant.Context, pipelineID string) error {
	pipelineID, ok := normalizeUUID(pipelineID)
	if !ok {
		return ErrPipelineNotFound
	}
	if !canManagePipelines(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := repo.ensurePipeline(ctx, tx, tenantContext.OrganizationID, pipelineID); err != nil {
		return err
	}

	leadCount, err := repo.countPipelineLeads(ctx, tx, tenantContext.OrganizationID, pipelineID)
	if err != nil {
		return err
	}
	if leadCount > 0 {
		return ErrHasLeads
	}

	tag, err := tx.Exec(ctx, `
		delete from public.pipelines
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, pipelineID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrPipelineNotFound
	}

	return tx.Commit(ctx)
}

func (repo Repository) ListStages(ctx context.Context, tenantContext tenant.Context, pipelineID string) ([]Stage, error) {
	args := []any{tenantContext.OrganizationID}
	where := "s.organization_id = $1::uuid"
	if strings.TrimSpace(pipelineID) != "" {
		normalized, ok := normalizeUUID(pipelineID)
		if !ok {
			return nil, ErrPipelineNotFound
		}
		args = append(args, normalized)
		where += " and s.pipeline_id = $2::uuid"
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+stageSelectFields()+`
		from public.stages s
		where `+where+`
		order by s.position asc, s.created_at asc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Stage{}
	for rows.Next() {
		stage, err := scanStage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, stage)
	}

	return out, rows.Err()
}

func (repo Repository) CreateStage(ctx context.Context, tenantContext tenant.Context, pipelineID string, input createStageInput) (Stage, error) {
	pipelineID, ok := normalizeUUID(pipelineID)
	if !ok {
		return Stage{}, ErrPipelineNotFound
	}
	if !canManagePipelines(tenantContext) {
		return Stage{}, tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Stage{}, err
	}
	defer tx.Rollback(ctx)

	if err := repo.ensurePipeline(ctx, tx, tenantContext.OrganizationID, pipelineID); err != nil {
		return Stage{}, err
	}

	stageKey, err := repo.uniqueStageKey(ctx, tx, tenantContext.OrganizationID, pipelineID, input.Name)
	if err != nil {
		return Stage{}, err
	}

	var stageID string
	err = tx.QueryRow(ctx, `
		insert into public.stages (
			organization_id,
			pipeline_id,
			name,
			color,
			position,
			stage_key,
			is_active
		)
		values (
			$1::uuid,
			$2::uuid,
			$3,
			$4,
			coalesce((
				select max(position) + 1
				from public.stages
				where organization_id = $1::uuid
				  and pipeline_id = $2::uuid
			), 0),
			$5,
			true
		)
		returning id::text
	`, tenantContext.OrganizationID, pipelineID, input.Name, input.Color, stageKey).Scan(&stageID)
	if err != nil {
		return Stage{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Stage{}, err
	}

	return repo.GetStage(ctx, tenantContext, stageID)
}

func (repo Repository) GetStage(ctx context.Context, tenantContext tenant.Context, stageID string) (Stage, error) {
	stageID, ok := normalizeUUID(stageID)
	if !ok {
		return Stage{}, ErrStageNotFound
	}

	stage, err := scanStage(repo.db.Pool().QueryRow(ctx, `
		select `+stageSelectFields()+`
		from public.stages s
		where s.organization_id = $1::uuid
		  and s.id = $2::uuid
		limit 1
	`, tenantContext.OrganizationID, stageID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Stage{}, ErrStageNotFound
	}
	return stage, err
}

func (repo Repository) UpdateStage(ctx context.Context, tenantContext tenant.Context, stageID string, input updateStageInput) (Stage, error) {
	stageID, ok := normalizeUUID(stageID)
	if !ok {
		return Stage{}, ErrStageNotFound
	}
	if !canManagePipelines(tenantContext) {
		return Stage{}, tenant.ErrOrganizationAccessDenied
	}

	assignments := []string{}
	args := []any{tenantContext.OrganizationID, stageID}
	addString := func(column string, field patchString) {
		if !field.Set {
			return
		}
		args = append(args, nullablePatchString(field))
		assignments = append(assignments, fmt.Sprintf("%s = $%d", column, len(args)))
	}
	addBool := func(column string, field patchBool) {
		if !field.Set {
			return
		}
		args = append(args, nullablePatchBool(field))
		assignments = append(assignments, fmt.Sprintf("%s = coalesce($%d::boolean, false)", column, len(args)))
	}

	addString("name", input.Name)
	addString("color", input.Color)
	addString("stage_key", input.StageKey)
	addBool("is_won", input.IsWon)
	addBool("is_lost", input.IsLost)
	addBool("is_active", input.IsActive)
	assignments = append(assignments, "updated_at = now()")

	tag, err := repo.db.Pool().Exec(ctx, `
		update public.stages
		set `+strings.Join(assignments, ", ")+`
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, args...)
	if err != nil {
		return Stage{}, err
	}
	if tag.RowsAffected() == 0 {
		return Stage{}, ErrStageNotFound
	}

	return repo.GetStage(ctx, tenantContext, stageID)
}

func (repo Repository) ReorderStages(ctx context.Context, tenantContext tenant.Context, pipelineID string, input reorderStagesInput) ([]Stage, error) {
	pipelineID, ok := normalizeUUID(pipelineID)
	if !ok {
		return nil, ErrPipelineNotFound
	}
	if !canManagePipelines(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if err := repo.ensurePipeline(ctx, tx, tenantContext.OrganizationID, pipelineID); err != nil {
		return nil, err
	}

	for _, item := range input.Stages {
		var existingPipelineID pgtype.Text
		err := tx.QueryRow(ctx, `
			select pipeline_id::text
			from public.stages
			where id = $1::uuid
			limit 1
		`, item.ID).Scan(&existingPipelineID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		if existingPipelineID.Valid && existingPipelineID.String != pipelineID {
			return nil, ErrInvalidReference
		}

		_, err = tx.Exec(ctx, `
			insert into public.stages (
				id,
				organization_id,
				pipeline_id,
				name,
				color,
				position,
				stage_key,
				is_active
			)
			values (
				$1::uuid,
				$2::uuid,
				$3::uuid,
				$4,
				$5,
				$6,
				$7,
				true
			)
			on conflict (id) do update set
				name = excluded.name,
				color = excluded.color,
				position = excluded.position,
				stage_key = excluded.stage_key,
				updated_at = now()
			where public.stages.organization_id = $2::uuid
			  and public.stages.pipeline_id = $3::uuid
		`, item.ID, tenantContext.OrganizationID, pipelineID, item.Name, item.Color, item.Position, item.StageKey)
		if err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return repo.ListStages(ctx, tenantContext, pipelineID)
}

func (repo Repository) DeleteStage(ctx context.Context, tenantContext tenant.Context, stageID string) error {
	stageID, ok := normalizeUUID(stageID)
	if !ok {
		return ErrStageNotFound
	}
	if !canManagePipelines(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := repo.getStagePipelineID(ctx, tx, tenantContext.OrganizationID, stageID); err != nil {
		return err
	}

	var leadCount int64
	if err := tx.QueryRow(ctx, `
		select count(*)
		from public.leads
		where organization_id = $1::uuid
		  and stage_id = $2::uuid
	`, tenantContext.OrganizationID, stageID).Scan(&leadCount); err != nil {
		return err
	}
	if leadCount > 0 {
		return ErrHasLeads
	}

	tag, err := tx.Exec(ctx, `
		delete from public.stages
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, stageID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrStageNotFound
	}

	return tx.Commit(ctx)
}

func (repo Repository) SetDefaultRoundRobin(ctx context.Context, tenantContext tenant.Context, pipelineID string, input setPipelineRoundRobinInput) (Pipeline, error) {
	pipelineID, ok := normalizeUUID(pipelineID)
	if !ok {
		return Pipeline{}, ErrPipelineNotFound
	}
	if !canManagePipelines(tenantContext) {
		return Pipeline{}, tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Pipeline{}, err
	}
	defer tx.Rollback(ctx)

	if err := repo.ensurePipeline(ctx, tx, tenantContext.OrganizationID, pipelineID); err != nil {
		return Pipeline{}, err
	}

	if input.RoundRobinID == nil {
		if _, err := tx.Exec(ctx, `
			update public.round_robins
			set pipeline_id = null,
			    updated_at = now()
			where organization_id = $1::uuid
			  and pipeline_id = $2::uuid
		`, tenantContext.OrganizationID, pipelineID); err != nil {
			return Pipeline{}, err
		}
	} else {
		tag, err := tx.Exec(ctx, `
			update public.round_robins
			set pipeline_id = $3::uuid,
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, tenantContext.OrganizationID, *input.RoundRobinID, pipelineID)
		if err != nil {
			return Pipeline{}, err
		}
		if tag.RowsAffected() == 0 {
			return Pipeline{}, ErrInvalidReference
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Pipeline{}, err
	}

	return repo.Get(ctx, tenantContext, pipelineID)
}

func (repo Repository) createDefaultStages(ctx context.Context, tx pgx.Tx, organizationID string, pipelineID string) error {
	defaults := []struct {
		name     string
		stageKey string
		color    string
	}{
		{name: "Novo", stageKey: "new", color: "#FF4529"},
		{name: "Em atendimento", stageKey: "in_progress", color: "#f59e0b"},
		{name: "Visita agendada", stageKey: "scheduled_visit", color: "#3b82f6"},
		{name: "Fechamento", stageKey: "closing", color: "#10b981"},
	}

	for index, stage := range defaults {
		if _, err := tx.Exec(ctx, `
			insert into public.stages (
				organization_id,
				pipeline_id,
				name,
				stage_key,
				color,
				position,
				is_active
			)
			values ($1::uuid, $2::uuid, $3, $4, $5, $6, true)
		`, organizationID, pipelineID, stage.name, stage.stageKey, stage.color, index); err != nil {
			return err
		}
	}

	return nil
}

func (repo Repository) ensurePipeline(ctx context.Context, tx pgx.Tx, organizationID string, pipelineID string) error {
	var exists bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.pipelines
			where organization_id = $1::uuid
			  and id = $2::uuid
		)
	`, organizationID, pipelineID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrPipelineNotFound
	}
	return nil
}

func (repo Repository) countPipelineLeads(ctx context.Context, tx pgx.Tx, organizationID string, pipelineID string) (int64, error) {
	var count int64
	err := tx.QueryRow(ctx, `
		select count(*)
		from public.leads
		where organization_id = $1::uuid
		  and pipeline_id = $2::uuid
	`, organizationID, pipelineID).Scan(&count)
	return count, err
}

func (repo Repository) getStagePipelineID(ctx context.Context, tx pgx.Tx, organizationID string, stageID string) (string, error) {
	var pipelineID string
	err := tx.QueryRow(ctx, `
		select pipeline_id::text
		from public.stages
		where organization_id = $1::uuid
		  and id = $2::uuid
		limit 1
	`, organizationID, stageID).Scan(&pipelineID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrStageNotFound
	}
	return pipelineID, err
}

func (repo Repository) uniqueStageKey(ctx context.Context, tx pgx.Tx, organizationID string, pipelineID string, name string) (string, error) {
	baseKey := buildStageKey(name)
	rows, err := tx.Query(ctx, `
		select stage_key
		from public.stages
		where organization_id = $1::uuid
		  and pipeline_id = $2::uuid
		  and stage_key is not null
	`, organizationID, pipelineID)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	used := map[string]struct{}{}
	for rows.Next() {
		var stageKey pgtype.Text
		if err := rows.Scan(&stageKey); err != nil {
			return "", err
		}
		if stageKey.Valid {
			used[stageKey.String] = struct{}{}
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}

	if _, exists := used[baseKey]; !exists {
		return baseKey, nil
	}

	for suffix := 2; ; suffix++ {
		candidate := fmt.Sprintf("%s_%d", baseKey, suffix)
		if _, exists := used[candidate]; !exists {
			return candidate, nil
		}
	}
}

func scanPipeline(row scanner) (Pipeline, error) {
	var pipeline Pipeline
	var defaultRoundRobinID pgtype.Text
	if err := row.Scan(
		&pipeline.ID,
		&pipeline.OrganizationID,
		&pipeline.Name,
		&pipeline.IsDefault,
		&pipeline.IsActive,
		&pipeline.Position,
		&defaultRoundRobinID,
		&pipeline.CreatedAt,
		&pipeline.UpdatedAt,
	); err != nil {
		return Pipeline{}, err
	}
	pipeline.DefaultRoundRobinID = textValue(defaultRoundRobinID)
	return pipeline, nil
}

func stageSelectFields() string {
	return `
		s.id::text,
		s.organization_id::text,
		s.pipeline_id::text,
		s.name,
		s.color,
		s.stage_key,
		coalesce(s.position, 0),
		coalesce(s.is_won, false),
		coalesce(s.is_lost, false),
		coalesce(s.is_active, true),
		s.created_at,
		s.updated_at`
}

func scanStage(row scanner) (Stage, error) {
	var stage Stage
	var color, stageKey pgtype.Text
	if err := row.Scan(
		&stage.ID,
		&stage.OrganizationID,
		&stage.PipelineID,
		&stage.Name,
		&color,
		&stageKey,
		&stage.Position,
		&stage.IsWon,
		&stage.IsLost,
		&stage.IsActive,
		&stage.CreatedAt,
		&stage.UpdatedAt,
	); err != nil {
		return Stage{}, err
	}

	stage.Color = textValue(color)
	stage.StageKey = textValue(stageKey)
	return stage, nil
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

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func canManagePipelines(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin", "manager") ||
		tenantContext.HasPermission("lead_manage") ||
		tenantContext.HasPermission("pipeline_edit")
}
