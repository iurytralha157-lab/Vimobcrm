package cadences

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

func (repo Repository) ListTemplates(ctx context.Context, tenantContext tenant.Context) ([]Template, error) {
	if err := repo.ensureTemplatesForStages(ctx, tenantContext); err != nil {
		return nil, err
	}

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

	metadata := taskMetadata(input)
	task, err := scanTask(repo.db.Pool().QueryRow(ctx, `
		insert into public.cadence_tasks_template (
			organization_id,
			cadence_template_id,
			title,
			type,
			delay_days,
			position,
			message_template,
			metadata
		)
		select
			ct.organization_id,
			ct.id,
			$3,
			$4,
			$5,
			$5,
			$6,
			$7::jsonb
		from public.cadence_templates ct
		where ct.organization_id = $1::uuid
		  and ct.id = $2::uuid
		returning `+taskSelectFields()+`
	`, tenantContext.OrganizationID, input.CadenceTemplateID, input.Title, input.Type, input.DayOffset, textOrNil(input.RecommendedMessage), jsonb(metadata)))
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

	task, err := scanTask(repo.db.Pool().QueryRow(ctx, `
		update public.cadence_tasks_template
		set title = $3,
		    type = $4,
		    delay_days = $5,
		    position = $5,
		    message_template = $6,
		    metadata = $7::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning `+taskSelectFields()+`
	`, tenantContext.OrganizationID, taskID, input.Title, input.Type, input.DayOffset, textOrNil(input.RecommendedMessage), jsonb(taskMetadata(input))))
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

func (repo Repository) ensureTemplatesForStages(ctx context.Context, tenantContext tenant.Context) error {
	_, err := repo.db.Pool().Exec(ctx, `
		insert into public.cadence_templates (
			organization_id,
			stage_key,
			stage_id,
			pipeline_id,
			name,
			created_by
		)
		select
			s.organization_id,
			s.stage_key,
			s.id,
			s.pipeline_id,
			s.name,
			$2::uuid
		from public.stages s
		where s.organization_id = $1::uuid
		  and not exists (
		    select 1
		    from public.cadence_templates ct
		    where ct.organization_id = s.organization_id
		      and ct.stage_id = s.id
		  )
		  and not exists (
		    select 1
		    from public.cadence_templates ct
		    where ct.organization_id = s.organization_id
		      and ct.pipeline_id = s.pipeline_id
		      and coalesce(ct.stage_key, '') = coalesce(s.stage_key, '')
		      and (ct.pipeline_id is not null or ct.stage_key is not null)
		  )
	`, tenantContext.OrganizationID, tenantContext.UserID)
	return err
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
	return tenantContext.HasPermission("settings_manage") ||
		tenantContext.HasPermission("settings_pipelines") ||
		tenantContext.HasPermission("cadences_manage") ||
		tenantContext.HasPermission("automations_edit") ||
		tenantContext.HasPermission("lead_manage")
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
