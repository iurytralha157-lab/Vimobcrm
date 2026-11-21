package automations

import (
	"context"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListTemplates(ctx context.Context, tenantContext tenant.Context) ([]AutomationTemplate, error) {
	if !canViewAutomations(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+templateSelectFields()+`
		from public.automation_templates
		where organization_id = $1::uuid
		order by created_at desc, id desc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []AutomationTemplate{}
	for rows.Next() {
		item, err := scanTemplate(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, rows.Err()
}

func (repo Repository) CreateTemplate(ctx context.Context, tenantContext tenant.Context, input CreateTemplateInput) (AutomationTemplate, error) {
	if !canManageAutomations(tenantContext) {
		return AutomationTemplate{}, tenant.ErrOrganizationAccessDenied
	}

	return scanTemplate(repo.db.Pool().QueryRow(ctx, `
		insert into public.automation_templates (
			organization_id,
			name,
			content,
			media_url,
			media_type,
			created_by
		)
		values ($1::uuid, $2, $3, $4, $5, $6::uuid)
		returning `+templateSelectFields()+`
	`, tenantContext.OrganizationID, input.Name, input.Content, input.MediaURL, input.MediaType, tenantContext.UserID))
}

func (repo Repository) DeleteTemplate(ctx context.Context, tenantContext tenant.Context, templateID string) error {
	if !canManageAutomations(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	templateID, ok := normalizeUUID(templateID)
	if !ok {
		return ErrInvalidInput
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.automation_templates
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, templateID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrTemplateNotFound
	}

	return nil
}

func templateSelectFields() string {
	return `
		id::text,
		organization_id::text,
		name,
		content,
		coalesce(media_url, ''),
		coalesce(media_type, ''),
		coalesce(created_by::text, ''),
		coalesce(created_at::text, ''),
		coalesce(updated_at::text, '')`
}

func scanTemplate(row scanner) (AutomationTemplate, error) {
	var item AutomationTemplate
	var mediaURL string
	var mediaType string
	var createdBy string
	if err := row.Scan(
		&item.ID,
		&item.OrganizationID,
		&item.Name,
		&item.Content,
		&mediaURL,
		&mediaType,
		&createdBy,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return AutomationTemplate{}, err
	}

	item.MediaURL = stringPtrFromSQL(mediaURL)
	item.MediaType = stringPtrFromSQL(mediaType)
	item.CreatedBy = stringPtrFromSQL(createdBy)
	return item, nil
}
