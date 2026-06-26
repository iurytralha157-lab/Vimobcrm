package stageconfig

import (
	"context"
	"encoding/json"
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

func (repo Repository) ListAutomations(ctx context.Context, tenantContext tenant.Context, stageID string) ([]StageAutomation, error) {
	args := []any{tenantContext.OrganizationID}
	where := "organization_id = $1::uuid"
	if strings.TrimSpace(stageID) != "" {
		normalized, ok := normalizeUUID(stageID)
		if !ok {
			return nil, ErrInvalidInput
		}
		args = append(args, normalized)
		where += " and stage_id = $2::uuid"
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+stageAutomationSelectFields()+`
		from public.stage_automations
		where `+where+`
		order by created_at desc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []StageAutomation{}
	for rows.Next() {
		item, err := scanStageAutomation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (repo Repository) CreateAutomation(ctx context.Context, tenantContext tenant.Context, input stageAutomationInput) (StageAutomation, error) {
	if !canManageStageConfig(tenantContext) {
		return StageAutomation{}, tenant.ErrOrganizationAccessDenied
	}
	stageID, ok := normalizeUUID(input.StageID)
	if !ok {
		return StageAutomation{}, ErrInvalidInput
	}
	configJSON := jsonb(input.Config)

	automation, err := scanStageAutomation(repo.db.Pool().QueryRow(ctx, `
		insert into public.stage_automations (
			organization_id,
			stage_id,
			trigger_type,
			config,
			is_active
		)
		select
			s.organization_id,
			s.id,
			$3,
			$4::jsonb,
			$5
		from public.stages s
		where s.organization_id = $1::uuid
		  and s.id = $2::uuid
		returning `+stageAutomationSelectFields()+`
	`, tenantContext.OrganizationID, stageID, input.TriggerType, configJSON, input.IsActive))
	if errors.Is(err, pgx.ErrNoRows) {
		return StageAutomation{}, ErrNotFound
	}
	return automation, err
}

func (repo Repository) UpdateAutomation(ctx context.Context, tenantContext tenant.Context, automationID string, input stageAutomationInput) (StageAutomation, error) {
	if !canManageStageConfig(tenantContext) {
		return StageAutomation{}, tenant.ErrOrganizationAccessDenied
	}
	automationID, ok := normalizeUUID(automationID)
	if !ok {
		return StageAutomation{}, ErrInvalidInput
	}

	automation, err := scanStageAutomation(repo.db.Pool().QueryRow(ctx, `
		update public.stage_automations
		set trigger_type = $3,
		    config = $4::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning `+stageAutomationSelectFields()+`
	`, tenantContext.OrganizationID, automationID, input.TriggerType, jsonb(input.Config)))
	if errors.Is(err, pgx.ErrNoRows) {
		return StageAutomation{}, ErrNotFound
	}
	return automation, err
}

func (repo Repository) DeleteAutomation(ctx context.Context, tenantContext tenant.Context, automationID string) error {
	if !canManageStageConfig(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	automationID, ok := normalizeUUID(automationID)
	if !ok {
		return ErrInvalidInput
	}
	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.stage_automations
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, automationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (repo Repository) ToggleAutomation(ctx context.Context, tenantContext tenant.Context, automationID string, isActive bool) (StageAutomation, error) {
	if !canManageStageConfig(tenantContext) {
		return StageAutomation{}, tenant.ErrOrganizationAccessDenied
	}
	automationID, ok := normalizeUUID(automationID)
	if !ok {
		return StageAutomation{}, ErrInvalidInput
	}
	automation, err := scanStageAutomation(repo.db.Pool().QueryRow(ctx, `
		update public.stage_automations
		set is_active = $3,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning `+stageAutomationSelectFields()+`
	`, tenantContext.OrganizationID, automationID, isActive))
	if errors.Is(err, pgx.ErrNoRows) {
		return StageAutomation{}, ErrNotFound
	}
	return automation, err
}

func (repo Repository) ListOperationalConfigs(ctx context.Context, tenantContext tenant.Context, pipelineID string, stageID string) ([]StageOperationalConfig, error) {
	pipelineID = strings.TrimSpace(pipelineID)
	stageID = strings.TrimSpace(stageID)
	if pipelineID != "" {
		var ok bool
		pipelineID, ok = normalizeUUID(pipelineID)
		if !ok {
			return nil, ErrInvalidInput
		}
	}
	if stageID != "" {
		var ok bool
		stageID, ok = normalizeUUID(stageID)
		if !ok {
			return nil, ErrInvalidInput
		}
	}

	detailed, err := repo.hasDetailedOperationalSchema(ctx)
	if err != nil {
		return nil, err
	}
	if detailed {
		return repo.listOperationalConfigsDetailed(ctx, tenantContext, pipelineID, stageID)
	}
	return repo.listOperationalConfigsJSON(ctx, tenantContext, pipelineID, stageID)
}

func (repo Repository) UpsertOperationalConfig(ctx context.Context, tenantContext tenant.Context, request StageOperationalConfigRequest) (StageOperationalConfig, error) {
	if !canManageStageConfig(tenantContext) {
		return StageOperationalConfig{}, tenant.ErrOrganizationAccessDenied
	}
	stageID, ok := normalizeUUID(request.StageID)
	if !ok {
		return StageOperationalConfig{}, ErrInvalidInput
	}
	if err := repo.ensureStage(ctx, tenantContext.OrganizationID, stageID); err != nil {
		return StageOperationalConfig{}, err
	}

	detailed, err := repo.hasDetailedOperationalSchema(ctx)
	if err != nil {
		return StageOperationalConfig{}, err
	}
	if detailed {
		if err := repo.upsertOperationalConfigDetailed(ctx, tenantContext, stageID, request); err != nil {
			return StageOperationalConfig{}, err
		}
	} else if err := repo.upsertOperationalConfigJSON(ctx, tenantContext, stageID, request); err != nil {
		return StageOperationalConfig{}, err
	}

	items, err := repo.ListOperationalConfigs(ctx, tenantContext, "", stageID)
	if err != nil {
		return StageOperationalConfig{}, err
	}
	if len(items) == 0 {
		return StageOperationalConfig{}, ErrNotFound
	}
	return items[0], nil
}

func (repo Repository) ListPipelineSLASettings(ctx context.Context, tenantContext tenant.Context, pipelineID string) ([]map[string]any, error) {
	args := []any{tenantContext.OrganizationID}
	where := "organization_id = $1::uuid"
	if strings.TrimSpace(pipelineID) != "" {
		normalized, ok := normalizeUUID(pipelineID)
		if !ok {
			return nil, ErrInvalidInput
		}
		args = append(args, normalized)
		where += " and pipeline_id = $2::uuid"
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select jsonb_build_object(
			'id', id::text,
			'organization_id', organization_id::text,
			'pipeline_id', pipeline_id::text,
			'stage_id', stage_id::text,
			'warning_hours', greatest(1, floor(coalesce(target_hours, 24)::numeric / 2)::int),
			'critical_hours', coalesce(target_hours, 24),
			'sla_start_field', 'created_at',
			'created_at', created_at,
			'updated_at', updated_at
		)
		from public.pipeline_sla_settings
		where `+where+`
		order by created_at desc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []map[string]any{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item map[string]any
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) UpsertPipelineSLASettings(ctx context.Context, tenantContext tenant.Context, request map[string]any) (map[string]any, error) {
	if !canManageStageConfig(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	pipelineID, ok := normalizeUUID(fmt.Sprint(request["pipeline_id"]))
	if !ok {
		return nil, ErrInvalidInput
	}
	stageID := strings.TrimSpace(fmt.Sprint(request["stage_id"]))
	var stageArg any
	if stageID != "" && stageID != "<nil>" {
		normalized, ok := normalizeUUID(stageID)
		if !ok {
			return nil, ErrInvalidInput
		}
		stageArg = normalized
	}
	targetHours := 24
	if value, ok := request["critical_hours"].(float64); ok && value > 0 {
		targetHours = int(value)
	}
	if value, ok := request["target_hours"].(float64); ok && value > 0 {
		targetHours = int(value)
	}

	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		with updated as (
			update public.pipeline_sla_settings
			set stage_id = $3::uuid,
			    target_hours = $4,
			    is_active = true,
			    updated_at = now()
			where organization_id = $1::uuid
			  and pipeline_id = $2::uuid
			returning *
		),
		inserted as (
			insert into public.pipeline_sla_settings (
				organization_id,
				pipeline_id,
				stage_id,
				target_hours,
				is_active
			)
			select $1::uuid, $2::uuid, $3::uuid, $4, true
			where not exists (select 1 from updated)
			returning *
		),
		item as (
			select * from updated
			union all
			select * from inserted
			limit 1
		)
		select jsonb_build_object(
			'id', id::text,
			'organization_id', organization_id::text,
			'pipeline_id', pipeline_id::text,
			'stage_id', stage_id::text,
			'warning_hours', greatest(1, floor(coalesce(target_hours, 24)::numeric / 2)::int),
			'critical_hours', coalesce(target_hours, 24),
			'sla_start_field', 'created_at',
			'created_at', created_at,
			'updated_at', updated_at
		)
		from item
	`, tenantContext.OrganizationID, pipelineID, stageArg, targetHours).Scan(&raw)
	if err != nil {
		return nil, err
	}
	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) hasDetailedOperationalSchema(ctx context.Context) (bool, error) {
	var exists bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from information_schema.columns
			where table_schema = 'public'
			  and table_name = 'stage_operational_configs'
			  and column_name = 'operation_context'
		)
	`).Scan(&exists)
	return exists, err
}

func (repo Repository) listOperationalConfigsDetailed(ctx context.Context, tenantContext tenant.Context, pipelineID string, stageID string) ([]StageOperationalConfig, error) {
	args := []any{tenantContext.OrganizationID}
	where := "soc.organization_id = $1::uuid"
	if pipelineID != "" {
		args = append(args, pipelineID)
		where += fmt.Sprintf(" and s.pipeline_id = $%d::uuid", len(args))
	}
	if stageID != "" {
		args = append(args, stageID)
		where += fmt.Sprintf(" and soc.stage_id = $%d::uuid", len(args))
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+operationalSelectDetailed()+`
		from public.stage_operational_configs soc
		join public.stages s on s.id = soc.stage_id and s.organization_id = soc.organization_id
		where `+where+`
		order by s.position asc, s.created_at asc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanOperationalRows(rows)
}

func (repo Repository) listOperationalConfigsJSON(ctx context.Context, tenantContext tenant.Context, pipelineID string, stageID string) ([]StageOperationalConfig, error) {
	args := []any{tenantContext.OrganizationID}
	where := "soc.organization_id = $1::uuid"
	if pipelineID != "" {
		args = append(args, pipelineID)
		where += fmt.Sprintf(" and s.pipeline_id = $%d::uuid", len(args))
	}
	if stageID != "" {
		args = append(args, stageID)
		where += fmt.Sprintf(" and soc.stage_id = $%d::uuid", len(args))
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+operationalSelectJSON()+`
		from public.stage_operational_configs soc
		join public.stages s on s.id = soc.stage_id and s.organization_id = soc.organization_id
		where `+where+`
		order by s.position asc, s.created_at asc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanOperationalRows(rows)
}

func (repo Repository) upsertOperationalConfigDetailed(ctx context.Context, tenantContext tenant.Context, stageID string, request StageOperationalConfigRequest) error {
	existing, err := repo.operationalConfigExists(ctx, tenantContext.OrganizationID, stageID)
	if err != nil {
		return err
	}

	if existing {
		assignments := []string{}
		args := []any{tenantContext.OrganizationID, stageID}
		add := func(column string, value any) {
			args = append(args, value)
			assignments = append(assignments, fmt.Sprintf("%s = $%d", column, len(args)))
		}
		if request.OperationContext != nil {
			add("operation_context", *request.OperationContext)
		}
		if request.ResponsibleSector != nil {
			add("responsible_sector", *request.ResponsibleSector)
		}
		if request.SLAHours != nil {
			add("sla_hours", *request.SLAHours)
		}
		addJSON := func(column string, raw *json.RawMessage) {
			if raw != nil {
				add(column, string(*raw))
				assignments[len(assignments)-1] += "::jsonb"
			}
		}
		addJSON("automatic_tasks", request.AutomaticTasks)
		addJSON("automatic_notifications", request.AutomaticNotifications)
		addJSON("automatic_operational_requests", request.AutomaticOperationalRequests)
		addJSON("checklist_template", request.ChecklistTemplate)
		addJSON("approval_flow", request.ApprovalFlow)
		if request.DashboardDestination != nil {
			add("dashboard_destination", *request.DashboardDestination)
		}
		addJSON("visibility_rules", request.VisibilityRules)
		if len(assignments) == 0 {
			return nil
		}
		assignments = append(assignments, "updated_at = now()")

		tag, err := repo.db.Pool().Exec(ctx, `
			update public.stage_operational_configs
			set `+strings.Join(assignments, ", ")+`
			where organization_id = $1::uuid
			  and stage_id = $2::uuid
		`, args...)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	}

	_, err = repo.db.Pool().Exec(ctx, `
		insert into public.stage_operational_configs (
			organization_id,
			stage_id,
			operation_context,
			responsible_sector,
			sla_hours,
			automatic_tasks,
			automatic_notifications,
			automatic_operational_requests,
			checklist_template,
			approval_flow,
			dashboard_destination,
			visibility_rules
		)
		values (
			$1::uuid,
			$2::uuid,
			$3,
			$4,
			$5,
			$6::jsonb,
			$7::jsonb,
			$8::jsonb,
			$9::jsonb,
			$10::jsonb,
			$11,
			$12::jsonb
		)
	`, tenantContext.OrganizationID, stageID, stringValue(request.OperationContext, "comercial"), stringPointerValue(request.ResponsibleSector), intValue(request.SLAHours, 24), rawJSONValue(request.AutomaticTasks), rawJSONValue(request.AutomaticNotifications), rawJSONValue(request.AutomaticOperationalRequests), rawJSONValue(request.ChecklistTemplate), rawJSONValue(request.ApprovalFlow), stringPointerValue(request.DashboardDestination), rawJSONValue(request.VisibilityRules))
	return err
}

func (repo Repository) upsertOperationalConfigJSON(ctx context.Context, tenantContext tenant.Context, stageID string, request StageOperationalConfigRequest) error {
	payload := operationalConfigPayload(request, false)
	existing, err := repo.operationalConfigExists(ctx, tenantContext.OrganizationID, stageID)
	if err != nil {
		return err
	}
	if !existing && len(payload) == 0 {
		payload = operationalConfigPayload(request, true)
	}
	if len(payload) == 0 {
		return nil
	}
	payloadJSON := jsonb(payload)

	if existing {
		tag, err := repo.db.Pool().Exec(ctx, `
			update public.stage_operational_configs
			set config = coalesce(config, '{}'::jsonb) || $3::jsonb,
			    updated_at = now()
			where organization_id = $1::uuid
			  and stage_id = $2::uuid
		`, tenantContext.OrganizationID, stageID, payloadJSON)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	}

	_, err = repo.db.Pool().Exec(ctx, `
		insert into public.stage_operational_configs (
			organization_id,
			stage_id,
			config
		)
		values ($1::uuid, $2::uuid, $3::jsonb)
	`, tenantContext.OrganizationID, stageID, payloadJSON)
	return err
}

func (repo Repository) operationalConfigExists(ctx context.Context, organizationID string, stageID string) (bool, error) {
	var exists bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.stage_operational_configs
			where organization_id = $1::uuid
			  and stage_id = $2::uuid
		)
	`, organizationID, stageID).Scan(&exists)
	return exists, err
}

func (repo Repository) ensureStage(ctx context.Context, organizationID string, stageID string) error {
	var exists bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.stages
			where organization_id = $1::uuid
			  and id = $2::uuid
		)
	`, organizationID, stageID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

func scanStageAutomation(row scanner) (StageAutomation, error) {
	var automation StageAutomation
	var configRaw pgtype.Text
	if err := row.Scan(
		&automation.ID,
		&automation.OrganizationID,
		&automation.StageID,
		&automation.TriggerType,
		&configRaw,
		&automation.IsActive,
		&automation.CreatedAt,
		&automation.UpdatedAt,
	); err != nil {
		return StageAutomation{}, err
	}
	automation.Config = jsonValue(configRaw)
	if automation.Config == nil {
		automation.Config = map[string]any{}
	}
	return automation, nil
}

func scanOperationalRows(rows pgx.Rows) ([]StageOperationalConfig, error) {
	out := []StageOperationalConfig{}
	for rows.Next() {
		item, err := scanOperationalConfig(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func scanOperationalConfig(row scanner) (StageOperationalConfig, error) {
	var item StageOperationalConfig
	var responsible, dashboard, stagePipelineID pgtype.Text
	var automaticTasks, automaticNotifications, automaticOperationalRequests pgtype.Text
	var checklistTemplate, approvalFlow, visibilityRules pgtype.Text
	var stageID, stageName string
	if err := row.Scan(
		&item.ID,
		&item.OrganizationID,
		&item.StageID,
		&item.OperationContext,
		&responsible,
		&item.SLAHours,
		&automaticTasks,
		&automaticNotifications,
		&automaticOperationalRequests,
		&checklistTemplate,
		&approvalFlow,
		&dashboard,
		&visibilityRules,
		&stageID,
		&stageName,
		&stagePipelineID,
	); err != nil {
		return StageOperationalConfig{}, err
	}

	item.ResponsibleSector = textPointer(responsible)
	item.AutomaticTasks = jsonValue(automaticTasks)
	item.AutomaticNotifications = jsonValue(automaticNotifications)
	item.AutomaticOperationalRequests = jsonValue(automaticOperationalRequests)
	item.ChecklistTemplate = jsonValue(checklistTemplate)
	item.ApprovalFlow = jsonValue(approvalFlow)
	item.DashboardDestination = textPointer(dashboard)
	item.VisibilityRules = jsonValue(visibilityRules)
	item.Stage = &StageRef{
		ID:         stageID,
		Name:       stageName,
		PipelineID: textPointer(stagePipelineID),
	}
	return item, nil
}

func stageAutomationSelectFields() string {
	return `
		id::text,
		organization_id::text,
		stage_id::text,
		trigger_type,
		coalesce(config, '{}'::jsonb)::text,
		coalesce(is_active, true),
		created_at::text,
		updated_at::text
	`
}

func operationalSelectDetailed() string {
	return `
		soc.id::text,
		soc.organization_id::text,
		soc.stage_id::text,
		coalesce(soc.operation_context, 'comercial'),
		soc.responsible_sector,
		coalesce(soc.sla_hours, 24),
		coalesce(soc.automatic_tasks, 'null'::jsonb)::text,
		coalesce(soc.automatic_notifications, 'null'::jsonb)::text,
		coalesce(soc.automatic_operational_requests, 'null'::jsonb)::text,
		coalesce(soc.checklist_template, 'null'::jsonb)::text,
		coalesce(soc.approval_flow, 'null'::jsonb)::text,
		soc.dashboard_destination,
		coalesce(soc.visibility_rules, 'null'::jsonb)::text,
		s.id::text,
		s.name,
		s.pipeline_id::text
	`
}

func operationalSelectJSON() string {
	return `
		soc.id::text,
		soc.organization_id::text,
		soc.stage_id::text,
		coalesce(soc.config->>'operation_context', 'comercial'),
		soc.config->>'responsible_sector',
		case
			when soc.config->>'sla_hours' ~ '^[0-9]+$' then (soc.config->>'sla_hours')::int
			else 24
		end,
		coalesce(soc.config->'automatic_tasks', 'null'::jsonb)::text,
		coalesce(soc.config->'automatic_notifications', 'null'::jsonb)::text,
		coalesce(soc.config->'automatic_operational_requests', 'null'::jsonb)::text,
		coalesce(soc.config->'checklist_template', 'null'::jsonb)::text,
		coalesce(soc.config->'approval_flow', 'null'::jsonb)::text,
		soc.config->>'dashboard_destination',
		coalesce(soc.config->'visibility_rules', 'null'::jsonb)::text,
		s.id::text,
		s.name,
		s.pipeline_id::text
	`
}

func operationalConfigPayload(request StageOperationalConfigRequest, includeDefaults bool) map[string]any {
	payload := map[string]any{}
	if includeDefaults {
		payload["operation_context"] = "comercial"
		payload["sla_hours"] = 24
	}
	if request.OperationContext != nil {
		payload["operation_context"] = *request.OperationContext
	}
	if request.ResponsibleSector != nil {
		payload["responsible_sector"] = *request.ResponsibleSector
	}
	if request.SLAHours != nil {
		payload["sla_hours"] = *request.SLAHours
	}
	addRawJSON := func(key string, raw *json.RawMessage) {
		if raw == nil {
			return
		}
		var value any
		if err := json.Unmarshal(*raw, &value); err == nil {
			payload[key] = value
		}
	}
	addRawJSON("automatic_tasks", request.AutomaticTasks)
	addRawJSON("automatic_notifications", request.AutomaticNotifications)
	addRawJSON("automatic_operational_requests", request.AutomaticOperationalRequests)
	addRawJSON("checklist_template", request.ChecklistTemplate)
	addRawJSON("approval_flow", request.ApprovalFlow)
	if request.DashboardDestination != nil {
		payload["dashboard_destination"] = *request.DashboardDestination
	}
	addRawJSON("visibility_rules", request.VisibilityRules)
	return payload
}

func normalizeUUID(value string) (string, bool) {
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil {
		return "", false
	}
	if !uuid.Valid {
		return "", false
	}
	return uuid.String(), true
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func jsonValue(value pgtype.Text) any {
	if !value.Valid || strings.TrimSpace(value.String) == "" || strings.TrimSpace(value.String) == "null" {
		return nil
	}
	var out any
	if err := json.Unmarshal([]byte(value.String), &out); err != nil {
		return nil
	}
	return out
}

func jsonb(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(payload)
}

func rawJSONValue(value *json.RawMessage) any {
	if value == nil {
		return nil
	}
	return string(*value)
}

func stringValue(value *string, fallback string) string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return fallback
	}
	return strings.TrimSpace(*value)
}

func stringPointerValue(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func intValue(value *int, fallback int) int {
	if value == nil {
		return fallback
	}
	return *value
}

func canManageStageConfig(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin", "manager") ||
		tenantContext.HasPermission("settings_manage") ||
		tenantContext.HasPermission("settings_pipelines") ||
		tenantContext.HasPermission("pipeline_edit") ||
		tenantContext.HasPermission("automations_edit") ||
		tenantContext.HasPermission("lead_manage")
}
