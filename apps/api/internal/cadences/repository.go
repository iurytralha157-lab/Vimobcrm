package cadences

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/authorization"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
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

func (repo Repository) ListTemplates(ctx context.Context, tenantContext tenant.Context) ([]Template, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			id::text,
			organization_id::text,
			pipeline_id::text,
			stage_id::text,
			stage_key,
			name,
			description,
			coalesce(is_active, true),
			created_at::text,
			updated_at::text
		from public.cadence_templates
		where organization_id = $1::uuid
		order by stage_key asc nulls last, name asc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	templates := []Template{}
	for rows.Next() {
		template, err := scanTemplate(rows)
		if err != nil {
			return nil, err
		}
		templates = append(templates, template)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(templates) == 0 {
		return []Template{}, nil
	}

	templateIDs := make([]string, 0, len(templates))
	indexByID := map[string]int{}
	for index, template := range templates {
		templateIDs = append(templateIDs, template.ID)
		indexByID[template.ID] = index
	}

	tasksByTemplate, err := repo.tasksByTemplate(ctx, tenantContext.OrganizationID, templateIDs)
	if err != nil {
		return nil, err
	}
	for templateID, tasks := range tasksByTemplate {
		if index, ok := indexByID[templateID]; ok {
			templates[index].Tasks = tasks
		}
	}
	for index := range templates {
		if templates[index].Tasks == nil {
			templates[index].Tasks = []TaskTemplate{}
		}
	}

	return templates, nil
}

func (repo Repository) CreateTask(ctx context.Context, tenantContext tenant.Context, request TaskRequest) (TaskTemplate, error) {
	if !canEditCadences(tenantContext) {
		return TaskTemplate{}, tenant.ErrOrganizationAccessDenied
	}
	input, err := normalizeTaskInput(taskInput{
		CadenceTemplateID:  request.CadenceTemplateID,
		DayOffset:          request.DayOffset,
		Type:               request.Type,
		Title:              request.Title,
		Description:        request.Description,
		Observation:        request.Observation,
		RecommendedMessage: request.RecommendedMessage,
	}, true)
	if err != nil {
		return TaskTemplate{}, err
	}
	if err := repo.ensureLegacyTemplateMutable(ctx, tenantContext.OrganizationID, input.CadenceTemplateID); err != nil {
		return TaskTemplate{}, err
	}

	metadata := taskMetadata(input)
	task, err := scanTask(repo.db.Pool().QueryRow(ctx, `
		insert into public.cadence_tasks_template (
			organization_id,
			cadence_template_id,
			title,
			description,
			type,
			day_offset,
			delay_days,
			due_minutes,
			position,
			observation,
			recommended_message,
			message_template,
			is_required,
			outcome_required,
			metadata
		)
		select
			ct.organization_id,
			ct.id,
			$3,
			$4,
			$5,
			$6,
			$6,
			$6 * 1440,
			$6,
			$7,
			$8,
			$8,
			true,
			false,
			$9::jsonb
		from public.cadence_templates ct
		where ct.organization_id = $1::uuid
		  and ct.id = $2::uuid
		returning `+taskSelectFields()+`
	`, tenantContext.OrganizationID, input.CadenceTemplateID,
		input.Title, textOrNil(input.Description), input.Type, input.DayOffset,
		textOrNil(input.Observation), textOrNil(input.RecommendedMessage), jsonb(metadata)))
	if errors.Is(err, pgx.ErrNoRows) {
		return TaskTemplate{}, ErrCadenceNotFound
	}
	return task, err
}

func (repo Repository) UpdateTask(ctx context.Context, tenantContext tenant.Context, taskID string, request UpdateTaskRequest) (TaskTemplate, error) {
	if !canEditCadences(tenantContext) {
		return TaskTemplate{}, tenant.ErrOrganizationAccessDenied
	}
	taskID, ok := normalizeUUID(taskID)
	if !ok {
		return TaskTemplate{}, ErrInvalidInput
	}
	input, err := normalizeTaskInput(taskInput{
		DayOffset:          request.DayOffset,
		Type:               request.Type,
		Title:              request.Title,
		Description:        request.Description,
		Observation:        request.Observation,
		RecommendedMessage: request.RecommendedMessage,
	}, false)
	if err != nil {
		return TaskTemplate{}, err
	}
	if err := repo.ensureLegacyTaskMutable(ctx, tenantContext.OrganizationID, taskID); err != nil {
		return TaskTemplate{}, err
	}

	task, err := scanTask(repo.db.Pool().QueryRow(ctx, `
		update public.cadence_tasks_template
		set title = $3,
		    description = $4,
		    type = $5,
		    day_offset = $6,
		    delay_days = $6,
		    due_minutes = $6 * 1440,
		    position = $6,
		    observation = $7,
		    recommended_message = $8,
		    message_template = $8,
		    metadata = $9::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning `+taskSelectFields()+`
	`, tenantContext.OrganizationID, taskID,
		input.Title, textOrNil(input.Description), input.Type, input.DayOffset,
		textOrNil(input.Observation), textOrNil(input.RecommendedMessage), jsonb(taskMetadata(input))))
	if errors.Is(err, pgx.ErrNoRows) {
		return TaskTemplate{}, ErrCadenceNotFound
	}
	return task, err
}

func (repo Repository) DeleteTask(ctx context.Context, tenantContext tenant.Context, taskID string) error {
	if !canEditCadences(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	taskID, ok := normalizeUUID(taskID)
	if !ok {
		return ErrInvalidInput
	}
	if err := repo.ensureLegacyTaskMutable(ctx, tenantContext.OrganizationID, taskID); err != nil {
		return err
	}
	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.cadence_tasks_template
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, taskID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrCadenceNotFound
	}
	return nil
}

func (repo Repository) ensureLegacyTemplateMutable(
	ctx context.Context,
	organizationID string,
	templateID string,
) error {
	var exists, managed bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select
		  exists (
		    select 1
		    from public.cadence_templates template
		    where template.organization_id = $1::uuid
		      and template.id = $2::uuid
		  ),
		  exists (
		    select 1
		    from public.stage_operational_configs rule
		    where rule.organization_id = $1::uuid
		      and coalesce(rule.config->>'operational_rules_version', '') = '1'
		      and nullif(rule.config->>'cadence_template_id', '') = $2
		  )
	`, organizationID, templateID).Scan(&exists, &managed); err != nil {
		return err
	}
	if !exists {
		return ErrCadenceNotFound
	}
	if managed {
		return ErrOperationalTemplateManaged
	}
	return nil
}

func (repo Repository) ensureLegacyTaskMutable(
	ctx context.Context,
	organizationID string,
	taskID string,
) error {
	var templateID string
	err := repo.db.Pool().QueryRow(ctx, `
		select task.cadence_template_id::text
		from public.cadence_tasks_template task
		where task.organization_id = $1::uuid
		  and task.id = $2::uuid
	`, organizationID, taskID).Scan(&templateID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrCadenceNotFound
	}
	if err != nil {
		return err
	}
	return repo.ensureLegacyTemplateMutable(ctx, organizationID, templateID)
}

func (repo Repository) SwitchLeadCadence(ctx context.Context, tenantContext tenant.Context, leadID string, request SwitchCadenceRequest) (SwitchCadenceResult, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return SwitchCadenceResult{}, ErrInvalidInput
	}
	templateID, ok := normalizeUUID(request.CadenceTemplateID)
	if !ok {
		return SwitchCadenceResult{}, ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return SwitchCadenceResult{}, err
	}
	defer tx.Rollback(ctx)

	// Authorization and mutation share the same locked lead snapshot. Without
	// this lock, a reassignment between the permission check and the private
	// cadence switch could let the previous owner mutate the lead.
	var assignedUserID, teamID pgtype.Text
	err = tx.QueryRow(ctx, `
		select assigned_user_id::text, team_id::text
		from public.leads
		where organization_id = $1::uuid and id = $2::uuid
		for update
	`, tenantContext.OrganizationID, leadID).Scan(&assignedUserID, &teamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return SwitchCadenceResult{}, ErrCadenceNotFound
	}
	if err != nil {
		return SwitchCadenceResult{}, err
	}
	if !authorization.CanOperateLead(tenantContext, authorization.LeadResource{
		AssignedUserID: textValue(assignedUserID),
		TeamID:         textValue(teamID),
	}) {
		return SwitchCadenceResult{}, tenant.ErrOrganizationAccessDenied
	}

	var enrollmentID string
	err = tx.QueryRow(ctx, `
		select private.switch_lead_cadence($1::uuid, $2::uuid, $3::uuid, $4::uuid)::text
	`, tenantContext.OrganizationID, leadID, templateID, tenantContext.UserID).Scan(&enrollmentID)
	if err != nil {
		message := err.Error()
		if strings.Contains(message, "cadence_template_not_found") ||
			strings.Contains(message, "cadence_lead_not_found") {
			return SwitchCadenceResult{}, ErrCadenceNotFound
		}
		if strings.Contains(message, "cadence_lead_not_open") ||
			strings.Contains(message, "cadence_stage_cycle_not_found") ||
			strings.Contains(message, "cadence_stage_rule_disabled") ||
			strings.Contains(message, "cadence_historical_cycle") ||
			strings.Contains(message, "cadence_template_incompatible") ||
			strings.Contains(message, "cadence_template_empty") {
			return SwitchCadenceResult{}, ErrInvalidInput
		}
		return SwitchCadenceResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return SwitchCadenceResult{}, err
	}
	return SwitchCadenceResult{EnrollmentID: enrollmentID, LeadID: leadID, CadenceTemplateID: templateID}, nil
}

func (repo Repository) tasksByTemplate(ctx context.Context, organizationID string, templateIDs []string) (map[string][]TaskTemplate, error) {
	if len(templateIDs) == 0 {
		return map[string][]TaskTemplate{}, nil
	}
	args := []any{organizationID}
	placeholders := []string{}
	for _, templateID := range templateIDs {
		args = append(args, templateID)
		placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", len(args)))
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+taskSelectFields()+`
		from public.cadence_tasks_template
		where organization_id = $1::uuid
		  and cadence_template_id in (`+strings.Join(placeholders, ", ")+`)
		order by delay_days asc, position asc, created_at asc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[string][]TaskTemplate{}
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		result[task.CadenceTemplateID] = append(result[task.CadenceTemplateID], task)
	}
	return result, rows.Err()
}

func scanTemplate(row scanner) (Template, error) {
	var template Template
	var pipelineID, stageID, stageKey, description, updatedAt pgtype.Text
	if err := row.Scan(
		&template.ID,
		&template.OrganizationID,
		&pipelineID,
		&stageID,
		&stageKey,
		&template.Name,
		&description,
		&template.IsActive,
		&template.CreatedAt,
		&updatedAt,
	); err != nil {
		return Template{}, err
	}
	template.PipelineID = textPointer(pipelineID)
	template.StageID = textPointer(stageID)
	template.StageKey = textPointer(stageKey)
	template.Description = textPointer(description)
	template.UpdatedAt = textPointer(updatedAt)
	template.Tasks = []TaskTemplate{}
	return template, nil
}

func scanTask(row scanner) (TaskTemplate, error) {
	var task TaskTemplate
	var messageTemplate, metadataRaw pgtype.Text
	var taskType pgtype.Text
	var position pgtype.Int4
	if err := row.Scan(
		&task.ID,
		&task.CadenceTemplateID,
		&task.DayOffset,
		&task.Title,
		&taskType,
		&position,
		&messageTemplate,
		&metadataRaw,
	); err != nil {
		return TaskTemplate{}, err
	}
	task.Type = textPointer(taskType)
	if position.Valid {
		value := int(position.Int32)
		task.Position = &value
	}
	metadata := parseObject(textValue(metadataRaw))
	task.Description = stringPointerFromMap(metadata, "description")
	task.Observation = stringPointerFromMap(metadata, "observation")
	task.RecommendedMessage = textPointer(messageTemplate)
	if task.RecommendedMessage == nil {
		task.RecommendedMessage = stringPointerFromMap(metadata, "recommended_message")
	}
	return task, nil
}

func taskSelectFields() string {
	return `
		id::text,
		cadence_template_id::text,
		delay_days,
		title,
		type,
		position,
		message_template,
		metadata::text
	`
}

func normalizeTaskInput(input taskInput, requireTemplate bool) (taskInput, error) {
	if requireTemplate {
		value, ok := normalizeUUID(input.CadenceTemplateID)
		if !ok {
			return taskInput{}, ErrInvalidInput
		}
		input.CadenceTemplateID = value
	}
	input.Title = strings.TrimSpace(input.Title)
	input.Type = strings.TrimSpace(input.Type)
	if input.Title == "" || input.Type == "" || input.DayOffset < 0 {
		return taskInput{}, ErrInvalidInput
	}
	input.Description = cleanStringPointer(input.Description)
	input.Observation = cleanStringPointer(input.Observation)
	input.RecommendedMessage = cleanStringPointer(input.RecommendedMessage)
	return input, nil
}

func taskMetadata(input taskInput) map[string]any {
	return map[string]any{
		"description":         pointerValue(input.Description),
		"observation":         pointerValue(input.Observation),
		"recommended_message": pointerValue(input.RecommendedMessage),
	}
}

func canEditCadences(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission(permissions.PipelineManage) ||
		tenantContext.HasPermission(permissions.AutomationsManage)
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

func cleanStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}

func pointerValue(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func textOrNil(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func parseObject(raw string) map[string]any {
	if strings.TrimSpace(raw) == "" {
		return map[string]any{}
	}
	out := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return map[string]any{}
	}
	return out
}

func stringPointerFromMap(value map[string]any, key string) *string {
	raw, ok := value[key]
	if !ok || raw == nil {
		return nil
	}
	text, ok := raw.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return nil
	}
	text = strings.TrimSpace(text)
	return &text
}

func jsonb(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(payload)
}
