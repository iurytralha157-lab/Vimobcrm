package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var templateVariablePattern = regexp.MustCompile(`\{(\w+)\}`)

type MessageTemplate struct {
	ID             string    `json:"id"`
	OrganizationID string    `json:"organization_id"`
	Name           string    `json:"name"`
	Content        string    `json:"content"`
	Category       string    `json:"category"`
	Variables      []string  `json:"variables"`
	CreatedBy      *string   `json:"created_by"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type MessageTemplateRequest struct {
	Name      string   `json:"name"`
	Content   string   `json:"content"`
	Category  string   `json:"category,omitempty"`
	Variables []string `json:"variables,omitempty"`
}

type MessageTemplatePatchRequest struct {
	Name     templatePatchString `json:"name,omitempty"`
	Content  templatePatchString `json:"content,omitempty"`
	Category templatePatchString `json:"category,omitempty"`
}

type templatePatchString struct {
	Set   bool
	Value *string
}

type messageTemplateInput struct {
	Name      string
	Content   string
	Category  string
	Variables []string
}

type messageTemplatePatchInput struct {
	NameSet      bool
	Name         string
	ContentSet   bool
	Content      string
	CategorySet  bool
	Category     *string
	VariablesSet bool
	Variables    []string
}

func (field *templatePatchString) UnmarshalJSON(data []byte) error {
	field.Set = true
	if strings.TrimSpace(string(data)) == "null" {
		field.Value = nil
		return nil
	}

	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return fmt.Errorf("%w: expected string or null", ErrInvalidInput)
	}
	field.Value = &value
	return nil
}

func (request MessageTemplateRequest) Validate() (messageTemplateInput, error) {
	name := trimTemplateString(request.Name, 120)
	if len([]rune(name)) < 2 {
		return messageTemplateInput{}, fmt.Errorf("%w: name must have at least 2 characters", ErrInvalidInput)
	}

	content := trimTemplateString(request.Content, 4_000)
	if content == "" {
		return messageTemplateInput{}, fmt.Errorf("%w: content is required", ErrInvalidInput)
	}

	category := trimTemplateString(request.Category, 80)
	if category == "" {
		category = "geral"
	}

	return messageTemplateInput{
		Name:      name,
		Content:   content,
		Category:  category,
		Variables: extractTemplateVariables(content),
	}, nil
}

func (request MessageTemplatePatchRequest) Validate() (messageTemplatePatchInput, error) {
	input := messageTemplatePatchInput{}

	if request.Name.Set {
		if request.Name.Value == nil {
			return messageTemplatePatchInput{}, fmt.Errorf("%w: name cannot be null", ErrInvalidInput)
		}
		input.Name = trimTemplateString(*request.Name.Value, 120)
		if len([]rune(input.Name)) < 2 {
			return messageTemplatePatchInput{}, fmt.Errorf("%w: name must have at least 2 characters", ErrInvalidInput)
		}
		input.NameSet = true
	}

	if request.Content.Set {
		if request.Content.Value == nil {
			return messageTemplatePatchInput{}, fmt.Errorf("%w: content cannot be null", ErrInvalidInput)
		}
		input.Content = trimTemplateString(*request.Content.Value, 4_000)
		if input.Content == "" {
			return messageTemplatePatchInput{}, fmt.Errorf("%w: content is required", ErrInvalidInput)
		}
		input.ContentSet = true
		input.VariablesSet = true
		input.Variables = extractTemplateVariables(input.Content)
	}

	if request.Category.Set {
		input.CategorySet = true
		if request.Category.Value != nil {
			category := trimTemplateString(*request.Category.Value, 80)
			if category == "" {
				category = "geral"
			}
			input.Category = &category
		}
	}

	if !input.NameSet && !input.ContentSet && !input.CategorySet {
		return messageTemplatePatchInput{}, fmt.Errorf("%w: at least one field is required", ErrInvalidInput)
	}

	return input, nil
}

func (repo Repository) ListMessageTemplates(ctx context.Context, tenantContext tenant.Context) ([]MessageTemplate, error) {
	hasCategory, err := repo.whatsappTemplatesHasColumn(ctx, "category")
	if err != nil {
		return nil, err
	}

	orderBy := "name asc"
	if hasCategory {
		orderBy = "category asc nulls last, name asc"
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+messageTemplateSelectFields(hasCategory)+`
		from public.whatsapp_message_templates
		where organization_id = $1::uuid
		order by `+orderBy+`, id asc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	templates := []MessageTemplate{}
	for rows.Next() {
		template, err := scanMessageTemplate(rows)
		if err != nil {
			return nil, err
		}
		templates = append(templates, template)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return templates, nil
}

func (repo Repository) CreateMessageTemplate(ctx context.Context, tenantContext tenant.Context, input messageTemplateInput) (MessageTemplate, error) {
	if !canManageWhatsApp(tenantContext) {
		return MessageTemplate{}, tenant.ErrOrganizationAccessDenied
	}

	hasCategory, err := repo.whatsappTemplatesHasColumn(ctx, "category")
	if err != nil {
		return MessageTemplate{}, err
	}

	var id string
	if hasCategory {
		err = repo.db.Pool().QueryRow(ctx, `
			insert into public.whatsapp_message_templates (
				organization_id,
				name,
				content,
				category,
				variables,
				created_by
			)
			values ($1::uuid, $2, $3, $4, $5, $6::uuid)
			returning id::text
		`, tenantContext.OrganizationID, input.Name, input.Content, input.Category, pgtype.FlatArray[string](input.Variables), tenantContext.UserID).Scan(&id)
	} else {
		err = repo.db.Pool().QueryRow(ctx, `
			insert into public.whatsapp_message_templates (
				organization_id,
				name,
				content,
				variables,
				created_by
			)
			values ($1::uuid, $2, $3, $4, $5::uuid)
			returning id::text
		`, tenantContext.OrganizationID, input.Name, input.Content, pgtype.FlatArray[string](input.Variables), tenantContext.UserID).Scan(&id)
	}
	if err != nil {
		return MessageTemplate{}, err
	}

	return repo.GetMessageTemplate(ctx, tenantContext, id)
}

func (repo Repository) UpdateMessageTemplate(ctx context.Context, tenantContext tenant.Context, templateID string, input messageTemplatePatchInput) (MessageTemplate, error) {
	if !canManageWhatsApp(tenantContext) {
		return MessageTemplate{}, tenant.ErrOrganizationAccessDenied
	}

	templateID, ok := normalizeUUID(templateID)
	if !ok {
		return MessageTemplate{}, ErrInvalidReference
	}

	hasCategory, err := repo.whatsappTemplatesHasColumn(ctx, "category")
	if err != nil {
		return MessageTemplate{}, err
	}

	args := []any{tenantContext.OrganizationID, templateID}
	assignments := []string{}
	addAssignment := func(column string, value any) {
		args = append(args, value)
		assignments = append(assignments, fmt.Sprintf("%s = $%d", column, len(args)))
	}

	if input.NameSet {
		addAssignment("name", input.Name)
	}
	if input.ContentSet {
		addAssignment("content", input.Content)
	}
	if input.CategorySet && hasCategory {
		addAssignment("category", input.Category)
	}
	if input.VariablesSet {
		addAssignment("variables", pgtype.FlatArray[string](input.Variables))
	}
	assignments = append(assignments, "updated_at = now()")

	tag, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_message_templates
		set `+strings.Join(assignments, ", ")+`
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, args...)
	if err != nil {
		return MessageTemplate{}, err
	}
	if tag.RowsAffected() == 0 {
		return MessageTemplate{}, ErrInvalidReference
	}

	return repo.GetMessageTemplate(ctx, tenantContext, templateID)
}

func (repo Repository) DeleteMessageTemplate(ctx context.Context, tenantContext tenant.Context, templateID string) error {
	if !canManageWhatsApp(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	templateID, ok := normalizeUUID(templateID)
	if !ok {
		return ErrInvalidReference
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.whatsapp_message_templates
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, templateID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrInvalidReference
	}

	return nil
}

func (repo Repository) GetMessageTemplate(ctx context.Context, tenantContext tenant.Context, templateID string) (MessageTemplate, error) {
	templateID, ok := normalizeUUID(templateID)
	if !ok {
		return MessageTemplate{}, ErrInvalidReference
	}

	hasCategory, err := repo.whatsappTemplatesHasColumn(ctx, "category")
	if err != nil {
		return MessageTemplate{}, err
	}

	template, err := scanMessageTemplate(repo.db.Pool().QueryRow(ctx, `
		select `+messageTemplateSelectFields(hasCategory)+`
		from public.whatsapp_message_templates
		where organization_id = $1::uuid
		  and id = $2::uuid
		limit 1
	`, tenantContext.OrganizationID, templateID))
	if errors.Is(err, pgx.ErrNoRows) {
		return MessageTemplate{}, ErrInvalidReference
	}
	if err != nil {
		return MessageTemplate{}, err
	}

	return template, nil
}

func (repo Repository) whatsappTemplatesHasColumn(ctx context.Context, column string) (bool, error) {
	var exists bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from information_schema.columns
			where table_schema = 'public'
			  and table_name = 'whatsapp_message_templates'
			  and column_name = $1
		)
	`, column).Scan(&exists)

	return exists, err
}

func messageTemplateSelectFields(hasCategory bool) string {
	categoryExpression := "'geral'::text"
	if hasCategory {
		categoryExpression = "coalesce(category, 'geral')"
	}

	return `
		id::text,
		organization_id::text,
		name,
		content,
		` + categoryExpression + `,
		coalesce(to_jsonb(variables), '[]'::jsonb)::text,
		created_by::text,
		created_at,
		updated_at`
}

func scanMessageTemplate(row scanner) (MessageTemplate, error) {
	var template MessageTemplate
	var category, createdBy pgtype.Text
	var variablesJSON string

	err := row.Scan(
		&template.ID,
		&template.OrganizationID,
		&template.Name,
		&template.Content,
		&category,
		&variablesJSON,
		&createdBy,
		&template.CreatedAt,
		&template.UpdatedAt,
	)
	if err != nil {
		return MessageTemplate{}, err
	}

	template.Category = textValue(category)
	if template.Category == "" {
		template.Category = "geral"
	}
	template.CreatedBy = textPtr(createdBy)
	if variablesJSON != "" {
		if err := json.Unmarshal([]byte(variablesJSON), &template.Variables); err != nil {
			return MessageTemplate{}, err
		}
	}
	if template.Variables == nil {
		template.Variables = []string{}
	}

	return template, nil
}

func extractTemplateVariables(content string) []string {
	matches := templateVariablePattern.FindAllStringSubmatch(content, -1)
	seen := map[string]struct{}{}
	variables := []string{}

	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		value := strings.ToLower(strings.TrimSpace(match[1]))
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		variables = append(variables, value)
	}

	return variables
}

func trimTemplateString(value string, maxLength int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > maxLength {
		return string(runes[:maxLength])
	}

	return value
}
